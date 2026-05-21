#!/usr/bin/env python3
"""
anp_glp_sync.py
===============
Baixa o XLSX de Vendas de GLP por Recipiente da ANP e upserta em anp_glp.
Parseia as 2 sheets (formato antigo + pós jun/2024). Idempotente.

Uso:
    python scripts/anp_glp_sync.py

Credenciais: SUPABASE_URL + SUPABASE_SERVICE_KEY (env ou .env)
"""
import io
import math
import os
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd
import requests
from bs4 import BeautifulSoup
from supabase import create_client

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_PAGE_URL = (
    "https://www.gov.br/anp/pt-br/assuntos/distribuicao-e-revenda"
    "/distribuidor/dados-de-mercado-glp"
)
_HEADERS = {"User-Agent": "Mozilla/5.0"}
_BATCH   = 500


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
    """Find LPG sales-by-container XLSX on ANP page.

    ANP renamed the file in May/2026 from `relatorio_vendas_por_recipiente*.xlsx`
    (underscores, long name) to `relatorio-vendas-recipiente.xlsx` (hyphens). The
    matcher below accepts both spellings via normalisation of separators so we
    survive future renames in either direction.
    """
    r = requests.get(_PAGE_URL, headers=_HEADERS, timeout=30)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "lxml")
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if not href.lower().endswith(".xlsx"):
            continue
        # Normalise: lowercase + collapse separators so 'relatorio-vendas-recipiente'
        # and 'relatorio_vendas_por_recipiente' both match the same canonical form.
        canonical = href.lower().replace("-", "_")
        filename = canonical.rsplit("/", 1)[-1]
        if filename.startswith("relatorio_vendas") and "recipiente" in filename:
            return href if href.startswith("http") else "https://www.gov.br" + href
    return None


def _parse_sheet_antiga(raw: pd.DataFrame) -> list[dict]:
    rows = []
    for i in range(9, len(raw)):
        mes = raw.iat[i, 0]
        dist = raw.iat[i, 1]
        if not isinstance(mes, (pd.Timestamp, datetime)) or not isinstance(dist, str):
            continue
        try:
            p13    = float(raw.iat[i, 2]) if pd.notna(raw.iat[i, 2]) else None
            outros = float(raw.iat[i, 3]) if pd.notna(raw.iat[i, 3]) else None
        except (TypeError, ValueError):
            continue
        ano = int(mes.year)
        m   = int(mes.month)
        d   = dist.strip()
        if p13 is not None:
            rows.append({"ano": ano, "mes": m, "distribuidora": d, "categoria": "P13", "vendas_kg": p13})
        if outros is not None:
            rows.append({"ano": ano, "mes": m, "distribuidora": d, "categoria": "Outros (total)", "vendas_kg": outros})
    return rows


def _parse_sheet_nova(raw: pd.DataFrame) -> list[dict]:
    rows = []
    for i in range(9, len(raw)):
        mes  = raw.iat[i, 0]
        dist = raw.iat[i, 1]
        if not isinstance(mes, (pd.Timestamp, datetime)) or not isinstance(dist, str):
            continue
        try:
            p13   = float(raw.iat[i, 2]) if pd.notna(raw.iat[i, 2]) else None
            o_glp = float(raw.iat[i, 3]) if pd.notna(raw.iat[i, 3]) else None
            o_esp = float(raw.iat[i, 4]) if pd.notna(raw.iat[i, 4]) else None
        except (TypeError, ValueError):
            continue
        ano = int(mes.year)
        m   = int(mes.month)
        d   = dist.strip()
        if p13 is not None:
            rows.append({"ano": ano, "mes": m, "distribuidora": d, "categoria": "P13", "vendas_kg": p13})
        if o_glp is not None:
            rows.append({"ano": ano, "mes": m, "distribuidora": d, "categoria": "Outros - GLP", "vendas_kg": o_glp})
        if o_esp is not None:
            rows.append({"ano": ano, "mes": m, "distribuidora": d, "categoria": "Outros - Especiais", "vendas_kg": o_esp})
        total = (o_glp or 0) + (o_esp or 0)
        if total > 0:
            rows.append({"ano": ano, "mes": m, "distribuidora": d, "categoria": "Outros (total)", "vendas_kg": total})
    return rows


def _upsert(sb, records: list[dict]) -> int:
    total = 0
    n_batches = math.ceil(len(records) / _BATCH)
    for i in range(0, len(records), _BATCH):
        batch = records[i : i + _BATCH]
        sb.table("anp_glp").upsert(
            batch, on_conflict="ano,mes,distribuidora,categoria"
        ).execute()
        total += len(batch)
        print(f"  [{i // _BATCH + 1}/{n_batches}] {total:,}/{len(records):,}")
    return total


def main():
    print("Buscando XLSX GLP na ANP...")
    xlsx_url = _find_xlsx_url()
    if not xlsx_url:
        print("Erro: nao encontrou link do XLSX")
        sys.exit(1)
    print(f"  URL: {xlsx_url.split('/')[-1]}")

    print("Baixando...", end=" ", flush=True)
    r = requests.get(xlsx_url, headers=_HEADERS, stream=True, timeout=180)
    r.raise_for_status()
    content = r.content
    print(f"{len(content) / 1024:.0f} KB")

    all_records: list[dict] = []

    try:
        raw_antiga = pd.read_excel(io.BytesIO(content), sheet_name="Vendas por recipiente", header=None)
        rows = _parse_sheet_antiga(raw_antiga)
        all_records.extend(rows)
        print(f"  Sheet antiga (até mai/2024): {len(rows):,} linhas")
    except Exception as e:
        print(f"  [aviso] sheet antiga: {e}")

    try:
        raw_nova = pd.read_excel(io.BytesIO(content), sheet_name="A partir de junho 2024", header=None)
        rows = _parse_sheet_nova(raw_nova)
        all_records.extend(rows)
        print(f"  Sheet nova  (jun/2024+):    {len(rows):,} linhas")
    except Exception as e:
        print(f"  [aviso] sheet nova: {e}")

    if not all_records:
        print("Nenhum dado parseado.")
        sys.exit(1)

    # Dedup: manter apenas última entrada por chave
    seen = {}
    for r in all_records:
        k = (r["ano"], r["mes"], r["distribuidora"], r["categoria"])
        seen[k] = r
    records = list(seen.values())

    print(f"\nTotal: {len(records):,} registros")
    url, key = _get_creds()
    sb = create_client(url, key)
    total = _upsert(sb, records)
    print(f"Concluido: {total:,} registros em anp_glp")


if __name__ == "__main__":
    main()
