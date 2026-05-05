#!/usr/bin/env python3
"""
sindicom_sync.py
================
Baixa o XLSX de Combustíveis do SINDICOM e upserta em sindicom.
Usa Playwright para contornar proteção anti-bot. Idempotente.

Uso:
    python scripts/sindicom_sync.py

Dependências extras: playwright (pip install playwright && playwright install chromium)
Credenciais: SUPABASE_URL + SUPABASE_SERVICE_KEY (env ou .env)
"""
import io
import math
import os
import sys
import tempfile
from pathlib import Path

import pandas as pd
from supabase import create_client

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_URL_DOWNLOAD = "https://sindicom.com.br/download/combustiveis/?wpdmdl=1043"
_BATCH        = 500

_MES_MAP = {
    "JANEIRO": 1, "FEVEREIRO": 2, "MARÇO": 3, "ABRIL": 4,
    "MAIO": 5, "JUNHO": 6, "JULHO": 7, "AGOSTO": 8,
    "SETEMBRO": 9, "OUTUBRO": 10, "NOVEMBRO": 11, "DEZEMBRO": 12,
}


def _get_creds():
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        env = Path(__file__).parent.parent / ".env"
        if env.exists():
            for line in env.read_text(encoding="utf-8").splitlines():
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
        print("Erro: SUPABASE_URL ou SUPABASE_SERVICE_KEY nao definidos")
        sys.exit(1)
    return url, key


def _download_requests() -> bytes:
    """Try simple HTTP download first."""
    import requests
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8",
        "Referer": "https://sindicom.com.br/",
    }
    r = requests.get(_URL_DOWNLOAD, headers=headers, timeout=60, allow_redirects=True)
    r.raise_for_status()
    ct = r.headers.get("Content-Type", "")
    if "html" in ct.lower():
        raise ValueError(f"Recebeu HTML em vez de XLSX (anti-bot): {ct}")
    return r.content


def _download_playwright() -> bytes:
    """Fallback: use Playwright headless Chrome."""
    from playwright.sync_api import sync_playwright

    with tempfile.TemporaryDirectory() as tmpdir:
        dest_path = None

        def _handle_download(download):
            nonlocal dest_path
            dest_path = Path(tmpdir) / (download.suggested_filename or "sindicom.xlsx")
            download.save_as(str(dest_path))

        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
            )
            ctx = browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                locale="pt-BR",
                accept_downloads=True,
            )
            page = ctx.new_page()
            page.add_init_script(
                "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
            )
            page.on("download", _handle_download)

            try:
                page.goto(_URL_DOWNLOAD, timeout=30000, wait_until="commit")
            except Exception as e:
                if "Download is starting" not in str(e) and dest_path is None:
                    raise

            # Wait up to 30s for the download to complete
            deadline = 30
            import time
            waited = 0
            while dest_path is None and waited < deadline:
                time.sleep(0.5)
                waited += 0.5

            browser.close()

        if dest_path is None or not Path(dest_path).exists():
            raise RuntimeError("Download via Playwright nao concluido")

        return Path(dest_path).read_bytes()


def _download_xlsx() -> bytes:
    print("Tentando download direto (requests)...", end=" ", flush=True)
    try:
        content = _download_requests()
        print(f"{len(content) / 1024:.0f} KB")
        return content
    except Exception as e:
        print(f"falhou ({e})")

    print("Usando Playwright...", end=" ", flush=True)
    content = _download_playwright()
    print(f"{len(content) / 1024:.0f} KB")
    return content


def _parse_xlsx(content: bytes) -> pd.DataFrame:
    df = pd.read_excel(io.BytesIO(content), sheet_name="dados_combs", dtype=str)
    print(f"  {len(df):,} linhas brutas")

    for c in df.columns:
        df[c] = df[c].astype(str).str.strip()
        df.loc[df[c].isin(["nan", "None", ""]), c] = None

    df.columns = [c.lower() for c in df.columns]

    df["mes_num"] = df["mes"].str.upper().map(_MES_MAP)
    df = df.dropna(subset=["mes_num"])
    df["mes"] = df["mes_num"].astype("Int8")
    df["ano"] = pd.to_numeric(df["ano"], errors="coerce").astype("Int16")
    df = df.drop(columns=["mes_num"])

    df["volume"] = pd.to_numeric(df["volume"], errors="coerce").astype("float64")
    df = df.dropna(subset=["ano", "mes", "volume"])

    return df


def _to_records(df: pd.DataFrame) -> list[dict]:
    records = []
    for _, row in df.iterrows():
        records.append({
            "ano":          int(row["ano"]),
            "mes":          int(row["mes"]),
            "empresa":      str(row["empresa"])      if pd.notna(row.get("empresa"))      else "",
            "nome_produto": str(row["nome_produto"]) if pd.notna(row.get("nome_produto")) else "",
            "segmento":     str(row["segmento"])     if pd.notna(row.get("segmento"))     else "",
            "uf":           str(row["uf"])            if pd.notna(row.get("uf"))           else "BR",
            "tipo":         str(row["tipo"])          if pd.notna(row.get("tipo"))         else None,
            "tipo_produto": str(row["tipo_produto"])  if pd.notna(row.get("tipo_produto")) else None,
            "regiao":       str(row["regiao"])        if pd.notna(row.get("regiao"))       else None,
            "volume":       float(row["volume"])      if pd.notna(row["volume"])           else None,
        })
    return records


def _upsert(sb, records: list[dict]) -> int:
    total = 0
    n_batches = math.ceil(len(records) / _BATCH)
    for i in range(0, len(records), _BATCH):
        batch = records[i : i + _BATCH]
        sb.table("sindicom").upsert(
            batch, on_conflict="ano,mes,empresa,nome_produto,segmento,uf"
        ).execute()
        total += len(batch)
        print(f"  [{i // _BATCH + 1}/{n_batches}] {total:,}/{len(records):,}")
    return total


def main():
    print("Baixando XLSX SINDICOM...")
    content = _download_xlsx()

    print("Parseando...")
    df = _parse_xlsx(content)

    records = _to_records(df)
    print(f"  {len(records):,} registros")

    su_url, key = _get_creds()
    sb = create_client(su_url, key)
    total = _upsert(sb, records)
    print(f"Concluido: {total:,} registros em sindicom")


if __name__ == "__main__":
    main()
