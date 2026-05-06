#!/usr/bin/env python3
"""
consolidar.py
=============
Consolida os CSVs de importações/exportações da ANP (Petróleo + Derivados)
em um único Parquet:
    DADOS/anp_dados_abertos_ie/dados_abertos_ie_consolidado.parquet

Schema:
    ano, mes, produto, operacao, volume_m3, valor_usd

Volume está em m³ (confere com totais conhecidos de comércio exterior do Brasil).

Filtra apenas combustíveis (descarta ASFALTO, LUBRIFICANTE, PARAFINA,
SOLVENTE, OUTROS NÃO ENERGÉTICOS).

Uso:
    python alertas/scripts/anp_dados_abertos_ie/consolidar.py
"""
import re
import sys
from pathlib import Path

import pandas as pd
import requests
from bs4 import BeautifulSoup

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_DADOS_DIR = Path(__file__).parents[3] / "DADOS" / "anp_dados_abertos_ie"
_DEST      = _DADOS_DIR / "dados_abertos_ie_consolidado.parquet"
_PAGE_URL  = (
    "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos"
    "/importacoes-e-exportacoes"
)
_HEADERS = {"User-Agent": "Mozilla/5.0"}
_PATS = {
    "petroleo":  re.compile(r"importacoes-exportacoes-petroleo[^/]*\.csv",  re.IGNORECASE),
    "derivados": re.compile(r"importacoes-exportacoes-derivados[^/]*\.csv", re.IGNORECASE),
}

_MES_MAP = {
    "JAN": 1, "FEV": 2, "MAR": 3, "ABR": 4,  "MAI": 5, "JUN": 6,
    "JUL": 7, "AGO": 8, "SET": 9, "OUT": 10, "NOV": 11, "DEZ": 12,
}

# Apenas combustíveis (NAFTA e COQUE incluídos a pedido)
_PRODUTOS_COMBUSTIVEIS = {
    "PETRÓLEO",
    "COMBUSTÍVEIS PARA AERONAVES",
    "COMBUSTÍVEIS PARA NAVIOS",
    "COQUE",
    "GASOLINA A",
    "GASOLINA DE AVIAÇÃO",
    "GLP",
    "NAFTA",
    "QUEROSENE DE AVIAÇÃO",
    "QUEROSENE ILUMINANTE",
    "ÓLEO COMBUSTÍVEL",
    "ÓLEO DIESEL",
}


def _parse_numero(s) -> float | None:
    """Converte número brasileiro (vírgula decimal) para float."""
    if s is None:
        return None
    s = str(s).strip()
    if not s or s.lower() in ("nan", "none"):
        return None
    s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def _ler_csv(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, sep=";", encoding="utf-8-sig", dtype=str)
    df = df.rename(columns={
        "ANO":                    "ano",
        "MÊS":                    "mes",
        "PRODUTO":                "produto",
        "OPERAÇÃO COMERCIAL":     "operacao",
        "IMPORTADO / EXPORTADO":  "volume_m3",
        "DISPÊNDIO / RECEITA":    "valor_usd",
    })

    df["ano"]      = pd.to_numeric(df["ano"], errors="coerce").astype("Int16")
    df["mes"]      = df["mes"].str.strip().str.upper().map(_MES_MAP).astype("Int8")
    df["produto"]  = df["produto"].str.strip()
    df["operacao"] = df["operacao"].str.strip()
    df["volume_m3"] = df["volume_m3"].apply(_parse_numero)
    df["valor_usd"] = df["valor_usd"].apply(_parse_numero)

    df = df.dropna(subset=["ano", "mes", "produto", "operacao"])
    return df[["ano", "mes", "produto", "operacao", "volume_m3", "valor_usd"]]


def _baixar_csvs() -> list[Path]:
    """Baixa os CSVs petroleo + derivados da página, sobrescrevendo locais."""
    r = requests.get(_PAGE_URL, headers=_HEADERS, timeout=30)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "lxml")

    encontrados: dict[str, str] = {}
    for a in soup.find_all("a", href=True):
        href = a["href"]
        for key, pat in _PATS.items():
            if key not in encontrados and pat.search(href):
                encontrados[key] = href if href.startswith("http") else "https://www.gov.br" + href

    paths = []
    for key, url in encontrados.items():
        nome = url.split("/")[-1].split("?")[0]
        dest = _DADOS_DIR / nome
        print(f"Baixando {nome}...", end=" ", flush=True)
        try:
            resp = requests.get(url, headers=_HEADERS, stream=True, timeout=180)
            resp.raise_for_status()
            with open(dest, "wb") as f:
                for chunk in resp.iter_content(65536):
                    f.write(chunk)
            print(f"{dest.stat().st_size/1024:.0f} KB")
            paths.append(dest)
        except Exception as e:
            print(f"ERRO: {e}")
            if dest.exists():
                paths.append(dest)
    return paths


def main():
    _DADOS_DIR.mkdir(parents=True, exist_ok=True)
    csvs = _baixar_csvs()
    if not csvs:
        print(f"Nenhum CSV obtido em {_DADOS_DIR}")
        sys.exit(1)

    partes = []
    for csv in csvs:
        print(f"Lendo {csv.name}...", end=" ", flush=True)
        try:
            df = _ler_csv(csv)
            partes.append(df)
            print(f"{len(df):,} linhas")
        except Exception as e:
            print(f"ERRO: {e}")

    if not partes:
        print("Nada lido. Abortando.")
        sys.exit(1)

    consolidado = pd.concat(partes, ignore_index=True)
    antes = len(consolidado)
    consolidado = consolidado[consolidado["produto"].isin(_PRODUTOS_COMBUSTIVEIS)]
    depois = len(consolidado)
    print(f"\nFiltro combustíveis: {antes:,} -> {depois:,} linhas (-{antes-depois:,})")

    consolidado["volume_m3"] = consolidado["volume_m3"].astype("float64")
    consolidado["valor_usd"] = consolidado["valor_usd"].astype("float64")
    consolidado = consolidado.sort_values(["ano", "mes", "produto", "operacao"])

    consolidado.to_parquet(_DEST, index=False, compression="snappy")
    sz = _DEST.stat().st_size / 1024

    # Limpa CSVs após consolidação
    for csv in csvs:
        try:
            csv.unlink()
            print(f"  [limpeza] removido {csv.name}")
        except Exception as e:
            print(f"  [aviso] falha ao remover {csv.name}: {e}")

    print()
    print(f"Concluido: {_DEST.name} ({sz:.1f} KB)")
    print(f"  {len(consolidado):,} linhas")
    print(f"  Periodo:  {consolidado['ano'].min()}-{consolidado.loc[consolidado['ano']==consolidado['ano'].min(),'mes'].min():02d}"
          f" -> {consolidado['ano'].max()}-{consolidado.loc[consolidado['ano']==consolidado['ano'].max(),'mes'].max():02d}")
    print(f"  Produtos: {sorted(consolidado['produto'].unique())}")
    print(f"  Operacoes: {sorted(consolidado['operacao'].unique())}")


if __name__ == "__main__":
    main()
