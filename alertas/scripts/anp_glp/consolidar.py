#!/usr/bin/env python3
"""
consolidar.py
=============
Lê o xlsx mais recente de Vendas de GLP por Recipiente e gera o Parquet:
    DADOS/anp_glp/glp_consolidado.parquet

Schema longo (1 linha por mês × distribuidora × categoria):
    ano, mes, mes_data, distribuidora, categoria, vendas_kg

Categorias geradas:
    'P13'                botijão 13 kg (residencial)
    'Outros (total)'     soma de GLP + especiais (contínuo desde 2019)
    'Outros - GLP'       botijões maiores GLP comum (≥ jun/2024)
    'Outros - Especiais' especiais P5/P2/empilháveis (≥ jun/2024)

A sheet antiga ('Vendas por recipiente', 2019-mai/2024) tem só P13 + OUTROS.
A sheet nova ('A partir de junho 2024') separou OUTROS em GLP + Especiais.

Uso:
    python alertas/scripts/anp_glp/consolidar.py
"""
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd
import requests
from bs4 import BeautifulSoup

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_DADOS_DIR = Path(__file__).parents[3] / "DADOS" / "anp_glp"
_DEST      = _DADOS_DIR / "glp_consolidado.parquet"
_PAGE_URL  = (
    "https://www.gov.br/anp/pt-br/assuntos/distribuicao-e-revenda"
    "/distribuidor/dados-de-mercado-glp"
)
_HEADERS = {"User-Agent": "Mozilla/5.0"}


def _baixar_xlsx() -> Path | None:
    """Baixa o xlsx 'relatorio_vendas_por_recipiente' mais recente da página."""
    r = requests.get(_PAGE_URL, headers=_HEADERS, timeout=30)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "lxml")

    file_url = None
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "relatorio_vendas_por_recipiente" in href.lower() and href.lower().endswith(".xlsx"):
            file_url = href if href.startswith("http") else "https://www.gov.br" + href
            break

    if not file_url:
        return None

    nome = file_url.split("/")[-1].split("?")[0]
    dest = _DADOS_DIR / nome
    print(f"Baixando {nome}...", end=" ", flush=True)
    resp = requests.get(file_url, headers=_HEADERS, stream=True, timeout=180)
    resp.raise_for_status()
    with open(dest, "wb") as f:
        for chunk in resp.iter_content(65536):
            f.write(chunk)
    print(f"{dest.stat().st_size/1024:.0f} KB")
    return dest


def _ler_sheet_antiga(path: Path) -> pd.DataFrame:
    """Sheet 'Vendas por recipiente' (2019-mai/2024): MÊS, DISTRIBUIDORA, P13, OUTROS."""
    raw = pd.read_excel(path, sheet_name="Vendas por recipiente", header=None)
    # Header está em ~L8; dados a partir de L9
    blocos = []
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

        if p13 is not None:
            blocos.append({"mes_data": mes, "distribuidora": dist.strip(),
                           "categoria": "P13", "vendas_kg": p13})
        if outros is not None:
            # Sheet antiga: OUTROS inclui especiais → mapeia para "Outros (total)"
            blocos.append({"mes_data": mes, "distribuidora": dist.strip(),
                           "categoria": "Outros (total)", "vendas_kg": outros})
    return pd.DataFrame(blocos)


def _ler_sheet_nova(path: Path) -> pd.DataFrame:
    """Sheet 'A partir de junho 2024': MÊS, DISTRIBUIDORA, P13(A), OUTROS GLP(B), OUTROS ESPECIAIS(C), TOTAL."""
    raw = pd.read_excel(path, sheet_name="A partir de junho 2024", header=None)
    blocos = []
    for i in range(9, len(raw)):
        mes  = raw.iat[i, 0]
        dist = raw.iat[i, 1]
        if not isinstance(mes, (pd.Timestamp, datetime)) or not isinstance(dist, str):
            continue
        try:
            p13    = float(raw.iat[i, 2]) if pd.notna(raw.iat[i, 2]) else None
            o_glp  = float(raw.iat[i, 3]) if pd.notna(raw.iat[i, 3]) else None
            o_esp  = float(raw.iat[i, 4]) if pd.notna(raw.iat[i, 4]) else None
        except (TypeError, ValueError):
            continue

        if p13 is not None:
            blocos.append({"mes_data": mes, "distribuidora": dist.strip(),
                           "categoria": "P13", "vendas_kg": p13})
        if o_glp is not None:
            blocos.append({"mes_data": mes, "distribuidora": dist.strip(),
                           "categoria": "Outros - GLP", "vendas_kg": o_glp})
        if o_esp is not None:
            blocos.append({"mes_data": mes, "distribuidora": dist.strip(),
                           "categoria": "Outros - Especiais", "vendas_kg": o_esp})
        # Total (B+C) — para continuidade visual com a sheet antiga
        total_outros = (o_glp or 0) + (o_esp or 0)
        if total_outros > 0:
            blocos.append({"mes_data": mes, "distribuidora": dist.strip(),
                           "categoria": "Outros (total)", "vendas_kg": total_outros})
    return pd.DataFrame(blocos)


def main():
    _DADOS_DIR.mkdir(parents=True, exist_ok=True)

    # Tenta usar xlsx local; se não houver, baixa
    locais = sorted(_DADOS_DIR.glob("*relatorio_vendas_por_recipiente*.xlsx"),
                    key=lambda p: p.stat().st_mtime)
    if locais:
        path = locais[-1]
        print(f"Usando local: {path.name}")
    else:
        path = _baixar_xlsx()
        if not path:
            print("Não foi possível obter o xlsx.")
            sys.exit(1)

    print()
    df_antigo = _ler_sheet_antiga(path)
    df_novo   = _ler_sheet_nova(path)
    print(f"Sheet antiga (até mai/2024): {len(df_antigo):,} linhas")
    print(f"Sheet nova   (jun/2024+):    {len(df_novo):,} linhas")

    df = pd.concat([df_antigo, df_novo], ignore_index=True)
    df["ano"] = df["mes_data"].dt.year.astype("Int16")
    df["mes"] = df["mes_data"].dt.month.astype("Int8")
    df["vendas_kg"] = df["vendas_kg"].astype("float64")
    df["distribuidora"] = df["distribuidora"].str.strip()

    df = df[["ano", "mes", "mes_data", "distribuidora", "categoria", "vendas_kg"]]
    df = df.sort_values(["mes_data", "distribuidora", "categoria"])

    df.to_parquet(_DEST, index=False, compression="snappy")
    sz = _DEST.stat().st_size / 1024

    # Limpa xlsx após consolidação
    try:
        path.unlink()
        print(f"  [limpeza] removido {path.name}")
    except Exception as e:
        print(f"  [aviso] falha ao remover: {e}")

    print()
    print(f"Concluido: {_DEST.name} ({sz:.1f} KB)")
    print(f"  {len(df):,} linhas")
    print(f"  Periodo: {df['mes_data'].min().strftime('%Y-%m')} -> {df['mes_data'].max().strftime('%Y-%m')}")
    print(f"  Distribuidoras: {df['distribuidora'].nunique()}")
    print(f"  Categorias:     {sorted(df['categoria'].unique())}")
    total_kg = df.loc[df['categoria'] != 'Outros (total)', 'vendas_kg'].sum()
    print(f"  Total acumulado P13+Outros GLP+Especiais: {total_kg/1e9:.1f} bilhoes kg")


if __name__ == "__main__":
    main()
