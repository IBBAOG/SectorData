"""
anp_watcher.py
==============
Monitors ANP for new monthly liquid fuel sales data and uploads to Supabase.

Two data sources checked in parallel:
  - Fonte A: ZIP/CSV download from ANP website
  - Fonte B: Power BI extractor (PAINEL_LIQUIDOS_VENDAS_ATUAL_EXTRACTOR.py)

CSV is preferred when both are available.

Scheduling:
  - Days 1-17: no check (data not published yet)
  - Day 18+: check every 10 minutes
  - After successful upload: pause until day 18 of next month

Usage:
  python anp_watcher.py             # Run as continuous service
  python anp_watcher.py --dry-run   # Check without uploading
  python anp_watcher.py --force     # Ignore day/state, run immediately
"""

import argparse
import importlib.util
import io
import json
import logging
import os
import sys
import time
import traceback
import unicodedata
import zipfile
from datetime import date, datetime
from pathlib import Path

import pandas as pd
import requests
import schedule
from dotenv import load_dotenv

# ─── Constants ───────────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).parent
STATE_FILE = SCRIPT_DIR / "anp_watcher_state.json"

# Path to the existing Power BI extractor (do not modify that file)
EXTRACTOR_PATH = Path(r"C:\Users\eduar\PAINEL_LIQUIDOS_VENDAS_ATUAL_EXTRACTOR.py")

# ANP page where the ZIP download link is published
ANP_PAGE_URL = (
    "https://www.gov.br/anp/pt-br/centrais-de-conteudo/paineis-dinamicos-da-anp"
    "/paineis-dinamicos-do-abastecimento"
    "/painel-dinamico-do-mercado-brasileiro-de-combustiveis-liquidos"
)

# Scheduling
CHECK_START_DAY = 18          # Don't check before this day of month
CHECK_INTERVAL_MINUTES = 10   # How often to poll once past day 18

HTTP_TIMEOUT = 60  # seconds for all HTTP requests

# Month abbreviation → number (matches extractor's MESES_ORDER)
MESES_MAP = {
    "Jan": 1, "Fev": 2, "Mar": 3, "Abr": 4,
    "Mai": 5, "Jun": 6, "Jul": 7, "Ago": 8,
    "Set": 9, "Out": 10, "Nov": 11, "Dez": 12,
}

# ─── Logging ─────────────────────────────────────────────────────────────────

log_file = SCRIPT_DIR / "anp_watcher.log"
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(log_file, encoding="utf-8"),
        logging.StreamHandler(open(sys.stdout.fileno(), mode="w", encoding="utf-8", closefd=False)),
    ],
)
log = logging.getLogger(__name__)

# ─── Environment ─────────────────────────────────────────────────────────────

# Search for .env walking up from the script directory
def _find_dotenv() -> Path | None:
    d = SCRIPT_DIR
    for _ in range(5):
        candidate = d / ".env"
        if candidate.exists():
            return candidate
        parent = d.parent
        if parent == d:
            break
        d = parent
    return None

_env_path = _find_dotenv()
if _env_path:
    load_dotenv(_env_path)
else:
    load_dotenv()  # fallback: let python-dotenv search CWD

# Accept both naming conventions (Next.js public prefix vs plain)
SUPABASE_URL = (
    os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    or os.getenv("SUPABASE_URL")
    or ""
)
SUPABASE_KEY = (
    os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    or os.getenv("SUPABASE_SERVICE_KEY")
    or ""
)

# ─── State management ────────────────────────────────────────────────────────

def load_state() -> dict:
    """Loads watcher state from disk. Returns defaults on first run or error."""
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            log.warning(f"Could not load state file: {e}. Starting fresh.")
    return {
        "last_successful_upload": None,   # e.g. "2025-03"
        "last_check_timestamp": None,     # ISO datetime string
        "month_completed": False,         # True after successful upload this month
    }


def save_state(state: dict):
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)


# ─── Scheduling logic ────────────────────────────────────────────────────────

def should_check_today(state: dict) -> bool:
    """
    Returns True if we should run a check right now:
      - Must be day 18 or later
      - Must not have already successfully uploaded this month's data
    """
    today = date.today()

    if today.day < CHECK_START_DAY:
        log.info(f"Day {today.day} < {CHECK_START_DAY} — skipping until day {CHECK_START_DAY}.")
        return False

    current_period = f"{today.year}-{today.month:02d}"
    if state.get("month_completed") and state.get("last_successful_upload") == current_period:
        log.info(f"Data for {current_period} already uploaded. Resuming checks on day {CHECK_START_DAY} next month.")
        return False

    return True


# ─── Fonte A: CSV/ZIP from ANP website ───────────────────────────────────────

def check_csv_source() -> dict | None:
    """
    Scrapes the ANP page for a ZIP download link, downloads it, and extracts
    Liquido_Vendas_Atual.csv. Returns {"source": "csv", "df": DataFrame} or None.
    """
    import re

    log.info("[CSV] Scanning ANP page for ZIP link...")
    try:
        r = requests.get(ANP_PAGE_URL, timeout=HTTP_TIMEOUT, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()

        # Find all .zip hrefs on the page
        zip_urls = re.findall(r'href=["\']([^"\']*\.zip[^"\']*)["\']', r.text, re.IGNORECASE)

        # Prefer URLs that contain relevant keywords
        keywords = ["liquido", "combustivel", "vendas", "abastecimento"]
        scored = []
        for u in zip_urls:
            ul = u.lower()
            score = sum(1 for kw in keywords if kw in ul)
            scored.append((score, u))
        scored.sort(reverse=True)
        candidates = [u for _, u in scored] or zip_urls

        if not candidates:
            log.warning("[CSV] No ZIP links found on ANP page.")
            return None

        for zip_url in candidates[:5]:
            if not zip_url.startswith("http"):
                zip_url = "https://www.gov.br" + zip_url

            log.info(f"[CSV] Trying ZIP: {zip_url}")
            try:
                resp = requests.get(zip_url, timeout=HTTP_TIMEOUT, stream=True)
                resp.raise_for_status()
                content = resp.content

                with zipfile.ZipFile(io.BytesIO(content)) as zf:
                    # Find the target CSV — prefer Liquido_Vendas_Atual.csv
                    csv_names = [
                        n for n in zf.namelist()
                        if "liquido_vendas_atual" in n.lower()
                    ]
                    if not csv_names:
                        csv_names = [
                            n for n in zf.namelist()
                            if "vendas_atual" in n.lower() and n.lower().endswith(".csv")
                        ]
                    if not csv_names:
                        csv_names = [n for n in zf.namelist() if n.lower().endswith(".csv")]

                    if not csv_names:
                        log.warning(f"[CSV] No CSV found in ZIP. Contents: {zf.namelist()}")
                        continue

                    csv_name = csv_names[0]
                    log.info(f"[CSV] Reading {csv_name}...")

                    with zf.open(csv_name) as csvf:
                        raw = csvf.read()

                    df = _parse_csv_bytes(raw)
                    if df is not None:
                        log.info(f"[CSV] Parsed {len(df)} rows. Columns: {list(df.columns)}")
                        return {"source": "csv", "df": df, "filename": csv_name}

            except Exception as e:
                log.warning(f"[CSV] Failed for {zip_url}: {e}")
                continue

        log.warning("[CSV] Could not obtain valid CSV data from any ZIP.")
        return None

    except Exception as e:
        log.error(f"[CSV] Error: {e}")
        return None


def _parse_csv_bytes(raw: bytes) -> "pd.DataFrame | None":
    """Tries multiple encodings and separators to parse a CSV from raw bytes."""
    for encoding in ["utf-8-sig", "latin-1", "utf-8"]:
        for sep in [";", ","]:
            try:
                df = pd.read_csv(io.BytesIO(raw), sep=sep, encoding=encoding, nrows=5)
                if len(df.columns) >= 4:  # Sanity check — must have at least 4 columns
                    df_full = pd.read_csv(io.BytesIO(raw), sep=sep, encoding=encoding,
                                          dtype=str, low_memory=False)
                    return df_full
            except Exception:
                continue
    return None


# ─── Fonte B: Power BI extractor ─────────────────────────────────────────────

def check_powerbi_source() -> dict | None:
    """
    Imports the existing PAINEL_LIQUIDOS_VENDAS_ATUAL_EXTRACTOR.py and queries
    the ANP Power BI API. Returns {"source": "powerbi", "ano", "mes", "rows"} or None.
    The extractor file is never modified — only imported.
    """
    log.info("[PowerBI] Querying ANP Power BI panel...")

    if not EXTRACTOR_PATH.exists():
        log.warning(f"[PowerBI] Extractor not found at: {EXTRACTOR_PATH}")
        return None

    try:
        spec = importlib.util.spec_from_file_location("anp_extrator", EXTRACTOR_PATH)
        extractor = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(extractor)

        # The extractor uses print() with emoji — redirect stdout to avoid CP1252 errors
        _orig_stdout = sys.stdout
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
        try:
            resource_key, model_id, app_ctx = extractor.resolve_config()
            ano, mes = extractor.get_ultimo_mes(resource_key, model_id, app_ctx)
            rows = extractor.get_dados_mes(ano, mes, resource_key, model_id, app_ctx)
        finally:
            sys.stdout.close()
            sys.stdout = _orig_stdout

        if not rows:
            log.warning("[PowerBI] No rows returned from API.")
            return None

        log.info(f"[PowerBI] Retrieved {len(rows)} rows for {mes}/{ano}.")
        return {"source": "powerbi", "ano": ano, "mes": mes, "rows": rows}

    except Exception as e:
        log.error(f"[PowerBI] Error: {e}\n{traceback.format_exc()}")
        return None


# ─── Detect new data ─────────────────────────────────────────────────────────

def _get_latest_supabase_period() -> str | None:
    """Returns the most recent (ano, mes) in vendas as 'YYYY-MM', or None."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        log.warning("Supabase credentials not set — cannot compare periods.")
        return None
    try:
        from supabase import create_client
        client = create_client(SUPABASE_URL, SUPABASE_KEY)
        result = (
            client.table("vendas")
            .select("ano,mes")
            .order("ano", desc=True)
            .order("mes", desc=True)
            .limit(1)
            .execute()
        )
        if result.data:
            row = result.data[0]
            return f"{row['ano']}-{int(row['mes']):02d}"
        return None
    except Exception as e:
        log.error(f"Failed to query Supabase for latest period: {e}")
        return None


def _source_period(source_result: dict) -> str | None:
    """Extracts the data period from a source result as 'YYYY-MM'."""
    if source_result["source"] == "powerbi":
        ano = source_result["ano"]
        mes_name = source_result["mes"]
        mes_num = MESES_MAP.get(mes_name, 0)
        return f"{ano}-{mes_num:02d}"

    if source_result["source"] == "csv":
        df = source_result["df"]
        norm_map = {_normalize_col(c): c for c in df.columns}
        ano_col = next((norm_map[k] for k in ["ANO", "ANO REFERENCIA"] if k in norm_map), None)
        mes_col = next((norm_map[k] for k in ["MES", "MES NUM"] if k in norm_map), None)
        if not ano_col or not mes_col:
            log.warning("[Detect] Could not find ANO/MES columns in CSV.")
            return None
        try:
            # Get the last period in the file (it may contain historical data)
            df_tmp = df[[ano_col, mes_col]].dropna().copy()
            df_tmp["_ano"] = pd.to_numeric(df_tmp[ano_col], errors="coerce")
            df_tmp["_mes_num"] = df_tmp[mes_col].apply(
                lambda v: MESES_MAP.get(str(v).strip(), None) or _safe_int(v)
            )
            df_tmp = df_tmp.dropna(subset=["_ano", "_mes_num"])
            if df_tmp.empty:
                return None
            idx = (df_tmp["_ano"] * 100 + df_tmp["_mes_num"]).idxmax()
            row = df_tmp.loc[idx]
            return f"{int(row['_ano'])}-{int(row['_mes_num']):02d}"
        except Exception as e:
            log.warning(f"[Detect] Error parsing CSV period: {e}")
            return None

    return None


def _safe_int(v) -> int | None:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def detect_new_data(source_result: dict) -> tuple[bool, str | None]:
    """
    Returns (is_new_data, period_str).
    is_new_data is True when the source has a period newer than what's in Supabase.
    """
    period = _source_period(source_result)
    if not period:
        return False, None

    supabase_period = _get_latest_supabase_period()
    log.info(f"Source period: {period}  |  Supabase latest: {supabase_period or 'empty'}")

    if supabase_period is None or period > supabase_period:
        return True, period
    return False, period


# ─── Classification helpers ──────────────────────────────────────────────────

def _classify_agent(agent: str) -> str:
    """Mirrors the classificar_agentes() SQL function in the DB."""
    if not agent:
        return "Others"
    a = agent.strip().upper()
    if "VIBRA" in a:
        return "Vibra"
    if "IPIRANGA" in a:
        return "Ipiranga"
    if any(k in a for k in ["RAIZEN", "SABBÁ", "SABBA", "CENTROESTE"]):
        return "Raizen"
    return "Others"


def _derive_segmento(mercado_dest: str | None) -> str:
    """
    Derives the segmento field from mercado_destinatario.

    ANP values and their mapping:
      POSTO DE COMBUSTÍVEIS - BANDEIRA BRANCA  → 'Outros'  (shown as 'Retail' by the view)
      POSTO DE COMBUSTÍVEIS - BANDEIRADO       → 'Outros'  (shown as 'Retail' by the view)
      TRR                                      → 'TRR'
      TRRNI                                    → 'TRR'
      CONSUMIDOR FINAL                         → 'B2B'

    The materialized view does: CASE WHEN segmento = 'Outros' THEN 'Retail' ELSE segmento END
    so gas-station rows must be stored as 'Outros' to appear under the Retail section.
    """
    if not mercado_dest:
        return "Outros"
    m = str(mercado_dest).strip().upper()
    if "POSTO" in m or "BANDEIRA" in m:
        return "Outros"   # → Retail in dashboard
    if "TRR" in m:
        return "TRR"
    if "CONSUMIDOR" in m:
        return "B2B"
    return "Outros"


# ─── Transform to Supabase schema ────────────────────────────────────────────

# ─── Filter source to target period ─────────────────────────────────────────

def _filter_to_period(source_result: dict, period: str) -> dict:
    """
    Returns a copy of source_result containing only rows for the target period.
    The ANP CSV has the full historical series — we must upload only the new month.
    Power BI already returns a single month, so no filtering is needed there.
    """
    parts = period.split("-")
    target_ano, target_mes = int(parts[0]), int(parts[1])

    if source_result["source"] == "powerbi":
        # Extractor already queries a single month — nothing to filter
        return source_result

    if source_result["source"] == "csv":
        df = source_result["df"].copy()
        norm_map = {_normalize_col(c): c for c in df.columns}
        ano_col = next((norm_map[k] for k in ["ANO", "ANO REFERENCIA"] if k in norm_map), None)
        mes_col = next((norm_map[k] for k in ["MES", "MES NUM"] if k in norm_map), None)

        if not ano_col or not mes_col:
            log.warning("[Filter] Cannot identify ANO/MES columns — uploading unfiltered. Risk of duplicates!")
            return source_result

        df["_ano_int"] = pd.to_numeric(df[ano_col], errors="coerce")
        df["_mes_int"] = df[mes_col].apply(
            lambda v: MESES_MAP.get(str(v).strip(), None) or _safe_int(v)
        )
        filtered = df[(df["_ano_int"] == target_ano) & (df["_mes_int"] == target_mes)].drop(
            columns=["_ano_int", "_mes_int"]
        )
        log.info(f"[Filter] CSV filtered: {len(df)} → {len(filtered)} rows for {period}")
        return {**source_result, "df": filtered}

    return source_result


# vendas table columns:
#   id (auto), ano, mes, agente_regulado, nome_produto,
#   regiao_destinatario, uf_destino, mercado_destinatario,
#   quantidade_produto, classificacao, date, segmento

def _transform_powerbi(rows: list, ano: str, mes_name: str) -> list[dict]:
    """
    Power BI row order: [ANO, MES, PRODUTO, REGIAO, ESTADO, MERCADO_DEST, AGENTE, QTD]
    QTD is already in mil m³ (same unit stored in quantidade_produto).
    """
    mes_num = MESES_MAP.get(mes_name, 1)
    date_str = f"{ano}-{mes_num:02d}-01"
    records = []

    for row in rows:
        if len(row) < 8:
            continue
        try:
            qtd = float(row[7]) if row[7] is not None else 0.0
        except (TypeError, ValueError):
            qtd = 0.0

        agente = str(row[6] or "").strip()
        mercado = str(row[5] or "").strip()

        records.append({
            "ano": int(ano),
            "mes": mes_num,
            "agente_regulado": agente,
            "nome_produto": str(row[2] or "").strip(),
            "regiao_destinatario": str(row[3] or "").strip(),
            "uf_destino": str(row[4] or "").strip(),
            "mercado_destinatario": mercado,
            "quantidade_produto": qtd,
            "classificacao": _classify_agent(agente),
            "date": date_str,
            "segmento": _derive_segmento(mercado),
        })

    return records


def _strip_accents(s: str) -> str:
    """Removes diacritics from a string: 'Região' → 'Regiao'."""
    return "".join(
        c for c in unicodedata.normalize("NFD", s)
        if unicodedata.category(c) != "Mn"
    )


_SUPERSCRIPT_MAP = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹", "0123456789")


def _normalize_col(s: str) -> str:
    """Uppercases, strips accents, and normalises superscript digits."""
    return _strip_accents(s.strip()).translate(_SUPERSCRIPT_MAP).upper()


def _transform_csv(df: pd.DataFrame) -> list[dict]:
    """
    Maps ANP CSV columns to the vendas table schema.
    Normalises column names (strips accents, uppercases) before matching.

    Real CSV column names (from Liquidos_Vendas_Atual.csv):
      Ano                              → ano
      Mes / Mês                        → mes  (abbreviation or number)
      Nome do Produto                  → nome_produto
      Região Destinatário              → regiao_destinatario
      UF Destino                       → uf_destino
      Mercado Destinatário             → mercado_destinatario
      Agente Regulado                  → agente_regulado
      Quantidade de Produto (mil m³)   → quantidade_produto
      Segmento (if present)            → segmento
    """
    df = df.copy()
    # Build a map: normalised_name → original_name
    norm_to_orig = {_normalize_col(c): c for c in df.columns}

    # Candidate normalised names for each field (accent-stripped, uppercase)
    col_candidates = {
        "ANO":     ["ANO", "ANO REFERENCIA"],
        "MES":     ["MES", "MES NUM", "NUMERO MES", "MONTH"],
        "PRODUTO": ["NOME DO PRODUTO", "PRODUTO", "GRP PRODUTO VENDAS",
                    "PRODUTO VENDAS", "DESCRICAO DO PRODUTO"],
        "REGIAO":  ["REGIAO DESTINATARIO", "REGIAO", "C REGIAO", "REGION"],
        "ESTADO":  ["UF DESTINO", "ESTADO", "C UF", "UF", "STATE"],
        "MERCADO": ["MERCADO DESTINATARIO", "MERCADO DEST", "QUALIF DEST", "MERCADO"],
        "AGENTE":  ["AGENTE REGULADO", "AGENTE", "NOM RAZAO SOCIAL", "DISTRIBUIDORA"],
        "QTD":     ["QUANTIDADE DE PRODUTO (MIL M3)", "QTD MIL M3", "QTD",
                    "QUANTIDADE", "VOLUME", "QUANTIDADE PRODUTO"],
        "SEG":     ["SEGMENTO", "SEGMENT"],
    }

    def find_col(candidates):
        for c in candidates:
            if c in norm_to_orig:
                return norm_to_orig[c]
        return None

    cols = {k: find_col(v) for k, v in col_candidates.items()}
    missing = [k for k, v in cols.items() if v is None and k not in ("SEG",)]
    if missing:
        log.warning(f"[Transform CSV] Missing expected columns: {missing}. Available: {list(df.columns)}")

    records = []
    for _, row in df.iterrows():
        try:
            ano_val = int(float(row[cols["ANO"]])) if cols["ANO"] else 0

            mes_raw = row[cols["MES"]] if cols["MES"] else 1
            if isinstance(mes_raw, str) and mes_raw.strip() in MESES_MAP:
                mes_num = MESES_MAP[mes_raw.strip()]
            else:
                mes_num = _safe_int(mes_raw) or 1

            date_str = f"{ano_val}-{mes_num:02d}-01"

            qtd_col = cols["QTD"]
            try:
                # Brazilian CSVs use comma as decimal separator: "0,010000" → 0.01
                qtd_raw = str(row[qtd_col]).replace(",", ".") if qtd_col and pd.notna(row[qtd_col]) else "0"
                qtd = float(qtd_raw)
            except (TypeError, ValueError):
                qtd = 0.0

            agente = str(row[cols["AGENTE"]] or "").strip() if cols["AGENTE"] else ""
            mercado = str(row[cols["MERCADO"]] or "").strip() if cols["MERCADO"] else ""

            # Use SEGMENTO column from CSV if present; otherwise derive from market type
            if cols["SEG"] and pd.notna(row[cols["SEG"]]):
                segmento = str(row[cols["SEG"]]).strip()
            else:
                segmento = _derive_segmento(mercado)

            records.append({
                "ano": ano_val,
                "mes": mes_num,
                "agente_regulado": agente,
                "nome_produto": str(row[cols["PRODUTO"]] or "").strip() if cols["PRODUTO"] else "",
                "regiao_destinatario": str(row[cols["REGIAO"]] or "").strip() if cols["REGIAO"] else "",
                "uf_destino": str(row[cols["ESTADO"]] or "").strip() if cols["ESTADO"] else "",
                "mercado_destinatario": mercado,
                "quantidade_produto": qtd,
                "classificacao": _classify_agent(agente),
                "date": date_str,
                "segmento": segmento,
            })
        except Exception as e:
            log.warning(f"[Transform CSV] Skipping row: {e}")
            continue

    return records


def transform_to_supabase(source_result: dict) -> list[dict]:
    if source_result["source"] == "powerbi":
        return _transform_powerbi(
            source_result["rows"], source_result["ano"], source_result["mes"]
        )
    if source_result["source"] == "csv":
        return _transform_csv(source_result["df"])
    return []


# ─── Upload to Supabase ───────────────────────────────────────────────────────

def upload_to_supabase(records: list[dict], period: str) -> bool:
    """
    Deletes all existing vendas rows for the given period, then bulk-inserts new ones.
    This is idempotent: re-running for the same period overwrites cleanly.
    Uses SUPABASE_SERVICE_ROLE_KEY (required for write access).
    """
    if not records:
        log.warning("No records to upload.")
        return False

    if not SUPABASE_URL or not SUPABASE_KEY:
        log.error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured.")
        return False

    try:
        from supabase import create_client
        client = create_client(SUPABASE_URL, SUPABASE_KEY)

        parts = period.split("-")
        ano, mes = int(parts[0]), int(parts[1])

        log.info(f"Deleting existing records for {ano}-{mes:02d}...")
        client.table("vendas").delete().eq("ano", ano).eq("mes", mes).execute()

        # Insert in batches to respect Supabase row limits
        batch_size = 500
        total = len(records)
        for i in range(0, total, batch_size):
            batch = records[i:i + batch_size]
            client.table("vendas").insert(batch).execute()
            log.info(f"  Inserted {min(i + batch_size, total)}/{total}...")

        log.info(f"Upload complete: {total} records for {period}.")

        # Refresh materialized views so the dashboard reflects new data immediately.
        # Requires the refresh_vendas_views() RPC to exist in Supabase
        # (created by migration 20260406000000_refresh_views_rpc.sql).
        log.info("Refreshing materialized views...")
        try:
            client.rpc("refresh_vendas_views", {}).execute()
            log.info("Materialized views refreshed.")
        except Exception as e:
            log.error(f"View refresh failed (data is uploaded, only dashboard aggregations are stale): {e}")

        return True

    except Exception as e:
        log.error(f"Upload failed: {e}\n{traceback.format_exc()}")
        return False


# ─── Orchestration ───────────────────────────────────────────────────────────

def run_check(dry_run: bool = False, force: bool = False):
    state = load_state()
    state["last_check_timestamp"] = datetime.now().isoformat(timespec="seconds")

    if not dry_run and not force and not should_check_today(state):
        save_state(state)
        return

    log.info("=" * 60)
    log.info(f"Running check  dry_run={dry_run}  force={force}")
    log.info("=" * 60)

    # Check both sources — Power BI may have a newer month before the ZIP is published
    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        f_csv     = executor.submit(check_csv_source)
        f_powerbi = executor.submit(check_powerbi_source)
        csv_result     = f_csv.result()
        powerbi_result = f_powerbi.result()

    if csv_result is None and powerbi_result is None:
        log.warning("Both sources failed. Will retry at next interval.")
        save_state(state)
        return

    # Pick the source with the most recent period; prefer CSV on tie (richer data)
    csv_period = _source_period(csv_result) if csv_result else None
    pbi_period = _source_period(powerbi_result) if powerbi_result else None

    if csv_period and pbi_period:
        if pbi_period > csv_period:
            log.info(f"Power BI is ahead ({pbi_period} > {csv_period}) — using Power BI.")
            source_result = powerbi_result
        else:
            log.info(f"CSV is up to date ({csv_period}) — using CSV.")
            source_result = csv_result
    else:
        source_result = csv_result or powerbi_result

    is_new, period = detect_new_data(source_result)

    if not is_new and not dry_run:
        log.info(f"No new data (source period: {period} already in Supabase).")
        save_state(state)
        return

    log.info(f"New data detected — period: {period}")

    # Filter source to ONLY the new period before transforming.
    # The ANP CSV contains the full historical series (2017–present).
    # We must not re-insert years already in Supabase.
    source_result = _filter_to_period(source_result, period)

    records = transform_to_supabase(source_result)
    log.info(f"Transformed {len(records)} records.")

    if dry_run:
        log.info(f"[DRY RUN] Would upload {len(records)} records for period {period}.")
        if records:
            log.info(f"[DRY RUN] First record: {json.dumps(records[0], ensure_ascii=False)}")
            log.info(f"[DRY RUN] Last record:  {json.dumps(records[-1], ensure_ascii=False)}")
            # Show column coverage
            sample = records[0]
            log.info("[DRY RUN] Column coverage:")
            for col_name, val in sample.items():
                log.info(f"  {col_name}: {repr(val)}")
        return

    success = upload_to_supabase(records, period)
    if success:
        state["last_successful_upload"] = period
        state["month_completed"] = True
        log.info(f"Success. Pausing checks until day {CHECK_START_DAY} of next month.")
    else:
        log.error("Upload failed — will retry at next interval.")

    save_state(state)


# ─── Entry point ─────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="ANP Fuel Data Watcher — monitors and uploads monthly sales data to Supabase."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run a full check (download, parse, transform) without uploading to Supabase.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Ignore day-of-month restriction and state; run check immediately.",
    )
    args = parser.parse_args()

    if not SUPABASE_URL:
        log.warning("NEXT_PUBLIC_SUPABASE_URL is not set in .env")
    if not SUPABASE_KEY:
        log.warning("SUPABASE_SERVICE_ROLE_KEY is not set in .env")

    if args.dry_run:
        log.info("-" * 60)
        log.info("DRY RUN — no data will be written to Supabase")
        log.info("-" * 60)
        run_check(dry_run=True, force=True)
        return

    log.info("-" * 60)
    log.info("ANP Watcher starting")
    log.info(f"  State file : {STATE_FILE}")
    log.info(f"  Check from : day {CHECK_START_DAY} of each month")
    log.info(f"  Interval   : every {CHECK_INTERVAL_MINUTES} minutes")
    log.info(f"  Log file   : {log_file}")
    log.info("-" * 60)

    # Run once immediately on startup
    run_check(dry_run=False, force=args.force)

    # In --force mode (used by GitHub Actions), exit after one run
    if args.force:
        log.info("--force mode: exiting after single run.")
        return

    # Schedule recurring checks
    schedule.every(CHECK_INTERVAL_MINUTES).minutes.do(run_check)

    while True:
        schedule.run_pending()
        time.sleep(30)


if __name__ == "__main__":
    main()
