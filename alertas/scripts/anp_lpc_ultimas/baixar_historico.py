#!/usr/bin/env python3
"""
baixar_historico.py
===================
Baixa toda a série histórica do LPC (Levantamento de Preços de Combustíveis)
da página de Dados Abertos da ANP — arquivos semestrais desde 2004.

Salva em DADOS/anp_lpc_ultimas/historico/ e atualiza historico.csv com uma
entrada por semana distinta encontrada nos arquivos.

Execute uma vez:
    python alertas/scripts/anp_lpc_ultimas/baixar_historico.py
"""
import sys
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import csv
import io
import re
import time
import zipfile
from datetime import datetime
from pathlib import Path

import pandas as pd
import requests
from bs4 import BeautifulSoup

_PAGE_URL = (
    "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos"
    "/serie-historica-de-precos-de-combustiveis"
)
_DADOS_DIR    = Path(__file__).parents[3] / "DADOS" / "anp_lpc_ultimas"
_HISTORICO_DIR = _DADOS_DIR / "historico"
_HISTORICO_CSV = _DADOS_DIR / "historico.csv"
_HEADERS = {"User-Agent": "Mozilla/5.0"}
_COLS = ["timestamp", "slug", "nome", "periodo", "mensagem", "arquivos", "url"]

_PAT = re.compile(r'(ca-(\d{4})-(\d{2})\.(zip|csv))', re.IGNORECASE)


def _listar_arquivos_remotos() -> list[tuple[int, int, str, str]]:
    r = requests.get(_PAGE_URL, headers=_HEADERS, timeout=30)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "lxml")
    arquivos = []
    for a in soup.find_all("a", href=True):
        m = _PAT.search(a["href"])
        if m:
            ano = int(m.group(2))
            sem = int(m.group(3))
            ext = m.group(4).lower()
            href = a["href"]
            url = href if href.startswith("http") else "https://www.gov.br" + href
            arquivos.append((ano, sem, ext, url))
    # Dedup por (ano, sem)
    seen = {}
    for tup in arquivos:
        seen[(tup[0], tup[1])] = tup
    return sorted(seen.values())


def _baixar(url: str, dest: Path, max_tentativas: int = 5):
    if dest.exists() and dest.stat().st_size > 0:
        return  # já baixado
    ultima_excecao = None
    for tent in range(1, max_tentativas + 1):
        try:
            tmp = dest.with_suffix(dest.suffix + ".part")
            with requests.get(url, headers=_HEADERS, stream=True, timeout=600) as r:
                r.raise_for_status()
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(chunk_size=1 << 14):
                        if chunk:
                            f.write(chunk)
            tmp.rename(dest)
            return
        except Exception as e:
            ultima_excecao = e
            try:
                tmp = dest.with_suffix(dest.suffix + ".part")
                if tmp.exists():
                    tmp.unlink()
            except Exception:
                pass
            time.sleep(min(2 ** tent, 30))
    raise ultima_excecao


def _extrair_datas(path: Path) -> set[str]:
    """Lê o arquivo e retorna conjunto de datas únicas em formato YYYY-MM-DD."""
    datas = set()
    try:
        if path.suffix.lower() == ".zip":
            with zipfile.ZipFile(path) as zf:
                nome = next((n for n in zf.namelist() if n.lower().endswith(".csv")), None)
                if not nome:
                    return datas
                with zf.open(nome) as f:
                    raw = f.read()
            df = pd.read_csv(io.BytesIO(raw), sep=";", encoding="latin-1",
                             usecols=lambda c: "data" in c.lower() and "coleta" in c.lower(),
                             dtype=str, low_memory=False)
        else:
            df = pd.read_csv(path, sep=";", encoding="latin-1",
                             usecols=lambda c: "data" in c.lower() and "coleta" in c.lower(),
                             dtype=str, low_memory=False)
        if df.empty or len(df.columns) == 0:
            return datas
        col = df.columns[0]
        for v in df[col].dropna().drop_duplicates():
            s = str(v).strip()
            # Formato esperado: DD/MM/YYYY
            m = re.match(r'(\d{2})/(\d{2})/(\d{4})', s)
            if m:
                datas.add(f"{m.group(3)}-{m.group(2)}-{m.group(1)}")
    except Exception as e:
        print(f"      [erro] {path.name}: {e}")
    return datas


def main():
    _HISTORICO_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Listando arquivos historicos em {_PAGE_URL}...")
    remotos = _listar_arquivos_remotos()
    print(f"  Encontrados: {len(remotos)} arquivos semestrais "
          f"({remotos[0][0]}-{remotos[0][1]:02d} a {remotos[-1][0]}-{remotos[-1][1]:02d})\n")

    todas_datas = []  # (data_iso, ano_sem, nome_arquivo)
    for ano, sem, ext, url in remotos:
        nome = f"ca-{ano}-{sem:02d}.{ext}"
        dest = _HISTORICO_DIR / nome

        ja_existe = dest.exists() and dest.stat().st_size > 0
        if not ja_existe:
            print(f"  [download] {nome}...", end=" ", flush=True)
            try:
                _baixar(url, dest)
                kb = dest.stat().st_size / 1024
                print(f"OK ({kb:.0f} KB)")
            except Exception as e:
                print(f"FALHA: {e}")
                continue
        else:
            print(f"  [cache]    {nome}", end="", flush=True)

        datas = _extrair_datas(dest)
        if datas:
            print(f" → {len(datas)} datas distintas")
            for d in datas:
                todas_datas.append((d, f"{ano}-{sem:02d}", nome))
        else:
            print(" → sem datas extraidas")
        time.sleep(0.2)

    # Dedup por data, mantendo o nome do primeiro arquivo encontrado
    por_data = {}
    for d, sem, nome in todas_datas:
        if d not in por_data:
            por_data[d] = (sem, nome)
    print(f"\nTotal de semanas distintas: {len(por_data)}")
    if por_data:
        ds = sorted(por_data)
        print(f"  Cobertura: {ds[0]} → {ds[-1]}")

    # Carregar historico.csv existente (mantém entradas que não são "ca-*")
    rows_existentes = []
    if _HISTORICO_CSV.exists():
        with open(_HISTORICO_CSV, encoding="utf-8-sig") as f:
            rows_existentes = list(csv.DictReader(f))

    # Manter apenas entradas que NÃO vêm desse pacote histórico (ou seja, manter o "ponta")
    rows_manter = [r for r in rows_existentes
                   if not r.get("arquivos", "").startswith("ca-")]

    # Adicionar nova entrada por data
    novos = []
    for d in sorted(por_data):
        sem, nome = por_data[d]
        novos.append({
            "timestamp": f"{d}T12:00:00",
            "slug":      "anp_lpc_ultimas",
            "nome":      "ANP LPC — Últimas Semanas Pesquisadas",
            "periodo":   d,
            "mensagem":  f"LPC semanal disponível: {d}",
            "arquivos":  nome,
            "url":       "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/serie-historica-de-precos-de-combustiveis",
        })

    final = rows_manter + novos
    final.sort(key=lambda r: r["timestamp"])

    with open(_HISTORICO_CSV, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=_COLS)
        w.writeheader()
        w.writerows(final)

    print(f"\nHistorico atualizado: {_HISTORICO_CSV}")
    print(f"  {len(rows_manter)} entradas anteriores preservadas + {len(novos)} novas")
    print(f"  Total: {len(final)} linhas")


if __name__ == "__main__":
    main()
