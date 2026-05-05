#!/usr/bin/env python3
"""
anp_precos_produtores_sync.py
=============================
Baixa as séries de Preços Médios Ponderados da ANP e upserta em
anp_precos_produtores. Inclui a série 2002-2012 (estática, apenas no
primeiro run) e sempre rebaixa a série 2013+ (corrente).

Uso:
    python scripts/anp_precos_produtores_sync.py

Credenciais: SUPABASE_URL + SUPABASE_SERVICE_KEY (env ou .env)
"""
import math
import os
import re
import sys
from pathlib import Path

import pandas as pd
import requests
from supabase import create_client

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_HEADERS = {"User-Agent": "Mozilla/5.0"}
_BATCH   = 500

_FONTES = [
    {
        "url":    (
            "https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia"
            "/precos/ppidp/precos-ponderados-semanais-2002-2012.xls"
        ),
        "sheet":  "Preços - Produtor e Importador",
        "estatica": True,
    },
    {
        "url":    (
            "https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia"
            "/precos/ppidp/precos-medios-ponderados-semanais-2013.xls"
        ),
        "sheet":  "Preços Produtor e Importador",
        "estatica": False,
    },
]

_REGIOES = ["Norte", "Nordeste", "Centro-Oeste", "Sul", "Sudeste"]

_NORMALIZAR_PRODUTO = {
    "Gasolina A":   "Gasolina A Comum",
    "Óleo Diesel²": "Óleo Diesel",
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


def _download(url: str) -> bytes:
    r = requests.get(url, headers=_HEADERS, stream=True, timeout=180)
    r.raise_for_status()
    return r.content


def _parse_unidade(produto: str) -> tuple[str, str]:
    m = re.match(r"(.+?)\s*\(([^)]+)\)\s*$", str(produto))
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return str(produto).strip(), ""


def _parse_xls(content: bytes, sheet: str) -> list[dict]:
    raw = pd.read_excel(content, sheet_name=sheet, header=None)
    rows = []
    for i in range(9, len(raw)):
        produto_raw = raw.iat[i, 0]
        if not isinstance(produto_raw, str) or not produto_raw.strip():
            continue
        d_ini = pd.to_datetime(raw.iat[i, 1], dayfirst=True, errors="coerce")
        d_fim = pd.to_datetime(raw.iat[i, 2], dayfirst=True, errors="coerce")
        if pd.isna(d_ini):
            continue
        produto, unidade = _parse_unidade(produto_raw)
        produto = _NORMALIZAR_PRODUTO.get(produto, produto)
        for k, regiao in enumerate(_REGIOES):
            v = raw.iat[i, 3 + k]
            try:
                preco = float(v) if pd.notna(v) and v != "***" else None
            except (TypeError, ValueError):
                preco = None
            if preco is None:
                continue
            rows.append({
                "data_inicio": d_ini.date().isoformat(),
                "data_fim":    (d_fim.date().isoformat() if pd.notna(d_fim) else d_ini.date().isoformat()),
                "produto":     produto,
                "unidade":     unidade,
                "regiao":      regiao,
                "preco":       preco,
            })
    return rows


def _already_has_static(sb) -> bool:
    """Returns True if 2002-2012 data is already in Supabase."""
    try:
        res = sb.table("anp_precos_produtores") \
                .select("data_inicio", count="exact") \
                .lt("data_inicio", "2013-01-01") \
                .limit(1).execute()
        return (res.count or 0) > 0
    except Exception:
        return False


def _upsert(sb, records: list[dict]) -> int:
    total = 0
    n_batches = math.ceil(len(records) / _BATCH)
    for i in range(0, len(records), _BATCH):
        batch = records[i : i + _BATCH]
        sb.table("anp_precos_produtores").upsert(
            batch, on_conflict="data_inicio,produto,regiao"
        ).execute()
        total += len(batch)
        print(f"  [{i // _BATCH + 1}/{n_batches}] {total:,}/{len(records):,}")
    return total


def main():
    url, key = _get_creds()
    sb = create_client(url, key)

    has_static = _already_has_static(sb)
    all_records: list[dict] = []

    for src in _FONTES:
        if src["estatica"] and has_static:
            print(f"  Série 2002-2012 já presente no Supabase — pulando")
            continue

        print(f"  Baixando {src['url'].split('/')[-1]}...", end=" ", flush=True)
        try:
            content = _download(src["url"])
            print(f"{len(content) / 1024:.0f} KB")
        except Exception as e:
            print(f"ERRO: {e}")
            if not src["estatica"]:
                sys.exit(1)
            continue

        rows = _parse_xls(content, src["sheet"])
        all_records.extend(rows)
        print(f"  → {len(rows):,} linhas")

    if not all_records:
        print("Nada a fazer.")
        sys.exit(0)

    # Deduplica pela chave de conflito antes do upsert (previne "ON CONFLICT DO UPDATE
    # cannot affect row a second time" quando as duas séries se sobrepõem)
    seen: set[tuple] = set()
    deduped: list[dict] = []
    for r in all_records:
        key_val = (r["data_inicio"], r["produto"], r["regiao"])
        if key_val not in seen:
            seen.add(key_val)
            deduped.append(r)
    if len(deduped) < len(all_records):
        print(f"  Deduplicados: {len(all_records):,} → {len(deduped):,}")
    all_records = deduped

    print(f"\nTotal: {len(all_records):,} registros")
    total = _upsert(sb, all_records)
    print(f"Concluido: {total:,} registros em anp_precos_produtores")


if __name__ == "__main__":
    main()
