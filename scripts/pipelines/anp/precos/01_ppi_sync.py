#!/usr/bin/env python3
"""
anp_ppi_sync.py
===============
Baixa o XLSX de PPI da ANP, parseia as 4 sheets e upserta em anp_ppi.
Idempotente — ON CONFLICT DO UPDATE.

Uso:
    python scripts/anp_ppi_sync.py

Credenciais: SUPABASE_URL + SUPABASE_SERVICE_KEY (env ou .env)
"""
import io
import math
import os
import re
import sys
import tempfile
from pathlib import Path

import pandas as pd
import requests
from bs4 import BeautifulSoup
from supabase import create_client

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_PAGE_URL = (
    "https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia"
    "/precos/precos-de-paridade-de-importacao"
)
_HEADERS = {"User-Agent": "Mozilla/5.0"}
_BATCH   = 500

_SHEETS = {
    "Gasolina R$ semanal":   ("Gasolina A Comum", "R$/litro"),
    "Diesel R$ semanal":     ("Diesel A S10",     "R$/litro"),
    "QAV R$ semanal":        ("QAV",              "R$/litro"),
    "GLP R$ kg semanal":     ("GLP",              "R$/13kg"),
}

_PERIODO_RE = re.compile(
    r"(\d{2})/(\d{2})/(\d{4})\s*[aA]\s*(\d{2})/(\d{2})/(\d{4})"
)


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


def _find_xlsx_url() -> str | None:
    r = requests.get(_PAGE_URL, headers=_HEADERS, timeout=30)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "lxml")
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "ppi" in href.lower() and href.lower().endswith(".xlsx"):
            return href if href.startswith("http") else "https://www.gov.br" + href
    return None


def _download(url: str) -> bytes:
    r = requests.get(url, headers=_HEADERS, stream=True, timeout=180)
    r.raise_for_status()
    return r.content


def _parse_periodo(s: str):
    m = _PERIODO_RE.match(str(s).strip())
    if not m:
        return None, None
    di, mi, ai, df_, mf, af = m.groups()
    try:
        return (
            pd.Timestamp(int(ai), int(mi), int(di)),
            pd.Timestamp(int(af), int(mf), int(df_)),
        )
    except ValueError:
        return None, None


def _detect_layout(raw: pd.DataFrame):
    header = raw.iloc[2].tolist()
    data_col = None
    for j, v in enumerate(header):
        if isinstance(v, str) and v.strip().lower() in {"data", "semana"}:
            data_col = j
            break
    if data_col is None:
        return [], -1
    locais = []
    j = data_col + 1
    while j < len(header):
        v = header[j]
        if isinstance(v, str) and v.strip():
            locais.append(v.strip())
            j += 1
        else:
            break
    return locais, j  # sep = first NaN column


def _parse_sheet(raw: pd.DataFrame, produto: str, unidade: str) -> list[dict]:
    locais, sep = _detect_layout(raw)
    if not locais:
        return []
    n = len(locais)
    rows = []
    for i in range(3, len(raw)):
        data_str = raw.iat[i, sep - n - 1] if (sep - n - 1) >= 0 else raw.iat[i, 1]
        if not isinstance(data_str, str):
            continue
        d_ini, d_fim = _parse_periodo(data_str)
        if d_ini is None:
            continue
        for k, local in enumerate(locais):
            preco = raw.iat[i, sep - n + k]
            varia = raw.iat[i, sep + 1 + k] if (sep + 1 + k) < raw.shape[1] else None
            try:
                preco = float(preco) if pd.notna(preco) and preco != "-" else None
            except (TypeError, ValueError):
                preco = None
            try:
                varia = float(varia) if pd.notna(varia) and varia != "-" else None
            except (TypeError, ValueError):
                varia = None
            if preco is None and varia is None:
                continue
            rows.append({
                "data_inicio": d_ini.date().isoformat(),
                "data_fim":    d_fim.date().isoformat(),
                "produto":     produto,
                "local":       local,
                "preco":       preco,
                "variacao_pct": varia,
                "unidade":     unidade,
            })
    return rows


def _upsert(sb, records: list[dict]) -> int:
    total = 0
    n_batches = math.ceil(len(records) / _BATCH)
    for i in range(0, len(records), _BATCH):
        batch = records[i : i + _BATCH]
        sb.table("anp_ppi").upsert(
            batch, on_conflict="data_fim,produto,local"
        ).execute()
        total += len(batch)
        print(f"  [{i // _BATCH + 1}/{n_batches}] {total:,}/{len(records):,}")
    return total


def main():
    print("Buscando XLSX PPI na ANP...")
    xlsx_url = _find_xlsx_url()
    if not xlsx_url:
        print("Erro: nao encontrou link do XLSX")
        sys.exit(1)
    print(f"  URL: {xlsx_url.split('/')[-1]}")

    print("Baixando...", end=" ", flush=True)
    content = _download(xlsx_url)
    print(f"{len(content) / 1024:.0f} KB")

    all_records: list[dict] = []
    for sheet, (produto, unidade) in _SHEETS.items():
        try:
            raw = pd.read_excel(io.BytesIO(content), sheet_name=sheet, header=None)
            rows = _parse_sheet(raw, produto, unidade)
            all_records.extend(rows)
            print(f"  {sheet}: {len(rows):,} linhas")
        except Exception as e:
            print(f"  [aviso] {sheet}: {e}")

    if not all_records:
        print("Nenhum dado parseado.")
        sys.exit(1)

    print(f"\nTotal: {len(all_records):,} registros")
    url, key = _get_creds()
    sb = create_client(url, key)
    total = _upsert(sb, all_records)
    print(f"Concluido: {total:,} registros em anp_ppi")


if __name__ == "__main__":
    main()
