"""
Data-freshness guardian (OPS alert).

The missing safety net against a SILENT ETL stall: a workflow that stays GREEN
(it ran, no exception, sent its hook) while the underlying data simply stops
advancing — the source went quiet, a scraper started returning 0 rows behind a
200, a CAPTCHA path degraded, etc. Nothing in the existing stack catches that;
the /home "Data Sources" table surfaces it visually but nobody is watching it at
03:00. This script watches it on a schedule and EMAILS the ops team when a base
crosses an overdue threshold tuned to that source's REAL publication cadence.

This is an OPS/admin alert (it pages the team), and is intentionally separate
from the client-subscription Alerts product (scripts/client_alerts/), which
emails subscribers when a base GETS new data. Here we email when a base FAILS to
get new data for too long.

How it decides "overdue"
  * Calls the existing RPC get_data_sources_freshness() with the service-role
    client (bypasses RLS) → (source_key, last_update, row_count) per base.
  * Each base has an overdue threshold in OVERDUE_HOURS (hours). A base is
    OVERDUE when  now - last_update > threshold.
  * Thresholds are GENEROUS — sized to each source's true upstream lag, NOT to
    its cron interval — so a legitimately-slow source never false-positives.
    The canonical example: ANP monthly fuel data for month M only publishes by
    mid/late M+1, so a ~64-day-old "April" row in early June is NORMAL. The
    curated overdueAfterHours in src/data/dataSources.ts is tuned for the /home
    traffic-light (cron×3) and is TOO TIGHT for an ops page — we widen it here
    and leave a comment on every value that diverges.
  * Bases with a NULL last_update (table ever empty) are reported separately as
    "no data ever" — that is a setup/never-ran signal, not a stall.

Output
  * Always logs the full per-base status (OK / OVERDUE / NO-DATA + age) to stdout
    so the GitHub Actions run log is a complete freshness snapshot every run.
  * If ANY base is overdue (or has never received data), emails ONE ops digest
    via the proven Gmail SMTP sender (scripts/client_alerts/_core/gmail_client).
    If everything is fresh, sends nothing and logs "all fresh".

Env gate (reuses scripts/client_alerts/_core/config.validate):
  Required: SUPABASE_URL, a service key (SUPABASE_SERVICE_KEY or
  SUPABASE_SERVICE_ROLE_KEY), GMAIL_APP_PASSWORD. GMAIL_ADDRESS defaults to
  ibbaogproject@gmail.com. With an incomplete env the CLI prints the missing
  vars and exits non-zero — no stack trace.

Recipient: ALERTAS_DEST_EMAIL (default eduardo.mendes@itaubba.com).

Run:  python -m scripts.freshness_monitor
"""
from __future__ import annotations

import html as html_lib
import logging
import os
import sys
from datetime import datetime, timezone

from scripts.client_alerts._core import config
from scripts.client_alerts._core.gmail_client import send_email, validate_api_key
from scripts.client_alerts._core.supabase_client import get_client

logger = logging.getLogger("freshness_monitor")

# ── Recipient ─────────────────────────────────────────────────────────────────
# Ops digest goes to the team, not to client subscribers. Defaults to Eduardo's
# work inbox (the primary recipient of operational alerts).
DEST_EMAIL: str = os.environ.get("ALERTAS_DEST_EMAIL", "eduardo.mendes@itaubba.com")

HOURS_PER_DAY = 24


# ── Overdue thresholds (HOURS) ────────────────────────────────────────────────
# Ported from src/data/dataSources.ts (each entry's `overdueAfterHours`, keyed by
# `key` == source_key). The catalog values are tuned for the /home traffic-light
# (cron interval × 3) which is deliberately TIGHT so the UI nudges early. An ops
# page must NOT false-positive on a source that is merely slow upstream, so where
# the catalog value is tighter than the source's true publication lag we WIDEN it
# here and document the divergence inline ("dataSources.ts: Nh → widened").
#
# Cadence buckets requested for this guardian:
#   * monthly fuel/trade  ≈ 75 days   (1800 h) — ANP/MDIC publish month M in M+1
#   * weekly              ≈ 21 days   ( 504 h)
#   * daily (cdp_diaria)  ≈ 9 days    ( 216 h) — D-6 production-date lag (D-8 over weekends)
#   * daily (subsidy)     ≈ 5 days    ( 120 h)
#   * vessels 6h/4h       ≈ 1.5 days  (  36 h)
#   * event-driven vessels≈ 10 days   ( 240 h) — port_arrivals / import_candidates (sparse)
#   * news (~5 min)       ≈ 6 hours
#   * anp_voip (annual)   ≈ 550 days (13200 h)
#   * price_bands         admin ad-hoc, no defined cadence → EXCLUDED (see below)
#
# IMPORTANT: every source_key returned by get_data_sources_freshness() must have
# an entry here (or be in EXCLUDED_KEYS), otherwise it would be silently
# unmonitored. _coverage_report() asserts this each run.
#
# NOTE (event-driven bases): port_arrivals and import_candidates are imperfectly
# served by row-recency — a row only appears when a real-world event occurs (a
# vessel crossing a port polygon / a tanker qualifying as a diesel import), so a
# long gap is normal silence, not a stall. A future refinement is to gate these
# on a sync-heartbeat (vessel_positions advancing / a discovery_runs row written)
# rather than last-row age. Not implemented yet — for now we just give them a
# generous row-recency threshold (see below).
DAYS = HOURS_PER_DAY  # readability: <n> * DAYS == n days in hours

OVERDUE_HOURS: dict[str, int] = {
    # ── Monthly fuel / trade (~75 days) ──────────────────────────────────────
    # ANP/MDIC publish month M only by mid/late M+1; a ~60-day-old latest month
    # is normal mid-cycle. 75 days = comfortably past two publication windows.
    "vendas": 75 * DAYS,                    # dataSources.ts: 1440h(60d) → widened
    "anp_glp": 75 * DAYS,                   # dataSources.ts:  504h(21d) → widened (it's monthly, not weekly)
    "anp_daie": 75 * DAYS,                  # dataSources.ts: 1440h(60d) → widened
    "anp_desembaracos": 75 * DAYS,          # not in dataSources.ts (umbrella key anp_daie) — monthly
    "mdic_comex": 75 * DAYS,                # dataSources.ts:   72h( 3d) → widened (source is monthly though crawled daily)
    "anp_precos_distribuicao": 75 * DAYS,   # dataSources.ts:  504h(21d) → widened (monthly grain)
    "anp_cdp_producao": 75 * DAYS,          # dataSources.ts:   96h( 4d) → widened (monthly APEX publication)

    # ── Weekly (~21 days) ────────────────────────────────────────────────────
    # A 1-week skip happens (holiday weeks, late bulletin); 21 days = 3 missed
    # weeks before paging.
    "anp_precos_produtores": 21 * DAYS,     # dataSources.ts: 504h(21d) — matches
    "anp_lpc": 21 * DAYS,                   # dataSources.ts: 504h(21d) — matches
    "d_g_margins": 21 * DAYS,               # dataSources.ts: 504h(21d) — matches (manual weekly upload)

    # ── Daily (~4–5 days) ────────────────────────────────────────────────────
    # Daily ETLs; allow a long weekend + a missed day before paging.
    "anp_subsidy_diesel_reference": 5 * DAYS,   # dataSources.ts: 72h(3d) → widened to 5d
    "anp_subsidy_commercialization": 5 * DAYS,  # dataSources.ts: 72h(3d) → widened to 5d
    # anp_cdp_diaria* track MAX(data) (the production-DATE frontier, not the
    # ingest time). ANP publishes daily production with a STRUCTURAL ~6-day lag
    # (D-6), and a weekend stall pushes the worst case to D-8 — so the threshold
    # must exceed the worst-case publication lag, not the cron interval. 9 days
    # gives a 1-day margin over D-8 while still catching a genuine multi-day
    # outage (e.g. the Power BI feed truly going dark).
    "anp_cdp_diaria": 9 * DAYS,                 # dataSources.ts: 24h(1d) → widened to 9d (D-6 lag, weekend worst case D-8)
    "anp_cdp_diaria_instalacao": 9 * DAYS,      # not in dataSources.ts (umbrella key anp_cdp_diaria) — same D-6 frontier lag → 9d
    "anp_cdp_diaria_poco": 9 * DAYS,            # not in dataSources.ts (umbrella key anp_cdp_diaria) — same D-6 frontier lag → 9d

    # ── Vessels 6h / 4h (~1.5 days = 36 h) ───────────────────────────────────
    "navios_diesel": 36,                    # dataSources.ts: 18h → widened to 36h
    "vessel_positions": 36,                 # dataSources.ts: 18h → widened to 36h
    # port_arrivals / import_candidates are EVENT-DRIVEN, not cron-cadence: a row
    # is written only when a vessel actually crosses a port polygon (arrivals) or
    # a tanker actually qualifies as a diesel import (candidates). They are sparse
    # by nature (lifetime ~20 / ~22 rows total), so a multi-day gap is normal
    # quiet, not a stall — row-recency must be generous. 10 days catches a truly
    # dead feed without nagging during ordinary lulls. (See the event-driven note
    # near OVERDUE_HOURS: a heartbeat gate would be the cleaner long-term fix.)
    "port_arrivals": 10 * DAYS,             # not in dataSources.ts (umbrella key vessel_positions) — event-driven, sparse (~20 rows lifetime) → 10d
    "import_candidates": 10 * DAYS,         # not in dataSources.ts (umbrella key vessel_positions) — event-driven, sparse (~22 rows lifetime) → 10d

    # ── News (~5 min cron) — 6 hours ─────────────────────────────────────────
    # External scanner every ~5 min; 6 h means it's been dead for ~70 cycles.
    "news_articles": 6,                     # dataSources.ts: 3h → widened to 6h

    # ── Annual (~550 days) ───────────────────────────────────────────────────
    # anp_voip publishes once a year, and its key tracks MAX(ano_publicacao),
    # whose baseline lags the real publication by ~6 months; the 2026 edition
    # publishes within an Apr–Jun window. 550 days avoids daily-nagging during the
    # normal publication window and pages only if a full annual cycle is clearly
    # missed.
    "anp_voip": 550 * DAYS,                 # dataSources.ts: 8760h(365d) → widened to 550d (annual + ~6mo baseline lag + Apr–Jun window)

    # ── Admin ad-hoc, but cap rarely changes — keep a very generous guard ─────
    # anp_subsidy_caps is admin-seeded (4 rows) and revised only when ANP changes
    # the cap policy. Not strictly a "cadence", but a 120-day guard catches a
    # truly dead table without nagging.
    "anp_subsidy_caps": 120 * DAYS,         # dataSources.ts: 2160h(90d) → widened to 120d
}

# ── Explicitly excluded (no defined cadence → no overdue concept) ─────────────
# price_bands is an admin-ad-hoc manual Excel upload with no schedule; flagging
# it would be noise. We EXCLUDE it from overdue evaluation (still logged with an
# EXCLUDED status so it never looks "silently dropped"). A generous 120-day guard
# was considered and rejected — there is genuinely no expectation it updates on
# any cadence, and a false page erodes trust in the digest.
EXCLUDED_KEYS: set[str] = {
    "price_bands",
}

# Human-readable cadence label per key (for the email + log; purely descriptive).
CADENCE_LABEL: dict[str, str] = {
    "vendas": "Monthly (publishes M+1)",
    "anp_glp": "Monthly (publishes M+1)",
    "anp_daie": "Monthly (publishes M+1)",
    "anp_desembaracos": "Monthly (publishes M+1)",
    "mdic_comex": "Monthly (publishes M+1)",
    "anp_precos_distribuicao": "Monthly",
    "anp_cdp_producao": "Monthly (APEX)",
    "anp_precos_produtores": "Weekly",
    "anp_lpc": "Weekly",
    "d_g_margins": "Weekly (manual upload)",
    "anp_subsidy_diesel_reference": "Daily",
    "anp_subsidy_commercialization": "Daily",
    "anp_cdp_diaria": "Daily (3×/day)",
    "anp_cdp_diaria_instalacao": "Daily (3×/day)",
    "anp_cdp_diaria_poco": "Daily (3×/day)",
    "navios_diesel": "Every 6h",
    "vessel_positions": "Every 6h",
    "port_arrivals": "Every 6h",
    "import_candidates": "Every 4h",
    "news_articles": "Continuous (~5 min)",
    "anp_voip": "Annual (May)",
    "anp_subsidy_caps": "Ad-hoc (admin)",
    "price_bands": "Ad-hoc (admin, excluded)",
}


# ── Data model ────────────────────────────────────────────────────────────────
class BaseStatus:
    """Per-base freshness verdict for a single run."""

    __slots__ = (
        "source_key",
        "last_update",
        "row_count",
        "threshold_hours",
        "age_hours",
        "state",  # "OK" | "OVERDUE" | "NO_DATA" | "EXCLUDED" | "UNMONITORED"
    )

    def __init__(
        self,
        source_key: str,
        last_update: datetime | None,
        row_count: int | None,
        threshold_hours: int | None,
        age_hours: float | None,
        state: str,
    ) -> None:
        self.source_key = source_key
        self.last_update = last_update
        self.row_count = row_count
        self.threshold_hours = threshold_hours
        self.age_hours = age_hours
        self.state = state

    # Convenience for the email/report.
    @property
    def age_days(self) -> float | None:
        return None if self.age_hours is None else self.age_hours / HOURS_PER_DAY

    @property
    def overdue_by_days(self) -> float | None:
        if self.age_hours is None or self.threshold_hours is None:
            return None
        return (self.age_hours - self.threshold_hours) / HOURS_PER_DAY

    @property
    def threshold_days(self) -> float | None:
        return None if self.threshold_hours is None else self.threshold_hours / HOURS_PER_DAY


# ── Parsing helpers ───────────────────────────────────────────────────────────
def _parse_ts(value: object) -> datetime | None:
    """
    Parse a Supabase timestamptz string (or None) into an aware UTC datetime.

    PostgREST returns ISO 8601 like '2026-04-01T00:00:00+00:00' (sometimes with
    a trailing 'Z'). Returns None for NULL/empty/unparseable so the caller can
    classify it as NO_DATA rather than crash.
    """
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        s = str(value).strip()
        # fromisoformat in 3.11+ handles offsets; normalise a trailing Z.
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(s)
        except ValueError:
            logger.warning("could not parse timestamp %r — treating as no-data", value)
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


# ── Core evaluation ───────────────────────────────────────────────────────────
def fetch_freshness() -> list[dict]:
    """Call get_data_sources_freshness() with the service-role client."""
    client = get_client()
    resp = client.rpc("get_data_sources_freshness", {}).execute()
    rows = resp.data or []
    if not rows:
        logger.warning(
            "get_data_sources_freshness() returned 0 rows — the RPC may be "
            "missing or every table is empty"
        )
    return rows


def evaluate(rows: list[dict], now: datetime | None = None) -> list[BaseStatus]:
    """
    Classify each freshness row against its overdue threshold.

    states:
      OK          fresh (age <= threshold)
      OVERDUE     age > threshold (this is what pages the team)
      NO_DATA     last_update is NULL (table never received data)
      EXCLUDED    source intentionally has no cadence (price_bands)
      UNMONITORED a source_key with no threshold and not excluded — a config gap;
                  reported so it can never be silently dropped.
    """
    now = now or datetime.now(timezone.utc)
    out: list[BaseStatus] = []

    for row in rows:
        key = row.get("source_key")
        if not key:
            continue
        last_update = _parse_ts(row.get("last_update"))
        row_count = row.get("row_count")

        if key in EXCLUDED_KEYS:
            age_hours = (
                (now - last_update).total_seconds() / 3600.0
                if last_update is not None
                else None
            )
            out.append(BaseStatus(key, last_update, row_count, None, age_hours, "EXCLUDED"))
            continue

        threshold = OVERDUE_HOURS.get(key)
        if threshold is None:
            # Unknown source_key → config gap. Surface it loudly, never drop it.
            age_hours = (
                (now - last_update).total_seconds() / 3600.0
                if last_update is not None
                else None
            )
            out.append(BaseStatus(key, last_update, row_count, None, age_hours, "UNMONITORED"))
            continue

        if last_update is None:
            out.append(BaseStatus(key, None, row_count, threshold, None, "NO_DATA"))
            continue

        age_hours = (now - last_update).total_seconds() / 3600.0
        state = "OVERDUE" if age_hours > threshold else "OK"
        out.append(BaseStatus(key, last_update, row_count, threshold, age_hours, state))

    # Stable, useful ordering: problems first, then by key.
    severity = {"OVERDUE": 0, "NO_DATA": 1, "UNMONITORED": 2, "OK": 3, "EXCLUDED": 4}
    out.sort(key=lambda s: (severity.get(s.state, 9), s.source_key))
    return out


def _coverage_report(rows: list[dict]) -> list[str]:
    """
    Return the list of source_keys present in the RPC but NOT covered by either
    OVERDUE_HOURS or EXCLUDED_KEYS (i.e. silently unmonitored). Empty = full
    coverage. Logged every run; also used by the validation CLI.
    """
    rpc_keys = {r.get("source_key") for r in rows if r.get("source_key")}
    covered = set(OVERDUE_HOURS) | EXCLUDED_KEYS
    return sorted(k for k in rpc_keys if k not in covered)


# ── Rendering ─────────────────────────────────────────────────────────────────
def _fmt_last(dt: datetime | None) -> str:
    return "— (never)" if dt is None else dt.strftime("%Y-%m-%d %H:%M UTC")


def _fmt_age(s: BaseStatus) -> str:
    if s.age_days is None:
        return "n/a"
    return f"{s.age_days:.1f}d"


def render_text(statuses: list[BaseStatus], generated_at: datetime) -> str:
    """Plain-text ops digest body (the email's text/plain alternative)."""
    overdue = [s for s in statuses if s.state == "OVERDUE"]
    no_data = [s for s in statuses if s.state == "NO_DATA"]
    unmon = [s for s in statuses if s.state == "UNMONITORED"]

    lines: list[str] = []
    lines.append("SectorData — Data Freshness Guardian")
    lines.append(f"Run: {generated_at.strftime('%Y-%m-%d %H:%M UTC')}")
    lines.append("")
    lines.append(
        f"{len(overdue)} overdue · {len(no_data)} never received data · "
        f"{len(unmon)} unmonitored (config gap)"
    )
    lines.append("")

    if overdue:
        lines.append("OVERDUE (data not advancing past its cadence threshold):")
        for s in overdue:
            lines.append(
                f"  - {s.source_key}: last {_fmt_last(s.last_update)} "
                f"({_fmt_age(s)} old) · threshold {s.threshold_days:.0f}d · "
                f"overdue by {s.overdue_by_days:.1f}d · {CADENCE_LABEL.get(s.source_key, '?')}"
            )
        lines.append("")

    if no_data:
        lines.append("NO DATA EVER (table empty — check the pipeline ran at all):")
        for s in no_data:
            lines.append(
                f"  - {s.source_key}: threshold {s.threshold_days:.0f}d · "
                f"{CADENCE_LABEL.get(s.source_key, '?')}"
            )
        lines.append("")

    if unmon:
        lines.append("UNMONITORED (source_key has no threshold — add one to OVERDUE_HOURS):")
        for s in unmon:
            lines.append(f"  - {s.source_key}: last {_fmt_last(s.last_update)}")
        lines.append("")

    lines.append("Full per-base status:")
    for s in statuses:
        lines.append(
            f"  [{s.state:<10}] {s.source_key:<30} "
            f"last {_fmt_last(s.last_update):<22} age {_fmt_age(s)}"
        )
    lines.append("")
    lines.append(
        "This is an automated OPS alert from scripts/freshness_monitor.py "
        "(.github/workflows/freshness_monitor.yml). It is independent of the "
        "client Alerts product."
    )
    return "\n".join(lines)


def render_html(statuses: list[BaseStatus], generated_at: datetime) -> str:
    """HTML ops digest body (the email's text/html alternative)."""
    overdue = [s for s in statuses if s.state == "OVERDUE"]
    no_data = [s for s in statuses if s.state == "NO_DATA"]
    unmon = [s for s in statuses if s.state == "UNMONITORED"]

    def esc(x: object) -> str:
        return html_lib.escape(str(x))

    def overdue_rows() -> str:
        cells = []
        for s in overdue:
            cells.append(
                "<tr>"
                f"<td style='padding:6px 10px;border:1px solid #eee'><b>{esc(s.source_key)}</b></td>"
                f"<td style='padding:6px 10px;border:1px solid #eee'>{esc(_fmt_last(s.last_update))}</td>"
                f"<td style='padding:6px 10px;border:1px solid #eee;text-align:right'>{esc(f'{s.overdue_by_days:.1f}d')}</td>"
                f"<td style='padding:6px 10px;border:1px solid #eee;text-align:right'>{esc(f'{s.threshold_days:.0f}d')}</td>"
                f"<td style='padding:6px 10px;border:1px solid #eee'>{esc(CADENCE_LABEL.get(s.source_key, '?'))}</td>"
                "</tr>"
            )
        return "".join(cells)

    def simple_rows(items: list[BaseStatus]) -> str:
        cells = []
        for s in items:
            cells.append(
                "<tr>"
                f"<td style='padding:6px 10px;border:1px solid #eee'><b>{esc(s.source_key)}</b></td>"
                f"<td style='padding:6px 10px;border:1px solid #eee'>{esc(_fmt_last(s.last_update))}</td>"
                f"<td style='padding:6px 10px;border:1px solid #eee'>{esc(CADENCE_LABEL.get(s.source_key, '?'))}</td>"
                "</tr>"
            )
        return "".join(cells)

    def all_rows() -> str:
        color = {
            "OVERDUE": "#c0392b",
            "NO_DATA": "#b9770e",
            "UNMONITORED": "#8e44ad",
            "OK": "#1e7e34",
            "EXCLUDED": "#7f8c8d",
        }
        cells = []
        for s in statuses:
            c = color.get(s.state, "#333")
            cells.append(
                "<tr>"
                f"<td style='padding:4px 10px;border:1px solid #eee;color:{c};font-weight:600'>{esc(s.state)}</td>"
                f"<td style='padding:4px 10px;border:1px solid #eee'>{esc(s.source_key)}</td>"
                f"<td style='padding:4px 10px;border:1px solid #eee'>{esc(_fmt_last(s.last_update))}</td>"
                f"<td style='padding:4px 10px;border:1px solid #eee;text-align:right'>{esc(_fmt_age(s))}</td>"
                "</tr>"
            )
        return "".join(cells)

    th = "padding:6px 10px;border:1px solid #ddd;background:#fafafa;text-align:left;font-size:12px;color:#555"
    parts: list[str] = []
    parts.append(
        "<div style='font-family:Arial,Helvetica,sans-serif;color:#222;max-width:760px'>"
    )
    parts.append(
        "<h2 style='margin:0 0 4px'>Data Freshness Guardian</h2>"
        f"<p style='margin:0 0 16px;color:#666'>Run {esc(generated_at.strftime('%Y-%m-%d %H:%M UTC'))} · "
        f"{len(overdue)} overdue · {len(no_data)} never received data · "
        f"{len(unmon)} unmonitored</p>"
    )

    if overdue:
        parts.append("<h3 style='color:#c0392b;margin:18px 0 6px'>Overdue</h3>")
        parts.append(
            "<table style='border-collapse:collapse;font-size:13px;width:100%'>"
            f"<tr><th style='{th}'>Source</th><th style='{th}'>Last data</th>"
            f"<th style='{th}'>Overdue by</th><th style='{th}'>Threshold</th>"
            f"<th style='{th}'>Cadence</th></tr>"
            f"{overdue_rows()}</table>"
        )

    if no_data:
        parts.append("<h3 style='color:#b9770e;margin:18px 0 6px'>No data ever</h3>")
        parts.append(
            "<table style='border-collapse:collapse;font-size:13px;width:100%'>"
            f"<tr><th style='{th}'>Source</th><th style='{th}'>Last data</th>"
            f"<th style='{th}'>Cadence</th></tr>"
            f"{simple_rows(no_data)}</table>"
        )

    if unmon:
        parts.append(
            "<h3 style='color:#8e44ad;margin:18px 0 6px'>Unmonitored (config gap)</h3>"
        )
        parts.append(
            "<table style='border-collapse:collapse;font-size:13px;width:100%'>"
            f"<tr><th style='{th}'>Source</th><th style='{th}'>Last data</th>"
            f"<th style='{th}'>Cadence</th></tr>"
            f"{simple_rows(unmon)}</table>"
        )

    parts.append("<h3 style='margin:22px 0 6px'>Full per-base status</h3>")
    parts.append(
        "<table style='border-collapse:collapse;font-size:12px;width:100%'>"
        f"<tr><th style='{th}'>State</th><th style='{th}'>Source</th>"
        f"<th style='{th}'>Last data</th><th style='{th}'>Age</th></tr>"
        f"{all_rows()}</table>"
    )

    parts.append(
        "<p style='margin:20px 0 0;color:#999;font-size:11px'>Automated OPS alert "
        "from scripts/freshness_monitor.py (.github/workflows/freshness_monitor.yml). "
        "Independent of the client Alerts product.</p>"
    )
    parts.append("</div>")
    return "".join(parts)


# ── Logging ───────────────────────────────────────────────────────────────────
def log_statuses(statuses: list[BaseStatus], coverage_gap: list[str]) -> None:
    """Always emit the complete per-base snapshot to stdout for the run log."""
    logger.info("── Data freshness snapshot (%d bases) ──", len(statuses))
    for s in statuses:
        age = "n/a" if s.age_days is None else f"{s.age_days:.1f}d"
        thr = "—" if s.threshold_days is None else f"{s.threshold_days:.0f}d"
        logger.info(
            "  [%-10s] %-30s last=%-22s age=%-7s threshold=%s rows=%s",
            s.state,
            s.source_key,
            _fmt_last(s.last_update),
            age,
            thr,
            s.row_count if s.row_count is not None else "?",
        )
    if coverage_gap:
        logger.warning(
            "COVERAGE GAP — %d source_key(s) returned by the RPC have no threshold "
            "and are not excluded: %s",
            len(coverage_gap),
            ", ".join(coverage_gap),
        )
    else:
        logger.info("Coverage OK — every source_key from the RPC is monitored or excluded.")


# ── Entry point ───────────────────────────────────────────────────────────────
def run() -> int:
    """
    Execute one monitor pass. Returns a process exit code:
      0  ran fine (whether or not it emailed — overdue is a data condition, not a
         job failure; we do NOT fail the workflow just because a source is late)
      2  missing required env (printed clearly, no stack trace)
      3  unexpected runtime error (RPC/SMTP) — surfaces as a red workflow run
    """
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    missing = config.validate()
    if missing:
        logger.error(
            "Missing required environment variable(s): %s. "
            "Set SUPABASE_URL, a service key (SUPABASE_SERVICE_KEY or "
            "SUPABASE_SERVICE_ROLE_KEY) and GMAIL_APP_PASSWORD.",
            ", ".join(missing),
        )
        return 2

    now = datetime.now(timezone.utc)

    try:
        rows = fetch_freshness()
    except Exception as exc:  # noqa: BLE001 — surface as a red run, not a crash dump
        logger.error("Failed to fetch freshness from Supabase: %s", exc, exc_info=True)
        return 3

    statuses = evaluate(rows, now=now)
    coverage_gap = _coverage_report(rows)
    log_statuses(statuses, coverage_gap)

    overdue = [s for s in statuses if s.state == "OVERDUE"]
    no_data = [s for s in statuses if s.state == "NO_DATA"]
    # Unmonitored config gaps also warrant a page — a base we forgot to cover is
    # exactly the silent-stall risk this guardian exists to remove.
    unmon = [s for s in statuses if s.state == "UNMONITORED"]

    problems = overdue + no_data + unmon
    if not problems:
        logger.info("All %d monitored bases are fresh — sending nothing.", len(statuses))
        return 0

    # Verify SMTP before composing — a clean ERROR + red run beats a silent zero-send.
    if not validate_api_key():
        logger.error("Gmail SMTP login failed — cannot send the ops digest.")
        return 3

    n = len(overdue) + len(no_data)
    subject = f"[SectorData] ⚠️ {n} data source(s) overdue"
    if unmon and n == 0:
        subject = f"[SectorData] ⚠️ {len(unmon)} data source(s) unmonitored"

    text = render_text(statuses, now)
    html = render_html(statuses, now)

    logger.info(
        "Emailing ops digest to %s — %d overdue, %d no-data, %d unmonitored",
        DEST_EMAIL, len(overdue), len(no_data), len(unmon),
    )
    result = send_email(to=DEST_EMAIL, subject=subject, html=html, text=text)
    if not result.get("success"):
        logger.error(
            "Ops digest send FAILED (status_code=%s): %s",
            result.get("status_code"), result.get("error"),
        )
        return 3

    logger.info("Ops digest sent (message_id=%s).", result.get("provider_message_id"))
    return 0


def main() -> None:
    sys.exit(run())


if __name__ == "__main__":
    main()
