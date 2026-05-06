#!/usr/bin/env python3
"""
consolidar.py
=============
Lê o xlsx PPI mais recente em DADOS/anp_ppi/ e gera o Parquet consolidado:
DADOS/anp_ppi/ppi_consolidado.parquet

Schema longo (1 linha por semana × produto × local):
    data_inicio, data_fim, produto, local, preco, variacao_pct, unidade

Detecta automaticamente o número de locais por sheet (varia: Gasolina/Diesel/QAV
têm 16, GLP tem 2).

Uso:
    python alertas/scripts/anp_ppi/consolidar.py
"""
import re
import sys
from pathlib import Path

import pandas as pd

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_DADOS_DIR = Path(__file__).parents[3] / "DADOS" / "anp_ppi"
_DEST      = _DADOS_DIR / "ppi_consolidado.parquet"

# sheet_name → (produto, unidade)
_SHEETS = {
    "Gasolina R$ semanal":   ("Gasolina A Comum", "R$/litro"),
    "Diesel R$ semanal":     ("Diesel A S10",     "R$/litro"),
    "QAV R$ semanal":        ("QAV",              "R$/litro"),
    "GLP R$ kg semanal":     ("GLP",              "R$/13kg"),
}

_PERIODO_RE = re.compile(
    r"(\d{2})/(\d{2})/(\d{4})\s*[aA]\s*(\d{2})/(\d{2})/(\d{4})"
)


def _parse_periodo(s: str) -> tuple[pd.Timestamp, pd.Timestamp] | tuple[None, None]:
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


def _detectar_layout(raw: pd.DataFrame) -> tuple[list[str], int]:
    """Retorna (locais, separator_col_index). Linha 2 tem 'Data'/'Semana' + locais
    + NaN separador + locais (variação)."""
    header = raw.iloc[2].tolist()
    # Achar índice da coluna Data/Semana (geralmente coluna 1)
    data_col = None
    for j, v in enumerate(header):
        if isinstance(v, str) and v.strip().lower() in {"data", "semana"}:
            data_col = j
            break
    if data_col is None:
        return [], -1

    # Locais começam logo após data_col, vão até primeira NaN
    locais = []
    j = data_col + 1
    while j < len(header):
        v = header[j]
        if isinstance(v, str) and v.strip():
            locais.append(v.strip())
            j += 1
        else:
            break
    sep = j  # primeira coluna NaN (separador entre preço e variação)
    return locais, sep


def _ler_sheet(path: Path, sheet: str, produto: str, unidade: str) -> pd.DataFrame:
    raw = pd.read_excel(path, sheet_name=sheet, header=None)
    locais, sep = _detectar_layout(raw)
    if not locais:
        return pd.DataFrame()

    n = len(locais)
    blocos = []
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

            blocos.append({
                "data_inicio":   d_ini,
                "data_fim":      d_fim,
                "produto":       produto,
                "local":         local,
                "preco":         preco,
                "variacao_pct":  varia,
                "unidade":       unidade,
            })
    return pd.DataFrame(blocos)


def _xlsx_mais_recente(dir_: Path) -> Path | None:
    cand = sorted(dir_.glob("ppi_*.xlsx"))
    return cand[-1] if cand else None


def main():
    src = _xlsx_mais_recente(_DADOS_DIR)
    if not src:
        print(f"Nenhum xlsx encontrado em {_DADOS_DIR}")
        sys.exit(1)
    print(f"Origem: {src.name}")

    partes = []
    for sheet, (produto, unidade) in _SHEETS.items():
        df = _ler_sheet(src, sheet, produto, unidade)
        partes.append(df)
        n_locais = df["local"].nunique() if not df.empty else 0
        print(f"  {sheet:30s} -> {len(df):,} linhas | {n_locais} locais ({produto})")

    consolidado = pd.concat(partes, ignore_index=True)
    consolidado["preco"]        = consolidado["preco"].astype("float32")
    consolidado["variacao_pct"] = consolidado["variacao_pct"].astype("float32")

    consolidado.to_parquet(_DEST, index=False, compression="snappy")
    sz = _DEST.stat().st_size / 1024
    print()
    print(f"Concluido: {_DEST.name}")
    print(f"  {len(consolidado):,} linhas | {sz:.1f} KB")
    print(f"  Periodo: {consolidado['data_inicio'].min().date()} -> {consolidado['data_fim'].max().date()}")
    print(f"  Produtos: {sorted(consolidado['produto'].unique())}")


if __name__ == "__main__":
    main()
