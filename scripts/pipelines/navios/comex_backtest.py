#!/usr/bin/env python3
"""
comex_backtest.py
=================
OFFLINE backtest harness — validates the /navios-diesel monthly diesel-volume
methodology (derived from the port lineup) against the official ComexStat-by-URF
ruler, for CLOSED months only.

WHY THIS EXISTS
---------------
The /navios-diesel dashboard estimates monthly diesel imports by reading the
public port lineups (scraped into ``navios_diesel``) and summing the discharged
cargo of each vessel at the month's last snapshot (RPC
``get_nd_volume_mensal_historico``). That estimate is *live* — it is the only
thing available in near-real-time — but it is a proxy. The official ruler is
ComexStat (MDIC), broken down by Unidade da Receita Federal de despacho (URF),
which we map to canonical ports.

IMPORTANT CAVEAT — desembaraço ≠ descarga
-----------------------------------------
ComexStat counts **customs clearance** (desembaraço aduaneiro), which lags the
**physical discharge** at the berth by days to weeks. A cargo discharged at the
end of month M is frequently cleared in month M+1. For that reason ComexStat is
USELESS as a live feed and is used here ONLY to backtest CLOSED past months,
where the lag has washed out. CTO decision (2026-06): ComexStat is the backtest
ruler, never the dashboard feed.

>>> THIS SCRIPT MUST NOT FEED THE DASHBOARD. <<<
It is a pure validation tool. It READS ``navios_diesel`` via the service-role key
and READS the ComexStat public API; it writes ONLY a local parquet/CSV under
``DADOS/`` (gitignored). It NEVER writes to Supabase.

WHAT IT PRODUCES
----------------
A per-port × month bias table:
    a = our methodology (discharged m³ from the lineup, per port)
    b = ComexStat-URF (cleared m³, per mapped port)
    b - a   (absolute gap)
    a / b   (ratio — >1 means we over-count, <1 means we under-count)

Persisted to ``DADOS/navios_comex_backtest.parquet`` (+ sibling .csv),
**appended/upserted in-place by (mes, porto)** — never deleted and rebuilt, to
preserve the running history (project standard; see CLAUDE.md / memory
"parquet in-place").

BIAS MONITOR
------------
Covered ports whose ``a / b`` exceeds ``BIAS_HIGH`` (over-counting, e.g. Itaqui)
or falls below ``BIAS_LOW`` (under-counting) for >= ``BIAS_PERSIST_MONTHS``
consecutive closed months are flagged. If any *covered* port breaches in any
month of the run, the script exits non-zero (so a future workflow / CI can gate
on it). Uncovered URFs (ports we do not scrape) are recorded for visibility but
never gate the exit code.

DENSITY NOTE (832 vs 835)
-------------------------
ComexStat reports mass (kg). We convert kg -> m³ with **832 kg/m³**, the
production-side density stored in ``ncm_densidade_kg_m3`` for NCM 27101921 (the
same density the production/imports pipelines use). The /navios-diesel lineup
itself uses **835 kg/m³** when it converts tonnes to m³ during scraping. We align
the ComexStat side to the official production density (832) so both sides of the
ratio sit on the same ruler; the 832 vs 835 spread is < 0.4 % and does not move
the bias verdict. Our side (``quantidade_convertida``) is already in m³ as stored
by the lineup pipeline and is used as-is.

METHODOLOGY REPLICATION
-----------------------
Step 3 faithfully replicates the discharged logic of
``supabase/migrations/20260527700000_nd_volume_mensal_historico_past_only_discharged.sql``
but broken down PER PORT (the RPC returns only the month total):
  * anchor   = last snapshot whose SP-local month == target month
  * error_ports = ports flagged ERRO_COLETA at the anchor (excluded entirely)
  * anchor_set  = (navio, porto) still pending at the anchor
                  (status NOT IN (ERRO_COLETA, Despachado)) — excluded
  * vessel_last_row = latest row per (navio, porto) with collected_at <= anchor
                      and status <> ERRO_COLETA
  * discharged  = sum of last_volume for vessels NOT in anchor_set and whose
                  port is NOT an error_port AND whose last_seen SP-month ==
                  target month (attribution_month filter)
A built-in sanity check asserts that the per-port sum equals the RPC total for
each backtested month.

USAGE
-----
    python scripts/pipelines/navios/comex_backtest.py
    python scripts/pipelines/navios/comex_backtest.py --from 2026-04 --to 2026-05
    python scripts/pipelines/navios/comex_backtest.py --dry-run
    python scripts/pipelines/navios/comex_backtest.py --quiet

With no --from/--to, the range defaults to every CLOSED month for which
``navios_diesel`` has data (baseline 2026-04 .. last full month before the
current SP month).

CREDENTIALS
-----------
SUPABASE_URL and SUPABASE_SERVICE_KEY, read from the environment or from a
``.env`` walked up the directory tree (works from a git worktree too).

FUTURE WORKFLOW
---------------
This is intentionally a stand-alone CLI. A future GitHub Actions job only needs
to ``pip install -r requirements.txt`` and call this script; a non-zero exit on a
covered-port breach is the gate. No Supabase write step is required.
"""
from __future__ import annotations

import argparse
import math
import sys
import time
import unicodedata
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import requests
from supabase import create_client

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


# ── Constants ──────────────────────────────────────────────────────────────────

NCM_DIESEL = "27101921"          # Óleo diesel (S10/S500), the lineup NCM
DENSITY_KG_M3 = 832.0            # production-side density for 27101921 (see docstring)
SP_TZ = timezone(timedelta(hours=-3))   # America/Sao_Paulo (no DST since 2019)
BASELINE_MONTH = "2026-04"       # the series baseline, mirrors the RPC

# Bias monitor thresholds (see docstring).
BIAS_HIGH = 1.5                  # a/b above this = over-counting (e.g. Itaqui)
BIAS_LOW = 0.6                   # a/b below this = under-counting
BIAS_PERSIST_MONTHS = 2          # consecutive closed months to call it persistent

# Output artifacts (DADOS/ is gitignored — local source of truth for consolidates).
OUT_PARQUET = "navios_comex_backtest.parquet"
OUT_CSV = "navios_comex_backtest.csv"

# ComexStat API (reuse endpoint/auth/UA/backoff from mdic_comex_sync.py — the API
# 429s aggressively; space requests out and honor Retry-After).
_COMEX_API = "https://api-comexstat.mdic.gov.br/general"
_COMEX_HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Origin": "https://comexstat.mdic.gov.br",
    "Referer": "https://comexstat.mdic.gov.br/",
}
_COMEX_RETRIES = 6
_COMEX_BACKOFF = [12, 15, 25, 40, 60, 90]
# Pause between every month leg to stay under the per-IP rate limit even on a
# fully successful run — cheap insurance against 429 cascades (12-15s window).
_COMEX_INTER_REQUEST_SLEEP = 13


# ── URF -> canonical port map ──────────────────────────────────────────────────
# The 15 URFs that handle diesel imports, mapped to our canonical port names.
# Ports we scrape into navios_diesel are "covered" (covered=True); the rest are
# "uncovered" — recorded for visibility but they never gate the exit code.
#
# ComexStat returns the URF as "<code> - <NAME>" with inconsistent dashes and
# accents (e.g. "0317903 - IRF SAO LUIS", "0417902 - IRF - PORTO DE SUAPE",
# "0217800 - ALF - BELÉM"). We match on a normalized key: strip the leading
# numeric code, drop accents, uppercase, collapse whitespace and stray dashes.
# Keys below are the normalized URF NAME (post-_norm_urf).
URF_PORT_MAP: dict[str, tuple[str, bool]] = {
    # normalized URF name            : (canonical port,                covered?)
    "IRF SAO LUIS":                    ("Porto de Itaqui",             True),
    "PORTO DE SANTOS":                 ("Porto de Santos",             True),
    "PORTO DE PARANAGUA":              ("Porto de Paranaguá",          True),
    "SAO SEBASTIAO":                   ("Porto de São Sebastião",      True),
    "IRF PORTO DE SUAPE":              ("Porto de Suape",              True),
    "MACEIO":                          ("Porto de Maceió",             True),
    "PORTO DE MANAUS":                 ("Manaus",                      False),
    "ALF BELEM":                       ("Belém/Vila do Conde",         False),
    "ALF SALVADOR":                    ("Salvador",                    False),
    "ALF FORTALEZA":                   ("Fortaleza/Mucuripe",          False),
    "IRF CAMPOS DOS GOYTACAZES":       ("Açu-RJ",                      False),
    "PORTO DE RIO GRANDE":             ("Rio Grande",                  False),
    "IRF NATAL":                       ("Natal",                       False),
    "PORTO DO RIO DE JANEIRO":         ("Rio de Janeiro",              False),
    # 15th entry: the canonical name for São Sebastião's URF also appears as
    # "PORTO DE SAO SEBASTIAO" in some vintages — alias it to the same port.
    "PORTO DE SAO SEBASTIAO":          ("Porto de São Sebastião",      True),
}


def _strip_accents(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
    )


def _norm_urf(raw: str) -> str:
    """Normalize a ComexStat URF label to a stable lookup key.

    "0417902 - IRF - PORTO DE SUAPE" -> "IRF PORTO DE SUAPE"
    "0317903 - IRF SAO LUIS"         -> "IRF SAO LUIS"
    "0217800 - ALF - BELÉM"          -> "ALF BELEM"
    """
    s = raw or ""
    # Drop the leading "<code> - " (numeric code + separator).
    if " - " in s:
        head, _, tail = s.partition(" - ")
        if head.strip().isdigit():
            s = tail
    s = _strip_accents(s).upper()
    # Replace any remaining dashes with spaces, then collapse whitespace.
    s = s.replace("-", " ")
    s = " ".join(s.split())
    return s


def _map_urf(raw: str) -> tuple[str, bool, str]:
    """Return (canonical_port, covered, normalized_key) for a raw URF label.

    Unknown URFs fall through as uncovered, keyed by their normalized label so
    they still appear in the bias table (visibility), prefixed "(unmapped) ".
    """
    key = _norm_urf(raw)
    if key in URF_PORT_MAP:
        port, covered = URF_PORT_MAP[key]
        return port, covered, key
    return f"(unmapped) {key}", False, key


# ── Credentials & .env discovery ───────────────────────────────────────────────

def _find_env() -> Path | None:
    """Walk up from this file looking for a .env (handles git worktrees)."""
    import os
    for base in (Path(__file__).resolve(), Path.cwd()):
        for parent in [base] + list(base.parents):
            cand = parent / ".env"
            if cand.is_file():
                return cand
    return None


def _get_creds() -> tuple[str, str]:
    import os
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        env_path = _find_env()
        if env_path:
            for line in env_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                k, v = k.strip(), v.strip()
                if k == "SUPABASE_URL" and not url:
                    url = v
                if k == "SUPABASE_SERVICE_KEY" and not key:
                    key = v
    if not url or not key:
        print("Error: SUPABASE_URL or SUPABASE_SERVICE_KEY not set "
              "(env or .env).", file=sys.stderr)
        sys.exit(1)
    return url, key


def _dados_dir() -> Path:
    """Locate the DADOS/ directory (sibling of the repo root), create if absent."""
    env_path = _find_env()
    root = env_path.parent if env_path else Path(__file__).resolve().parents[3]
    d = root / "DADOS"
    d.mkdir(parents=True, exist_ok=True)
    return d


# ── ComexStat pull (URF) ───────────────────────────────────────────────────────

def _comex_post(month: str, quiet: bool) -> tuple[list[dict], bool]:
    """POST one month of diesel imports by URF. Returns (rows, http_ok).

    http_ok distinguishes a legitimate empty (HTTP 200, no data) from a masked
    failure (every attempt non-200, e.g. sustained 429) — see CLAUDE.md
    Pegadinha #12.
    """
    payload = {
        "flow": "import",
        "monthDetail": True,
        "period": {"from": month, "to": month},
        "filters": [{"filter": "ncm", "values": [NCM_DIESEL]}],
        "details": ["ncm", "urf"],
        "metrics": ["metricFOB", "metricKG", "metricStatistic"],
    }
    http_ok = False
    for attempt in range(_COMEX_RETRIES):
        try:
            r = requests.post(_COMEX_API, headers=_COMEX_HEADERS, json=payload,
                              timeout=60)
            if r.status_code == 200:
                http_ok = True
                rows = r.json().get("data", {}).get("list", []) or []
                return rows, True
            if not quiet:
                print(f"    [warn] {month} attempt {attempt + 1}: "
                      f"HTTP {r.status_code} ({r.text[:100].strip()})")
            retry_after = r.headers.get("Retry-After")
            wait = _COMEX_BACKOFF[attempt]
            if retry_after and retry_after.isdigit():
                wait = max(wait, int(retry_after))
        except Exception as e:  # noqa: BLE001
            if not quiet:
                print(f"    [warn] {month} attempt {attempt + 1} failed: {e}")
            wait = _COMEX_BACKOFF[attempt]
        if attempt < _COMEX_RETRIES - 1:
            time.sleep(wait)
    return [], http_ok


def _comex_by_port(months: list[str], quiet: bool) -> tuple[dict[tuple[str, str], float],
                                                            dict[tuple[str, str], dict],
                                                            list[str]]:
    """Pull ComexStat-URF diesel for each month and aggregate kg -> m³ by port.

    Returns:
      comex_m3[(month, port)]  -> m³ (kg / DENSITY_KG_M3, summed over URFs that
                                  map to the same canonical port)
      meta[(month, port)]      -> {"covered": bool, "kg": float, "urfs": [labels]}
      http_failed_months       -> months where every HTTP attempt failed
    """
    comex_kg: dict[tuple[str, str], float] = defaultdict(float)
    covered_of: dict[tuple[str, str], bool] = {}
    urfs_of: dict[tuple[str, str], list[str]] = defaultdict(list)
    http_failed: list[str] = []

    for idx, month in enumerate(months):
        if not quiet:
            print(f"  ComexStat import {month} ...", end=" ", flush=True)
        rows, http_ok = _comex_post(month, quiet)
        if not http_ok:
            http_failed.append(month)
        n_mapped = 0
        for row in rows:
            kg = row.get("metricKG")
            try:
                kg = float(kg)
            except (TypeError, ValueError):
                continue
            if math.isnan(kg):
                continue
            raw_urf = str(row.get("urf") or "")
            port, covered, _key = _map_urf(raw_urf)
            comex_kg[(month, port)] += kg
            covered_of[(month, port)] = covered
            if raw_urf not in urfs_of[(month, port)]:
                urfs_of[(month, port)].append(raw_urf)
            n_mapped += 1
        if not quiet:
            print(f"{len(rows)} URF rows ({n_mapped} mapped)"
                  + ("" if http_ok else "  [HTTP FAILED]"))
        if idx < len(months) - 1:
            time.sleep(_COMEX_INTER_REQUEST_SLEEP)

    comex_m3: dict[tuple[str, str], float] = {}
    meta: dict[tuple[str, str], dict] = {}
    for key, kg in comex_kg.items():
        comex_m3[key] = kg / DENSITY_KG_M3
        meta[key] = {
            "covered": covered_of.get(key, False),
            "kg": kg,
            "urfs": urfs_of.get(key, []),
        }
    return comex_m3, meta, http_failed


# ── Our methodology (per-port discharged) ──────────────────────────────────────

def _parse_ts(s: str) -> datetime:
    return datetime.fromisoformat(s)


def _sp_month(ts: datetime) -> str:
    return ts.astimezone(SP_TZ).strftime("%Y-%m")


def _fetch_navios(sb) -> list[dict]:
    """Page all non-cabotagem navios_diesel rows needed for the replication."""
    cols = ("collected_at,porto,status,navio,quantidade_convertida,is_cabotagem")
    rows: list[dict] = []
    off = 0
    while True:
        page = sb.table("navios_diesel").select(cols).range(off, off + 999).execute()
        data = page.data or []
        rows.extend(data)
        if len(data) < 1000:
            break
        off += 1000
    out = []
    for r in rows:
        if r.get("is_cabotagem"):
            continue
        ts = _parse_ts(r["collected_at"])
        out.append({
            "ts": ts,
            "porto": r["porto"],
            "status": r["status"],
            "navio": r["navio"],
            "qc": float(r.get("quantidade_convertida") or 0.0),
            "month": _sp_month(ts),
        })
    return out


def _our_discharged_by_port(rows: list[dict], months: list[str]
                            ) -> tuple[dict[tuple[str, str], float], dict[str, float]]:
    """Replicate get_nd_volume_mensal_historico discharged, broken down per port.

    Returns:
      ours[(month, port)] -> discharged m³ for that port in that month
      totals[month]       -> sum over ports (for the sanity check vs the RPC)
    """
    # anchor per month = MAX(collected_at) whose SP-month == that month.
    month_max: dict[str, datetime] = {}
    for r in rows:
        m = r["month"]
        if m not in month_max or r["ts"] > month_max[m]:
            month_max[m] = r["ts"]

    ours: dict[tuple[str, str], float] = defaultdict(float)
    totals: dict[str, float] = {}

    for target in months:
        if target not in month_max:
            totals[target] = 0.0
            continue
        anchor = month_max[target]
        anchor_rows = [r for r in rows if r["ts"] == anchor]
        # error_ports: ERRO_COLETA at the anchor — excluded entirely.
        error_ports = {r["porto"] for r in anchor_rows if r["status"] == "ERRO_COLETA"}
        # anchor_set: (navio, porto) still pending at the anchor.
        anchor_set = {
            (r["navio"], r["porto"]) for r in anchor_rows
            if r["status"] not in ("ERRO_COLETA", "Despachado")
        }
        # vessel_last_row: latest row per (navio, porto), collected_at <= anchor,
        # status <> ERRO_COLETA.
        last: dict[tuple[str, str], dict] = {}
        for r in rows:
            if r["ts"] > anchor or r["status"] == "ERRO_COLETA":
                continue
            key = (r["navio"], r["porto"])
            if key not in last or r["ts"] > last[key]["ts"]:
                last[key] = r
        # discharged: not pending, port not an error_port, and the vessel's
        # last-seen SP-month == target (attribution_month filter, exactly as the
        # RPC's discharged CTE join d.attribution_month = ma.month).
        total = 0.0
        for (navio, porto), r in last.items():
            if (navio, porto) in anchor_set:
                continue
            if porto in error_ports:
                continue
            if _sp_month(r["ts"]) != target:
                continue
            ours[(target, porto)] += r["qc"]
            total += r["qc"]
        totals[target] = total
    return ours, totals


def _rpc_totals(sb, quiet: bool) -> dict[str, float]:
    """Pull the RPC's per-month discharged totals for the sanity check."""
    mx = (sb.table("navios_diesel")
            .select("collected_at")
            .order("collected_at", desc=True)
            .limit(1).execute())
    if not mx.data:
        return {}
    anchor = mx.data[0]["collected_at"]
    res = sb.rpc("get_nd_volume_mensal_historico",
                 {"p_collected_at": anchor}).execute()
    out: dict[str, float] = {}
    for r in (res.data or []):
        out[r["month"]] = float(r.get("discharged_volume") or 0.0)
    return out


# ── Month range ────────────────────────────────────────────────────────────────

def _add_month(m: str, delta: int) -> str:
    y, mo = map(int, m.split("-"))
    idx = (y * 12 + (mo - 1)) + delta
    return f"{idx // 12:04d}-{idx % 12 + 1:02d}"


def _closed_months(rows: list[dict], frm: str | None, to: str | None) -> list[str]:
    """Resolve the [from, to] range of CLOSED months to backtest.

    Default: BASELINE_MONTH .. last full month before the current SP month,
    intersected with the months for which navios_diesel actually has data.
    """
    current = datetime.now(SP_TZ).strftime("%Y-%m")
    last_closed = _add_month(current, -1)
    have = sorted({r["month"] for r in rows})
    lo = frm or BASELINE_MONTH
    hi = to or last_closed
    if lo < BASELINE_MONTH:
        lo = BASELINE_MONTH
    # Never backtest the current (open) month — desembaraço lag makes it noise.
    if hi >= current:
        hi = last_closed
    months = [m for m in have if lo <= m <= hi]
    return months


# ── Bias table assembly + persistence ──────────────────────────────────────────

def _build_table(ours: dict[tuple[str, str], float],
                 comex_m3: dict[tuple[str, str], float],
                 meta: dict[tuple[str, str], dict],
                 months: list[str]) -> pd.DataFrame:
    """One row per (month, port) present on either side. a=ours, b=comex."""
    keys = set(ours) | set(comex_m3)
    recs = []
    for (month, port) in sorted(keys):
        if month not in months:
            continue
        a = ours.get((month, port), 0.0)
        b = comex_m3.get((month, port), 0.0)
        m = meta.get((month, port), {})
        covered = bool(m.get("covered", False))
        ratio = (a / b) if b else None
        recs.append({
            "mes": month,
            "porto": port,
            "covered": covered,
            "ours_m3": round(a, 2),
            "comex_m3": round(b, 2),
            "comex_kg": round(m.get("kg", 0.0), 1),
            "diff_b_minus_a": round(b - a, 2),
            "ratio_a_over_b": round(ratio, 4) if ratio is not None else None,
            "comex_urfs": "; ".join(m.get("urfs", [])) or None,
            "computed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        })
    return pd.DataFrame.from_records(recs)


_COLUMNS = [
    "mes", "porto", "covered", "ours_m3", "comex_m3", "comex_kg",
    "diff_b_minus_a", "ratio_a_over_b", "comex_urfs", "computed_at",
]


def _upsert_parquet(df_new: pd.DataFrame, quiet: bool) -> Path:
    """Append/upsert by (mes, porto) into DADOS/navios_comex_backtest.parquet.

    Never deletes the file and rebuilds — preserves prior months (project
    standard). Existing (mes, porto) rows are overwritten by the fresh run.
    """
    dados = _dados_dir()
    pq = dados / OUT_PARQUET
    csv = dados / OUT_CSV

    if pq.exists():
        try:
            existing = pd.read_parquet(pq)
        except Exception as e:  # noqa: BLE001
            print(f"  [warn] could not read existing parquet ({e}); "
                  f"starting fresh frame", file=sys.stderr)
            existing = pd.DataFrame(columns=_COLUMNS)
    else:
        existing = pd.DataFrame(columns=_COLUMNS)

    # Drop the (mes, porto) pairs we just recomputed, then concat the new rows.
    if not existing.empty and not df_new.empty:
        new_keys = set(zip(df_new["mes"], df_new["porto"]))
        mask = [
            (m, p) not in new_keys
            for m, p in zip(existing["mes"], existing["porto"])
        ]
        existing = existing[mask]

    # Avoid the pandas FutureWarning about concatenating an all-NA/empty frame:
    # only concat the side(s) that actually carry rows.
    parts = [d for d in (existing, df_new) if not d.empty]
    if parts:
        combined = pd.concat(parts, ignore_index=True)
    else:
        combined = pd.DataFrame(columns=_COLUMNS)
    # Guard against accidental dup keys before writing (CLAUDE.md: dedupe before
    # upsert) — keep the last occurrence (the fresh run).
    combined = (combined
                .drop_duplicates(subset=["mes", "porto"], keep="last")
                .sort_values(["mes", "covered", "porto"],
                             ascending=[True, False, True])
                .reset_index(drop=True))
    # Stable column order.
    for c in _COLUMNS:
        if c not in combined.columns:
            combined[c] = None
    combined = combined[_COLUMNS]

    combined.to_parquet(pq, index=False)
    combined.to_csv(csv, index=False, encoding="utf-8")
    if not quiet:
        print(f"\nWrote {len(df_new)} fresh rows -> {pq} "
              f"({len(combined)} total rows after upsert)")
        print(f"  sibling CSV -> {csv}")
    return pq


# ── Bias monitor ───────────────────────────────────────────────────────────────

def _run_monitor(df: pd.DataFrame, quiet: bool) -> bool:
    """Print the bias verdict; return True if any COVERED port breaches.

    A breach for the exit code = a covered port with ratio>BIAS_HIGH or
    ratio<BIAS_LOW. Persistence (>= BIAS_PERSIST_MONTHS consecutive closed
    months) is reported as a stronger signal but a single-month covered breach
    already trips the gate so a freshly-introduced scraper bug is caught early.
    """
    breached = False
    if df.empty:
        return False

    # Per-port consecutive-breach detection for the persistence note.
    persistent: list[str] = []
    for port, grp in df[df["covered"]].groupby("porto"):
        grp = grp.sort_values("mes")
        streak = 0
        worst = 0
        direction = ""
        for _, row in grp.iterrows():
            ratio = row["ratio_a_over_b"]
            if ratio is None or (isinstance(ratio, float) and math.isnan(ratio)):
                streak = 0
                continue
            if ratio > BIAS_HIGH:
                streak = streak + 1 if direction == "high" else 1
                direction = "high"
            elif ratio < BIAS_LOW:
                streak = streak + 1 if direction == "low" else 1
                direction = "low"
            else:
                streak = 0
                direction = ""
            worst = max(worst, streak)
        if worst >= BIAS_PERSIST_MONTHS:
            persistent.append(f"{port} ({direction}, {worst} consecutive months)")

    if not quiet:
        print("\n=== Bias monitor ===")
        print(f"  thresholds: a/b > {BIAS_HIGH} (over-count) or "
              f"< {BIAS_LOW} (under-count); persistence >= "
              f"{BIAS_PERSIST_MONTHS} months")

    for _, row in df.iterrows():
        ratio = row["ratio_a_over_b"]
        if ratio is None or (isinstance(ratio, float) and math.isnan(ratio)):
            continue
        hi = ratio > BIAS_HIGH
        lo = ratio < BIAS_LOW
        if not (hi or lo):
            continue
        tag = "OVER-COUNT" if hi else "UNDER-COUNT"
        scope = "COVERED" if row["covered"] else "uncovered"
        if row["covered"]:
            breached = True
        if not quiet:
            print(f"  [{tag}] {scope:9s} {row['mes']} {row['porto']}: "
                  f"ours={row['ours_m3']:,.0f} comex={row['comex_m3']:,.0f} "
                  f"a/b={ratio:.2f}")

    if persistent and not quiet:
        print("  PERSISTENT covered breaches (>= "
              f"{BIAS_PERSIST_MONTHS} consecutive months):")
        for p in persistent:
            print(f"    - {p}")

    return breached


# ── Pretty print ───────────────────────────────────────────────────────────────

def _print_table(df: pd.DataFrame) -> None:
    print("\n=== Bias table (a=ours, b=ComexStat, both m³ @832 kg/m³) ===")
    hdr = (f"{'mes':7s} {'cov':3s} {'port':26s} "
           f"{'ours(a)':>12s} {'comex(b)':>12s} {'b-a':>12s} {'a/b':>7s}")
    print(hdr)
    print("-" * len(hdr))
    for _, r in df.iterrows():
        ratio = r["ratio_a_over_b"]
        rs = f"{ratio:.2f}" if (ratio is not None
                                and not (isinstance(ratio, float) and math.isnan(ratio))
                                ) else "  -"
        cov = "yes" if r["covered"] else " no"
        print(f"{r['mes']:7s} {cov:3s} {str(r['porto'])[:26]:26s} "
              f"{r['ours_m3']:>12,.0f} {r['comex_m3']:>12,.0f} "
              f"{r['diff_b_minus_a']:>12,.0f} {rs:>7s}")


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(
        description="Offline ComexStat-URF backtest of the /navios-diesel "
                    "monthly diesel-volume methodology (closed months only).")
    ap.add_argument("--from", dest="frm", type=str, default=None,
                    help="First closed month YYYY-MM (default: 2026-04).")
    ap.add_argument("--to", dest="to", type=str, default=None,
                    help="Last closed month YYYY-MM (default: last full month).")
    ap.add_argument("--dry-run", action="store_true",
                    help="Do not write the parquet/CSV; just print + monitor.")
    ap.add_argument("--quiet", action="store_true",
                    help="Suppress progress chatter (keep table + monitor).")
    args = ap.parse_args()
    quiet = args.quiet

    url, key = _get_creds()
    sb = create_client(url, key)

    # ── Step 3a: our methodology (per port) ──
    if not quiet:
        print("Reading navios_diesel (service-role) ...")
    navios = _fetch_navios(sb)
    months = _closed_months(navios, args.frm, args.to)
    if not months:
        print("No closed months to backtest in the requested range.",
              file=sys.stderr)
        sys.exit(1)
    if not quiet:
        print(f"Closed months: {months[0]} .. {months[-1]} ({len(months)})")

    ours, totals = _our_discharged_by_port(navios, months)

    # ── Sanity check: per-port sum == RPC total ──
    rpc_tot = _rpc_totals(sb, quiet)
    sanity_ok = True
    if not quiet:
        print("\n=== Sanity check (per-port sum vs RPC discharged total) ===")
    for m in months:
        ours_sum = totals.get(m, 0.0)
        rpc_v = rpc_tot.get(m)
        if rpc_v is None:
            if not quiet:
                print(f"  {m}: ours_sum={ours_sum:,.2f}  (RPC has no row — skip)")
            continue
        match = abs(ours_sum - rpc_v) < 0.5
        sanity_ok = sanity_ok and match
        flag = "OK" if match else "MISMATCH"
        if not quiet:
            print(f"  {m}: ours_sum={ours_sum:,.2f}  rpc={rpc_v:,.2f}  [{flag}]")
    if not sanity_ok:
        print("\n[ERROR] per-port replication does not match the RPC total — "
              "the methodology replication has drifted from the migration. "
              "Refusing to trust the bias table.", file=sys.stderr)
        sys.exit(3)

    # ── Step 1: ComexStat-URF pull ──
    if not quiet:
        print("\nPulling ComexStat-URF (diesel 27101921, import) ...")
    comex_m3, meta, http_failed = _comex_by_port(months, quiet)
    if http_failed:
        print(f"\n[ERROR] ComexStat HTTP failed for: {', '.join(http_failed)} "
              "— bias table would be incomplete. Aborting without writing.",
              file=sys.stderr)
        sys.exit(2)

    # ── Step 4: bias table ──
    df = _build_table(ours, comex_m3, meta, months)
    _print_table(df)

    # ── Step 5: monitor ──
    breached = _run_monitor(df, quiet)

    # ── Persist (in-place upsert) ──
    if args.dry_run:
        if not quiet:
            print("\n[dry-run] skipping parquet/CSV write.")
    else:
        _upsert_parquet(df, quiet)

    if breached:
        print("\n[ALERT] At least one COVERED port breached the bias threshold "
              "(see monitor above). Exiting non-zero so a future workflow can "
              "gate on it. NOTE: ComexStat lags physical discharge — a small "
              "breach on a single recent month can be lag, not a bug; a "
              "persistent breach (e.g. Itaqui over-counting) is the real signal.",
              file=sys.stderr)
        sys.exit(4)

    if not quiet:
        print("\nDone. All covered ports within bias thresholds.")


if __name__ == "__main__":
    main()
