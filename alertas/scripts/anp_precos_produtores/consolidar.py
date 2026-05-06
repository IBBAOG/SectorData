#!/usr/bin/env python3
"""
consolidar.py
=============
Baixa as duas séries de Preços Médios Ponderados (2002-2012 e 2013+) e
consolida em um único Parquet:
    DADOS/anp_precos_produtores/precos_produtores_consolidado.parquet

Schema longo (1 linha por semana × produto × região):
    data_inicio, data_fim, produto, unidade, regiao, preco

Uso:
    python alertas/scripts/anp_precos_produtores/consolidar.py
"""
import re
import sys
from pathlib import Path

import pandas as pd
import requests

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_DADOS_DIR = Path(__file__).parents[3] / "DADOS" / "anp_precos_produtores"
_DEST      = _DADOS_DIR / "precos_produtores_consolidado.parquet"

_FONTES = [
    {
        "url":     "https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia"
                   "/precos/ppidp/precos-ponderados-semanais-2002-2012.xls",
        "nome":    "precos-ponderados-semanais-2002-2012.xls",
        "sheet":   "Preços - Produtor e Importador",
        "estatica": True,   # série fechada, não muda — baixar só se ausente
    },
    {
        "url":     "https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia"
                   "/precos/ppidp/precos-medios-ponderados-semanais-2013.xls",
        "nome":    "precos-medios-ponderados-semanais-2013.xls",
        "sheet":   "Preços Produtor e Importador",
        "estatica": False,  # série corrente — sempre rebaixar
    },
]

_REGIOES = ["Norte", "Nordeste", "Centro-Oeste", "Sul", "Sudeste"]
_HEADERS = {"User-Agent": "Mozilla/5.0"}

# A ANP renomeou produtos ao migrar para a serie 2013+. Mapeamos para nomes
# canonicos para que as series sejam continuas no Parquet.
_NORMALIZAR_PRODUTO = {
    "Gasolina A":      "Gasolina A Comum",  # antiga -> nova nomenclatura
    "Óleo Diesel²":    "Óleo Diesel",       # nova -> mantem nome antigo (sem o ²)
}


def _baixar(url: str, dest: Path):
    r = requests.get(url, headers=_HEADERS, stream=True, timeout=120)
    r.raise_for_status()
    with open(dest, "wb") as f:
        for chunk in r.iter_content(65536):
            f.write(chunk)


def _parse_unidade(produto: str) -> tuple[str, str]:
    """Extrai unidade do nome: 'Óleo Diesel (R$/litro)' -> ('Óleo Diesel', 'R$/litro')"""
    m = re.match(r"(.+?)\s*\(([^)]+)\)\s*$", str(produto))
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return str(produto).strip(), ""


def _ler_arquivo(path: Path, sheet: str) -> pd.DataFrame:
    raw = pd.read_excel(path, sheet_name=sheet, header=None)
    blocos = []
    for i in range(9, len(raw)):  # dados começam na L9
        produto_raw = raw.iat[i, 0]
        if not isinstance(produto_raw, str) or not produto_raw.strip():
            continue
        d_ini = raw.iat[i, 1]
        d_fim = raw.iat[i, 2]

        d_ini = pd.to_datetime(d_ini, dayfirst=True, errors="coerce")
        d_fim = pd.to_datetime(d_fim, dayfirst=True, errors="coerce")
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
            blocos.append({
                "data_inicio": d_ini,
                "data_fim":    d_fim if pd.notna(d_fim) else d_ini,
                "produto":     produto,
                "unidade":     unidade,
                "regiao":      regiao,
                "preco":       preco,
            })
    return pd.DataFrame(blocos)


def main():
    _DADOS_DIR.mkdir(parents=True, exist_ok=True)
    partes = []

    for src in _FONTES:
        dest = _DADOS_DIR / src["nome"]

        if src["estatica"] and dest.exists() and dest.stat().st_size > 0:
            print(f"Cache {src['nome']} ({dest.stat().st_size/1024:.0f} KB)")
        else:
            print(f"Baixando {src['nome']}...", end=" ", flush=True)
            try:
                _baixar(src["url"], dest)
                print(f"{dest.stat().st_size/1024:.0f} KB")
            except Exception as e:
                print(f"ERRO: {e}")
                if not dest.exists():
                    continue
                print(f"  Usando cópia local existente")

        df = _ler_arquivo(dest, src["sheet"])
        partes.append(df)
        n_prod = df["produto"].nunique() if not df.empty else 0
        print(f"  -> {len(df):,} linhas | {n_prod} produtos")

    if not partes:
        print("Nenhum dado lido. Abortando.")
        sys.exit(1)

    consolidado = pd.concat(partes, ignore_index=True)
    consolidado["preco"] = consolidado["preco"].astype("float32")
    consolidado = consolidado.sort_values(["data_inicio", "produto", "regiao"])

    consolidado.to_parquet(_DEST, index=False, compression="snappy")
    sz = _DEST.stat().st_size / 1024

    # Limpa apenas a série dinâmica (2013+); mantém o cache estático (2002-2012)
    for src in _FONTES:
        if src["estatica"]:
            continue
        f = _DADOS_DIR / src["nome"]
        if f.exists():
            try:
                f.unlink()
            except Exception:
                pass

    print()
    print(f"Concluido: {_DEST.name} ({sz:.1f} KB)")
    print(f"  {len(consolidado):,} linhas")
    print(f"  Periodo: {consolidado['data_inicio'].min().date()} -> {consolidado['data_inicio'].max().date()}")
    print(f"  Produtos: {consolidado['produto'].nunique()}")
    print(f"  Regioes:  {sorted(consolidado['regiao'].unique())}")


if __name__ == "__main__":
    main()
