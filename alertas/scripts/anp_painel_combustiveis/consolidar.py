#!/usr/bin/env python3
"""
consolidar.py
=============
Lê o ZIP mais recente do Painel Combustíveis Líquidos da ANP e gera 3 Parquets:
    DADOS/anp_painel_combustiveis/vendas.parquet
    DADOS/anp_painel_combustiveis/entregas.parquet
    DADOS/anp_painel_combustiveis/importacoes_distribuidores.parquet

Limpa CSVs/ZIP/pastas extraídas após consolidação.

Volume normalizado para m³ (fonte ANP usa "mil m³"; multiplicado por 1000).

Uso:
    python alertas/scripts/anp_painel_combustiveis/consolidar.py
"""
import re
import shutil
import sys
import zipfile
from pathlib import Path

import pandas as pd
import requests

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_DADOS_DIR = Path(__file__).parents[3] / "DADOS" / "anp_painel_combustiveis"
_ZIP_URL   = ("https://www.gov.br/anp/pt-br/centrais-de-conteudo"
              "/dados-abertos/arquivos/mdpg/liquidos.zip")
_HEADERS   = {"User-Agent": "Mozilla/5.0"}

_VENDAS_PARQUET     = _DADOS_DIR / "vendas.parquet"
_ENTREGAS_PARQUET   = _DADOS_DIR / "entregas.parquet"
_IMPORT_PARQUET     = _DADOS_DIR / "importacoes_distribuidores.parquet"

# Schemas alvo (lower-snake-case)
_VENDAS_COLS_ATUAL = {
    "Ano":                              "ano",
    "Mês":                              "mes",
    "Agente Regulado":                  "agente_regulado",
    "Código do Produto":                "codigo_produto",
    "Nome do Produto":                  "nome_produto",
    "Descrição do Produto":             "descricao_produto",
    "Região Origem":                    "regiao_origem",
    "UF Origem":                        "uf_origem",
    "Região Destinatário":              "regiao_destinatario",
    "UF Destino":                       "uf_destino",
    "Mercado Destinatário":             "mercado_destinatario",
    "Quantidade de Produto (mil m³)":   "volume_mil_m3",
}

# Histórico não tem Descrição do Produto e não tem header
_VENDAS_COLS_HIST = [
    "ano", "mes", "agente_regulado", "codigo_produto", "nome_produto",
    "regiao_origem", "uf_origem", "regiao_destinatario", "uf_destino",
    "mercado_destinatario", "volume_mil_m3",
]

_ENTREGAS_COLS = {
    "Ano":                              "ano",
    "Mês":                              "mes",
    "Fornecedor Destino":               "fornecedor",
    "Distribuidor Origem":              "distribuidor",
    "Código do Produto":                "codigo_produto",
    "Nome do Produto":                  "nome_produto",
    "Região Origem":                    "regiao_origem",
    "UF Origem":                        "uf_origem",
    "Localidade Destino":               "localidade_destino",
    "Região Destinatário":              "regiao_destinatario",
    "UF Destino":                       "uf_destino",
    "Quantidade de Produto (mil m³)":   "volume_mil_m3",
}

_IMPORT_COLS = {
    "Ano":                              "ano",
    "Mês":                              "mes",
    "Distribuidor":                     "distribuidor",
    "Região":                           "regiao",
    "UF":                               "uf",
    "Código do Produto":                "codigo_produto",
    "Nome do Produto":                  "nome_produto",
    "Descrição do Produto":             "descricao_produto",
    "Região Origem":                    "regiao_origem",
    "UF Origem":                        "uf_origem",
    "Quantidade de produto (mil m³)":   "volume_mil_m3",
}


def _parse_numero(s) -> float | None:
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


def _normalizar(df: pd.DataFrame) -> pd.DataFrame:
    df["ano"] = pd.to_numeric(df["ano"], errors="coerce").astype("Int16")
    df["mes"] = pd.to_numeric(df["mes"], errors="coerce").astype("Int8")
    df["volume_mil_m3"] = df["volume_mil_m3"].apply(_parse_numero)
    df["volume_m3"]     = df["volume_mil_m3"] * 1000.0
    df = df.drop(columns=["volume_mil_m3"])
    df = df.dropna(subset=["ano", "mes"])
    # Strip strings
    for col in df.columns:
        if df[col].dtype == "object":
            df[col] = df[col].astype(str).str.strip()
            df.loc[df[col].isin(["nan", "None", ""]), col] = None
    return df


def _consolidar_vendas(extract_dir: Path) -> pd.DataFrame:
    partes = []

    f_atual = extract_dir / "Liquidos_Vendas_Atual.csv"
    if f_atual.exists():
        df = pd.read_csv(f_atual, sep=";", encoding="latin-1", dtype=str)
        df = df.rename(columns=_VENDAS_COLS_ATUAL)
        df = df[[c for c in _VENDAS_COLS_ATUAL.values() if c in df.columns]]
        partes.append(df)
        print(f"  Vendas Atual:    {len(df):,} linhas")

    f_hist = extract_dir / "Liquidos_Vendas_Historico_2007_a_2017.csv"
    if f_hist.exists():
        df = pd.read_csv(f_hist, sep=";", encoding="latin-1", dtype=str,
                         header=None, names=_VENDAS_COLS_HIST)
        partes.append(df)
        print(f"  Vendas Histórico:{len(df):,} linhas")

    if not partes:
        return pd.DataFrame()

    df = pd.concat(partes, ignore_index=True)
    df = _normalizar(df)

    # Dedup por todas as dimensões (overlap atual×histórico em 2017)
    dims = [c for c in df.columns if c != "volume_m3"]
    antes = len(df)
    df = df.drop_duplicates(subset=dims, keep="first")
    if antes != len(df):
        print(f"  Vendas dedup:    {antes:,} -> {len(df):,}")

    # ─── Correção histórica de Diesel B ──────────────────────────────────────
    # "Diesel B" (Diesel A + biodiesel obrigatório) só passou a existir em
    # 2010 com a obrigatoriedade do B5. Os ~1.5k registros pré-2010 do Painel
    # ANP rotulados como "Diesel B" são uma categoria diferente (volumes 100x
    # menores, provavelmente testes piloto / rotulagem retroativa errada) e
    # NÃO representam o produto comercial. Descartamos.
    antes = len(df)
    mask = (df["nome_produto"] == "Diesel B") & (df["ano"] < 2010)
    n_drop = int(mask.sum())
    df = df[~mask]
    if n_drop:
        print(f"  Diesel B pré-2010 descartado: {n_drop:,} linhas")

    return df.sort_values(["ano", "mes"])


def _consolidar_entregas(extract_dir: Path) -> pd.DataFrame:
    f = extract_dir / "Liquidos_Entregas_Historico.csv"
    if not f.exists():
        return pd.DataFrame()
    df = pd.read_csv(f, sep=";", encoding="latin-1", dtype=str)
    df = df.rename(columns=_ENTREGAS_COLS)
    df = df[[c for c in _ENTREGAS_COLS.values() if c in df.columns]]
    print(f"  Entregas:        {len(df):,} linhas")
    df = _normalizar(df)

    # ─── Correção histórica: jan-mai/2007 incompletos ────────────────────────
    # Os primeiros 5 meses do dataset Entregas têm volume ~100x menor que o
    # padrão (Diesel A em 12-25 mil m³ vs 2.500+ a partir de jun/2007).
    # Captura inicial do Painel ANP foi parcial — descartamos.
    antes = len(df)
    mask = (df["ano"] == 2007) & (df["mes"] < 6)
    n_drop = int(mask.sum())
    df = df[~mask]
    if n_drop:
        print(f"  Entregas jan-mai/2007 descartado: {n_drop:,} linhas")

    return df.sort_values(["ano", "mes"])


def _consolidar_importacoes(extract_dir: Path) -> pd.DataFrame:
    f = extract_dir / "Liquidos_Importacao_de_Distribuidores.csv"
    if not f.exists():
        return pd.DataFrame()
    df = pd.read_csv(f, sep=";", encoding="latin-1", dtype=str)
    df = df.rename(columns=_IMPORT_COLS)
    df = df[[c for c in _IMPORT_COLS.values() if c in df.columns]]
    print(f"  Importações:     {len(df):,} linhas")
    df = _normalizar(df)
    return df.sort_values(["ano", "mes"])


def _baixar_e_extrair() -> Path:
    """Baixa o ZIP e extrai numa pasta temporária dentro de _DADOS_DIR."""
    _DADOS_DIR.mkdir(parents=True, exist_ok=True)
    zip_dest    = _DADOS_DIR / "_liquidos_tmp.zip"
    extract_dir = _DADOS_DIR / "_extract_tmp"

    print(f"Baixando {_ZIP_URL.split('/')[-1]}...", end=" ", flush=True)
    r = requests.get(_ZIP_URL, headers=_HEADERS, stream=True, timeout=300)
    r.raise_for_status()
    with open(zip_dest, "wb") as f:
        for chunk in r.iter_content(65536):
            f.write(chunk)
    print(f"{zip_dest.stat().st_size/1024/1024:.0f} MB")

    if extract_dir.exists():
        shutil.rmtree(extract_dir)
    extract_dir.mkdir()
    with zipfile.ZipFile(zip_dest) as zf:
        zf.extractall(extract_dir)
    zip_dest.unlink()
    return extract_dir


def main():
    # Tenta usar pasta extraída existente; se não houver, baixa
    candidatos = [d for d in _DADOS_DIR.iterdir()
                  if d.is_dir() and d.name not in ("_extract_tmp",)
                  and any(d.glob("Liquidos_*.csv"))]
    if candidatos:
        extract_dir = max(candidatos, key=lambda p: p.stat().st_mtime)
        print(f"Usando pasta existente: {extract_dir.name}")
    else:
        extract_dir = _baixar_e_extrair()

    print()
    print("Consolidando datasets...")
    vendas    = _consolidar_vendas(extract_dir)
    entregas  = _consolidar_entregas(extract_dir)
    importac  = _consolidar_importacoes(extract_dir)

    print()
    if not vendas.empty:
        vendas.to_parquet(_VENDAS_PARQUET, index=False, compression="snappy")
        print(f"  vendas.parquet:                  {_VENDAS_PARQUET.stat().st_size/1024/1024:.1f} MB ({len(vendas):,} linhas)")
    if not entregas.empty:
        entregas.to_parquet(_ENTREGAS_PARQUET, index=False, compression="snappy")
        print(f"  entregas.parquet:                {_ENTREGAS_PARQUET.stat().st_size/1024/1024:.1f} MB ({len(entregas):,} linhas)")
    if not importac.empty:
        importac.to_parquet(_IMPORT_PARQUET, index=False, compression="snappy")
        print(f"  importacoes_distribuidores.parquet: {_IMPORT_PARQUET.stat().st_size/1024/1024:.1f} MB ({len(importac):,} linhas)")

    # Limpeza: remove TODAS as pastas extraídas (CSVs grandes) e ZIPs antigos
    for item in _DADOS_DIR.iterdir():
        if item.is_dir():
            try:
                shutil.rmtree(item)
                print(f"  [limpeza] removido {item.name}/")
            except Exception as e:
                print(f"  [aviso] falha em {item.name}: {e}")
        elif item.suffix == ".zip":
            try:
                item.unlink()
                print(f"  [limpeza] removido {item.name}")
            except Exception as e:
                print(f"  [aviso] falha em {item.name}: {e}")

    print()
    if not vendas.empty:
        print(f"Vendas:    {vendas['ano'].min()}-{int(vendas[vendas['ano']==vendas['ano'].min()]['mes'].min()):02d}"
              f" -> {vendas['ano'].max()}-{int(vendas[vendas['ano']==vendas['ano'].max()]['mes'].max()):02d}")
    if not entregas.empty:
        print(f"Entregas:  {entregas['ano'].min()}-{int(entregas[entregas['ano']==entregas['ano'].min()]['mes'].min()):02d}"
              f" -> {entregas['ano'].max()}-{int(entregas[entregas['ano']==entregas['ano'].max()]['mes'].max()):02d}")


if __name__ == "__main__":
    main()
