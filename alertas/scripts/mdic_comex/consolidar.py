#!/usr/bin/env python3
"""
consolidar.py
=============
Baixa via API do MDIC Comex Stat o histórico de import/export dos 3 NCMs
de petróleo (cru, gasolinas, diesel) e gera o Parquet:
    DADOS/mdic_comex/comex_consolidado.parquet

Schema:
    ano, mes, flow, ncm_codigo, ncm_nome, pais, volume_kg, valor_fob_usd

API instável: para cada (ano, flow), faz até N retries com backoff exponencial
até obter resposta com linhas. Períodos já presentes no Parquet são pulados
(idempotente).

Uso:
    python alertas/scripts/mdic_comex/consolidar.py
    python alertas/scripts/mdic_comex/consolidar.py --mes 2026-03   (só esse mês)
    python alertas/scripts/mdic_comex/consolidar.py --desde 2020    (a partir do ano)
"""
import argparse
import sys
import time
from datetime import date
from pathlib import Path

import pandas as pd
import requests

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_DADOS_DIR = Path(__file__).parents[3] / "DADOS" / "mdic_comex"
_DEST      = _DADOS_DIR / "comex_consolidado.parquet"
_API       = "https://api-comexstat.mdic.gov.br/general"
_HEADERS   = {"Content-Type": "application/json", "Accept": "application/json"}

# NCMs da MDIC Comex Stat (códigos completos 8 dígitos):
#   27090010 = Óleos brutos de petróleo
#   27101259 = Outras gasolinas (exceto aviação)
#   27101921 = Gasóleo (Diesel)
# Nota: 27090000 (categoria-mãe sem dígitos finais) NÃO retorna dados.
_NCMS = ["27090010", "27101259", "27101921"]

_ANO_MIN = 1997
_RETRIES_POR_QUERY = 4
_BACKOFF = [1, 3, 8, 20]  # seconds per retry — falha rápido, anos sem dado podem ser raros


def _post_retry(payload: dict, label: str = "") -> list[dict]:
    """POST com retries; retorna [] se todas as tentativas falharam ou vieram vazias."""
    for tent in range(_RETRIES_POR_QUERY):
        try:
            r = requests.post(_API, headers=_HEADERS, json=payload, timeout=60)
            if r.status_code == 200:
                data = r.json().get("data", {}).get("list", []) or []
                if data:
                    return data
        except Exception:
            pass
        if tent < _RETRIES_POR_QUERY - 1:
            time.sleep(_BACKOFF[tent])
    return []


def _query(flow: str, pf: str, pt: str) -> list[dict]:
    payload = {
        "flow":        flow,
        "monthDetail": True,
        "period":      {"from": pf, "to": pt},
        "filters":     [{"filter": "ncm", "values": _NCMS}],
        "details":     ["ncm", "country"],
        "metrics":     ["metricFOB", "metricKG"],
    }
    return _post_retry(payload, f"{flow} {pf}-{pt}")


def _normaliza(rows: list[dict]) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    df = df.rename(columns={
        "coNcm":       "ncm_codigo",
        "ncm":         "ncm_nome",
        "country":     "pais",
        "year":        "ano",
        "monthNumber": "mes",
        "metricKG":    "volume_kg",
        "metricFOB":   "valor_fob_usd",
    })
    df["ano"] = pd.to_numeric(df["ano"], errors="coerce").astype("Int16")
    df["mes"] = pd.to_numeric(df["mes"], errors="coerce").astype("Int8")
    df["volume_kg"]     = pd.to_numeric(df["volume_kg"],     errors="coerce").astype("float64")
    df["valor_fob_usd"] = pd.to_numeric(df["valor_fob_usd"], errors="coerce").astype("float64")
    df = df.dropna(subset=["ano", "mes"])
    return df[["ano", "mes", "flow", "ncm_codigo", "ncm_nome", "pais",
               "volume_kg", "valor_fob_usd"]]


def _ncms_por_ano() -> dict[int, set[str]]:
    """Retorna {ano: {ncm_codigo, ...}} já presentes no Parquet."""
    if not _DEST.exists():
        return {}
    try:
        df = pd.read_parquet(_DEST, columns=["ano", "ncm_codigo"])
        out: dict[int, set[str]] = {}
        for r in df.itertuples(index=False):
            out.setdefault(int(r.ano), set()).add(r.ncm_codigo)
        return out
    except Exception:
        return {}


def _backfill_mes(ano: int, mes: int) -> pd.DataFrame:
    """Tenta baixar um mês específico (ambos flows). Retorna DataFrame combinado."""
    p = f"{ano}-{mes:02d}"
    partes = []
    for flow in ("import", "export"):
        rows = _query(flow, p, p)
        if rows:
            for r in rows:
                r["flow"] = flow
            df = _normaliza(rows)
            partes.append(df)
            print(f"    {flow:6s} {p}: {len(df):,} linhas")
        else:
            print(f"    {flow:6s} {p}: vazio (após {_RETRIES_POR_QUERY} tentativas)")
    return pd.concat(partes, ignore_index=True) if partes else pd.DataFrame()


def _backfill_ano(ano: int) -> pd.DataFrame:
    """Tenta baixar um ano inteiro (ambos flows). Fallback para mês-a-mês se ano-todo falhar."""
    pf, pt = f"{ano}-01", f"{ano}-12"
    partes = []
    for flow in ("import", "export"):
        rows = _query(flow, pf, pt)
        if rows:
            for r in rows:
                r["flow"] = flow
            df = _normaliza(rows)
            partes.append(df)
            print(f"  {ano} {flow:6s}: {len(df):,} linhas (janela anual)", flush=True)
        else:
            # Fallback: mês-a-mês
            print(f"  {ano} {flow:6s}: janela anual vazia, mês-a-mês...", flush=True)
            achou = 0
            for m in range(1, 13):
                pmes = f"{ano}-{m:02d}"
                rows_m = _query(flow, pmes, pmes)
                if rows_m:
                    for r in rows_m:
                        r["flow"] = flow
                    df_m = _normaliza(rows_m)
                    partes.append(df_m)
                    achou += len(df_m)
            if achou:
                print(f"  {ano} {flow:6s}: +{achou:,} via mês-a-mês", flush=True)
            else:
                print(f"  {ano} {flow:6s}: sem dados em todo o ano", flush=True)

    return pd.concat(partes, ignore_index=True) if partes else pd.DataFrame()


def _salvar(df: pd.DataFrame):
    """Concatena com Parquet existente e dedupa."""
    _DADOS_DIR.mkdir(parents=True, exist_ok=True)
    if _DEST.exists():
        existente = pd.read_parquet(_DEST)
        df = pd.concat([existente, df], ignore_index=True)
    # Dedup por todas as dimensões (mantém últimos valores)
    dims = ["ano", "mes", "flow", "ncm_codigo", "pais"]
    df = df.drop_duplicates(subset=dims, keep="last")
    df = df.sort_values(["ano", "mes", "flow", "ncm_codigo", "pais"])
    df.to_parquet(_DEST, index=False, compression="snappy")


def _resumo():
    if not _DEST.exists():
        return
    df = pd.read_parquet(_DEST, columns=["ano", "mes", "flow"])
    sz = _DEST.stat().st_size / 1024
    print()
    print(f"Parquet: {_DEST.name} ({sz:.1f} KB)")
    print(f"  {len(df):,} linhas")
    if not df.empty:
        meses = sorted({(int(r.ano), int(r.mes)) for r in df.itertuples()})
        print(f"  Periodo: {meses[0][0]}-{meses[0][1]:02d} -> {meses[-1][0]}-{meses[-1][1]:02d}")
        print(f"  Meses distintos: {len(meses)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mes",   help="YYYY-MM (apenas esse mês)")
    ap.add_argument("--desde", type=int, help="Ano inicial (default: 1997 + apenas faltantes)")
    args = ap.parse_args()

    _DADOS_DIR.mkdir(parents=True, exist_ok=True)

    if args.mes:
        ano, mes = map(int, args.mes.split("-"))
        print(f"Atualizando {ano}-{mes:02d}...")
        df = _backfill_mes(ano, mes)
        if not df.empty:
            _salvar(df)
        _resumo()
        return

    ano_min  = args.desde or _ANO_MIN
    ano_max  = date.today().year
    cache    = _ncms_por_ano()
    alvos    = set(_NCMS)

    for ano in range(ano_min, ano_max + 1):
        # Pula apenas anos passados que já têm os 3 NCMs cobertos
        if ano < ano_max and alvos.issubset(cache.get(ano, set())):
            print(f"  {ano}: cache ({len(cache[ano])} NCMs)")
            continue

        df = _backfill_ano(ano)
        if not df.empty:
            _salvar(df)
            cache.setdefault(ano, set()).update(df["ncm_codigo"].unique())

    _resumo()


if __name__ == "__main__":
    main()
