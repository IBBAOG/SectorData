"""
ANP CDP daily-panel roster canary (OPS alert).

The blind spot this covers: ANP's daily production Power BI panel can lag its
own monthly CDP publication on the DIMENSION side — a brand-new installation
(and its wells) shows up in the monthly well-level data (anp_cdp_producao)
months before ANP adds it to the daily panel's well/installation dimensions.
Real case: FPSO P-78 ('PETROBRAS 78' in instalacao_destino) and its 2 wells
(~87 kbpd) were absent from the daily panel for ~5 months and we only caught it
by accident. No freshness/failure monitor can see this — every workflow is
green and every base advances daily; the data is simply incomplete upstream.

How it works (pure read-only SQL over OUR tables — no Power BI calls):
  1. Pick the latest COMPLETE month in anp_cdp_producao (a month is accepted
     when its producing-well row count is >= 70% of the previous month's —
     guards against a partially-ingested month at the publication boundary).
  2. Reference roster = wells of that month with material production
     (> MIN_WELL_KBPD, default 1 kbpd).
  3. Observed roster = wells seen in anp_cdp_diaria_poco in the last
     DAILY_WINDOW_DAYS days of DATA (relative to MAX(data), not today —
     the daily frontier structurally lags D-6/D-8).
  4. Missing = reference wells absent from the observed roster (normalized
     name match). Same idea for installations (instalacao_destino vs
     anp_cdp_diaria_instalacao.instalacao) with a fuzzy, generous match —
     naming differs across the two sources ('PETROBRAS 78' vs 'FPSO ...'),
     and a false negative here is cheap because the WELL check is the one
     that gates the alert.
  5. Email ops ONLY when the missing wells' aggregate monthly production
     exceeds ALERT_THRESHOLD_KBPD (default 10 kbpd) — listing each well, its
     kbpd and its installation. Below the threshold: log-only.

Failure semantics (mirrors freshness_monitor): the workflow goes RED only when
the CHECK ITSELF breaks (env/RPC/SMTP error). A roster gap is a DATA condition
— it emails and exits 0.

Known benign causes of a listed well (kept in the email footer): a well shut in
for maintenance after the reference month, or a name-format drift between the
monthly CSV and the daily panel. The aggregate-kbpd threshold keeps this noise
below the paging bar.

Env gate (reuses scripts/client_alerts/_core/config.validate):
  Required: SUPABASE_URL, a service key (SUPABASE_SERVICE_KEY or
  SUPABASE_SERVICE_ROLE_KEY), GMAIL_APP_PASSWORD.

Recipient: ALERTAS_DEST_EMAIL (default eduardo.mendes@itaubba.com).

Run:  python -m scripts.cdp_roster_canary
"""
from __future__ import annotations

import html as html_lib
import logging
import os
import re
import sys
import unicodedata
from datetime import date, datetime, timedelta, timezone

from scripts.client_alerts._core import config
from scripts.client_alerts._core.gmail_client import send_email, validate_api_key
from scripts.client_alerts._core.supabase_client import get_client

logger = logging.getLogger("cdp_roster_canary")

# ── Recipient ─────────────────────────────────────────────────────────────────
DEST_EMAIL: str = os.environ.get("ALERTAS_DEST_EMAIL", "eduardo.mendes@itaubba.com")

# ── Tunables ──────────────────────────────────────────────────────────────────
# A reference-roster well must average more than this in the monthly data to be
# tracked at all (filters ~6 500 marginal/shut-in wells down to the ~250 that
# actually move the needle).
MIN_WELL_KBPD = 1.0
# Aggregate monthly production of the missing wells that triggers the email.
ALERT_THRESHOLD_KBPD = 10.0
# Daily-roster lookback, in days of DATA (relative to MAX(data) in the daily
# well table, NOT relative to today — the daily frontier lags D-6/D-8).
DAILY_WINDOW_DAYS = 10
# A candidate reference month is "complete" when its producing-well row count is
# at least this fraction of the previous month's.
MONTH_COMPLETENESS_RATIO = 0.70
# How many months to step back looking for a complete month before giving up.
MAX_MONTH_STEPS = 3

BBL_PER_KBPD = 1000.0
_PAGE = 1000  # PostgREST page size


# ── Name normalization ────────────────────────────────────────────────────────
def _strip_accents(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
    )


def norm_well(name: str | None) -> str:
    """
    Normalize a well name for cross-source matching: uppercase, accent-strip,
    drop any parenthetical designation (the daily 'NOME POÇO ANP' may carry
    one), collapse whitespace. Both sources use the standard ANP well code
    (e.g. '7-BUZ-79-RJS'), so after this the match is exact.
    """
    if not name:
        return ""
    s = _strip_accents(str(name)).upper()
    s = re.sub(r"\s*\(.*?\)\s*", " ", s)   # drop parenthetical designations
    s = re.sub(r"\s+", " ", s).strip()
    return s


# Generic installation-type/filler tokens carrying no identity.
_INST_GENERIC_TOKENS = {
    "FPSO", "FSO", "FPU", "UEP", "SS", "PLATAFORMA", "NAVIO", "POLO",
    "DE", "DO", "DA", "DOS", "DAS", "E",
}


def _inst_tokens(name: str | None) -> tuple[set[str], set[str]]:
    """
    Identity tokens of an installation name, split into (digits, alpha).
    Normalized, generics and single-letter alpha removed ('P' in 'P-78' carries
    no identity — the number does).
    """
    if not name:
        return set(), set()
    s = _strip_accents(str(name)).upper()
    s = re.sub(r"[^A-Z0-9]+", " ", s)
    tokens = {t for t in s.split() if t and t not in _INST_GENERIC_TOKENS}
    digits = {t for t in tokens if t.isdigit()}
    alpha = {t for t in tokens - digits if len(t) >= 2}
    return digits, alpha


def inst_matches(monthly_name: str, daily_names: list[str]) -> bool:
    """
    Fuzzy-tolerant installation match. Naming differs across sources (monthly
    instalacao_destino vs the daily panel's labels), so the rules are generous
    BUT digit-aware — both sources use platform-fleet names ('PETROBRAS 78',
    'P-78') where the NUMBER is the identity and the fleet word is not:
      (a) numbered platforms: a shared digit token is required, and the alpha
          tokens must not contradict (overlap, or one side has none);
      (b) unnumbered installations: any shared alpha token, or normalized
          substring containment either way. The containment fallback is
          SKIPPED when both sides carry digit tokens that are disjoint —
          '8 PETROBRAS' is a substring of '78 PETROBRAS' but the numbers
          contradict, so it must not count as a match.
    Generous = an installation is only listed as missing when nothing in the
    daily roster plausibly refers to it — a false negative here is cheap
    because the well-level check is the one that gates the alert.
    """
    m_digits, m_alpha = _inst_tokens(monthly_name)
    if not m_digits and not m_alpha:
        return True  # unattributed/blank — nothing to look for
    m_norm = " ".join(sorted(m_digits | m_alpha))
    for d in daily_names:
        d_digits, d_alpha = _inst_tokens(d)
        if m_digits:
            # Numbered platform: the number must agree; the fleet/alpha part
            # must overlap or be absent on either side.
            if (m_digits & d_digits) and (m_alpha & d_alpha or not m_alpha or not d_alpha):
                return True
        elif m_alpha & d_alpha:
            return True
        if m_digits and d_digits and not (m_digits & d_digits):
            # Both sides numbered but the numbers contradict (e.g. monthly
            # 'PETROBRAS 8' vs daily 'PETROBRAS 78') — containment would leak
            # a match here ('8 PETROBRAS' ⊂ '78 PETROBRAS'). Not a match.
            continue
        d_norm = " ".join(sorted(d_digits | d_alpha))
        if d_norm and (m_norm in d_norm or d_norm in m_norm):
            return True
    return False


# ── Supabase fetch helpers (read-only SELECTs, paged) ─────────────────────────
def _fetch_all(table: str, columns: str, filters: list[tuple[str, str, object]],
               order_by: tuple[str, ...]) -> list[dict]:
    """
    Page through a PostgREST SELECT (Supabase caps a request at ~1000 rows).
    `order_by` must be a total order (the PK) — without it PostgREST does not
    guarantee stable page boundaries, so rows could be skipped/duplicated
    across pages.
    """
    client = get_client()
    out: list[dict] = []
    start = 0
    while True:
        q = client.table(table).select(columns)
        for col, op, val in filters:
            q = q.filter(col, op, val)
        for col in order_by:
            q = q.order(col)
        resp = q.range(start, start + _PAGE - 1).execute()
        batch = resp.data or []
        out.extend(batch)
        if len(batch) < _PAGE:
            return out
        start += _PAGE


def _month_producing_count(ano: int, mes: int) -> int:
    """Count producing-well rows (petroleo > 0) of a monthly CDP month."""
    client = get_client()
    resp = (
        client.table("anp_cdp_producao")
        .select("poco", count="exact", head=True)
        .filter("ano", "eq", ano)
        .filter("mes", "eq", mes)
        .filter("petroleo_bbl_dia", "gt", 0)
        .execute()
    )
    return resp.count or 0


def _prev_month(ano: int, mes: int) -> tuple[int, int]:
    return (ano - 1, 12) if mes == 1 else (ano, mes - 1)


def pick_reference_month() -> tuple[int, int]:
    """
    Latest month in anp_cdp_producao whose producing-well count is >=
    MONTH_COMPLETENESS_RATIO of the previous month's (a partial month at the
    publication boundary fails this and we step back).
    """
    client = get_client()
    resp = (
        client.table("anp_cdp_producao")
        .select("ano,mes")
        .order("ano", desc=True)
        .order("mes", desc=True)
        .limit(1)
        .execute()
    )
    if not resp.data:
        raise RuntimeError("anp_cdp_producao is empty — no reference month")
    ano, mes = int(resp.data[0]["ano"]), int(resp.data[0]["mes"])

    for _ in range(MAX_MONTH_STEPS):
        p_ano, p_mes = _prev_month(ano, mes)
        n_cur = _month_producing_count(ano, mes)
        n_prev = _month_producing_count(p_ano, p_mes)
        if n_prev == 0 or n_cur >= MONTH_COMPLETENESS_RATIO * n_prev:
            logger.info(
                "Reference month %04d-%02d (%d producing wells; previous month %d)",
                ano, mes, n_cur, n_prev,
            )
            return ano, mes
        logger.info(
            "Month %04d-%02d looks partial (%d wells vs %d previous) — stepping back",
            ano, mes, n_cur, n_prev,
        )
        ano, mes = p_ano, p_mes
    logger.warning("No clearly-complete month within %d steps — using %04d-%02d",
                   MAX_MONTH_STEPS, ano, mes)
    return ano, mes


# ── Core check ────────────────────────────────────────────────────────────────
class MissingWell:
    __slots__ = ("poco", "campo", "instalacao", "kbpd")

    def __init__(self, poco: str, campo: str | None, instalacao: str | None, kbpd: float):
        self.poco = poco
        self.campo = campo or "—"
        self.instalacao = instalacao or "—"
        self.kbpd = kbpd


def run_check() -> tuple[tuple[int, int], date, list[MissingWell], list[str], float]:
    """
    Execute the roster comparison.

    Returns (reference (ano, mes), daily frontier date, missing wells sorted by
    kbpd desc, missing installations, total missing kbpd).
    """
    ano, mes = pick_reference_month()

    # Reference roster: material wells of the reference month (> MIN_WELL_KBPD).
    # ~250 rows — the server-side petroleo filter does the heavy lifting.
    monthly_rows = _fetch_all(
        "anp_cdp_producao",
        "poco,campo,instalacao_destino,petroleo_bbl_dia",
        [
            ("ano", "eq", ano),
            ("mes", "eq", mes),
            ("petroleo_bbl_dia", "gt", MIN_WELL_KBPD * BBL_PER_KBPD),
        ],
        order_by=("poco", "campo", "bacia", "local"),  # PK remainder (ano,mes fixed)
    )
    # Sum per well (defensive: the natural key is wider than poco).
    ref: dict[str, MissingWell] = {}
    for r in monthly_rows:
        key = norm_well(r.get("poco"))
        if not key:
            continue
        kbpd = (r.get("petroleo_bbl_dia") or 0.0) / BBL_PER_KBPD
        if key in ref:
            ref[key].kbpd += kbpd
        else:
            ref[key] = MissingWell(
                str(r.get("poco")), r.get("campo"), r.get("instalacao_destino"), kbpd
            )
    logger.info("Reference roster: %d wells > %.0f kbpd in %04d-%02d",
                len(ref), MIN_WELL_KBPD, ano, mes)

    # Observed daily roster, relative to the daily frontier (not today).
    client = get_client()
    resp = (
        client.table("anp_cdp_diaria_poco")
        .select("data")
        .order("data", desc=True)
        .limit(1)
        .execute()
    )
    if not resp.data:
        raise RuntimeError("anp_cdp_diaria_poco is empty — no daily roster")
    frontier = date.fromisoformat(str(resp.data[0]["data"]))
    cutoff = frontier - timedelta(days=DAILY_WINDOW_DAYS)

    daily_rows = _fetch_all("anp_cdp_diaria_poco", "poco",
                            [("data", "gte", cutoff.isoformat())],
                            order_by=("data", "poco"))  # PK
    observed = {norm_well(r.get("poco")) for r in daily_rows}
    observed.discard("")
    logger.info("Observed daily roster: %d distinct wells in (%s → %s]",
                len(observed), cutoff.isoformat(), frontier.isoformat())

    missing = sorted(
        (w for k, w in ref.items() if k not in observed),
        key=lambda w: -w.kbpd,
    )
    total_missing_kbpd = sum(w.kbpd for w in missing)

    # Installation comparison (informational — fuzzy, generous).
    inst_rows = _fetch_all("anp_cdp_diaria_instalacao", "instalacao",
                           [("data", "gte", cutoff.isoformat())],
                           order_by=("data", "instalacao"))  # PK
    daily_insts = sorted({str(r.get("instalacao")) for r in inst_rows if r.get("instalacao")})
    monthly_insts = sorted({
        str(r.get("instalacao_destino"))
        for r in monthly_rows if r.get("instalacao_destino")
    })
    missing_insts = [m for m in monthly_insts if not inst_matches(m, daily_insts)]
    logger.info("Installations: %d monthly vs %d daily — %d unmatched",
                len(monthly_insts), len(daily_insts), len(missing_insts))

    return (ano, mes), frontier, missing, missing_insts, total_missing_kbpd


# ── Rendering ─────────────────────────────────────────────────────────────────
def render_text(ref_month: tuple[int, int], frontier: date,
                missing: list[MissingWell], missing_insts: list[str],
                total_kbpd: float, generated_at: datetime) -> str:
    ano, mes = ref_month
    lines: list[str] = []
    lines.append("SectorData — ANP CDP daily-panel roster canary")
    lines.append(f"Run: {generated_at.strftime('%Y-%m-%d %H:%M UTC')}")
    lines.append("")
    lines.append(
        f"{len(missing)} well(s) with material production in the monthly CDP "
        f"({ano:04d}-{mes:02d}) are ABSENT from the daily panel's last "
        f"{DAILY_WINDOW_DAYS} days of data (frontier {frontier.isoformat()})."
    )
    lines.append(f"Aggregate missing production: {total_kbpd:,.1f} kbpd "
                 f"(alert threshold {ALERT_THRESHOLD_KBPD:.0f} kbpd).")
    lines.append("")
    lines.append("Missing wells (monthly avg, bbl/d as kbpd):")
    for w in missing:
        lines.append(f"  - {w.poco:<24} {w.kbpd:7.1f} kbpd · field {w.campo} · "
                     f"installation {w.instalacao}")
    if missing_insts:
        lines.append("")
        lines.append("Monthly installations with no plausible daily-panel match:")
        for m in missing_insts:
            lines.append(f"  - {m}")
    lines.append("")
    lines.append(
        "Likely cause: ANP has not yet added the installation/wells to the "
        "daily panel's dimensions (the panel's roster lags the monthly CDP). "
        "Benign causes: a well shut in after the reference month, or a name-"
        "format drift between the monthly CSV and the daily panel."
    )
    lines.append("")
    lines.append(
        "Automated OPS alert from scripts/cdp_roster_canary.py "
        "(.github/workflows/cdp_roster_canary.yml). Independent of the client "
        "Alerts product."
    )
    return "\n".join(lines)


def render_html(ref_month: tuple[int, int], frontier: date,
                missing: list[MissingWell], missing_insts: list[str],
                total_kbpd: float, generated_at: datetime) -> str:
    ano, mes = ref_month

    def esc(x: object) -> str:
        return html_lib.escape(str(x))

    th = ("padding:6px 10px;border:1px solid #ddd;background:#fafafa;"
          "text-align:left;font-size:12px;color:#555")
    td = "padding:6px 10px;border:1px solid #eee"

    rows = "".join(
        "<tr>"
        f"<td style='{td}'><b>{esc(w.poco)}</b></td>"
        f"<td style='{td};text-align:right'>{esc(f'{w.kbpd:,.1f}')}</td>"
        f"<td style='{td}'>{esc(w.campo)}</td>"
        f"<td style='{td}'>{esc(w.instalacao)}</td>"
        "</tr>"
        for w in missing
    )

    parts: list[str] = []
    parts.append("<div style='font-family:Arial,Helvetica,sans-serif;color:#222;max-width:760px'>")
    parts.append(
        "<h2 style='margin:0 0 4px'>ANP CDP daily-panel roster canary</h2>"
        f"<p style='margin:0 0 16px;color:#666'>Run {esc(generated_at.strftime('%Y-%m-%d %H:%M UTC'))} · "
        f"reference month {ano:04d}-{mes:02d} · daily frontier {esc(frontier.isoformat())}</p>"
    )
    parts.append(
        f"<p style='margin:0 0 12px'><b>{len(missing)} well(s)</b> with material "
        f"production in the monthly CDP are absent from the daily panel's last "
        f"{DAILY_WINDOW_DAYS} days of data — "
        f"<b style='color:#c0392b'>{esc(f'{total_kbpd:,.1f}')} kbpd</b> aggregate "
        f"(threshold {ALERT_THRESHOLD_KBPD:.0f} kbpd).</p>"
    )
    parts.append(
        "<table style='border-collapse:collapse;font-size:13px;width:100%'>"
        f"<tr><th style='{th}'>Well</th><th style='{th}'>Monthly avg (kbpd)</th>"
        f"<th style='{th}'>Field</th><th style='{th}'>Installation</th></tr>"
        f"{rows}</table>"
    )
    if missing_insts:
        items = "".join(f"<li>{esc(m)}</li>" for m in missing_insts)
        parts.append(
            "<h3 style='margin:18px 0 6px'>Monthly installations with no plausible "
            "daily-panel match</h3>"
            f"<ul style='margin:0 0 12px;font-size:13px'>{items}</ul>"
        )
    parts.append(
        "<p style='margin:16px 0 0;color:#666;font-size:12px'>Likely cause: ANP has "
        "not yet added the installation/wells to the daily panel's dimensions (the "
        "panel's roster lags the monthly CDP). Benign causes: a well shut in after "
        "the reference month, or a name-format drift between the monthly CSV and "
        "the daily panel.</p>"
    )
    parts.append(
        "<p style='margin:14px 0 0;color:#999;font-size:11px'>Automated OPS alert "
        "from scripts/cdp_roster_canary.py (.github/workflows/cdp_roster_canary.yml). "
        "Independent of the client Alerts product.</p>"
    )
    parts.append("</div>")
    return "".join(parts)


# ── Entry point ───────────────────────────────────────────────────────────────
def run() -> int:
    """
    Execute one canary pass. Exit codes (mirrors freshness_monitor):
      0  ran fine (gap or no gap — a roster gap is a data condition, it emails
         and exits 0; we do NOT fail the workflow for it)
      2  missing required env (printed clearly, no stack trace)
      3  the check itself broke (Supabase/SMTP error) — red workflow run
    """
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    missing_env = config.validate()
    if missing_env:
        logger.error(
            "Missing required environment variable(s): %s. "
            "Set SUPABASE_URL, a service key (SUPABASE_SERVICE_KEY or "
            "SUPABASE_SERVICE_ROLE_KEY) and GMAIL_APP_PASSWORD.",
            ", ".join(missing_env),
        )
        return 2

    now = datetime.now(timezone.utc)

    try:
        ref_month, frontier, missing, missing_insts, total_kbpd = run_check()
    except Exception as exc:  # noqa: BLE001 — surface as a red run
        logger.error("Roster check failed: %s", exc, exc_info=True)
        return 3

    if missing:
        logger.info("Missing wells (%d, %.1f kbpd aggregate):", len(missing), total_kbpd)
        for w in missing:
            logger.info("  - %-24s %7.1f kbpd · %s · %s", w.poco, w.kbpd, w.campo, w.instalacao)
    if missing_insts:
        logger.info("Unmatched monthly installations: %s", ", ".join(missing_insts))

    if total_kbpd <= ALERT_THRESHOLD_KBPD:
        logger.info(
            "Roster gap %.1f kbpd is at/below the %.0f kbpd threshold — no email.",
            total_kbpd, ALERT_THRESHOLD_KBPD,
        )
        return 0

    if not validate_api_key():
        logger.error("Gmail SMTP login failed — cannot send the ops alert.")
        return 3

    subject = (f"[SectorData] ⚠️ CDP daily panel missing {total_kbpd:,.0f} kbpd "
               f"of monthly wells ({len(missing)} well(s))")
    text = render_text(ref_month, frontier, missing, missing_insts, total_kbpd, now)
    html = render_html(ref_month, frontier, missing, missing_insts, total_kbpd, now)

    logger.info("Emailing ops alert to %s — %d wells, %.1f kbpd",
                DEST_EMAIL, len(missing), total_kbpd)
    result = send_email(to=DEST_EMAIL, subject=subject, html=html, text=text)
    if not result.get("success"):
        logger.error("Ops alert send FAILED (status_code=%s): %s",
                     result.get("status_code"), result.get("error"))
        return 3

    logger.info("Ops alert sent (message_id=%s).", result.get("provider_message_id"))
    return 0


def main() -> None:
    sys.exit(run())


if __name__ == "__main__":
    main()
