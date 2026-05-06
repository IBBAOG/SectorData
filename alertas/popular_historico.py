#!/usr/bin/env python3
"""
popular_historico.py
====================
Gera histórico robusto para cada base, buscando a maior série possível.

Estratégia por base:
  - APIs (MDIC Comex, ANP Painel Power BI): consulta histórica completa
  - Arquivos com dados estruturados: lê completamente e extrai todos os meses
  - Outros: usa o estado atual / nome do arquivo

Execute uma vez para popular o baseline:
    python alertas/popular_historico.py
"""
import sys
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import csv
import importlib.util
import io
import json
import os
import re
import time
import unicodedata
import zipfile
from datetime import datetime, date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from monitor import MONITORES

_ALERTAS_DIR      = Path(__file__).parent
_DADOS_DIR        = _ALERTAS_DIR.parent / "DADOS"
_ESTADO_DIR       = _ALERTAS_DIR / "estado"
_HISTORICO_GLOBAL = _DADOS_DIR / "historico_alertas.csv"
_COLS             = ["timestamp", "slug", "nome", "periodo", "mensagem", "arquivos", "url"]
_EXTS_DADOS       = {".csv", ".xlsx", ".xlsb", ".xls", ".zip", ".pdf"}
_EXCLUIR          = {"historico.csv"}

_MESES_ABREV_PT = {
    "JAN": "01", "FEV": "02", "MAR": "03", "ABR": "04",
    "MAI": "05", "JUN": "06", "JUL": "07", "AGO": "08",
    "SET": "09", "OUT": "10", "NOV": "11", "DEZ": "12",
}


# ── helpers genéricos ─────────────────────────────────────────────────────────

def _mtime_iso(path: Path) -> str:
    return datetime.fromtimestamp(path.stat().st_mtime).isoformat(timespec="seconds")


def _norm(s) -> str:
    s = str(s) if s is not None else ""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.strip().upper()


def _entrada(ts, slug, nome, url, periodo, arquivo, mensagem=None):
    return {
        "timestamp": ts,
        "slug":      slug,
        "nome":      nome,
        "periodo":   periodo,
        "mensagem":  mensagem or f"Dados disponíveis: {periodo}" if periodo else "Baseline inicial",
        "arquivos":  arquivo,
        "url":       url,
    }


def _periodo_ts(periodo_yyyy_mm: str) -> str:
    """Converte 'YYYY-MM' em ISO timestamp (último dia do mês às 12:00)."""
    try:
        y, m = periodo_yyyy_mm.split("-")
        return f"{y}-{m}-15T12:00:00"
    except Exception:
        return datetime.now().isoformat(timespec="seconds")


def _periodo_do_arquivo(nome: str) -> str:
    n = nome.lower()
    m = re.search(r'(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})', n)
    if m:
        return f"{m.group(1)} a {m.group(2)}"
    m = re.search(r'([a-z]{3})(\d{2})_([a-z]{3})(\d{2})', n)
    if m and m.group(1)[:3].upper() in _MESES_ABREV_PT:
        return f"{m.group(1)}/20{m.group(2)} a {m.group(3)}/20{m.group(4)}"
    m = re.search(r'\b((?:19|20)\d{2})-((?:19|20)\d{2})\b', n)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    m = re.search(r'\b(\d{2})-(20\d{2})\b', n)
    if m and 1 <= int(m.group(1)) <= 12:
        return f"{m.group(1)}/{m.group(2)}"
    m = re.search(r'\b(20\d{2})(\d{2})\b', n)
    if m and 1 <= int(m.group(2)) <= 12:
        return f"{m.group(2)}/{m.group(1)}"
    m = re.search(r'(20\d{2}-\d{2}-\d{2})', n)
    if m:
        return m.group(1)
    m = re.search(r'\b(20\d{2})\b', n)
    if m:
        return m.group(1)
    return ""


def _ler_csv_pandas(path):
    import pandas as pd
    src = path
    if isinstance(path, (bytes, bytearray)):
        src = io.BytesIO(path)
        sample = path[:512]
    else:
        with open(path, "rb") as f:
            sample = f.read(512)
    enc = "utf-8-sig" if sample[:3] == b"\xef\xbb\xbf" else "latin-1"
    decoded = sample.decode(enc, errors="ignore")
    sep = ";" if decoded.count(";") >= decoded.count(",") else ","
    return pd.read_csv(src, sep=sep, encoding=enc, dtype=str, low_memory=False)


# ── extração de períodos genérica de DataFrame ────────────────────────────────

def _extrair_periodos_df(df, col_ano=None, col_mes=None) -> list[str]:
    """Retorna lista ordenada de 'YYYY-MM' únicos."""
    if col_ano is None or col_mes is None:
        return []
    pares = set()
    for _, r in df[[col_ano, col_mes]].dropna(how="all").iterrows():
        ano_s = str(r[col_ano]).strip()
        mes_s = str(r[col_mes]).strip().upper()

        # Ano pode vir "2024", "2024.0", ou Timestamp
        m_ano = re.search(r'((?:19|20)\d{2})', ano_s)
        if not m_ano:
            continue
        ano = m_ano.group(1)

        # Mês pode ser número ou abreviação PT
        mes = _MESES_ABREV_PT.get(mes_s[:3])
        if mes is None:
            m_mes = re.search(r'\b(\d{1,2})\b', mes_s)
            if m_mes and 1 <= int(m_mes.group(1)) <= 12:
                mes = f"{int(m_mes.group(1)):02d}"
        if mes is None:
            continue

        pares.add(f"{ano}-{mes}")
    return sorted(pares)


def _achar_col(df, *cands):
    norm = {_norm(c): c for c in df.columns}
    for c in cands:
        if _norm(c) in norm:
            return norm[_norm(c)]
    return None


# ── handlers especializados por base ──────────────────────────────────────────

def historico_anp_dados_abertos_ie(slug, nome, url) -> list[dict]:
    """Lê os 2 CSVs (petróleo e derivados) e extrai todos os meses."""
    rows = []
    pasta = _DADOS_DIR / slug
    for arq in sorted(pasta.glob("*.csv")):
        ts = _mtime_iso(arq)
        try:
            df = _ler_csv_pandas(arq)
            col_ano = _achar_col(df, "ANO")
            col_mes = _achar_col(df, "MES")
            if col_ano and col_mes:
                periodos = _extrair_periodos_df(df, col_ano, col_mes)
                for p in periodos:
                    rows.append(_entrada(_periodo_ts(p), slug, nome, url,
                                         p, arq.name,
                                         f"Dados disponíveis: {p} ({arq.stem.split('-')[2]})"))
                continue
        except Exception:
            pass
        rows.append(_entrada(ts, slug, nome, url,
                             _periodo_do_arquivo(arq.name), arq.name))
    return rows


def historico_anp_glp(slug, nome, url) -> list[dict]:
    """Lê o xlsx de GLP (ambas abas: histórica e a partir de jun/2024) e extrai meses."""
    import pandas as pd
    rows = []
    pasta = _DADOS_DIR / slug
    for arq in sorted(pasta.glob("*.xlsx")):
        ts = _mtime_iso(arq)
        periodos = set()
        try:
            xl = pd.ExcelFile(arq)
            for sheet in xl.sheet_names:
                for skip in (8, 7, 9, 6, 10, 5):
                    try:
                        df = pd.read_excel(arq, sheet_name=sheet, skiprows=skip, dtype=str)
                        col_mes = _achar_col(df, "MES", "MÊS")
                        if not col_mes:
                            continue
                        antes = len(periodos)
                        for v in df[col_mes].dropna():
                            s = str(v).strip()
                            m = re.match(r'(\d{4})-(\d{2})', s)
                            if m and 2000 <= int(m.group(1)) <= 2030:
                                periodos.add(f"{m.group(1)}-{m.group(2)}")
                        if len(periodos) > antes:
                            break
                    except Exception:
                        continue
            for p in sorted(periodos):
                rows.append(_entrada(_periodo_ts(p), slug, nome, url, p, arq.name))
            if periodos:
                continue
        except Exception:
            pass
        rows.append(_entrada(ts, slug, nome, url,
                             _periodo_do_arquivo(arq.name), arq.name))
    return rows


def historico_sindicom(slug, nome, url) -> list[dict]:
    """Lê o xlsx do SINDICOM e extrai todos os meses (granularidade mensal)."""
    import pandas as pd
    rows = []
    pasta = _DADOS_DIR / slug
    for arq in sorted(pasta.glob("*.xlsx")):
        ts = _mtime_iso(arq)
        try:
            df = pd.read_excel(arq, dtype=str)
            col_ano = _achar_col(df, "ANO")
            col_mes = _achar_col(df, "MES")
            if col_ano and col_mes:
                periodos = _extrair_periodos_df(df, col_ano, col_mes)
                for p in periodos:
                    rows.append(_entrada(_periodo_ts(p), slug, nome, url,
                                         p, arq.name))
                if periodos:
                    continue
        except Exception:
            pass
        rows.append(_entrada(ts, slug, nome, url,
                             _periodo_do_arquivo(arq.name), arq.name))
    return rows


def historico_anp_lpc(slug, nome, url) -> list[dict]:
    """
    ANP LPC: combina ponta (xlsx semanais) + histórico (Dados Abertos
    semestrais ca-YYYY-NN.{csv,zip} desde 2004 em DADOS/anp_lpc_ultimas/historico/).
    """
    import pandas as pd, zipfile
    rows = []
    pasta = _DADOS_DIR / slug

    # Ponta — xlsx semanais
    for arq in sorted(pasta.glob("*.xlsx")):
        rows.append(_entrada(
            _mtime_iso(arq), slug, nome, url,
            _periodo_do_arquivo(arq.name), arq.name,
            f"Semana disponível: {_periodo_do_arquivo(arq.name)}",
        ))

    # Histórico — dados abertos semestrais
    historico_dir = pasta / "historico"
    if historico_dir.exists():
        url_historico = ("https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos"
                         "/serie-historica-de-precos-de-combustiveis")
        por_data = {}
        for arq in sorted(historico_dir.glob("ca-*.*")):
            try:
                if arq.suffix.lower() == ".zip":
                    with zipfile.ZipFile(arq) as zf:
                        nome_csv = next((n for n in zf.namelist() if n.lower().endswith(".csv")), None)
                        if not nome_csv:
                            continue
                        with zf.open(nome_csv) as f:
                            raw = f.read()
                    df = pd.read_csv(io.BytesIO(raw), sep=";", encoding="latin-1",
                                     usecols=lambda c: "data" in c.lower() and "coleta" in c.lower(),
                                     dtype=str, low_memory=False)
                else:
                    df = pd.read_csv(arq, sep=";", encoding="latin-1",
                                     usecols=lambda c: "data" in c.lower() and "coleta" in c.lower(),
                                     dtype=str, low_memory=False)
                if df.empty or len(df.columns) == 0:
                    continue
                col = df.columns[0]
                for v in df[col].dropna().drop_duplicates():
                    s = str(v).strip()
                    m = re.match(r'(\d{2})/(\d{2})/(\d{4})', s)
                    if m:
                        d = f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
                        if d not in por_data:
                            por_data[d] = arq.name
            except Exception as e:
                print(f"      [erro] {arq.name}: {e}")

        for d in sorted(por_data):
            rows.append(_entrada(
                f"{d}T12:00:00", slug, nome, url_historico,
                d, por_data[d],
                f"LPC semanal disponível: {d}",
            ))

    return rows


def historico_anp_precos_produtores(slug, nome, url) -> list[dict]:
    """Lê o xls de preços ponderados semanais 2002-2012 — 1 entrada por mês."""
    import pandas as pd
    rows = []
    pasta = _DADOS_DIR / slug
    for arq in sorted(list(pasta.glob("*.xls")) + list(pasta.glob("*.xlsx"))):
        ts = _mtime_iso(arq)
        try:
            df = pd.read_excel(arq, dtype=str)
            # Procura coluna com datas
            datas = set()
            for col in df.columns:
                vals = df[col].dropna().head(50)
                for v in vals:
                    s = str(v).strip()
                    m = re.match(r'(\d{4})-(\d{2})', s)
                    if m and 1990 <= int(m.group(1)) <= 2030:
                        datas.add(f"{m.group(1)}-{m.group(2)}")
                if datas:
                    # Coletar todos os valores dessa coluna
                    for v in df[col].dropna():
                        s = str(v).strip()
                        m = re.match(r'(\d{4})-(\d{2})', s)
                        if m:
                            datas.add(f"{m.group(1)}-{m.group(2)}")
                    break
            for p in sorted(datas):
                rows.append(_entrada(_periodo_ts(p), slug, nome, url,
                                     p, arq.name))
            if datas:
                continue
        except Exception:
            pass
        rows.append(_entrada(ts, slug, nome, url,
                             _periodo_do_arquivo(arq.name), arq.name))
    return rows


def historico_anp_desembaracos(slug, nome, url) -> list[dict]:
    """Lê o xlsx de desembaraços e extrai meses."""
    import pandas as pd
    rows = []
    pasta = _DADOS_DIR / slug
    for arq in sorted(pasta.glob("*.xlsx")):
        ts = _mtime_iso(arq)
        try:
            for skip in [3, 4, 5, 6, 7, 8]:
                df = pd.read_excel(arq, skiprows=skip, dtype=str)
                col_ano = _achar_col(df, "ANO")
                col_mes = _achar_col(df, "MES", "MÊS")
                if col_ano and col_mes:
                    periodos = _extrair_periodos_df(df, col_ano, col_mes)
                    for p in periodos:
                        rows.append(_entrada(_periodo_ts(p), slug, nome, url,
                                             p, arq.name))
                    if periodos:
                        break
            if any(r["arquivos"] == arq.name for r in rows):
                continue
        except Exception:
            pass
        rows.append(_entrada(ts, slug, nome, url,
                             _periodo_do_arquivo(arq.name), arq.name))
    return rows


def historico_anp_cdp(slug, nome, url) -> list[dict]:
    """CDP: lê coluna 'Período' dos CSVs."""
    rows = []
    pasta = _DADOS_DIR / slug
    for arq in sorted(pasta.glob("producao_poco_*.csv")):
        ts = _mtime_iso(arq)
        try:
            df = _ler_csv_pandas(arq)
            col_per = _achar_col(df, "PERIODO", "PERÍODO")
            if col_per:
                periodos = set()
                for v in df[col_per].dropna():
                    m = re.match(r'(\d{4})/(\d{2})', str(v).strip())
                    if m:
                        periodos.add(f"{m.group(1)}-{m.group(2)}")
                ambiente = arq.stem.split("_")[-1]  # M, S, ou T
                amb_nome = {"M": "Mar", "S": "Pré-Sal", "T": "Terra"}.get(ambiente, ambiente)
                for p in sorted(periodos):
                    rows.append(_entrada(_periodo_ts(p), slug, nome, url,
                                         p, arq.name,
                                         f"Produção {amb_nome} disponível: {p}"))
                if periodos:
                    continue
        except Exception:
            pass
        rows.append(_entrada(ts, slug, nome, url,
                             _periodo_do_arquivo(arq.name), arq.name))
    return rows


def historico_anp_painel_powerbi(slug, nome, url) -> list[dict]:
    """Consulta o Power BI da ANP para obter TODOS os meses disponíveis."""
    rows = []
    extractor_path = Path(__file__).parent.parent / "scripts" / "extractors" / "anp_painel_powerbi.py"
    if not extractor_path.exists():
        return [_entrada(datetime.now().isoformat(timespec="seconds"),
                         slug, nome, url, "", "",
                         "Extrator Power BI não encontrado")]

    print("    [PowerBI] Buscando todos os meses disponíveis na API...")
    try:
        spec = importlib.util.spec_from_file_location("anp_extr", extractor_path)
        ext  = importlib.util.module_from_spec(spec)
        # Silenciar prints do extractor
        _orig = sys.stdout
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
        try:
            spec.loader.exec_module(ext)
            resource_key, model_id, app_ctx = ext.resolve_config()

            # Mesma query do get_ultimo_mes mas pegando TODAS as linhas
            payload = ext.build_payload(
                select_cols=[
                    {**ext.col("d", "ANO"),           "Name": "ANO"},
                    {**ext.col("d", "NOM_MES_ABREV"), "Name": "MES"},
                ],
                where_conds=[ext.where_in("f", "TIPO_EXTRACAO", ["Vendas"])],
                model_id=model_id, app_ctx=app_ctx, limit=2000,
            )
            data = ext.post_query(payload, resource_key)
            raw_rows = ext.parse_dsr(data)
        finally:
            sys.stdout.close()
            sys.stdout = _orig

        # Coletar todos os (ano, mes_abrev) válidos
        meses_pt = ext.MESES_ORDER
        periodos = set()
        for r in raw_rows:
            ano = str(r[0]).strip() if r[0] is not None else ""
            mes = str(r[1]).strip() if r[1] is not None else ""
            if ano.isdigit() and mes in meses_pt:
                mes_num = meses_pt.index(mes) + 1
                periodos.add(f"{ano}-{mes_num:02d}")

        zip_arq = ""
        zips = list((_DADOS_DIR / slug).glob("*.zip"))
        if zips:
            zip_arq = zips[0].name

        for p in sorted(periodos):
            rows.append(_entrada(_periodo_ts(p), slug, nome, url, p, zip_arq,
                                 f"Vendas Power BI disponíveis: {p}"))
        print(f"    [PowerBI] {len(periodos)} meses recuperados ({min(periodos) if periodos else '—'} → {max(periodos) if periodos else '—'})")
    except Exception as e:
        print(f"    [PowerBI] Erro: {e}")
        rows.append(_entrada(datetime.now().isoformat(timespec="seconds"),
                             slug, nome, url, "", "", f"Falha ao consultar Power BI: {e}"))
    return rows


def historico_mdic_comex(slug, nome, url) -> list[dict]:
    """Consulta a API do MDIC Comex de 1997 até hoje, ano por ano, filtrado por NCM."""
    import requests
    rows = []
    api = "https://api-comexstat.mdic.gov.br/general"
    headers = {"Content-Type": "application/json"}
    ncms = ["27090000", "27101259", "27101921"]

    ano_inicio = 1997
    ano_fim    = date.today().year

    print(f"    [Comex] Consultando API de {ano_inicio} a {ano_fim} para 3 NCMs...")
    periodos_total = set()

    for ano in range(ano_inicio, ano_fim + 1):
        for flow in ("import", "export"):
            payload = {
                "flow":        flow,
                "monthDetail": True,
                "period":      {"from": f"{ano}-01", "to": f"{ano}-12"},
                "filters":     [{"filter": "ncm", "values": ncms}],
                "details":     ["ncm"],
                "metrics":     ["metricFOB", "metricKG"],
            }
            for tentativa in range(3):
                try:
                    r = requests.post(api, headers=headers, json=payload, timeout=60)
                    if r.status_code == 429:
                        time.sleep(5 * (tentativa + 1))
                        continue
                    r.raise_for_status()
                    data_rows = r.json().get("data", {}).get("list", []) or []
                    for d in data_rows:
                        y = str(d.get("year", "")).strip()
                        mn = str(d.get("monthNumber", "")).strip()
                        if y.isdigit() and mn.isdigit():
                            periodos_total.add(f"{y}-{int(mn):02d}")
                    break
                except Exception:
                    time.sleep(2)
                    continue
        if ano % 5 == 0:
            print(f"    [Comex] {ano}: {len(periodos_total)} meses acumulados")
        time.sleep(0.3)

    for p in sorted(periodos_total):
        rows.append(_entrada(_periodo_ts(p), slug, nome, url, p, "",
                             f"Comex (Petróleo/Gasolina/Diesel) disponível: {p}"))
    print(f"    [Comex] Total: {len(periodos_total)} meses recuperados")
    return rows


# ── handlers fallback ─────────────────────────────────────────────────────────

def historico_generico(slug, nome, url) -> list[dict]:
    rows = []
    pasta = _DADOS_DIR / slug
    if not pasta.exists():
        return rows
    arqs = sorted(
        [f for f in pasta.iterdir()
         if f.is_file() and f.suffix.lower() in _EXTS_DADOS and f.name not in _EXCLUIR],
        key=lambda f: f.stat().st_mtime,
    )
    for arq in arqs:
        rows.append(_entrada(
            _mtime_iso(arq), slug, nome, url,
            _periodo_do_arquivo(arq.name), arq.name,
        ))
    return rows


# ── roteador ──────────────────────────────────────────────────────────────────

_HANDLERS = {
    "anp_dados_abertos_ie":   historico_anp_dados_abertos_ie,
    "anp_glp":                historico_anp_glp,
    "sindicom":               historico_sindicom,
    "anp_lpc_ultimas":        historico_anp_lpc,
    "anp_precos_produtores":  historico_anp_precos_produtores,
    "anp_desembaracos":       historico_anp_desembaracos,
    "anp_cdp_producao_poco":  historico_anp_cdp,
    "anp_painel_combustiveis": historico_anp_painel_powerbi,
    "mdic_comex":             historico_mdic_comex,
}


def _escrever_csv(path: Path, rows: list[dict]):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=_COLS)
        w.writeheader()
        w.writerows(rows)


def main():
    ts_agora    = datetime.now().isoformat(timespec="seconds")
    global_rows = []

    print(f"Populando histórico — {ts_agora}\n{'─' * 70}")

    for m in MONITORES:
        handler = _HANDLERS.get(m.slug, historico_generico)
        print(f"\n[{m.slug}]")
        rows = handler(m.slug, m.nome, m.url)
        if not rows:
            rows = historico_generico(m.slug, m.nome, m.url)
        if not rows:
            rows = [_entrada(ts_agora, m.slug, m.nome, m.url,
                             "", "", "Baseline inicial — sem dados")]

        _escrever_csv((_DADOS_DIR / m.slug) / "historico.csv", rows)
        global_rows.extend(rows)

        periodos = [r["periodo"] for r in rows if r["periodo"]]
        cob = f"{min(periodos)} → {max(periodos)}" if periodos else "—"
        print(f"  >> {len(rows)} entradas | cobertura: {cob}")

    global_rows.sort(key=lambda r: (r["slug"], r["periodo"]))
    _escrever_csv(_HISTORICO_GLOBAL, global_rows)

    print(f"\n{'─' * 70}")
    print(f"Total: {len(global_rows)} entradas | {_HISTORICO_GLOBAL}")


if __name__ == "__main__":
    main()
