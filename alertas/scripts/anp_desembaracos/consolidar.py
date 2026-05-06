#!/usr/bin/env python3
"""
consolidar.py
=============
Baixa os arquivos anuais ANP de Desembaraços (todas as edições disponíveis na
página) e consolida em um único Parquet:
    DADOS/anp_desembaracos/desembaracos_consolidado.parquet

Cache:
    Anos fechados (anteriores ao ano corrente) → reusa cópia local se existir.
    Ano corrente → sempre rebaixa (recebe atualizações mensais).

Schema:
    ano, mes, importador, cnpj, uf, ncm, descricao_ncm,
    ua_despacho, pais_origem, quantidade_kg

Uso:
    python alertas/scripts/anp_desembaracos/consolidar.py
"""
import re
import sys
from datetime import date
from pathlib import Path

import pandas as pd
import requests
from bs4 import BeautifulSoup

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_DADOS_DIR = Path(__file__).parents[3] / "DADOS" / "anp_desembaracos"
_DEST      = _DADOS_DIR / "desembaracos_consolidado.parquet"
_PAGE_URL  = (
    "https://www.gov.br/anp/pt-br/assuntos/importacoes-e-exportacoes"
    "/relatorio-de-desembaracos-de-importacoes-de-petroleo-gas-derivados-e-biocombustiveis"
)
_HEADERS = {"User-Agent": "Mozilla/5.0"}
_FILE_PAT = re.compile(r"desembaraco-(\d{4})\.xlsx", re.IGNORECASE)
_ANO_ATUAL = date.today().year

_COLS_RENAME = {
    "Mês de desembaraço":              "mes",
    "Importador":                      "importador",
    "CNPJ":                            "cnpj",
    "UF DO CNPJ*":                     "uf",
    "NCM":                             "ncm",
    "Descrição NCM":                   "descricao_ncm",
    "UA Despacho":                     "ua_despacho",
    "Pais de origem":                  "pais_origem",
    "Quantidade de produto em quilos": "quantidade_kg",
}

# Apenas combustíveis — descarta petroquímicos, lubrificantes, aditivos,
# asfalto/betume, solventes e categorias "Outros".
_NCMS_COMBUSTIVEIS = {
    22071010,  # Etanol carburante (≥99% volume)
    22072011,  # Etanol carburante anidro
    27090010,  # Petróleo cru
    27101251,  # Naftas para aviação
    27101911,  # Querosene de aviação (QAV)
    27101921,  # Gasóleo (Diesel)
    27101922,  # Fuel-oil
    27101931,  # Gasolina A (sem aditivos)
    27101932,  # Gasolina aditivada
    27101994,  # Mistura de hidrocarbonetos (parafínicos)
    27111100,  # Gás natural liquefeito (GNL)
    27111300,  # Butanos (LPG)
    27111910,  # GLP propano/butano
    27112100,  # Gás natural (gasoso)
    27112910,  # Butanos gasoso
    38260000,  # Biodiesel
}


def _listar_anos_disponiveis() -> dict[int, str]:
    """Returns {ano: url} para todos os arquivos desembaraco-YYYY.xlsx."""
    r = requests.get(_PAGE_URL, headers=_HEADERS, timeout=30)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "lxml")
    out: dict[int, str] = {}
    for a in soup.find_all("a", href=True):
        m = _FILE_PAT.search(a["href"])
        if m:
            ano = int(m.group(1))
            href = a["href"]
            url = href if href.startswith("http") else "https://www.gov.br" + href
            out[ano] = url
    return dict(sorted(out.items()))


def _baixar(url: str, dest: Path):
    r = requests.get(url, headers=_HEADERS, stream=True, timeout=180)
    r.raise_for_status()
    with open(dest, "wb") as f:
        for chunk in r.iter_content(65536):
            f.write(chunk)


def _ler_arquivo(path: Path, ano: int) -> pd.DataFrame:
    with pd.ExcelFile(path) as xf:
        sheets = [s for s in xf.sheet_names if s.lower().startswith("desemb")]
        partes = []
        for sheet in sheets:
            df = pd.read_excel(xf, sheet_name=sheet, skiprows=2)
            df = df.rename(columns=_COLS_RENAME)
            df = df[pd.to_numeric(df["mes"], errors="coerce").notna()]
            partes.append(df)
    if not partes:
        return pd.DataFrame()

    df = pd.concat(partes, ignore_index=True)
    df["ano"] = ano
    df["mes"] = pd.to_numeric(df["mes"], errors="coerce").astype("Int8")
    df["ncm"] = pd.to_numeric(df["ncm"], errors="coerce").astype("Int64")
    df["quantidade_kg"] = pd.to_numeric(df["quantidade_kg"], errors="coerce").astype("float64")

    # Filtra apenas NCMs de combustíveis
    df = df[df["ncm"].isin(_NCMS_COMBUSTIVEIS)]

    for col in ("importador", "cnpj", "uf", "descricao_ncm", "ua_despacho", "pais_origem"):
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip()
            df.loc[df[col] == "nan", col] = None

    cols = ["ano", "mes", "importador", "cnpj", "uf", "ncm",
            "descricao_ncm", "ua_despacho", "pais_origem", "quantidade_kg"]
    return df[[c for c in cols if c in df.columns]]


def main():
    _DADOS_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Consultando {_PAGE_URL}...")
    anos_disponiveis = _listar_anos_disponiveis()
    print(f"  {len(anos_disponiveis)} anos disponiveis: {list(anos_disponiveis)}")
    print()

    partes = []
    for ano, url in anos_disponiveis.items():
        nome = f"desembaraco-{ano}.xlsx"
        dest = _DADOS_DIR / nome
        is_corrente = (ano == _ANO_ATUAL)

        if is_corrente or not dest.exists():
            try:
                print(f"[{ano}] Baixando {nome}...", end=" ", flush=True)
                _baixar(url, dest)
                print(f"{dest.stat().st_size/1024:.0f} KB")
            except Exception as e:
                print(f"ERRO: {e}")
                if not dest.exists():
                    continue
        else:
            print(f"[{ano}] Cache {nome} ({dest.stat().st_size/1024:.0f} KB)")

        try:
            df = _ler_arquivo(dest, ano)
            partes.append(df)
            print(f"       -> {len(df):,} linhas")
        except Exception as e:
            print(f"       ERRO ao ler: {e}")

    if not partes:
        print("Nenhum dado lido. Abortando.")
        sys.exit(1)

    consolidado = pd.concat(partes, ignore_index=True)
    consolidado.to_parquet(_DEST, index=False, compression="snappy")
    sz = _DEST.stat().st_size / 1024

    # Limpa apenas o xlsx do ano corrente; mantém anos fechados como cache
    f_corrente = _DADOS_DIR / f"desembaraco-{_ANO_ATUAL}.xlsx"
    if f_corrente.exists():
        try:
            f_corrente.unlink()
            print(f"  [limpeza] removido {f_corrente.name}")
        except Exception as e:
            print(f"  [aviso] falha ao remover {f_corrente.name}: {e}")

    print()
    print(f"Concluido: {_DEST.name} ({sz:.1f} KB)")
    print(f"  {len(consolidado):,} linhas")
    print(f"  Periodo: {consolidado['ano'].min()}-{int(consolidado.loc[consolidado['ano']==consolidado['ano'].min(),'mes'].min()):02d} -> "
          f"{consolidado['ano'].max()}-{int(consolidado.loc[consolidado['ano']==consolidado['ano'].max(),'mes'].max()):02d}")
    print(f"  NCMs:        {consolidado['ncm'].nunique()}")
    print(f"  Importadores: {consolidado['importador'].nunique()}")
    print(f"  Paises:       {consolidado['pais_origem'].nunique()}")


if __name__ == "__main__":
    main()
