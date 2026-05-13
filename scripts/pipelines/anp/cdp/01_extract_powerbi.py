#!/usr/bin/env python3
"""
01_extract_powerbi.py — ANP CDP well production via Power BI public API.

Replaces the Selenium + CAPTCHA approach (01_extract.py) for the monthly
production snapshot pipeline.  Queries the same Power BI report used by
anp_cdp_powerbi.py (pages 4-6), at well (poco) granularity, then:

  1. Aggregates daily rows → monthly averages per (poco, campo, bacia).
  2. Derives the 'local' dimension (PosSal | PreSal | Terra) by querying
     the existing anp_cdp_producao table; falls back to a bacia heuristic
     for wells not yet seen in the DB.
  3. Writes three CSV files per period — one per local bucket — in the exact
     column format expected by 02_upload.py._parse_csv().

Usage (same interface as 01_extract.py --capture):
  python scripts/pipelines/anp/cdp/01_extract_powerbi.py --periodo 04/2026 --output output/anp
  python scripts/pipelines/anp/cdp/01_extract_powerbi.py --de 01/2026 --ate 04/2026 --output output/anp

Environment variables (for local lookup):
  SUPABASE_URL, SUPABASE_SERVICE_KEY  (optional — only used for local resolution)

The script is idempotent: if the output CSV already exists and is non-empty it is
skipped (same semantics as 01_extract.py).
"""

import argparse
import calendar
import csv
import os
import re
import sys
from datetime import date, timedelta
from pathlib import Path

# ─── Well-name normalisation ──────────────────────────────────────────────────
# The Power BI API returns well names in compact format without hyphens
# (e.g. "7SPH6SPS").  The historical anp_cdp_producao table was populated by
# the APEX Selenium extractor which returned the canonical ANP SIGEP hyphenated
# format ("7-SPH-6-SPS").  Without normalisation the PK (poco) differs between
# old and new rows, preventing upsert deduplication and creating duplicates.
#
# The rule is deterministic: insert a hyphen at every transition between a run
# of digits and a run of letters (or vice versa).
#   "7SPH6SPS"  → "7-SPH-6-SPS"
#   "7SPH2DSPS" → "7-SPH-2D-SPS"   (2D is one letter-group with a digit suffix)
#   "9SPS77A"   → "9-SPS-77-A"
#   "7OATP1RJS" → "7-OAT-P-1-RJS"  splits every digit↔letter boundary
#
# NOTE: this normalisation is intentionally applied ONLY in this script
# (monthly snapshot → anp_cdp_producao).  The daily table anp_cdp_diaria_poco
# has always stored compact names and is NOT changed here.

_RE_HYPHEN_SPLIT = re.compile(r"(?<=\d)(?=[A-Za-z])|(?<=[A-Za-z])(?=\d)")


def _normalise_poco(name: str) -> str:
    """Convert compact ANP well code to canonical hyphenated SIGEP format."""
    if not name:
        return name
    # Already contains hyphens → assume already normalised, just strip/upper
    if "-" in name:
        return name.strip().upper()
    return _RE_HYPHEN_SPLIT.sub("-", name.strip().upper())


# Allow running from repo root or from the script directory.
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

try:
    from scripts.extractors.anp_cdp_powerbi import extract_producao_diaria_poco_todos
except ModuleNotFoundError:
    # Alternate import path when run as a module from scripts/
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
    from extractors.anp_cdp_powerbi import extract_producao_diaria_poco_todos  # type: ignore

# ─── Constants ────────────────────────────────────────────────────────────────

# Basins known to be purely Pre-Salt (Santos deep-water pre-salt polygon).
# These map to local='PreSal'.  All other offshore basins map to 'PosSal'.
# Onshore basins map to 'Terra'.
_PRESAL_CAMPOS_KEYWORDS = {
    "BUZIOS", "MERO", "LAPA", "ATAPU", "SEPIA", "IRACEMA", "BERBIGAO",
    "OESTE DE ATAPU", "BACALHAU", "GATO DO MATO", "TUPI", "SAPINHOA",
    "SUL DE LULA", "OESTE DE JARDINS",
}

# Basins that are entirely onshore → local='Terra'
_TERRA_BASINS = {
    "RECÔNCAVO", "RECONCAVO", "POTIGUAR", "SERGIPE-ALAGOAS", "TUCANO",
    "BARREIRINHAS", "PARNAÍBA", "PARNAIBA", "SOLIMÕES", "SOLIMOES",
    "AMAZONAS", "MÉDIO AMAZONAS", "MEDIO AMAZONAS",
    "ESPÍRITO SANTO TERRESTRE", "ESPIRITO SANTO TERRESTRE",
    "SANTOS TERRESTRE", "CAMPOS TERRESTRE",
    "SÃO FRANCISCO", "SAO FRANCISCO",
    "PARANÁ", "PARANA",
}

# Offshore basins (PosSal or PreSal depending on campo)
_OFFSHORE_BASINS = {
    "SANTOS", "CAMPOS", "ESPÍRITO SANTO", "ESPIRITO SANTO",
    "FOZ DO AMAZONAS", "PARÁ-MARANHÃO", "PARA-MARANHAO",
    "PELOTAS", "JEQUITINHONHA", "JACUÍPE", "JACUIPE",
    "CUMURUXATIBA",
}

_LOCAL_FROM_AMBIENTE = {"M": "PosSal", "S": "PreSal", "T": "Terra"}
_AMBIENTE_FROM_LOCAL = {v: k for k, v in _LOCAL_FROM_AMBIENTE.items()}


def _derive_local_heuristic(campo: str, bacia: str) -> str:
    """
    Heuristic local derivation when DB lookup fails.

    Priority:
      1. Known Pre-Salt campo names → 'PreSal'
      2. Onshore basin names        → 'Terra'
      3. Offshore basin names       → 'PosSal'
      4. Default                    → 'PosSal'  (most missing are offshore)
    """
    campo_up = (campo or "").upper().strip()
    bacia_up = (bacia or "").upper().strip()

    # Check if campo matches known pre-sal fields
    for kw in _PRESAL_CAMPOS_KEYWORDS:
        if kw in campo_up:
            return "PreSal"

    # Check bacia
    for tb in _TERRA_BASINS:
        if tb in bacia_up:
            return "Terra"

    for ob in _OFFSHORE_BASINS:
        if ob in bacia_up:
            return "PosSal"

    # Unknown → default offshore post-salt
    return "PosSal"


def _build_campo_local_map() -> dict[str, str]:
    """
    Query anp_cdp_producao for distinct (campo, local) pairs.
    Returns {campo_upper: local} mapping.
    Falls back to empty dict if Supabase is not configured.
    """
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("  [local-map] SUPABASE_URL/SERVICE_KEY not set — skipping DB lookup, using heuristic only")
        return {}

    try:
        from supabase import create_client
        sb = create_client(url, key)

        # Fetch distinct (campo, local) from the materialized view (much smaller than base table)
        # mv_anp_cdp_pocos has one row per (poco, campo, bacia, local) — still manageable.
        # We only need campo→local mapping so we deduplicate in Python below.
        result = sb.table("mv_anp_cdp_pocos").select("campo,local").execute()
        mapping: dict[str, str] = {}
        for row in (result.data or []):
            c = (row.get("campo") or "").upper().strip()
            lo = row.get("local") or ""
            if c and lo:
                # If campo appears with multiple locals (edge case), prefer PreSal > PosSal > Terra
                existing = mapping.get(c)
                if not existing:
                    mapping[c] = lo
                else:
                    rank = {"PreSal": 0, "PosSal": 1, "Terra": 2}
                    if rank.get(lo, 3) < rank.get(existing, 3):
                        mapping[c] = lo
        print(f"  [local-map] Loaded {len(mapping)} campo→local mappings from DB")
        return mapping
    except Exception as e:
        print(f"  [local-map] DB lookup failed ({e}), falling back to heuristic")
        return {}


_heuristic_fallback_warned: set[str] = set()


def _resolve_local(campo: str, bacia: str, campo_map: dict[str, str]) -> str:
    """Resolve local for a (campo, bacia) pair using DB map first, then heuristic.

    DB map is authoritative — it reflects the historical classification already
    stored in anp_cdp_producao.  Heuristic is only used for genuinely new campos.
    Each heuristic fallback is logged once (per session) so drift is visible.
    """
    key = (campo or "").upper().strip()
    if key in campo_map:
        return campo_map[key]
    result = _derive_local_heuristic(campo, bacia)
    if key not in _heuristic_fallback_warned:
        _heuristic_fallback_warned.add(key)
        print(f"  [local-heuristic] New campo not in DB: campo='{campo}' bacia='{bacia}' → {result}")
    return result


def _month_date_range(ano: int, mes: int) -> tuple[date, date]:
    """Return (first_day, first_day_of_next_month) for the given year/month."""
    first = date(ano, mes, 1)
    if mes == 12:
        last_excl = date(ano + 1, 1, 1)
    else:
        last_excl = date(ano, mes + 1, 1)
    return first, last_excl


def _days_in_month(ano: int, mes: int) -> int:
    return calendar.monthrange(ano, mes)[1]


def _parse_periodo(s: str) -> tuple[int, int]:
    m = re.match(r"^(\d{2})/(\d{4})$", s)
    if not m:
        raise ValueError(f"Invalid period format: {s}. Expected MM/YYYY")
    mes, ano = int(m.group(1)), int(m.group(2))
    if not 1 <= mes <= 12:
        raise ValueError(f"Invalid month: {mes}")
    return ano, mes


def _generate_periods(de: str, ate: str) -> list[tuple[int, int]]:
    d_m, d_y = int(de[:2]), int(de[3:])
    a_m, a_y = int(ate[:2]), int(ate[3:])
    periods = []
    y, m = d_y, d_m
    while (y, m) <= (a_y, a_m):
        periods.append((y, m))
        m += 1
        if m > 12:
            m, y = 1, y + 1
    return periods


def extract_and_write(ano: int, mes: int, output_dir: str, campo_map: dict[str, str]) -> bool:
    """
    Extract Power BI data for the given month, aggregate to monthly averages,
    derive local, and write 3 CSV files (one per local bucket).

    Returns True if at least one CSV was written with data, False otherwise.
    """
    # Check if all 3 files already exist and are non-empty
    all_exist = True
    for local_code in ("M", "S", "T"):
        fname = f"producao_poco_{mes:02d}-{ano}_{local_code}.csv"
        fpath = Path(output_dir) / fname
        if not fpath.exists() or fpath.stat().st_size < 100:
            all_exist = False
            break
    if all_exist:
        print(f"  → {mes:02d}/{ano}: all 3 CSVs already exist, skipping")
        return True

    start, end_excl = _month_date_range(ano, mes)
    n_days = _days_in_month(ano, mes)

    print(f"\n  → Extracting {mes:02d}/{ano} from Power BI (poco level)...")
    try:
        rows = extract_producao_diaria_poco_todos(start, end_excl, window=100_000)
    except Exception as e:
        print(f"  ERROR: Power BI extraction failed: {e}", file=sys.stderr)
        return False

    if not rows:
        print(f"  WARNING: No rows returned from Power BI for {mes:02d}/{ano}")
        return False

    print(f"  Raw rows from Power BI: {len(rows)}")

    # Aggregate: sum petroleum + gas per (poco, campo, bacia) across all days in month.
    # Then divide by days_in_month to get average daily rate (consistent with APEX metric).
    # Key: (poco, campo, bacia)
    agg: dict[tuple, dict] = {}
    for r in rows:
        poco  = _normalise_poco((r.get("poco")  or "").strip())
        campo = (r.get("campo") or "").strip()
        bacia = (r.get("bacia") or "").strip()
        petro = r.get("petroleo_bbl_dia") or 0.0
        gas   = r.get("gas_mm3_dia")      or 0.0

        key = (poco, campo, bacia)
        if key not in agg:
            agg[key] = {"petroleo_sum": 0.0, "gas_sum": 0.0, "n_days": 0}
        entry = agg[key]
        entry["petroleo_sum"] += float(petro)
        entry["gas_sum"]      += float(gas)
        entry["n_days"]       += 1  # count production days

    # Build output rows with monthly averages
    # APEX CSV uses average daily rate for the reporting month.
    # Strategy: sum / n_production_days (not n_days_in_month) so partial months are
    # handled correctly (matches ANP CDP display behaviour).
    period_str = f"{ano}/{mes:02d}"  # e.g. "2026/04" — matches _parse_csv format yyyy/mm
    # _parse_csv extracts ano from str[:4], mes from str[5:7] — so we need "YYYY/MM" or "MM/YYYY"
    # Looking at 02_upload.py line 401: out["ano"] = pd.to_numeric(out["periodo"].str[:4], errors="coerce")
    # and out["mes"] = pd.to_numeric(out["periodo"].str[5:7], errors="coerce")
    # So period must be "YYYY/MM" format.

    # Bucket rows by local
    buckets: dict[str, list] = {"PosSal": [], "PreSal": [], "Terra": []}
    skipped = 0

    for (poco, campo, bacia), vals in agg.items():
        if not poco or not campo:
            skipped += 1
            continue

        prod_days = max(vals["n_days"], 1)
        petro_avg = vals["petroleo_sum"] / prod_days
        gas_avg   = vals["gas_sum"]      / prod_days

        # Only include active wells
        if petro_avg <= 0 and gas_avg <= 0:
            continue

        local = _resolve_local(campo, bacia, campo_map)
        buckets[local].append({
            "Bacia":             bacia,
            "Nome Poço ANP":     poco,
            "Campo":             campo,
            "Período":           period_str,
            "Petróleo (bbl/dia)":    round(petro_avg, 4),
            "Gás Total (mm3/dia)":   round(gas_avg,   6),
        })

    if skipped:
        print(f"  Skipped {skipped} rows with empty poco/campo")

    # Write CSV files
    local_to_code = {"PosSal": "M", "PreSal": "S", "Terra": "T"}
    total_written = 0
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    for local, code in local_to_code.items():
        bucket_rows = buckets[local]
        fname = f"producao_poco_{mes:02d}-{ano}_{code}.csv"
        fpath = Path(output_dir) / fname

        if not bucket_rows:
            print(f"  [{local}] 0 wells — skipping CSV")
            continue

        fieldnames = ["Bacia", "Nome Poço ANP", "Campo", "Período",
                      "Petróleo (bbl/dia)", "Gás Total (mm3/dia)"]
        with open(fpath, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames, delimiter=",")
            writer.writeheader()
            writer.writerows(bucket_rows)

        print(f"  [{local}] {len(bucket_rows)} wells → {fpath.name} ({fpath.stat().st_size / 1024:.1f} KB)")
        total_written += len(bucket_rows)

    if total_written == 0:
        print(f"  ERROR: No rows written for {mes:02d}/{ano}", file=sys.stderr)
        return False

    print(f"  Total: {total_written} well-rows across 3 locals for {mes:02d}/{ano}")
    return True


def main():
    parser = argparse.ArgumentParser(
        description="Extract ANP CDP well production data via Power BI (no CAPTCHA, no Selenium)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--periodo", help="Single period MM/YYYY")
    parser.add_argument("--de",      help="Start period MM/YYYY")
    parser.add_argument("--ate",     help="End period MM/YYYY")
    parser.add_argument("--output",  default="output/anp", help="Output directory (default: output/anp)")

    # Kept for CLI compatibility with 01_extract.py (ignored for PowerBI mode)
    parser.add_argument("--ambiente", default="todos", help="Ignored — all ambientes extracted together")
    parser.add_argument("--capture",     action="store_true", help="[compat] Ignored")
    parser.add_argument("--replay",      action="store_true", help="[compat] Ignored")
    parser.add_argument("--replay-only", action="store_true", dest="replay_only", help="[compat] Ignored")

    args = parser.parse_args()

    if args.periodo and (args.de or args.ate):
        parser.error("Use --periodo OR --de/--ate, not both")
    if not args.periodo and not args.de:
        parser.error("Provide --periodo or --de/--ate")
    if args.de and not args.ate:
        args.ate = args.de
    if args.ate and not args.de:
        args.de = args.ate

    if args.periodo:
        ano, mes = _parse_periodo(args.periodo)
        periods = [(ano, mes)]
    else:
        periods = _generate_periods(args.de, args.ate)

    print("ANP CDP — Well Production via Power BI")
    print(f"Periods : {periods[0][1]:02d}/{periods[0][0]} to {periods[-1][1]:02d}/{periods[-1][0]} ({len(periods)} months)")
    print(f"Output  : {args.output}")
    print()

    # Build campo → local lookup from existing DB data (once, shared across all periods)
    campo_map = _build_campo_local_map()

    ok = 0
    fail = 0
    for ano, mes in periods:
        if extract_and_write(ano, mes, args.output, campo_map):
            ok += 1
        else:
            fail += 1

    print(f"\nDone: {ok}/{len(periods)} periods succeeded, {fail} failed")
    if fail > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
