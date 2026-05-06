#!/usr/bin/env python3
"""
backfill_lacunas.py
===================
Baixa e appenda ao Parquet todas as semanas da página ANP LPC que ainda
não estão no arquivo consolidado. Útil para preencher lacunas após
períodos sem execução do monitor.

Uso:
    python alertas/scripts/anp_lpc_ultimas/backfill_lacunas.py
"""
import re
import sys
import time
import warnings
from pathlib import Path

import pandas as pd
import requests
from bs4 import BeautifulSoup

warnings.filterwarnings("ignore")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).parents[2]))
from bases.anp_lpc_ultimas import AnpLpcUltimas

_URL = (
    "https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia"
    "/precos/levantamento-de-precos-de-combustiveis-ultimas-semanas-pesquisadas"
)
_HEADERS  = {"User-Agent": "Mozilla/5.0"}
_PARQUET  = Path(__file__).parents[3] / "DADOS" / "anp_lpc_ultimas" / "lpc_consolidado.parquet"
_DEST_DIR = Path(__file__).parents[3] / "DADOS" / "anp_lpc_ultimas"
_PAT = re.compile(
    r"(revendas_lpc_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.xlsx)",
    re.IGNORECASE,
)


def main():
    monitor = AnpLpcUltimas()

    # Datas já presentes no Parquet
    existente       = pd.read_parquet(_PARQUET, columns=["data_coleta"])
    datas_existentes = set(existente["data_coleta"].dt.date.astype(str))
    print(f"Parquet atual: {len(existente):,} linhas | max: {existente['data_coleta'].max().date()}")

    # Buscar todas as semanas da página
    print(f"\nConsultando página ANP...")
    r = requests.get(_URL, headers=_HEADERS, timeout=30)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "lxml")

    todas: dict[str, tuple[str, str]] = {}  # data_fim -> (nome_arquivo, url)
    for a in soup.find_all("a", href=True):
        m = _PAT.search(a["href"])
        if m:
            data_fim = m.group(3)
            nome     = m.group(1)
            href     = a["href"]
            url      = href if href.startswith("http") else "https://www.gov.br" + href
            todas[data_fim] = (nome, url)

    # Filtrar semanas cujas datas não estão no Parquet
    lacunas = {
        d: v for d, v in todas.items()
        if d not in datas_existentes  # data_fim não está como data_coleta
    }

    # Mais preciso: verificar se há datas da semana no Parquet
    # (a semana vai de data_inicio a data_fim, verificamos se data_fim está ausente)
    print(f"Semanas na página: {len(todas)} | Com lacuna no Parquet: {len(lacunas)}")

    if not lacunas:
        print("Nenhuma lacuna encontrada. Parquet está atualizado.")
        return

    print()
    total = 0
    for i, data_fim in enumerate(sorted(lacunas), 1):
        nome, url_arq = lacunas[data_fim]
        dest = _DEST_DIR / nome

        if not dest.exists():
            print(f"[{i:02d}/{len(lacunas)}] Baixando {nome}...", end=" ", flush=True)
            try:
                r2 = requests.get(url_arq, headers=_HEADERS, stream=True, timeout=120)
                r2.raise_for_status()
                with open(dest, "wb") as f:
                    for chunk in r2.iter_content(65536):
                        f.write(chunk)
                print(f"{dest.stat().st_size / 1024:.0f} KB", flush=True)
            except Exception as e:
                print(f"ERRO: {e}")
                continue
        else:
            print(f"[{i:02d}/{len(lacunas)}] {nome} (cache)", flush=True)

        try:
            n = monitor._append_parquet(str(dest))
            total += n
            print(f"           +{n:,} linhas adicionadas")
        except Exception as e:
            print(f"           ERRO append: {e}")

        time.sleep(0.2)

    final = pd.read_parquet(_PARQUET, columns=["data_coleta"])
    print(f"\nConcluido!")
    print(f"  Total adicionado: {total:,} linhas")
    print(f"  Parquet final:    {len(final):,} linhas | max: {final['data_coleta'].max().date()}")


if __name__ == "__main__":
    main()
