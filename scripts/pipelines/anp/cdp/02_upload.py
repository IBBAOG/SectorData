#!/usr/bin/env python3
"""Upload ANP CDP production data to Supabase.

Modes:
  --from-parquet PATH   Historical backfill from consolidated Parquet
  --from-csv-dir DIR    Incremental update from CI CSV output directory

Environment:
  SUPABASE_URL, SUPABASE_SERVICE_KEY

# IMPORTANT: This pipeline must NOT aggregate, dedupe, or transform production
# values. The CDP APEX CSV is authoritative — load it row-by-row as-is.
# Any "fix" that sums/averages/filters production has been a regression.
# See docs/app/anp-cdp.md "As-is loading contract" before changing.
"""

import argparse
import glob
import os
import re
import time
from pathlib import Path

import pandas as pd
from supabase import create_client

# Load .env / .env.local from project root (grandparent of this script)
try:
    from dotenv import load_dotenv
    _root = Path(__file__).resolve().parent.parent
    load_dotenv(_root / ".env")
    load_dotenv(_root / ".env.local", override=False)
except ImportError:
    pass

SUPABASE_URL = (
    os.environ.get("SUPABASE_URL")
    or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
)
SUPABASE_SERVICE_KEY = (
    os.environ.get("SUPABASE_SERVICE_KEY")
    or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
)

if not SUPABASE_URL:
    raise SystemExit("ERROR: set SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL")
if not SUPABASE_SERVICE_KEY:
    raise SystemExit(
        "ERROR: set SUPABASE_SERVICE_KEY\n"
        "  Get it from: Supabase Dashboard → Project Settings → API → service_role"
    )

BATCH = 200
_AMBIENTE_TO_LOCAL = {"M": "PosSal", "S": "PreSal", "T": "Terra"}
_PAT_CSV = re.compile(r"producao_poco_(\d{2})-(\d{4})_([MST])\.csv$", re.IGNORECASE)

# ── Source format guard ────────────────────────────────────────────────────────
# The CDP APEX portal produces well codes (poco) in SIGEP hyphenated format:
#   e.g. "7-SPH-6-SPS", "1-RJS-400-RJ", "3-FRA-77D-SES"
# Power BI exports compact codes without hyphens:
#   e.g. "7SPH6SPS", "1RJS400RJ", "3FRA77DSES"
# If a dataset is predominantly in compact format, it was NOT sourced from the
# CDP APEX portal and must not be uploaded into anp_cdp_producao.
_PAT_APEX_POCO = re.compile(r"^\d+-[A-Z0-9]+-", re.IGNORECASE)
_COMPACT_FORMAT_THRESHOLD = 0.20   # abort if >20% of rows are compact (non-hyphenated)

# Primary key columns for upsert conflict resolution.
# The APEX CSV has one row per (poco, campo, bacia) per file (per local per period).
# This is guaranteed unique by the ANP portal structure — no aggregation is needed.
_PK = ["ano", "mes", "poco", "campo", "bacia", "local"]

# Parquet → canonical column names
_RENAME = {
    "nome_poco_anp":             "poco",
    "gas_natural_total_mm3_dia": "gas_total_mm3_dia",
}

# All production numeric columns — stored as-is from the CSV (no transformation).
# Note: condensado_bbl_dia, gas_natural_assoc_mm3_dia, gas_natural_n_assoc_mm3_dia,
# and gas_royalties were dropped from anp_cdp_producao (DB DROP COLUMN). The pipeline
# no longer writes them. Historic parquet files retain these columns in-place per the
# project's parquet-in-place rule.
_NUM_COLS = [
    "petroleo_bbl_dia",
    "oleo_bbl_dia",
    "gas_total_mm3_dia",
    "agua_bbl_dia",
    "tempo_prod_hs_mes",
]

# Text metadata columns
_META_COLS = [
    "estado",
    "nome_poco_operador",
    "operador",
    "num_contrato",
    "instalacao_destino",
    "tipo_instalacao",
]


def _check_poco_format(df: pd.DataFrame, allow_non_apex: bool = False) -> None:
    """
    Validate that poco values are in APEX hyphenated format.

    Raises SystemExit if more than _COMPACT_FORMAT_THRESHOLD fraction of rows
    have compact (non-hyphenated) poco codes, unless allow_non_apex is True.
    This guards against accidentally uploading Power BI data into anp_cdp_producao.
    """
    if "poco" not in df.columns or df.empty:
        return
    total = len(df)
    compact = df["poco"].apply(
        lambda v: bool(v) and not _PAT_APEX_POCO.match(str(v).strip())
    ).sum()
    ratio = compact / total if total > 0 else 0.0
    if ratio > _COMPACT_FORMAT_THRESHOLD:
        pct = ratio * 100
        sample = df.loc[
            df["poco"].apply(lambda v: bool(v) and not _PAT_APEX_POCO.match(str(v).strip())),
            "poco"
        ].head(5).tolist()
        msg = (
            f"\nERROR: {pct:.1f}% of rows have poco in compact format "
            f"(e.g. {sample[0]!r} ...),\n"
            f"       expected APEX hyphenated format (e.g. '7-SPH-6-SPS').\n"
            f"       This pipeline must consume the CDP APEX portal, not Power BI.\n"
            f"       Power BI feeds the SEPARATE /anp-cdp-diaria dashboard "
            f"(table anp_cdp_diaria*).\n"
            f"       If you intend to change source, update docs/app/anp-cdp.md\n"
            f"       and remove this guard explicitly (--allow-non-apex-format)."
        )
        if allow_non_apex:
            print(f"  [WARN] {msg.strip()} (suppressed by --allow-non-apex-format)")
        else:
            raise SystemExit(msg)


def _get_max_date(sb) -> tuple[int, int]:
    """Return overall (max_ano, max_mes) across all locals — kept for parquet backfill."""
    r = (
        sb.table("anp_cdp_producao")
        .select("ano,mes")
        .order("ano", desc=True)
        .order("mes", desc=True)
        .limit(1)
        .execute()
    )
    if r.data:
        return (r.data[0]["ano"], r.data[0]["mes"])
    return (0, 0)


def _get_max_date_per_local(sb) -> dict[str, tuple[int, int]]:
    """Return {local: (max_ano, max_mes)} for each local value in the DB.

    The ANP publishes offshore (Mar/Pre-Sal) and onshore (Terra) data at different
    times within the same reporting month.  Using a single global max-date for the
    incremental-skip check causes previously-missing offshore data to be silently
    skipped once Terra is already loaded for that month.  Tracking per-local prevents
    that gap.
    """
    result: dict[str, tuple[int, int]] = {}
    for local in _AMBIENTE_TO_LOCAL.values():
        r = (
            sb.table("anp_cdp_producao")
            .select("ano,mes")
            .eq("local", local)
            .order("ano", desc=True)
            .order("mes", desc=True)
            .limit(1)
            .execute()
        )
        if r.data:
            result[local] = (r.data[0]["ano"], r.data[0]["mes"])
        else:
            result[local] = (0, 0)
    return result


def _prepare(df: pd.DataFrame, allow_non_apex: bool = False) -> pd.DataFrame:
    # IMPORTANT: This pipeline must NOT aggregate, dedupe, or transform production
    # values. The CDP APEX CSV is authoritative — load it row-by-row as-is.
    # Any "fix" that sums/averages/filters production has been a regression.
    # See docs/app/anp-cdp.md "As-is loading contract" before changing.

    df = df.rename(columns=_RENAME)

    # Drop columns that no longer exist in the DB (parquet-in-place rule keeps them in
    # historical files; we strip them here so --from-parquet backfill doesn't fail with
    # "column does not exist" on supabase-py upsert). The CSV path is also safe by
    # construction (_parse_csv only emits canonical columns), but the drop is idempotent
    # and centralizes the contract here for both entry points.
    df = df.drop(
        columns=[
            "condensado_bbl_dia",
            "gas_natural_assoc_mm3_dia",
            "gas_natural_n_assoc_mm3_dia",
            "gas_royalties",
        ],
        errors="ignore",
    )

    # Ensure all required columns exist; fill missing with defaults
    for col in _NUM_COLS:
        if col not in df.columns:
            df[col] = 0.0
    for col in _META_COLS:
        if col not in df.columns:
            df[col] = None

    # Strip whitespace from text columns
    for col in ("poco", "campo", "bacia") + tuple(_META_COLS):
        if col in df.columns and df[col].dtype == object:
            df[col] = df[col].str.strip()

    # Guard: validate poco format before upsert
    _check_poco_format(df, allow_non_apex=allow_non_apex)

    # NO aggregation, NO deduplication, NO filtering of "zero-production" wells.
    # The ANP CSV is the source of truth. Each row goes into the DB exactly as-is.
    # Wells with zero production are legitimate — they are still published by the ANP.
    return df


# ── Cross-local self-heal (incident 2026-05-23) ───────────────────────────────
# The DB trigger `trg_anp_cdp_guard_cross_local` (migration 20260521130000)
# RAISEs when an INSERT would create a second row for the same
# (ano, mes, poco, campo, bacia) under a different `local`. Format:
#   "Cross-local duplicate blocked: (ano=<n>, mes=<n>, poco=<s>, campo=<s>,
#    bacia=<s>) already exists with local=<l1>. New insert would add local=<l2>."
#
# When this happens during normal ETL, it means the ANP republished a well's
# classification (e.g. PosSal -> PreSal). The new local is authoritative.
# The fix is to DELETE the stale row (old local) and retry the batch.
#
# Without this self-heal, a single republished well aborts the whole batch
# of ~200 rows and ALL 60 GHA runs since 2026-05-23 failed.
_CROSS_LOCAL_RE = re.compile(
    r"Cross-local duplicate blocked: \(ano=(?P<ano>\d+), mes=(?P<mes>\d+), "
    r"poco=(?P<poco>[^,]+), campo=(?P<campo>[^,]+), bacia=(?P<bacia>[^)]+)\) "
    r"already exists with local=(?P<old>[A-Za-z]+)\. "
    r"New insert would add local=(?P<new>[A-Za-z]+)\.",
)


def _extract_error_message(e: Exception) -> str:
    """Return the human-readable message from a postgrest APIError or generic Exception.

    `postgrest.exceptions.APIError` exposes `.message` (the Postgres RAISE text).
    Older clients may only expose it via `str(e)` which serialises the dict.
    """
    msg = getattr(e, "message", None)
    if isinstance(msg, str) and msg:
        return msg
    return str(e)


def _parse_cross_local_conflict(e: Exception) -> dict | None:
    """Detect & parse a 'Cross-local duplicate blocked' error.

    Returns a dict {ano, mes, poco, campo, bacia, old, new} on match, else None.
    The trigger only reports the FIRST conflict per failed INSERT statement,
    so callers must retry the batch — additional conflicts (if any) will
    surface one at a time on each retry.
    """
    text = _extract_error_message(e)
    if "Cross-local duplicate blocked" not in text:
        return None
    m = _CROSS_LOCAL_RE.search(text)
    if not m:
        # Marker found but format unexpected — surface to ops without self-heal.
        print(f"  [self-heal] Marker found but regex failed to parse: {text!r}")
        return None
    return {
        "ano": int(m.group("ano")),
        "mes": int(m.group("mes")),
        "poco": m.group("poco").strip(),
        "campo": m.group("campo").strip(),
        "bacia": m.group("bacia").strip(),
        "old": m.group("old").strip(),
        "new": m.group("new").strip(),
    }


def _delete_stale_local(sb, conflict: dict) -> int:
    """DELETE the stale row whose (ano, mes, poco, campo, bacia) matches but local=old.

    Returns the number of rows deleted (expected: 1; 0 means a concurrent run
    already removed it; >1 is a data anomaly worth flagging).
    """
    r = (
        sb.table("anp_cdp_producao")
        .delete()
        .eq("ano", conflict["ano"])
        .eq("mes", conflict["mes"])
        .eq("poco", conflict["poco"])
        .eq("campo", conflict["campo"])
        .eq("bacia", conflict["bacia"])
        .eq("local", conflict["old"])
        .execute()
    )
    n = len(r.data or [])
    if n > 1:
        print(
            f"  [self-heal][WARN] Deleted {n} stale rows for "
            f"(ano={conflict['ano']}, mes={conflict['mes']}, poco={conflict['poco']}, "
            f"campo={conflict['campo']}, bacia={conflict['bacia']}, local={conflict['old']}) "
            f"— expected 1. Possible data anomaly upstream."
        )
    return n


# Maximum number of distinct cross-local conflicts we self-heal per batch
# before giving up. Each successful heal triggers a re-attempt; without
# bound a malformed batch could loop forever consuming a row at a time.
# Empirically the ANP republishes <5 wells per period, so 10 is generous.
_MAX_CROSS_LOCAL_HEALS_PER_BATCH = 10


def _upsert(sb, rows: list[dict]) -> None:
    total = len(rows)
    ok = 0
    for i in range(0, total, BATCH):
        batch = rows[i : i + BATCH]
        ano_label = batch[0]["ano"]
        heals_done = 0
        # `attempt` counts transient-error retries only. Cross-local heals do
        # NOT consume an attempt — they extend the retry budget because the
        # batch hasn't truly "failed", only one row needed reclassification.
        attempt = 0
        while True:
            try:
                sb.table("anp_cdp_producao").upsert(
                    batch, on_conflict="ano,mes,poco,campo,bacia,local"
                ).execute()
                ok += len(batch)
                break
            except Exception as e:
                # Cross-local republish: ANP changed a well's classification.
                # Delete the stale row (old local) and retry the same batch.
                conflict = _parse_cross_local_conflict(e)
                if conflict is not None:
                    if heals_done >= _MAX_CROSS_LOCAL_HEALS_PER_BATCH:
                        print(
                            f"  [self-heal][ABORT] Batch {i}-{i+len(batch)} (ano~{ano_label}) "
                            f"hit {heals_done} cross-local heals without converging — "
                            f"escalating last error: {e}"
                        )
                        raise
                    deleted = _delete_stale_local(sb, conflict)
                    print(
                        f"  [self-heal] Resolved cross-local republish: "
                        f"ano={conflict['ano']} mes={conflict['mes']} "
                        f"poco={conflict['poco']} campo={conflict['campo']} "
                        f"bacia={conflict['bacia']} "
                        f"(was: local={conflict['old']} -> now: local={conflict['new']}). "
                        f"Deleted {deleted} old row(s). Retrying batch."
                    )
                    heals_done += 1
                    # Loop again WITHOUT incrementing `attempt` (this isn't a transient failure).
                    continue

                # Transient error path (network, timeout, etc.) — exponential backoff.
                if attempt >= 2:
                    print(f"  ERRO batch {i}-{i+len(batch)} (ano~{ano_label}): {e}")
                    raise
                time.sleep(2 ** attempt)
                attempt += 1
                continue
        print(f"  {ok}/{total} rows upserted (ano ~{ano_label})…", end="\r")
    print(f"\n  Done: {ok} rows upserted.")


def _rows_from_df(df: pd.DataFrame) -> list[dict]:
    import math
    df = df.dropna(subset=_PK)
    # Fill NaN in numeric cols with None (NULL in DB) — not 0.
    # The ANP may publish NULL for a column legitimately.
    rows = df.where(pd.notna(df), None).to_dict("records")
    for r in rows:
        r["ano"] = int(r["ano"])
        r["mes"] = int(r["mes"])
        # Catch any residual float nan that escaped the where() replacement
        # (can happen with object-dtype columns holding float nan values).
        for k, v in r.items():
            if isinstance(v, float) and math.isnan(v):
                r[k] = None
    return rows


def _purge_period(sb, ano: int, mes: int) -> None:
    """Delete all rows for a given (ano, mes) before re-uploading.

    Use this to guarantee a clean slate when re-processing a month that may
    contain rows from an old data format (e.g. compact poco codes without
    dashes) that would otherwise survive a PK-based upsert and create
    apparent duplicates.
    """
    print(f"  Purging existing rows for {ano}/{mes:02d}…")
    deleted = 0
    for local in _AMBIENTE_TO_LOCAL.values():
        r = (
            sb.table("anp_cdp_producao")
            .delete()
            .eq("ano", ano)
            .eq("mes", mes)
            .eq("local", local)
            .execute()
        )
        deleted += len(r.data)
    print(f"  Purged {deleted} rows for {ano}/{mes:02d}.")


def _refresh_mv(sb) -> None:
    print("  Refreshing materialized view mv_anp_cdp_pocos…")
    try:
        sb.rpc("refresh_anp_cdp_pocos", {}).execute()
        print("  View refreshed.")
    except Exception as e:
        print(f"  WARN: could not refresh view: {e}")


def _refresh_production_mv(sb) -> None:
    """Refresh the /well-by-well dashboard MVs after a CDP upload batch.

    Calls refresh_mv_production() which refreshes:
      - mv_production_monthly
      - mv_production_installation_monthly
      - mv_brazil_monthly
    These MVs cache pre-joined anp_cdp_producao x field_stakes data (Round 5 perf).
    Granted to service_role only. Non-fatal: stale MVs are acceptable until next run.
    """
    try:
        sb.rpc("refresh_mv_production", {}).execute()
        print("  Refreshed mv_production_monthly + mv_production_installation_monthly + mv_brazil_monthly")
    except Exception as e:
        # Don't fail the pipeline on MV refresh error — data is still in anp_cdp_producao;
        # MV just stale until next run.
        print(f"  WARNING: failed to refresh production MVs: {e}")


def _warn_partial_offshore(sb, periods_uploaded: set[tuple[int, int]]) -> None:
    """
    Emit a warning when offshore (PosSal/PreSal) well counts for the uploaded month
    are less than 50% of the previous month.  This signals partial data — the ANP
    publishes incrementally throughout month M+1 as operators submit their reports.
    Does NOT fail the pipeline; informational only.
    """
    offshore_locals = ("PosSal", "PreSal")
    for ano, mes in sorted(periods_uploaded):
        prev_ano, prev_mes = (ano, mes - 1) if mes > 1 else (ano - 1, 12)
        for local in offshore_locals:
            try:
                cur = (
                    sb.table("anp_cdp_producao")
                    .select("poco", count="exact")
                    .eq("local", local)
                    .eq("ano", ano)
                    .eq("mes", mes)
                    .execute()
                )
                prev = (
                    sb.table("anp_cdp_producao")
                    .select("poco", count="exact")
                    .eq("local", local)
                    .eq("ano", prev_ano)
                    .eq("mes", prev_mes)
                    .execute()
                )
                cur_count = cur.count or 0
                prev_count = prev.count or 0
                if prev_count > 0:
                    ratio = cur_count / prev_count
                    status = "OK" if ratio >= 0.5 else "PARTIAL"
                    print(
                        f"  [coverage] {local} {ano}/{mes:02d}: "
                        f"{cur_count} wells vs {prev_count} in {prev_ano}/{prev_mes:02d} "
                        f"({ratio:.0%}) — {status}"
                    )
                    if ratio < 0.5:
                        print(
                            f"  [WARN] {local} {ano}/{mes:02d} has only {ratio:.0%} of prior month wells. "
                            f"ANP data for this month is likely still being submitted by operators. "
                            f"Pipeline will re-run automatically to capture more data as it becomes available."
                        )
            except Exception as e:
                print(f"  [coverage] {local} {ano}/{mes:02d}: could not compare ({e})")


def _validate_row_count(sb, ano: int, mes: int) -> None:
    """Print offshore distinct-well count for the uploaded period.

    Expected baseline for a complete month: ~774 wells (PosSal + PreSal combined)
    matching the ANP portal pagination.
    """
    try:
        from supabase import PostgrestAPIError
    except ImportError:
        PostgrestAPIError = Exception

    for local in ("PosSal", "PreSal"):
        try:
            r = (
                sb.table("anp_cdp_producao")
                .select("poco", count="exact")
                .eq("ano", ano)
                .eq("mes", mes)
                .eq("local", local)
                .execute()
            )
            print(f"  [validate] {local} {ano}/{mes:02d}: {r.count or 0} rows in DB")
        except Exception as e:
            print(f"  [validate] {local} {ano}/{mes:02d}: could not count ({e})")


# ── Defense-in-depth post-upload checks (Phase B1, 2026-05-21) ─────────────────
# Three guards added after the Apr/2026 triplication incident (rows triplicated
# across PosSal/PreSal/Terra → 12.853 kbpd vs ~4.337 kbpd corrected, 3rd occurrence
# of the same bug). The Fase A SQL quarantine moved 2,076 rows to
# `_quarantine_anp_cdp_apr2026`. These checks prevent the next occurrence by:
#   1) Detecting cross-local duplication for any (poco, campo, bacia) in a period
#   2) Spike-flagging months where production is >1.8x trailing 3-month average
#   3) Refusing to upload when M/S/T frames overlap >5% (ANP returns same CSV bug)
# All three RAISE on failure to abort the pipeline and surface in GHA logs.


def _check_cross_local_duplicates(sb, ano: int, mes: int) -> None:
    """Fail-loud if same (poco, campo, bacia) has rows with >1 local in (ano, mes).

    Pulls every row for the period and aggregates client-side because PostgREST
    cannot express GROUP BY ... HAVING COUNT(DISTINCT) > 1.  This is bounded:
    a single (ano, mes) has at most ~7k rows (Apr/2026 reached ~6,413 after the
    triplication; healthy months sit around 2,100-2,400).
    """
    rows_seen: list[dict] = []
    PAGE = 1000
    offset = 0
    while True:
        try:
            r = (
                sb.table("anp_cdp_producao")
                .select("poco,campo,bacia,local")
                .eq("ano", ano)
                .eq("mes", mes)
                .range(offset, offset + PAGE - 1)
                .execute()
            )
        except Exception as e:
            print(f"  [cross-local-check] {ano}/{mes:02d}: could not query ({e}); skipping")
            return
        data = r.data or []
        rows_seen.extend(data)
        if len(data) < PAGE:
            break
        offset += PAGE
        if offset > 50_000:
            # safety cap; healthy month should never reach this.
            # Fail loud: silent truncation could mask the very bug this check
            # exists to detect — a quadruplication producing >50k rows would
            # be partially scanned and GROUP BY could report "OK" on a sample.
            raise RuntimeError(
                f"safety cap exceeded ({offset} rows) for ano={ano} mes={mes} "
                f"— halt to inspect manually; possible amplification bug"
            )

    # Group by (poco, campo, bacia) -> set of distinct local values
    triplet_to_locals: dict[tuple, set] = {}
    for row in rows_seen:
        key = (row.get("poco"), row.get("campo"), row.get("bacia"))
        loc = row.get("local")
        if loc:
            triplet_to_locals.setdefault(key, set()).add(loc)

    offenders = [
        (key, locs) for key, locs in triplet_to_locals.items() if len(locs) > 1
    ]
    if offenders:
        sample = "; ".join(
            f"{k[0]}@{k[1]}/{k[2]} ({len(locs)} locais: {sorted(locs)})"
            for k, locs in offenders[:5]
        )
        raise RuntimeError(
            f"CROSS-LOCAL DUPLICATE DETECTED em ano={ano} mes={mes}: "
            f"{len(offenders)} wells (sample: {sample}). "
            f"Pipeline aborted to prevent dashboard KPI inflation. "
            f"Investigate _AMBIENTE_TO_LOCAL mapping or ANP response duplication."
        )
    print(f"  [cross-local-check] {ano}/{mes:02d}: OK (no triplet in >1 local)")


def _warn_spike_upward(sb, ano: int, mes: int) -> None:
    """Fail if monthly petroleum SUM is >1.8x the 3-month trailing average.

    The trailing window is the 3 months immediately preceding (ano, mes).
    Skips silently if fewer than 2 trailing months have data (e.g. first months
    in DB) to avoid false alarms on backfill.

    Threshold tiers:
      ratio > 1.8  → RAISE (likely duplication)
      ratio > 1.4  → print WARN (verify visually but continue)
      ratio ≤ 1.4  → silent (normal seasonal variation)
    """
    # Build the trailing 3 months preceding (ano, mes)
    trailing_months: list[tuple[int, int]] = []
    a, m = ano, mes
    for _ in range(3):
        m -= 1
        if m < 1:
            m = 12
            a -= 1
        trailing_months.append((a, m))

    def _sum_petroleo(year: int, month: int) -> float | None:
        """Return SUM(petroleo_bbl_dia) for the given period, or None if no rows."""
        total = 0.0
        any_data = False
        offset = 0
        PAGE = 1000
        while True:
            try:
                r = (
                    sb.table("anp_cdp_producao")
                    .select("petroleo_bbl_dia")
                    .eq("ano", year)
                    .eq("mes", month)
                    .range(offset, offset + PAGE - 1)
                    .execute()
                )
            except Exception:
                return None
            data = r.data or []
            if not data:
                break
            any_data = True
            for row in data:
                v = row.get("petroleo_bbl_dia")
                if v is not None:
                    try:
                        total += float(v)
                    except (TypeError, ValueError):
                        pass
            if len(data) < PAGE:
                break
            offset += PAGE
            if offset > 50_000:
                break
        return total if any_data else None

    trailing_totals: list[float] = []
    for ty, tm in trailing_months:
        s = _sum_petroleo(ty, tm)
        if s is not None and s > 0:
            trailing_totals.append(s)

    if len(trailing_totals) < 2:
        # not enough history — skip silently (e.g. first months of DB, backfill)
        return

    avg_trailing = sum(trailing_totals) / len(trailing_totals)
    curr = _sum_petroleo(ano, mes)
    if not curr or avg_trailing <= 0:
        return

    ratio = curr / avg_trailing
    if ratio > 1.8:
        raise RuntimeError(
            f"SPIKE UPWARD ANOMALY em ano={ano} mes={mes}: "
            f"production {curr:,.0f} bbl/dia is {ratio:.2f}x the trailing "
            f"{len(trailing_totals)}-month avg ({avg_trailing:,.0f}). "
            f"Possible upload duplication. Investigate before proceeding."
        )
    elif ratio > 1.4:
        print(
            f"  [WARN] {ano}/{mes:02d}: production is {ratio:.2f}x trailing "
            f"{len(trailing_totals)}mo avg — verify visually"
        )
    else:
        print(
            f"  [spike-check] {ano}/{mes:02d}: production ratio {ratio:.2f}x "
            f"trailing avg — OK"
        )


def _validate_ambiente_consistency(
    frames_by_ambiente: dict[tuple[int, int, str], pd.DataFrame],
) -> None:
    """Detect if M, S, T 'frames' share >5% of (poco, campo, bacia) tuples.

    The ANP CDP APEX portal occasionally returns the SAME CSV for clicks against
    different ambiente filters (M/S/T) — confirmed root cause of the Apr/2026
    triplication.  The legitimate overlap is between M (PosSal, all offshore)
    and S (PreSal, subset) — that case is handled by `_deduplicate_m_vs_s`.
    The illegitimate overlap is between T (onshore) and either M or S, or any
    pair where overlap exceeds the "subset" expectation by being near-total.

    Behaviour:
      - M ∩ S overlap is expected (S ⊂ M for offshore wells).  Suppressed.
      - T overlapping >5% with M or S → fatal (onshore wells cannot be offshore).
      - M ∩ S overlap that exceeds 95% in BOTH directions → fatal (M=S, ANP bug).
    """
    by_amb: dict[str, set[tuple]] = {}
    for (_ano, _mes, amb), df in frames_by_ambiente.items():
        if df is None or df.empty or "poco" not in df.columns:
            continue
        keys = set(
            zip(df["poco"].astype(str), df["campo"].astype(str), df["bacia"].astype(str))
        )
        # multiple periods of same ambiente accumulate (rare, but safe)
        by_amb.setdefault(amb, set()).update(keys)

    ambientes = list(by_amb.keys())
    PCT_THRESHOLD = 0.05  # 5%

    for i in range(len(ambientes)):
        for j in range(i + 1, len(ambientes)):
            a, b = ambientes[i], ambientes[j]
            ka, kb = by_amb[a], by_amb[b]
            if not ka or not kb:
                continue
            overlap = len(ka & kb)
            smaller = min(len(ka), len(kb))
            pct = overlap / smaller if smaller > 0 else 0.0

            # M ∩ S is a known legitimate subset relationship (S ⊂ M).
            # Suppress unless it looks like total equality (>=95% from both sides).
            if {a, b} == {"M", "S"}:
                pct_from_a = overlap / len(ka) if ka else 0
                pct_from_b = overlap / len(kb) if kb else 0
                if pct_from_a > 0.95 and pct_from_b > 0.95:
                    raise RuntimeError(
                        f"AMBIENTE OVERLAP ANOMALY: M and S frames are essentially "
                        f"identical ({overlap}/{len(ka)} from M, {overlap}/{len(kb)} "
                        f"from S). ANP may be returning the same CSV for both "
                        f"ambiente clicks. Inspect raw CSVs before re-uploading."
                    )
                continue

            # Any other pair (M↔T, S↔T) should have ~0% overlap.
            if pct > PCT_THRESHOLD:
                raise RuntimeError(
                    f"AMBIENTE OVERLAP ANOMALY: {a} and {b} share "
                    f"{overlap}/{smaller} wells ({pct:.1%}). "
                    f"ANP may be returning the same CSV for different ambiente "
                    f"clicks. Inspect raw CSVs before re-uploading."
                )
    print(
        f"  [ambiente-overlap] OK ({len(ambientes)} ambientes: "
        f"{sorted(ambientes)})"
    )


def _from_parquet(sb, path: str, ano_inicio: int = 0, allow_non_apex: bool = False) -> None:
    print(f"Reading parquet: {path}")
    df = pd.read_parquet(path)
    df = _prepare(df, allow_non_apex=allow_non_apex)
    if ano_inicio:
        df = df[df["ano"] >= ano_inicio]
        print(f"  Filtering from ano >= {ano_inicio}")
    rows = _rows_from_df(df)
    print(f"  {len(rows)} rows to upsert…")
    _upsert(sb, rows)
    _refresh_mv(sb)
    _refresh_production_mv(sb)


def _parse_csv(path: str, local: str) -> pd.DataFrame | None:
    # ANP CDP CSVs: try multiple encodings/separators.
    # Order: cp1252 (APEX portal legacy), utf-8-sig (PowerBI extractor output),
    #        plain utf-8, then semicolon-separated legacy format.
    # Break on the first parse that yields >5 columns AND detects the key columns.
    #
    # Thousand-separator handling:
    #   ANP switched to European locale format in 2026: separator=';', decimal=',',
    #   thousands separator='.'.  pandas decimal=',' alone does NOT strip the dot
    #   thousand-separator, causing values like "10.498,7882" to parse as NaN.
    #   We pass thousands='.' when decimal=',' so that high-production wells (>999
    #   bbl/dia) are not silently dropped.  For the legacy comma-sep format
    #   (decimal='.') there is no thousand-separator in the source, so thousands=None.
    last_exc: Exception | None = None
    df = None
    # Tuple: (sep, decimal, encoding, thousands)
    for sep, decimal, enc, thousands in [
        (",", ".", "cp1252",    ","),   # APEX 2026 US-format with quoted thousands ("5,984.1718")
        (",", ".", "utf-8-sig", ","),   # Same but UTF-8 BOM
        (",", ".", "utf-8-sig", None),  # Legacy Power BI extractor (kept for safety)
        (",", ".", "cp1252",    None),  # Legacy APEX comma-decimal (pre-2026, no thousands)
        (",", ".", "utf-8",     None),
        (";", ",", "cp1252",    "."),   # European semicolon/comma-decimal
        (";", ",", "utf-8",     "."),
    ]:
        try:
            _df = pd.read_csv(
                path,
                encoding=enc,
                encoding_errors="ignore",
                engine="python",
                sep=sep,
                on_bad_lines="skip",
                decimal=decimal,
                thousands=thousands,
            )
            if _df.empty or len(_df.columns) <= 5:
                continue
            # Quick check: does this parse yield the required columns?
            _cols_lower = [c.lower() for c in _df.columns]
            _has_poco   = any("poco" in c or "poço" in c for c in _cols_lower)
            _has_petroleo = any("petrleo" in c or "petróleo" in c or "petroleo" in c for c in _cols_lower)
            _has_periodo  = any("perodo" in c or "período" in c or "periodo" in c for c in _cols_lower)
            if _has_poco and _has_petroleo and _has_periodo:
                df = _df
                break  # good parse
            # Column names parsed but key cols not detected yet — keep trying other encodings
            if df is None:
                df = _df  # keep as candidate in case no encoding produces better results
        except Exception as e:
            last_exc = e
    if df is None or df.empty:
        if last_exc:
            print(f"  WARN: could not parse {path}: {last_exc}")
        return None
    if df.empty:
        return None

    col_map: dict[str, str] = {}
    for c in df.columns:
        cl = c.lower()
        if "bacia" in cl:
            col_map["bacia"] = c
        elif ("poco" in cl or "po\xe7o" in cl) and "anp" in cl:
            # Prefer "Nome Poço ANP" (official SIGEP hyphenated code) over
            # "Nome Poço Operador" (compact operator-internal code without hyphens).
            col_map["poco"] = c
        elif ("poco" in cl or "po\xe7o" in cl) and "poco" not in col_map:
            # Fallback: any poço column if ANP column was not found yet.
            col_map["poco"] = c
        elif "campo" in cl:
            col_map["campo"] = c
        elif "estado" in cl or "uf" == cl:
            col_map["estado"] = c
        elif "operador" in cl:
            col_map["operador"] = c
        elif "contrato" in cl:
            col_map["num_contrato"] = c
        elif "destino" in cl:
            col_map["instalacao_destino"] = c
        elif "tipo" in cl and "instal" in cl:
            col_map["tipo_instalacao"] = c
        elif ("perodo" in cl or "período" in cl or cl == "periodo") and "carga" not in cl:
            col_map["periodo"] = c
        elif "petrleo" in cl or "petróleo" in cl or (cl.startswith("petroleo") and "bbl" in cl):
            col_map["petroleo"] = c
        elif "leo (bbl" in cl and "petr" not in cl:
            col_map["oleo"] = c
        elif "total" in cl and "mm" in cl:
            col_map["gas_total"] = c
        elif "gua (bbl" in cl or "água" in cl:
            col_map["agua"] = c
        elif "tempo" in cl and "prod" in cl:
            col_map["tempo_prod"] = c

    required = ("bacia", "poco", "campo", "periodo", "petroleo")
    if not all(k in col_map for k in required):
        print(f"  WARN: missing key columns in {os.path.basename(path)}, got: {list(col_map)}")
        return None

    def _num(key: str) -> pd.Series:
        col = col_map.get(key)
        if col is None:
            return pd.Series([None] * len(df), dtype=object)
        return pd.to_numeric(df[col], errors="coerce")

    def _txt(key: str):
        col = col_map.get(key)
        # astype(str) evita AttributeError quando pandas auto-detecta tipo numérico
        # (ex: num_contrato = '48610007063201791' vira int64 sem o astype)
        return df[col].astype(str).str.strip() if col else None

    out = pd.DataFrame({
        "bacia":                       df[col_map["bacia"]].astype(str).str.strip(),
        "poco":                        df[col_map["poco"]].astype(str).str.strip(),
        "campo":                       df[col_map["campo"]].astype(str).str.strip(),
        "estado":                      _txt("estado"),
        "operador":                    _txt("operador"),
        "nome_poco_operador":          None,
        "num_contrato":                _txt("num_contrato"),
        "instalacao_destino":          _txt("instalacao_destino"),
        "tipo_instalacao":             _txt("tipo_instalacao"),
        "periodo":                     df[col_map["periodo"]].astype(str).str.strip(),
        "petroleo_bbl_dia":            _num("petroleo"),
        "oleo_bbl_dia":                _num("oleo"),
        "gas_total_mm3_dia":           _num("gas_total"),
        "agua_bbl_dia":                _num("agua"),
        "tempo_prod_hs_mes":           _num("tempo_prod"),
        "local":                       local,
    })
    out["ano"] = pd.to_numeric(out["periodo"].str[:4], errors="coerce")
    out["mes"] = pd.to_numeric(out["periodo"].str[5:7], errors="coerce")
    return out.drop(columns=["periodo"])


def _deduplicate_m_vs_s(
    frames_by_period: dict[tuple[int, int, str], pd.DataFrame],
) -> list[pd.DataFrame]:
    """Remove PreSal rows from the M (PosSal) frame when an S (PreSal) frame exists.

    The ANP CDP APEX portal exports overlapping data:
      - File M (ambiente=M, local=PosSal): contains ALL offshore wells, including
        wells that are Pré-Sal.  These rows are IDENTICAL to those in file S.
      - File S (ambiente=S, local=PreSal): contains only the Pré-Sal subset.

    If both M and S are present for the same (ano, mes), loading both as-is would
    store the shared 187 (for Apr/2026) wells twice — once as PosSal and once as
    PreSal — doubling their production in any aggregate query.

    Correct treatment:
      - From M: keep ONLY the rows whose 'poco' does NOT appear in the S frame
        (these are the genuinely Pós-Sal wells not present in S).
      - From S: keep all rows (these are the Pré-Sal wells).
      - From T: keep all rows (onshore).

    This preserves the exact 774-row count from the portal (282 PosSal + 492 PreSal
    = 774 total offshore rows for Apr/2026, matching the portal's pagination).
    """
    result: list[pd.DataFrame] = []
    # Group by (ano, mes) to process pairs
    period_keys: set[tuple[int, int]] = set()
    for (ano_c, mes_c, amb) in frames_by_period:
        period_keys.add((ano_c, mes_c))

    for (ano_c, mes_c) in sorted(period_keys):
        frame_m = frames_by_period.get((ano_c, mes_c, "M"))
        frame_s = frames_by_period.get((ano_c, mes_c, "S"))
        frame_t = frames_by_period.get((ano_c, mes_c, "T"))

        if frame_m is not None and frame_s is not None:
            # Both M and S present: keep M rows whose poco is NOT in S
            presal_pocos = set(frame_s["poco"].dropna())
            possal_rows = frame_m[~frame_m["poco"].isin(presal_pocos)].copy()
            n_removed = len(frame_m) - len(possal_rows)
            print(
                f"  [dedup M/S] {ano_c}/{mes_c:02d}: removed {n_removed} PreSal rows from M "
                f"(kept {len(possal_rows)} PosSal-only rows); S has {len(frame_s)} PreSal rows"
            )
            result.append(possal_rows)
            result.append(frame_s)
        else:
            if frame_m is not None:
                result.append(frame_m)
            if frame_s is not None:
                result.append(frame_s)

        if frame_t is not None:
            result.append(frame_t)

    return result


def _from_csv_dir(sb, csv_dir: str, incremental: bool = True, purge: bool = False, allow_non_apex: bool = False) -> None:
    # Fetch per-local max dates so that an ambiente whose data arrived later than
    # another for the same month is not incorrectly skipped.
    max_dates: dict[str, tuple[int, int]] = (
        _get_max_date_per_local(sb) if incremental else {}
    )
    if incremental and max_dates:
        for loc, (ano, mes) in sorted(max_dates.items()):
            if ano:
                print(f"  DB max date [{loc}]: {ano}/{mes:02d}")
    else:
        print("No incremental check — uploading all CSVs found in dir")

    csvs = sorted(glob.glob(os.path.join(csv_dir, "producao_poco_*.csv")))
    # Keyed by (ano, mes, amb) to enable M/S deduplication
    frames_by_period: dict[tuple[int, int, str], pd.DataFrame] = {}
    # Track which (ano, mes) pairs are being uploaded so we can purge them first.
    periods_to_purge: set[tuple[int, int]] = set()

    for path in csvs:
        m = _PAT_CSV.search(os.path.basename(path))
        if not m:
            continue
        mes_c, ano_c, amb = int(m.group(1)), int(m.group(2)), m.group(3).upper()
        local = _AMBIENTE_TO_LOCAL.get(amb)
        if not local:
            continue
        # Per-local incremental skip: only skip if this local already has a newer
        # or equal month in the DB.  A missing local (max_date=(0,0)) means the DB
        # has no rows for it yet — always upload in that case.
        if incremental:
            max_ano, max_mes = max_dates.get(local, (0, 0))
            if max_ano and (
                ano_c < max_ano or (ano_c == max_ano and mes_c < max_mes)
            ):
                print(f"  Skipping {os.path.basename(path)} — {local} already at {max_ano}/{max_mes:02d}")
                continue
        frame = _parse_csv(path, local)
        if frame is not None and not frame.empty:
            print(f"  Parsed {os.path.basename(path)}: {len(frame)} rows")
            frames_by_period[(ano_c, mes_c, amb)] = frame
            periods_to_purge.add((ano_c, mes_c))

    if not frames_by_period:
        print("No new CSV data to upload.")
        return

    # Pre-upload guard: refuse if ANP returned the same CSV for different ambiente
    # clicks (cross-ambiente overlap > 5%).  This was the root cause of the
    # Apr/2026 triplication incident — see _validate_ambiente_consistency docstring.
    _validate_ambiente_consistency(frames_by_period)

    # Resolve M/S overlap: wells in both M and S files are PreSal — keep them
    # only in the S frame (local=PreSal).  Remove them from M to avoid double-counting.
    frames = _deduplicate_m_vs_s(frames_by_period)

    # Purge existing rows for each target period before upserting.  This removes
    # stale rows that used a different poco naming convention (e.g. compact codes
    # without dashes from legacy ANP exports) that would otherwise survive a
    # PK-based upsert and create apparent duplicates in the dashboard.
    if purge:
        for ano_p, mes_p in sorted(periods_to_purge):
            _purge_period(sb, ano_p, mes_p)

    df = pd.concat(frames, ignore_index=True)
    df = _prepare(df, allow_non_apex=allow_non_apex)

    # Guard against PK duplicates in the source data (e.g. legacy dumps 2005-2013
    # where the same (poco, campo, bacia) appears multiple times in the same month
    # with different instalacao_destino values — the DB PK does not include that
    # column, so Postgres raises 21000 "ON CONFLICT DO UPDATE command cannot affect
    # row a second time" when a batch contains two rows with the same PK.
    # keep='last' preserves the last occurrence (arbitrary but deterministic).
    before_dedup = len(df)
    df = df.drop_duplicates(subset=_PK, keep="last")
    n_dropped = before_dedup - len(df)
    if n_dropped > 0:
        pct = n_dropped / before_dedup * 100
        level = "WARN" if pct > 5 else "INFO"
        print(
            f"  [{level}] Dropped {n_dropped} PK-duplicate rows before upsert "
            f"({pct:.1f}% of {before_dedup} total). "
            f"This is expected for legacy ANP dumps (2005-2013) where a well can "
            f"appear multiple times per month with different instalacao_destino."
        )
    else:
        print(f"  [INFO] No PK duplicates found ({before_dedup} rows are all unique).")

    rows = _rows_from_df(df)
    print(f"  {len(rows)} rows to upsert (as-is, no aggregation)…")
    _upsert(sb, rows)
    _refresh_mv(sb)
    _refresh_production_mv(sb)

    # Validation: report offshore row counts for each uploaded period
    for ano_p, mes_p in sorted(periods_to_purge):
        _validate_row_count(sb, ano_p, mes_p)

    # Post-upload defense-in-depth (Phase B1):
    #   _check_cross_local_duplicates RAISES if any (poco, campo, bacia) is now
    #     spread across more than one local in the just-uploaded period.
    #   _warn_spike_upward RAISES if the monthly petroleum sum jumped >1.8x the
    #     trailing 3-month average — telltale of upload duplication.
    # Both run AFTER upsert so they audit the final DB state, not the staging frame.
    for ano_p, mes_p in sorted(periods_to_purge):
        _check_cross_local_duplicates(sb, ano_p, mes_p)
        _warn_spike_upward(sb, ano_p, mes_p)

    # periods_to_purge collects all (ano, mes) pairs from successfully parsed CSVs
    # regardless of the --purge flag, so it's always available for the coverage check.
    _warn_partial_offshore(sb, periods_to_purge)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from-parquet", metavar="PATH", help="Historical backfill from Parquet")
    ap.add_argument("--from-csv-dir", metavar="DIR", help="Incremental update from CSV directory")
    ap.add_argument("--no-incremental", action="store_true", help="Re-upload even if data already in DB")
    ap.add_argument(
        "--purge",
        action="store_true",
        help=(
            "Delete all existing rows for each target (ano, mes) before upserting "
            "(csv-dir mode only).  Use when re-uploading a month that may contain "
            "stale rows from a legacy poco naming format — guarantees a clean slate."
        ),
    )
    ap.add_argument("--ano-inicio", type=int, default=0, metavar="ANO", help="Skip rows before this year (parquet mode)")
    ap.add_argument(
        "--allow-non-apex-format",
        action="store_true",
        help=(
            "Suppress the poco format guard that aborts uploads when >20%% of rows "
            "have compact (non-hyphenated) well codes. Use only for deliberate "
            "backfills from non-APEX sources with CTO sign-off."
        ),
    )
    args = ap.parse_args()

    if not args.from_parquet and not args.from_csv_dir:
        ap.error("Provide --from-parquet or --from-csv-dir")

    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    if args.from_parquet:
        _from_parquet(
            sb, args.from_parquet,
            ano_inicio=args.ano_inicio,
            allow_non_apex=args.allow_non_apex_format,
        )
    else:
        _from_csv_dir(
            sb, args.from_csv_dir,
            incremental=not args.no_incremental,
            purge=args.purge,
            allow_non_apex=args.allow_non_apex_format,
        )


if __name__ == "__main__":
    main()
