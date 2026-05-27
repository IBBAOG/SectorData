"""
Upload Field Stakes (per-field × per-company working interest) to Supabase.

Usage:
    python scripts/manual/field_stakes_upload.py [path/to/field_stakes_brasil.xlsx]

Excel path priority:
    1. CLI argument (sys.argv[1])
    2. Env var  FIELD_STAKES_XLSX
    3. Default  C:\\Users\\eduar\\dashboard_projeto\\data\\field_stakes_brasil.xlsx

Credentials (env vars, fall back to .env file):
    SUPABASE_URL
    SUPABASE_SERVICE_KEY

Excel structure (only sheet 'field_stakes' is consumed):
    campo (text, ANP CAPS+acentos) | empresa (raw legal name) | stake_pct (float)
    + ignored metadata cols (bacia, ambiente, situacao, operador, fonte, data_fonte, obs)

Pipeline:
    1. Load 'field_stakes' sheet via openpyxl (UTF-8 safe for diacritics).
    2. Normalize raw 'empresa' strings via EMPRESA_NORMALIZATION dictionary
       (collapses legal-entity suffixes and SPE/subsidiary fragmentation).
    3. Fetch canonical 'campo' universe from RPC get_field_stakes_overview()
       (= UNION of mv_anp_cdp_pocos.campo + already-registered field_stakes).
    4. Map each Excel campo → canonical via (a) ASCII-folded uppercase exact match
       then (b) difflib.get_close_matches(cutoff=0.85). Unmatched → skipped.
    5. Group by canonical campo; only campos with SUM(stake_pct) = 100 ± 0.01 are uploaded.
    6. Per matched campo: DELETE existing rows for that campo, INSERT fresh set.
       This mimics admin_upsert_field_stakes() replace-all semantics, but uses
       direct table writes because admin_upsert_field_stakes() guards on is_admin()
       which checks auth.uid() — null under Service Role Key. The 'updated_by'
       column is left NULL (seed bootstrap, not a user edit). This is the ONLY
       place writes happen outside the RPC; all Admin Panel edits go through it.

Reports per run:
    - N empresas raw / N normalized canonical
    - N campos in Excel / matched-exact / matched-fuzzy / unmatched (with list)
    - N campos uploaded vs skipped (sum != 100 or unmatched)
"""

from __future__ import annotations

import difflib
import os
import sys
import unicodedata
from pathlib import Path

import pandas as pd
from supabase import create_client


# ── Credentials ───────────────────────────────────────────────────────────────

def _load_env_file() -> dict[str, str]:
    env_path = Path(".env")
    if not env_path.exists():
        return {}
    result: dict[str, str] = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        result[key.strip()] = val.strip()
    return result


def _get_credentials() -> tuple[str, str]:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        env = _load_env_file()
        url = url or env.get("SUPABASE_URL", "")
        key = key or env.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        print("ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_KEY (set env vars or .env)")
        sys.exit(1)
    return url, key


# ── Excel path ────────────────────────────────────────────────────────────────

_DEFAULT_EXCEL = r"C:\Users\eduar\dashboard_projeto\data\field_stakes_brasil.xlsx"


def _get_excel_path() -> str:
    if len(sys.argv) > 1:
        return sys.argv[1]
    return os.environ.get("FIELD_STAKES_XLSX", _DEFAULT_EXCEL)


# ── Empresa normalization ─────────────────────────────────────────────────────
#
# Goals:
#   - Strip legal-entity suffixes (S.A., Ltda., Corp., Inc., Brasil) when redundant.
#   - Collapse SPE / subsidiary fragmentation into the parent group
#     (e.g. all "PRIO *" → "PRIO"; all "Brava Energia (3R *)" → "Brava Energia";
#     all "Equinor *" → "Equinor"; all "PetroReconcavo *" → "PetroReconcavo").
#   - Group ex-mergers under the surviving name (Enauta → Brava Energia).
#
# Covers all 77 distinct raw strings in field_stakes_brasil.xlsx (2026-05-26).
# Unmapped raw strings fall through with .strip() only — extend this dict
# when new partners appear in future Anuario revisions.
EMPRESA_NORMALIZATION: dict[str, str] = {
    # ── Operators majors ──
    "Petroleo Brasileiro S.A. - Petrobras": "Petrobras",
    "Shell Brasil Petroleo Ltda.": "Shell",
    "TotalEnergies EP Brasil Ltda.": "TotalEnergies",
    "Equinor Brasil Energia Ltda.": "Equinor",
    "Equinor Energy do Brasil Ltda.": "Equinor",
    "Repsol Sinopec Brasil S.A.": "Repsol Sinopec",
    "ExxonMobil Exploracao Brasil Ltda.": "ExxonMobil",
    "Petrogal Brasil S.A.": "Petrogal",
    "CNODC Brasil Petroleo e Gas Ltda.": "CNODC",
    "CNOOC Petroleum Brasil Ltda.": "CNOOC",
    "ONGC Campos Ltda.": "ONGC",
    "QatarEnergy Brasil Ltda.": "QatarEnergy",
    "Petronas Petroleo Brasil Ltda.": "Petronas",
    "Sonangol Hidrocarbonetos Brasil Ltda.": "Sonangol",
    "Perenco Petroleo e Gas do Brasil Ltda.": "Perenco",

    # ── PRIO group (all variants → PRIO) ──
    "PRIO S.A.": "PRIO",
    "PRIO Bravo Ltda.": "PRIO",
    "PRIO Jaguar Ltda. (ex-Petro Rio Jaguar)": "PRIO",
    "PRIO Tigris Ltda.": "PRIO",

    # ── Brava Energia (ex-Enauta + 3R Petroleum subsidiaries) ──
    "Brava Energia S.A. (ex-Enauta)": "Brava Energia",
    "Brava Energia (3R Bahia S.A.)": "Brava Energia",
    "Brava Energia (3R Pescada S.A.)": "Brava Energia",
    "Brava Energia (3R Petroleum Offshore S.A.)": "Brava Energia",
    "Brava Energia (3R Potiguar S.A.)": "Brava Energia",
    "Brava Energia (3R RNCE S.A.)": "Brava Energia",

    # ── PetroReconcavo group (and SPEs) ──
    "PetroReconcavo S.A.": "PetroReconcavo",
    "SPE Miranga S.A. (PetroReconcavo group)": "PetroReconcavo",
    "SPE Tieta S.A. (PetroReconcavo group)": "PetroReconcavo",

    # ── Seacrest SPEs ──
    "Seacrest SPE Cricare S.A.": "Seacrest",
    "Seacrest SPE Norte Capixaba S.A.": "Seacrest",

    # ── Origem Energia ──
    "Origem Energia S.A.": "Origem Energia",

    # ── Mid-size independents ──
    "Eneva S.A.": "Eneva",
    "Karoon Energy Ltda.": "Karoon",
    "Geopark Brasil S.A.": "Geopark",
    "Alvopetro Energia Ltda.": "Alvopetro",
    "Trident Energy do Brasil Ltda.": "Trident Energy",
    "BW Energy Maromba do Brasil Ltda.": "BW Energy",
    "Reconcavo E&P S.A.": "Reconcavo Energia",
    "Reconcavo Energia S.A.": "Reconcavo Energia",
    "Potiguar E&P S.A.": "Potiguar E&P",
    "Imetame Energia S.A.": "Imetame Energia",
    "Tamar Energia S.A.": "Tamar Energia",
    "Carmo Energy S.A.": "Carmo Energy",
    "Mandacaru Energia Ltda.": "Mandacaru Energia",

    # ── Small independents (suffix-strip only) ──
    "Petrosynergy Ltda.": "Petrosynergy",
    "Pericia Petroleo Ltda.": "Pericia Petroleo",
    "Andorinha Energia Ltda.": "Andorinha Energia",
    "Gas Bridge S.A.": "Gas Bridge",
    "Creative Energy & Technology Ltda.": "Creative Energy",
    "Petro-Victory Energy Corp.": "Petro-Victory",
    "BGM Petroleo & Gas Ltda.": "BGM",
    "Barra Bonita Energia Ltda.": "Barra Bonita Energia",
    "Brasil Refinarias S.A.": "Brasil Refinarias",
    "Campo Petroleo & Gas Ltda.": "Campo Petroleo",
    "Capixaba Energia Ltda.": "Capixaba Energia",
    "EPG Brasil Energia Ltda.": "EPG Brasil",
    "Energizzi Energias do Brasil Ltda.": "Energizzi",
    "Geoflux Ltda.": "Geoflux",
    "Geopar Geosolutions Ltda.": "Geopar",
    "Guto & Cacal Petroleo Ltda.": "Guto & Cacal",
    "IPI Oil & Gas Ltda.": "IPI Oil & Gas",
    "NFT Energia Ltda.": "NFT Energia",
    "Newo Brasil Energia Ltda.": "Newo Brasil",
    "Nion Energia Ltda.": "Nion Energia",
    "Nord Energia Ltda.": "Nord Energia",
    "Nova Petroleo Reconcavo Ltda.": "Nova Petroleo Reconcavo",
    "Nova Tecnica Engenharia Ltda.": "Nova Tecnica",
    "Oil Group Brasil Ltda.": "Oil Group Brasil",
    "Parana Xisto S.A.": "Parana Xisto",
    "Petroborn Petroleo & Gas Ltda.": "Petroborn",
    "Petroil Petroleo Ltda.": "Petroil",
    "Petrom Petroleo Brasileiro Ltda.": "Petrom",
    "Phoenix Oleo & Gas S.A.": "Phoenix Oleo & Gas",
    "SHB Energia Ltda.": "SHB Energia",
    "Slim Drilling Brasil Ltda.": "Slim Drilling",
    "Vipetro Petroleo Ltda.": "Vipetro",
    "Westlawn Energia do Brasil Ltda.": "Westlawn Energia",
}


def _normalize_empresa(raw: str) -> str:
    """Map raw legal name → canonical short name. Fallback: strip whitespace."""
    if raw is None:
        return ""
    raw = str(raw).strip()
    return EMPRESA_NORMALIZATION.get(raw, raw)


# ── Campo canonicalization (ASCII-fold + fuzzy match) ─────────────────────────

def _ascii_fold_upper(s: str) -> str:
    """Strip diacritics + uppercase, for tolerant exact-match comparison."""
    if s is None:
        return ""
    nf = unicodedata.normalize("NFD", str(s))
    return "".join(c for c in nf if unicodedata.category(c) != "Mn").upper().strip()


def _match_campo(
    excel_campo: str,
    canonical_set: set[str],
    canonical_by_fold: dict[str, str],
) -> tuple[str | None, str]:
    """
    Returns (matched_canonical_campo, match_kind) where match_kind in
    {"exact", "fuzzy", "none"}. None canonical → no match.
    """
    fold = _ascii_fold_upper(excel_campo)
    if fold in canonical_by_fold:
        return canonical_by_fold[fold], "exact"

    matches = difflib.get_close_matches(excel_campo, list(canonical_set), n=1, cutoff=0.85)
    if matches:
        return matches[0], "fuzzy"

    return None, "none"


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    excel_path = _get_excel_path()
    print(f"Excel file: {excel_path}")

    if not Path(excel_path).exists():
        print(f"ERROR: File not found: {excel_path}")
        sys.exit(1)

    # 1. Load Excel
    try:
        df = pd.read_excel(excel_path, sheet_name="field_stakes", engine="openpyxl")
    except Exception as e:
        print(f"ERROR: Could not read sheet 'field_stakes': {e}")
        sys.exit(1)

    # Sanity-print a few diacritic-bearing names to confirm UTF-8 round-trip
    sample = [c for c in df["campo"].dropna().unique() if any(ord(ch) > 127 for ch in c)][:5]
    print(f"  Diacritic sample (should be readable): {sample}")
    print(f"  Excel rows: {len(df)}; distinct campos: {df['campo'].nunique()}; "
          f"distinct empresas (raw): {df['empresa'].nunique()}")

    # 2. Normalize empresas
    df["empresa_canon"] = df["empresa"].apply(_normalize_empresa)
    distinct_canon = df["empresa_canon"].nunique()
    print(f"  Distinct empresas (normalized): {distinct_canon}")

    # 3. Fetch canonical campo list from RPC
    url, key = _get_credentials()
    supabase = create_client(url, key)

    print("\nFetching canonical campo universe from get_field_stakes_overview()...")
    resp = supabase.rpc("get_field_stakes_overview").execute()
    canonical_rows = resp.data or []
    canonical_set: set[str] = {row["campo"] for row in canonical_rows if row.get("campo")}
    canonical_by_fold: dict[str, str] = {}
    for c in canonical_set:
        fold = _ascii_fold_upper(c)
        # Last-write-wins is fine; collisions across folded keys are unlikely in our universe.
        canonical_by_fold[fold] = c
    print(f"  Canonical campos available: {len(canonical_set)}")

    # 4. Match each Excel campo → canonical
    excel_campos = sorted(df["campo"].dropna().unique())
    match_map: dict[str, str | None] = {}
    fuzzy_pairs: list[tuple[str, str]] = []
    unmatched: list[str] = []
    n_exact = 0
    for ec in excel_campos:
        matched, kind = _match_campo(ec, canonical_set, canonical_by_fold)
        match_map[ec] = matched
        if kind == "exact":
            n_exact += 1
        elif kind == "fuzzy":
            fuzzy_pairs.append((ec, matched))  # type: ignore[arg-type]
        else:
            unmatched.append(ec)

    print(f"\nCampo match results:")
    print(f"  Total Excel campos: {len(excel_campos)}")
    print(f"  Exact match (ASCII-fold upper): {n_exact}")
    print(f"  Fuzzy match (difflib >=0.85): {len(fuzzy_pairs)}")
    if fuzzy_pairs:
        print(f"  Fuzzy pairs (excel -> canonical):")
        for ec, cc in fuzzy_pairs:
            print(f"    {ec!r} -> {cc!r}")
    print(f"  Unmatched: {len(unmatched)}")
    if unmatched:
        print(f"  Unmatched campos (skipped; Eduardo resolves via UI):")
        for u in unmatched:
            print(f"    {u!r}")

    # 5. Group rows by canonical campo, validate sum == 100
    df["campo_canon"] = df["campo"].map(match_map)
    matched_df = df[df["campo_canon"].notna()].copy()

    grouped: dict[str, list[dict]] = {}
    skipped_sum: list[tuple[str, float]] = []
    for campo, sub in matched_df.groupby("campo_canon"):
        # Merge any rows whose normalized empresa collides under the same campo
        # (e.g. multiple Brava SPEs on same field → sum their stakes).
        agg = sub.groupby("empresa_canon", as_index=False)["stake_pct"].sum()
        total = float(agg["stake_pct"].sum())
        if abs(total - 100.0) > 0.01:
            skipped_sum.append((str(campo), total))
            continue
        grouped[str(campo)] = [
            {"empresa": str(row["empresa_canon"]).strip(), "stake_pct": float(row["stake_pct"])}
            for _, row in agg.iterrows()
            if str(row["empresa_canon"]).strip()
        ]

    print(f"\nUpload plan:")
    print(f"  Campos with sum==100 (will upload): {len(grouped)}")
    print(f"  Campos with sum!=100 (skipped):     {len(skipped_sum)}")
    if skipped_sum:
        for c, t in skipped_sum:
            print(f"    {c!r} sum={t:.4f}")

    # 6. Upload (DELETE then INSERT per campo)
    if not grouped:
        print("\nWARNING: Nothing to upload.")
        return

    print(f"\nUploading {len(grouped)} campos to field_stakes...")
    n_done = 0
    n_rows_inserted = 0
    n_failed = 0
    for campo, stakes in grouped.items():
        try:
            supabase.table("field_stakes").delete().eq("campo", campo).execute()
            rows = [
                {
                    "campo": campo,
                    "empresa": s["empresa"],
                    "stake_pct": s["stake_pct"],
                    # updated_by left NULL: seed bootstrap, no admin uid available
                }
                for s in stakes
            ]
            supabase.table("field_stakes").insert(rows).execute()
            n_done += 1
            n_rows_inserted += len(rows)
            if n_done % 50 == 0:
                print(f"  ...{n_done}/{len(grouped)} campos uploaded")
        except Exception as e:
            n_failed += 1
            print(f"  ERROR uploading {campo!r}: {e}")

    print(f"\nDone! {n_done} campos uploaded ({n_rows_inserted} stake rows). "
          f"Failures: {n_failed}.")

    # Summary
    print("\n" + "=" * 70)
    print("FINAL REPORT")
    print("=" * 70)
    print(f"Empresas raw / normalized:   {df['empresa'].nunique()} -> {distinct_canon}")
    print(f"Campos Excel:                {len(excel_campos)}")
    print(f"  exact-matched:             {n_exact}")
    print(f"  fuzzy-matched:             {len(fuzzy_pairs)}")
    print(f"  unmatched (skipped):       {len(unmatched)}")
    print(f"Upload sum==100 plan:        {len(grouped)} campos / "
          f"skipped sum!=100: {len(skipped_sum)}")
    print(f"Upload result:               {n_done} campos OK, {n_failed} failures, "
          f"{n_rows_inserted} stake rows inserted")


if __name__ == "__main__":
    main()
