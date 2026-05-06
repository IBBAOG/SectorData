#!/usr/bin/env python3
"""
consolidar.py
=============
Baixa o histórico de Produção por Poço da ANP (Dados Abertos, 2005-2023)
e gera o Parquet:
    DADOS/anp_cdp_producao_poco/cdp_consolidado.parquet

Schema longo (1 linha por poço × ambiente × mês):
    ano, mes, ambiente, estado, bacia, nome_poco_anp, nome_poco_operador,
    campo, operador, num_contrato, oleo_bbl_dia, condensado_bbl_dia,
    petroleo_bbl_dia, gas_natural_assoc_mm3_dia, gas_natural_n_assoc_mm3_dia,
    gas_natural_total_mm3_dia, gas_royalties, agua_bbl_dia,
    instalacao_destino, tipo_instalacao, tempo_prod_hs_mes

Cobertura:
- 2005-2020: ZIP anual com CSVs por mês × ambiente
- 2021-2023: ZIP mensal (3 CSVs: Mar/PreSal/Terra)
- 2024+: precisa Selenium (não há bulk)

Estrutura dos CSVs:
- 0-3 linhas iniciais com cabeçalho ANP (CSVs antigos)
- 2 linhas de header (linha "Estado;Bacia;..." + linha de sub-headers)
- Dados a partir daí; ano+mês extraídos da coluna "Período" (YYYY/MM)

Uso:
    python alertas/scripts/anp_cdp_producao_poco/consolidar.py
"""
import io
import re
import sys
import zipfile
from pathlib import Path

import pandas as pd
import requests
from bs4 import BeautifulSoup

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_DADOS_DIR = Path(__file__).parents[3] / "DADOS" / "anp_cdp_producao_poco"
_DEST      = _DADOS_DIR / "cdp_consolidado.parquet"
_PAGE_URL  = ("https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos"
              "/producao-de-petroleo-e-gas-natural-por-poco")
_HEADERS   = {"User-Agent": "Mozilla/5.0"}

# Mapeamento ambiente: nome do arquivo → letra
_AMBIENTE_MAP = [
    ("presal", "S"),
    ("pre-sal", "S"),
    ("pre_sal", "S"),
    ("mar",    "M"),
    ("terra",  "T"),
]

# Pastas adicionais com CSVs avulsos extraídos via Selenium (formato:
# producao_poco_MM-YYYY_<AMB>.csv, separador vírgula, header 1 linha)
_PASTAS_CSVS_AVULSOS = [
    Path(__file__).parents[3] / "DADOS" / "anp_cdp_producao_poco",
    Path(__file__).parents[3] / "output" / "anp",
]
_PAT_CSV_AVULSO = re.compile(r"producao_poco_(\d{2})-(\d{4})_([MST])\.csv$", re.IGNORECASE)

# Posição das colunas no CSV (após pular as 2 linhas de header)
# Header L0 = "Estado;Bacia;Nome Poço;;Campo;Operador;Número do Contrato;Período;
#              Óleo (bbl/dia);Condensado (bbl/dia);Petróleo (bbl/dia);
#              Gás Natural (Mm³/dia);;;Volume Gás Royalties (Mm³/dia);
#              Água (bbl/dia);Instalação Destino;Tipo Instalação;
#              Tempo de Produção (hs por mês);..."
# Header L1 = ";;ANP;Operador;;;;;;;;Associado;Não Associado;Gás Total;..."
_COLS = [
    "estado",                       # 0
    "bacia",                        # 1
    "nome_poco_anp",                # 2 (sub: "ANP")
    "nome_poco_operador",           # 3 (sub: "Operador")
    "campo",                        # 4
    "operador",                     # 5
    "num_contrato",                 # 6
    "periodo",                      # 7  (YYYY/MM)
    "oleo_bbl_dia",                 # 8
    "condensado_bbl_dia",           # 9
    "petroleo_bbl_dia",             # 10
    "gas_natural_assoc_mm3_dia",    # 11 (sub: "Associado")
    "gas_natural_n_assoc_mm3_dia",  # 12 (sub: "Não Associado")
    "gas_natural_total_mm3_dia",    # 13 (sub: "Gás Total")
    "gas_royalties",                # 14
    "agua_bbl_dia",                 # 15
    "instalacao_destino",           # 16
    "tipo_instalacao",              # 17
    "tempo_prod_hs_mes",            # 18
]


def _ambiente_de(nome_arquivo: str) -> str | None:
    n = nome_arquivo.lower()
    for key, val in _AMBIENTE_MAP:
        if key in n:
            return val
    return None


def _listar_zips() -> list[tuple[int, str, str]]:
    """Retorna lista (ano, nome_arquivo, url)."""
    r = requests.get(_PAGE_URL, headers=_HEADERS, timeout=30)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "lxml")
    out, seen = [], set()
    for a in soup.find_all("a", href=True):
        h = a["href"]
        if not (h.lower().endswith(".zip") and "producao" in h.lower()):
            continue
        fname = h.split("/")[-1]
        if fname in seen:
            continue
        seen.add(fname)
        url = h if h.startswith("http") else "https://www.gov.br" + h
        m = re.search(r"/(\d{4})/[^/]+\.zip$", url)
        if m:
            ano = int(m.group(1))
        else:
            m2 = re.search(r"(\d{4})", fname)
            ano = int(m2.group(1)) if m2 else 0
        out.append((ano, fname, url))
    return sorted(out)


def _ler_csv(raw: bytes, ambiente: str) -> pd.DataFrame | None:
    """Lê CSV pulando cabeçalho ANP + 2 linhas de header. Posicional.
    Auto-detecta UTF-8 (com ou sem BOM) vs Latin-1 — alguns meses de 2023
    foram publicados pela ANP em Latin-1 sem BOM."""
    try:
        text = raw.decode("utf-8-sig", errors="strict")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    linhas = text.split("\n")

    # Encontra a linha "Estado;Bacia;..." — header L0
    header_idx = None
    for i, line in enumerate(linhas[:30]):
        norm = line.lower()
        if "estado" in norm and "bacia" in norm and "campo" in norm:
            header_idx = i
            break
    if header_idx is None:
        return None

    # Dados começam 2 linhas depois (header L0 + sub-header L1)
    body = "\n".join(linhas[header_idx + 2:])
    df = pd.read_csv(
        io.StringIO(body), sep=";", header=None, dtype=str, low_memory=False,
    )
    if df.empty or df.shape[1] < 8:
        return None

    # Detecta shift: alguns CSVs antigos têm 1 coluna a menos (Estado faltando).
    # Localiza a coluna de Período (formato YYYY/MM) em uma amostra das primeiras linhas.
    sample = df.head(50)
    periodo_col_idx = None
    for col_idx in (7, 6, 8):  # esperado=7; -1 e +1 como fallback
        if col_idx >= sample.shape[1]:
            continue
        col = sample.iloc[:, col_idx].astype(str).str.strip()
        if col.str.match(r"^\d{4}/\d{2}$").sum() >= 5:
            periodo_col_idx = col_idx; break
    if periodo_col_idx is None:
        return None

    shift = periodo_col_idx - 7  # 0 = padrão; -1 = sem coluna Estado
    if shift != 0:
        # Insere coluna vazia no início para alinhar com schema padrão
        if shift < 0:
            df.insert(0, "_pad_", None)
        else:  # shift > 0: remove coluna inicial
            df = df.iloc[:, shift:]

    # Atribui nomes posicionais
    n_cols_alvo = min(len(_COLS), df.shape[1])
    novo_df = df.iloc[:, :n_cols_alvo].copy()
    novo_df.columns = _COLS[:n_cols_alvo]

    # Strip strings
    for c in novo_df.columns:
        novo_df[c] = novo_df[c].astype(str).str.strip()
        novo_df.loc[novo_df[c].isin(["nan", "None", ""]), c] = None

    # Drop linhas sem nome de poço (footnotes/totals/empty)
    # Usa nome_poco_anp pois 'estado' pode estar vazio em alguns CSVs antigos.
    if "nome_poco_anp" in novo_df.columns:
        novo_df = novo_df.dropna(subset=["nome_poco_anp"])

    # Parse periodo → ano, mes
    if "periodo" in novo_df.columns:
        m = novo_df["periodo"].fillna("").str.match(r"^\d{4}/\d{2}$")
        novo_df = novo_df[m].copy()
        novo_df["ano"] = novo_df["periodo"].str[:4].astype("Int16")
        novo_df["mes"] = novo_df["periodo"].str[5:7].astype("Int8")
    else:
        return None

    novo_df["ambiente"] = ambiente

    # Numeric cols (vírgula decimal)
    num_cols = [c for c in novo_df.columns if any(k in c for k in (
        "oleo", "petroleo", "condensado", "gas", "agua", "tempo", "royalt"))]
    for c in num_cols:
        novo_df[c] = (novo_df[c].astype(str)
                              .str.replace(".", "", regex=False)
                              .str.replace(",", ".", regex=False))
        novo_df[c] = pd.to_numeric(novo_df[c], errors="coerce").astype("float64")

    # Drop linhas sem nome de poço
    if "nome_poco_anp" in novo_df.columns:
        novo_df = novo_df.dropna(subset=["nome_poco_anp"])

    return novo_df if not novo_df.empty else None


def _ler_csv_avulso(path: Path, ano: int, mes: int, ambiente: str) -> pd.DataFrame | None:
    """Lê CSV avulso extraído via Selenium (header 1 linha, 47 cols).
    Auto-detecta separador (; ou ,) e encoding (latin-1 / utf-8-sig)."""
    # Auto-detecta encoding
    raw = path.read_bytes()
    try:
        head = raw[:4096].decode("utf-8-sig")
        encoding = "utf-8-sig"
    except UnicodeDecodeError:
        head = raw[:4096].decode("latin-1")
        encoding = "latin-1"
    # Sep: o que aparecer mais na 1a linha
    primeira = head.split("\n", 1)[0]
    sep = ";" if primeira.count(";") >= primeira.count(",") else ","

    df = pd.read_csv(path, sep=sep, encoding=encoding, dtype=str,
                     low_memory=False, on_bad_lines="skip")
    if df.empty:
        return None

    # Mapeia nomes do header Selenium para canônicos
    rename = {
        "Estado":                       "estado",
        "Bacia":                        "bacia",
        "Nome Poço ANP":                "nome_poco_anp",
        "Nome Poço Operador":           "nome_poco_operador",
        "Campo":                        "campo",
        "Operador":                     "operador",
        "Número do Contrato":           "num_contrato",
        "Período":                      "periodo",
        "Óleo (bbl/dia)":               "oleo_bbl_dia",
        "Condensado (bbl/dia)":         "condensado_bbl_dia",
        "Petróleo (bbl/dia)":           "petroleo_bbl_dia",
        "Gás Natural (Mm³/dia) Assoc":     "gas_natural_assoc_mm3_dia",
        "Gás Natural (Mm³/dia) N Assoc":   "gas_natural_n_assoc_mm3_dia",
        "Gás Natural (Mm³/dia) Total":     "gas_natural_total_mm3_dia",
        "Volume Gás Royalties (m³/mês)":   "gas_royalties",
        "Água (bbl/dia)":               "agua_bbl_dia",
        "Instalação Destino":           "instalacao_destino",
        "Tipo Instalação":              "tipo_instalacao",
        "Tempo de Produção (hs por mês)": "tempo_prod_hs_mes",
    }
    df = df.rename(columns=rename)
    cols = [c for c in rename.values() if c in df.columns]
    df = df[cols].copy()

    # Strip + nan handling
    for c in df.columns:
        df[c] = df[c].astype(str).str.strip()
        df.loc[df[c].isin(["nan", "None", ""]), c] = None

    df = df.dropna(subset=["estado", "nome_poco_anp"])

    # Numeric: formato BR (1.234,56) se sep=';'; US (1234.56) se sep=','
    num_cols = [c for c in df.columns if any(k in c for k in (
        "oleo", "petroleo", "condensado", "gas", "agua", "tempo", "royalt"))]
    for c in num_cols:
        if sep == ";":
            ser = (df[c].astype(str)
                       .str.replace(".", "", regex=False)
                       .str.replace(",", ".", regex=False))
        else:
            ser = df[c].astype(str)
        df[c] = pd.to_numeric(ser, errors="coerce").astype("float64")

    df["ano"] = ano
    df["mes"] = mes
    df["ambiente"] = ambiente
    return df if not df.empty else None


def _coletar_csvs_avulsos() -> list[tuple[Path, int, int, str]]:
    """Retorna [(path, ano, mes, ambiente)] de todos os CSVs Selenium em pastas conhecidas."""
    out = []
    for pasta in _PASTAS_CSVS_AVULSOS:
        if not pasta.exists():
            continue
        for f in pasta.glob("producao_poco_*.csv"):
            m = _PAT_CSV_AVULSO.search(f.name)
            if m:
                out.append((f, int(m.group(2)), int(m.group(1)), m.group(3).upper()))
    return out


def _processar_zip(url: str, fname: str, ano_padrao: int) -> list[pd.DataFrame]:
    print(f"  Baixando {fname}...", end=" ", flush=True)
    r = requests.get(url, headers=_HEADERS, timeout=300)
    if r.status_code != 200:
        print(f"FALHOU ({r.status_code})")
        return []
    print(f"{len(r.content)/1024:.0f} KB")

    partes = []
    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        nomes_csv = [n for n in zf.namelist() if n.lower().endswith(".csv")]

        # Detecta se há arquivos mensais (e.g. 2010_01_producao_mar.csv).
        # Se há, ignoramos o anual consolidado (e.g. 2010_producao_mar.csv).
        tem_mensal = any(re.search(r"\d{4}[_\-]\d{2}", n) for n in nomes_csv)

        for n in nomes_csv:
            base = n.rsplit("/", 1)[-1].lower()
            amb = _ambiente_de(base)
            if amb is None:
                continue
            # Skip anual consolidado se há mensais
            if tem_mensal and re.match(r"^\d{4}_producao_", base):
                continue

            try:
                with zf.open(n) as f:
                    raw = f.read()
                df = _ler_csv(raw, amb)
                if df is not None and not df.empty:
                    partes.append(df)
            except Exception as e:
                print(f"    [aviso] {n}: {e}")
    return partes


def main():
    _DADOS_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Listando ZIPs em {_PAGE_URL}...")
    zips = _listar_zips()
    print(f"  {len(zips)} ZIPs (anos {zips[0][0]}-{zips[-1][0]})")
    print()

    # Cache: anos completamente cobertos (2005-2020 anuais não mudam)
    cache_anos: set[int] = set()
    if _DEST.exists():
        try:
            df_existente = pd.read_parquet(_DEST, columns=["ano"])
            cache_anos = set(int(a) for a in df_existente["ano"].dropna().unique())
        except Exception:
            pass

    todos_dfs = []
    for ano, fname, url in zips:
        # Skip anos antigos já no cache (não mudam)
        if ano in cache_anos and ano <= 2020:
            print(f"  {ano} {fname}: cache")
            continue

        partes = _processar_zip(url, fname, ano)
        if partes:
            df = pd.concat(partes, ignore_index=True)
            todos_dfs.append(df)
            print(f"    -> {len(df):,} linhas")

    # CSVs avulsos via Selenium (cobertura pós-2023)
    avulsos = _coletar_csvs_avulsos()
    if avulsos:
        print()
        print(f"CSVs avulsos (Selenium) encontrados: {len(avulsos)}")
        for path, ano, mes, amb in sorted(avulsos, key=lambda x: (x[1], x[2], x[3])):
            try:
                df = _ler_csv_avulso(path, ano, mes, amb)
                if df is not None:
                    todos_dfs.append(df)
                    print(f"  {ano}-{mes:02d} {amb}: {len(df):,} linhas ({path.name})")
            except Exception as e:
                print(f"  {path.name}: ERRO {e}")

    if todos_dfs:
        novo = pd.concat(todos_dfs, ignore_index=True)
        if _DEST.exists():
            existente = pd.read_parquet(_DEST)
            df = pd.concat([existente, novo], ignore_index=True)
        else:
            df = novo
        # Dedup
        dims = ["ano", "mes", "ambiente", "nome_poco_anp", "operador", "campo"]
        antes = len(df)
        df = df.drop_duplicates(subset=dims, keep="last")
        if antes != len(df):
            print(f"  Dedup: {antes:,} -> {len(df):,}")

        # Reclassificação Pré-Sal vs Pós-Sal:
        # Os poços do Pré-Sal (ambiente=S) também aparecem em Mar (M) — double-counting.
        # Para cada (ano, mes), poços em S são Pré-Sal; poços em M mas NÃO em S são Pós-Sal.
        # Substituímos a coluna `ambiente` por `local` com valores: PreSal, PosSal, Terra.
        antes = len(df)
        # Chaves dos registros Pré-Sal (string composta para isin vetorizado)
        df["_key"] = (df["ano"].astype(str) + "|" +
                      df["mes"].astype(str) + "|" +
                      df["nome_poco_anp"].astype(str))
        s_keys = set(df.loc[df["ambiente"] == "S", "_key"])
        m_dup_mask = (df["ambiente"] == "M") & df["_key"].isin(s_keys)
        df = df[~m_dup_mask].copy()
        df["local"] = df["ambiente"].map({"S": "PreSal", "M": "PosSal", "T": "Terra"})
        df = df.drop(columns=["ambiente", "_key"])
        if antes != len(df):
            print(f"  Pré-Sal dedup: {antes:,} -> {len(df):,} ({antes-len(df):,} duplicatas removidas de Mar)")

        df = df.sort_values(["ano", "mes", "local", "nome_poco_anp"])
        df.to_parquet(_DEST, index=False, compression="snappy")

    if not _DEST.exists():
        print("\nNenhum dado processado.")
        sys.exit(1)

    sz = _DEST.stat().st_size / 1024 / 1024
    df_final = pd.read_parquet(_DEST)
    print()
    print(f"Concluido: {_DEST.name} ({sz:.1f} MB)")
    print(f"  {len(df_final):,} linhas")
    print(f"  Periodo:    {df_final['ano'].min()}-{int(df_final[df_final['ano']==df_final['ano'].min()]['mes'].min()):02d}"
          f" -> {df_final['ano'].max()}-{int(df_final[df_final['ano']==df_final['ano'].max()]['mes'].max()):02d}")
    print(f"  Locais:     {sorted(df_final['local'].dropna().unique())}")
    print(f"  Bacias:     {df_final['bacia'].nunique()}")
    print(f"  Estados:    {df_final['estado'].nunique()}")
    print(f"  Operadores: {df_final['operador'].nunique()}")
    print(f"  Poços:      {df_final['nome_poco_anp'].nunique()}")


if __name__ == "__main__":
    main()
