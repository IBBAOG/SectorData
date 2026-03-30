import os
import re
import time
import warnings
from datetime import datetime, timezone, timedelta
from io import BytesIO, StringIO

import pandas as pd
import requests

warnings.filterwarnings("ignore", message="Unverified HTTPS request")

# ---------------------------------------------------------------------------
# URLs / constantes
# ---------------------------------------------------------------------------

URL_SANTOS_ESPERADOS = (
    "https://www.portodesantos.com.br/"
    "informacoes-operacionais/operacoes-portuarias/"
    "navegacao-e-movimento-de-navios/navios-esperados-carga/"
)
URL_SANTOS_ATRACADOS = (
    "https://www.portodesantos.com.br/"
    "informacoes-operacionais/operacoes-portuarias/"
    "navegacao-e-movimento-de-navios/atracados-porto-terminais/"
)
URL_ITAQUI      = "https://www.portodoitaqui.com.br/porto-agora/navios/esperados"
URL_PARANAGUA   = "https://www.appaweb.appa.pr.gov.br/appaweb/pesquisa.aspx?WCI=relLineUpRetroativo"
URL_SAO_SEBAST  = "https://sisport.portoss.sp.gov.br/LineUp/ConsultaPublicaProgramacao.aspx"
SUAPE_SHEET_ID  = "1wfmbo5z4iLqDmANEIslnM-G0FYD57e0iruKHrbzniOk"
SUAPE_SHEET_RAW = "Dados Brutos"

# Colunas-padrão da tabela consolidada (ordem de exibição)
COLS_PADRAO = [
    "Porto", "Status", "Navio", "Carga",
    "Quantidade Original", "Unidade Origem", "Quantidade (m³)",
    "Chegada", "Atracação", "Desatracação",
    "Origem", "Terminal",
]

# Status a serem excluídos da tabela final
_STATUS_EXCLUIR = {"REATRACÁVEL", "REATRACAVEL", "DESATRACADO"}

# ---------------------------------------------------------------------------
# Conversão de unidades → m³
# ---------------------------------------------------------------------------

# Densidade média do diesel S-10 (kg/L = t/m³)
_DIESEL_DENSITY = 0.835   # t/m³  → 1 t = 1/0.835 ≈ 1.198 m³

# Fatores: 1 <unidade> = ? m³
_FATOR_M3: dict[str, float] = {
    # Toneladas (métrica)
    "t":          1.0 / _DIESEL_DENSITY,
    "ton":        1.0 / _DIESEL_DENSITY,
    "tons":       1.0 / _DIESEL_DENSITY,
    "ton.":       1.0 / _DIESEL_DENSITY,
    "tons.":      1.0 / _DIESEL_DENSITY,
    "tonelada":   1.0 / _DIESEL_DENSITY,
    "toneladas":  1.0 / _DIESEL_DENSITY,
    "mt":         1.0 / _DIESEL_DENSITY,   # metric ton
    # Kilo-toneladas
    "kt":         1_000.0 / _DIESEL_DENSITY,
    # Metro cúbico (já está em m³)
    "m3":         1.0,
    "m³":         1.0,
    "c":          1.0,    # Suape: "C" = cubagem = m³
    "cb":         1.0,
    "cub":        1.0,
    # Quilolitro (= m³)
    "kl":         1.0,
    "klt":        1.0,
    # Litro
    "l":          0.001,
    "lt":         0.001,
    "lts":        0.001,
    "litros":     0.001,
    # Barril (US oil barrel)
    "bbl":        0.158987,
    "bbl.":       0.158987,
    "barrel":     0.158987,
    "barrels":    0.158987,
    # Galão (US)
    "gal":        0.003785,
    "gallon":     0.003785,
    # Galão (UK / imperial)
    "igal":       0.004546,
}


def _parse_numero(v) -> float | None:
    """
    Extrai o valor numérico de qualquer representação:
      - float/int puro                → retorna direto
      - "42.079,000 Tons."  (BR)      → 42079.0
      - "20.000"            (BR mil.) → 20000.0
      - "200.0"             (EN)      → 200.0
      - "20,000.50"         (EN mil.) → 20000.5
    """
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return None if pd.isna(v) else float(v)
    s = str(v).strip()
    # Isolar a primeira sequência numérica com separadores (ex: "42.079,000 Tons.")
    m = re.search(r"[\d][\d.,]*", s)
    if not m:
        return None
    num = m.group()

    # Decidir o formato pelo padrão de separadores:
    has_dot   = "." in num
    has_comma = "," in num

    if has_dot and has_comma:
        # Determina qual é o separador decimal (o último)
        last_dot   = num.rfind(".")
        last_comma = num.rfind(",")
        if last_comma > last_dot:
            # BR: "42.079,000"  → remove pontos, troca vírgula por ponto
            return float(num.replace(".", "").replace(",", "."))
        else:
            # EN: "20,000.50"   → remove vírgulas
            return float(num.replace(",", ""))
    elif has_comma:
        # Só vírgula — pode ser milhar EN ou decimal BR
        after_comma = num.rsplit(",", 1)[-1]
        if len(after_comma) == 3 and after_comma.isdigit():
            # "20,000" → milhar EN → 20000
            return float(num.replace(",", ""))
        # "0,835" → decimal BR → 0.835
        return float(num.replace(",", "."))
    elif has_dot:
        # Só ponto — pode ser decimal EN ou milhar BR
        after_dot = num.rsplit(".", 1)[-1]
        if len(after_dot) == 3 and after_dot.isdigit():
            # "20.000" → ambíguo: se ≥ 100 trata como milhar BR
            candidate = int(num.replace(".", ""))
            if candidate >= 100:
                return float(candidate)
        return float(num)
    else:
        return float(num)


def _inferir_unidade(v, hint: str | None = None) -> str:
    """
    Infere a unidade a partir de:
      - hint explícito (prioridade máxima)
      - texto da string (ex: "42.079,000 Tons." → "t")
      - valor "C" (Suape) → "m³"
    Retorna a unidade em letras minúsculas padronizada.
    """
    if hint:
        return hint.strip().lower()
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return "t"
    s = str(v).strip()

    # Testa se o valor inteiro é uma unidade conhecida (ex: "C", "T", "KL")
    if re.fullmatch(r"[A-Za-z³]+\.?", s):
        return s.lower().rstrip(".")

    # Procura padrão de unidade no texto após os números
    m = re.search(
        r"\b(m3|m³|kl|klt|bbl|barrel|barrels|gal|gallon|igal"
        r"|kt|ton\.?|tons\.?|tonelada[s]?|mt|cb|cub|litros?|lts?|[tTcCmM])\b",
        s,
        re.IGNORECASE,
    )
    if m:
        return m.group(1).lower().rstrip(".")
    return "t"   # padrão portuário: toneladas


def _para_m3(valor: float, unidade: str) -> float | None:
    """Converte `valor` na `unidade` fornecida para m³. Retorna None se não conversível."""
    if valor is None or pd.isna(valor):
        return None
    fator = _FATOR_M3.get(unidade.strip().lower())
    if fator is None:
        # Tentativa de correspondência parcial
        for chave, f in _FATOR_M3.items():
            if chave in unidade.lower():
                fator = f
                break
    if fator is None:
        return None   # unidade desconhecida
    return round(float(valor) * fator, 2)


# ---------------------------------------------------------------------------
# Helpers gerais
# ---------------------------------------------------------------------------

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}

def _get(url: str, retries: int = 3, timeout: int = 60) -> str:
    for attempt in range(1, retries + 1):
        try:
            resp = requests.get(url, headers=_HEADERS, verify=False, timeout=timeout)
            resp.raise_for_status()
            return resp.content.decode("utf-8", errors="replace")
        except Exception as e:
            if attempt == retries:
                raise
            time.sleep(5 * attempt)


def _col(df: pd.DataFrame, keyword: str, required: bool = True) -> str | None:
    matches = [c for c in df.columns if keyword.lower() in str(c).lower()]
    if not matches:
        if required:
            raise KeyError(f"Coluna '{keyword}' não encontrada. Colunas: {df.columns.tolist()}")
        return None
    return matches[0]


def _diesel_puro(produto: str) -> bool:
    """Retorna True apenas para diesel puro — exclui biodiesel e diesel marítimo."""
    s = str(produto).upper().strip()
    return "DIESEL" in s and "BIO" not in s and "MARIT" not in s


def _normalizar(df: pd.DataFrame, porto: str, status: str) -> pd.DataFrame:
    """Insere Porto/Status e alinha ao esquema-padrão (colunas ausentes → NaN)."""
    df = df.copy()
    df.insert(0, "Porto",  porto)
    df.insert(1, "Status", status)
    for col in COLS_PADRAO:
        if col not in df.columns:
            df[col] = pd.NA
    extras = [c for c in df.columns if c not in COLS_PADRAO]
    return df[COLS_PADRAO + extras]


# ---------------------------------------------------------------------------
# Porto de Santos – Esperados
# ---------------------------------------------------------------------------

def buscar_santos_esperados() -> pd.DataFrame:
    html = _get(URL_SANTOS_ESPERADOS)
    marcador = "LIQUIDO A GRANEL"
    idx = html.upper().index(marcador)
    inicio = html.rfind("<table", 0, idx)
    fim = html.find("</table>", idx) + len("</table>")
    df = pd.read_html(StringIO(html[inicio:fim]))[0]

    df.columns = [col[1] if col[0] != col[1] else col[0] for col in df.columns]
    df = df.loc[:, ~df.columns.str.startswith("Unnamed")]

    col_op       = _col(df, "Opera")
    col_merc     = _col(df, "Mercadoria")
    col_navio    = _col(df, "Navio")
    col_chegada  = _col(df, "Cheg")
    col_terminal = _col(df, "Terminal")
    col_peso     = _col(df, "Peso", required=False)

    mask = (
        df["Nav"].str.strip().str.upper().eq("LONG")
        & df[col_op].str.strip().str.upper().eq("DESC")
        & df[col_merc].str.strip().str.upper().eq("OLEO DIESEL")
    )
    r = df.loc[mask].copy()
    r = r.rename(columns={
        col_navio:    "Navio",
        col_merc:     "Carga",
        col_chegada:  "Chegada",
        col_terminal: "Terminal",
    })
    if col_peso:
        r = r.rename(columns={col_peso: "Quantidade (m³)"})
    r["Unidade Origem"] = "t"   # Santos reporta em toneladas métricas

    return _normalizar(r, porto="Porto de Santos", status="Esperado")


# ---------------------------------------------------------------------------
# Porto de Santos – Atracados
# ---------------------------------------------------------------------------

def buscar_santos_atracados() -> pd.DataFrame:
    html = _get(URL_SANTOS_ATRACADOS)
    df = pd.read_html(StringIO(html))[0]

    col_carga = _col(df, "Carga")
    col_navio = _col(df, "Navio")
    col_local = _col(df, "Local")
    col_desc  = _col(df, "Desc")   # Desc (t) = toneladas descarregadas
    col_emb   = _col(df, "Emb")

    mask = df[col_carga].str.strip().str.upper().eq("OLEO DIESEL")
    r = df.loc[mask].copy()
    r = r.rename(columns={
        col_navio: "Navio",
        col_carga: "Carga",
        col_local: "Terminal",
        col_desc:  "Quantidade (m³)",  # será convertida abaixo
        col_emb:   "Emb (t)",
    })
    r["Unidade Origem"] = "t"   # colunas Desc (t) / Emb (t) são toneladas

    return _normalizar(r, porto="Porto de Santos", status="Atracado")


# ---------------------------------------------------------------------------
# Porto de Itaqui – Atracados / Fundeados / Esperados
# ---------------------------------------------------------------------------

def buscar_itaqui() -> pd.DataFrame:
    html = _get(URL_ITAQUI)
    dfs = pd.read_html(StringIO(html))
    mapeamento = {0: "Atracado", 1: "Fundeado", 2: "Esperado"}
    partes = []

    for i, status in mapeamento.items():
        if i >= len(dfs):
            continue
        df = dfs[i].copy()

        col_carga = _col(df, "Carga")
        mask = df[col_carga].str.strip().str.upper().str.contains("DIESEL", na=False)
        f = df.loc[mask].copy()
        if f.empty:
            continue

        col_navio = _col(df, "Navio")
        f = f.rename(columns={col_navio: "Navio", col_carga: "Carga"})

        # Berço → Terminal
        c_berco = _col(df, "Ber", required=False)
        if c_berco:
            f = f.rename(columns={c_berco: "Terminal"})

        # Qtd → Quantidade (m³) (ainda em t; será convertida no consolidar)
        # Forçar string para que _parse_numero() trate "39.889" como 39889 (BR)
        # e não como float 39.889 (EN) — pd.read_html converte automaticamente.
        c_qtd = _col(df, "Qtd", required=False)
        if c_qtd:
            f[c_qtd] = f[c_qtd].astype(str)
            f = f.rename(columns={c_qtd: "Quantidade (m³)"})

        # Prev Chegada → Chegada
        c_cheg = next(
            (c for c in df.columns if "Prev" in c and "Chegada" in c), None
        )
        if c_cheg:
            f = f.rename(columns={c_cheg: "Chegada"})

        f["Unidade Origem"] = "t"   # Itaqui reporta em toneladas

        partes.append(_normalizar(f, porto="Porto de Itaqui", status=status))

    return pd.concat(partes, ignore_index=True, sort=False) if partes else pd.DataFrame()


# ---------------------------------------------------------------------------
# Porto de Paranaguá – todas as tabelas
# ---------------------------------------------------------------------------

_PARANAGUA_STATUS = {
    1: "Atracado",
    2: "Programado",
    3: "Ao Largo (Reatracação)",
    4: "Ao Largo",
    5: "Esperado",
    7: "Despachado",
}


def buscar_paranagua() -> pd.DataFrame:
    html = _get(URL_PARANAGUA)
    dfs = pd.read_html(StringIO(html))
    partes = []

    for i, status in _PARANAGUA_STATUS.items():
        if i >= len(dfs):
            continue
        df = dfs[i].copy()

        if isinstance(df.columns, pd.MultiIndex):
            df.columns = [col[1] for col in df.columns]
        df = df.loc[:, ~df.columns.str.startswith("Unnamed")]

        merc_cols = [c for c in df.columns if "Mercad" in c]
        sent_cols = [c for c in df.columns if "Sentido" in c]
        if not merc_cols or not sent_cols:
            continue

        col_merc = merc_cols[0]
        col_sent = sent_cols[0]
        mask = (
            df[col_merc].str.strip().str.upper().str.contains("DIESEL", na=False)
            & df[col_sent].str.strip().str.upper().eq("IMP")
        )
        f = df.loc[mask].copy()
        if f.empty:
            continue

        col_navio  = _col(f, "Embarca")
        col_berco  = _col(f, "Ber", required=False)
        rename_map = {col_navio: "Navio", col_merc: "Carga", col_sent: "Sentido"}

        if col_berco:
            rename_map[col_berco] = "Terminal"

        # Previsto (ex: "42.079,000 Tons.") → Quantidade (m³)
        c_prev = _col(f, "Previsto", required=False)
        if c_prev:
            rename_map[c_prev] = "Quantidade (m³)"

        # Chegada: preferir coluna já chamada "Chegada"; senão ETA
        if "Chegada" not in f.columns:
            for cand in ["ETA", "Atrac\u00e7\u00e3o"]:
                if cand in f.columns:
                    rename_map[cand] = "Chegada"
                    break

        # Atracação (berthing)
        c_atrac = _col(f, "Atrac", required=False)
        if c_atrac and c_atrac not in rename_map.values():
            rename_map[c_atrac] = "Atracação"

        # Desatracação
        c_desatrac = next((c for c in f.columns if "Desatrac" in c), None)
        if c_desatrac:
            rename_map[c_desatrac] = "Desatracação"

        f = f.rename(columns=rename_map)
        f = f.loc[:, ~f.columns.duplicated()]

        # Paranaguá reporta sempre em toneladas (embutido em "Tons." na string)
        f["Unidade Origem"] = "t"

        partes.append(_normalizar(f, porto="Porto de Paranaguá", status=status))

    return pd.concat(partes, ignore_index=True, sort=False) if partes else pd.DataFrame()


# ---------------------------------------------------------------------------
# Porto de São Sebastião
# ---------------------------------------------------------------------------

_SS_STATUS_MAP = {
    "OPERANDO":    "Atracado",
    "FUNDEADO":    "Fundeado",
    "DESATRACADO": "Desatracado",
    "PROGRAMADO":  "Programado",
}


def buscar_sao_sebastiao() -> pd.DataFrame:
    html = _get(URL_SAO_SEBAST)
    dfs = pd.read_html(StringIO(html))
    partes = []

    for tab_idx, df_raw in enumerate(dfs[:2]):
        df = df_raw.copy()
        col_merc  = _col(df, "MERCAD")
        col_navio = _col(df, "NAVIO")

        mask = df[col_merc].str.strip().str.upper().str.contains("DIESEL", na=False)
        f = df.loc[mask].copy()
        if f.empty:
            continue

        f = f.rename(columns={col_navio: "Navio", col_merc: "Carga"})

        for kw, dest in [
            ("PREVIS",   "Chegada"),
            ("PESO",     "Quantidade (m³)"),
            ("LOCAL",    "Terminal"),
            ("OPERADOR", "Operador"),
            ("PRODU",    "Atracação"),
        ]:
            c = _col(df, kw, required=False)
            if c:
                f = f.rename(columns={c: dest})

        # São Sebastião reporta PESO (Ton) → toneladas
        f["Unidade Origem"] = "t"

        if tab_idx == 0:
            col_sit = _col(f, "SITUA", required=False)
            if col_sit:
                f[col_sit] = (
                    f[col_sit].str.strip().str.upper()
                    .map(_SS_STATUS_MAP).fillna(f[col_sit])
                )
                for _, grp in f.groupby(col_sit, sort=False):
                    status_val = grp[col_sit].iloc[0]
                    partes.append(
                        _normalizar(grp.drop(columns=col_sit),
                                    porto="Porto de São Sebastião",
                                    status=status_val)
                    )
            else:
                partes.append(
                    _normalizar(f, porto="Porto de São Sebastião", status="Operando")
                )
        else:
            partes.append(
                _normalizar(f, porto="Porto de São Sebastião", status="Programado")
            )

    return pd.concat(partes, ignore_index=True, sort=False) if partes else pd.DataFrame()


# ---------------------------------------------------------------------------
# Porto de Suape – Google Sheets (aba oculta "Dados Brutos", formato wide)
# ---------------------------------------------------------------------------

def buscar_suape() -> pd.DataFrame:
    url = f"https://docs.google.com/spreadsheets/d/{SUAPE_SHEET_ID}/export?format=xlsx"
    resp = requests.get(url, verify=False, timeout=60)
    resp.raise_for_status()

    xl  = pd.ExcelFile(BytesIO(resp.content))
    df  = xl.parse(SUAPE_SHEET_RAW, header=0)

    # Grupos de colunas por posição: Produto / Quantidade / Unidade
    prod_cols = [c for c in df.columns
                 if str(c).startswith("Produto")
                 and not any(k in str(c) for k in ["Tipo", "Operador", "Qtd", "Unid", "Confirm"])]
    qtd_cols  = [c for c in df.columns if str(c).startswith("Quantidade")]
    uni_cols  = [c for c in df.columns if str(c).startswith("Unidade")]

    # Alinhar os três grupos pelo mesmo índice (menor comprimento é o limitante)
    n = min(len(prod_cols), len(qtd_cols), len(uni_cols))
    prod_cols = prod_cols[:n]
    qtd_cols  = qtd_cols[:n]
    uni_cols  = uni_cols[:n]

    # Máscara: diesel PURO em qualquer coluna de produto
    mask = df[prod_cols].apply(lambda col: col.map(_diesel_puro)).any(axis=1)
    f = df.loc[mask].copy()
    if f.empty:
        return pd.DataFrame()

    col_status   = _col(df, "Status da Embarca")
    col_navio    = _col(df, "Nome da Embarca")
    col_berco    = _col(df, "Ber")
    col_imo      = _col(df, "IMO")
    col_origem   = _col(df, "ltima Escala", required=False)

    date_cols    = [c for c in df.columns
                    if any(k in str(c) for k in ["ETA / ATA", "ETB / ATB", "Desatrac"])]
    col_chegada  = next((c for c in date_cols if "ETA / ATA" in str(c)), None)
    col_atrac    = next((c for c in date_cols if "ETB / ATB" in str(c)), None)
    col_desatrac = next(
        (c for c in date_cols if "Desatrac" in str(c) and "Situa" not in str(c)), None
    )

    # Para cada navio: consolidar quantidade e unidade dos produtos diesel puro
    def _qtd_e_unidade(row):
        total   = 0.0
        units   = []
        for pc, qc, uc in zip(prod_cols, qtd_cols, uni_cols):
            if _diesel_puro(str(row[pc])):
                try:
                    total += float(row[qc])
                    u = str(row[uc]).strip()
                    if u and u.lower() != "nan":
                        units.append(u)
                except (ValueError, TypeError):
                    pass
        # Unidade: pega o valor mais comum (ou único) entre os grupos
        unidade = max(set(units), key=units.count) if units else "C"
        return pd.Series({
            "Quantidade (m³)": total if total > 0 else pd.NA,
            "Unidade Origem":  unidade,
        })

    f[["Quantidade (m³)", "Unidade Origem"]] = f.apply(_qtd_e_unidade, axis=1)

    rename_map = {
        col_status: "Status",
        col_navio:  "Navio",
        col_berco:  "Terminal",
        col_imo:    "IMO",
    }
    if col_chegada:  rename_map[col_chegada]  = "Chegada"
    if col_atrac:    rename_map[col_atrac]    = "Atracação"
    if col_desatrac: rename_map[col_desatrac] = "Desatracação"
    if col_origem:   rename_map[col_origem]   = "Origem"

    f = f.rename(columns=rename_map)
    f["Status"] = f["Status"].str.strip()

    # Excluir cabotagem: origem terminando em "-BRA" indica rota doméstica
    if "Origem" in f.columns:
        cabotagem = f["Origem"].str.strip().str.upper().str.endswith("-BRA").fillna(False)
        n_cab = cabotagem.sum()
        if n_cab > 0:
            print(f"  Suape: {n_cab} navio(s) de cabotagem removido(s) (origem -BRA)")
        f = f.loc[~cabotagem]

    # Carga: lista de produtos diesel puro por navio
    f["Carga"] = f.apply(
        lambda row: " | ".join(
            str(row[c]) for c in prod_cols if _diesel_puro(str(row[c]))
        ), axis=1
    )

    partes = []
    for status_val, grp in f.groupby("Status", sort=False):
        partes.append(
            _normalizar(grp.drop(columns="Status").copy(),
                        porto="Porto de Suape",
                        status=status_val)
        )
    return pd.concat(partes, ignore_index=True, sort=False) if partes else pd.DataFrame()


# ---------------------------------------------------------------------------
# Consolidação final + conversão para m³
# ---------------------------------------------------------------------------

def _aplicar_conversao(resultado: pd.DataFrame) -> pd.DataFrame:
    """
    Para cada linha:
      1. Extrai valor numérico de 'Quantidade (m³)' (pode conter texto como "Tons.")
         → salva em 'Quantidade Original' (valor numérico na unidade de origem)
      2. Lê 'Unidade Origem' (com fallback à inferência da string)
      3. Converte para m³ usando _FATOR_M3 → salva em 'Quantidade (m³)'
    """
    def _converter_linha(row):
        raw     = row.get("Quantidade (m³)", pd.NA)
        hint    = row.get("Unidade Origem",  pd.NA)
        hint    = None if pd.isna(hint) else str(hint)

        valor   = _parse_numero(raw)
        unidade = _inferir_unidade(raw, hint=hint)
        m3      = _para_m3(valor, unidade)

        return pd.Series({
            "Quantidade Original": valor,
            "Unidade Origem":      unidade,
            "Quantidade (m³)":     m3,
        })

    resultado[["Quantidade Original", "Unidade Origem", "Quantidade (m³)"]] = resultado.apply(
        _converter_linha, axis=1
    )
    return resultado


def _filtrar_datas_antigas(df: pd.DataFrame) -> pd.DataFrame:
    """
    Remove linhas cujas datas (Chegada, Atracação, Desatracação) são TODAS
    anteriores a 7 dias antes da data de coleta.
    Se pelo menos uma das datas for recente (ou estiver vazia), a linha é mantida.
    """
    _BRT = timezone(timedelta(hours=-3))
    limite = datetime.now(_BRT) - timedelta(days=7)
    colunas_data = ["Chegada", "Atracação", "Desatracação"]

    def _linha_valida(row):
        datas_presentes = []
        for col in colunas_data:
            val = row.get(col)
            if pd.isna(val) or str(val).strip() == "":
                continue
            try:
                dt = pd.to_datetime(str(val), dayfirst=True)
                datas_presentes.append(dt)
            except (ValueError, TypeError):
                continue
        # Se nenhuma data preenchida, manter a linha
        if not datas_presentes:
            return True
        # Manter se pelo menos uma data é >= limite
        return any(dt.replace(tzinfo=_BRT) >= limite for dt in datas_presentes)

    mask = df.apply(_linha_valida, axis=1)
    removidos = (~mask).sum()
    if removidos > 0:
        print(f"  Filtro de datas: {removidos} registro(s) removido(s) (datas > 7 dias atrás)")
    return df.loc[mask]


def consolidar(*tabelas: pd.DataFrame) -> pd.DataFrame:
    validas = [t for t in tabelas if t is not None and not t.empty]
    if not validas:
        return pd.DataFrame(columns=COLS_PADRAO)

    result = pd.concat(validas, ignore_index=True, sort=False)

    # Filtrar status excluídos
    result = result[~result["Status"].str.strip().str.upper().isin(_STATUS_EXCLUIR)]

    # Filtrar apenas diesel puro
    result = result[
        result["Carga"].apply(
            lambda v: any(_diesel_puro(p) for p in str(v).split("|"))
        )
    ]

    # Padronizar nome da carga
    result["Carga"] = "Óleo Diesel"

    # Converter quantidades para m³
    result = _aplicar_conversao(result)

    # Filtrar registros com todas as datas anteriores a 7 dias da coleta
    result = _filtrar_datas_antigas(result)

    result = result.reset_index(drop=True)
    extras = [c for c in result.columns if c not in COLS_PADRAO]
    return result[COLS_PADRAO + extras]


# ---------------------------------------------------------------------------
# Salvar CSV
# ---------------------------------------------------------------------------

def salvar_csv(resultado: pd.DataFrame) -> str:
    """Appenda o resultado em um único CSV, adicionando coluna de timestamp."""
    pasta = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")
    os.makedirs(pasta, exist_ok=True)

    caminho = os.path.join(pasta, "navios_diesel.csv")

    cols = [c for c in COLS_PADRAO if c in resultado.columns]
    resultado = resultado[cols].copy()
    _BRT = timezone(timedelta(hours=-3))
    resultado.insert(0, "Consulta", datetime.now(_BRT).strftime("%Y-%m-%d %H:%M"))

    arquivo_existe = os.path.isfile(caminho) and os.path.getsize(caminho) > 0
    resultado.to_csv(
        caminho,
        mode="a" if arquivo_existe else "w",
        header=not arquivo_existe,
        index=False,
        encoding="utf-8-sig",
    )

    return caminho


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # Mapping: display name → canonical porto name (multiple sources can share a porto)
    _FONTE_PORTO = {
        "Porto de Santos – Esperados":  "Porto de Santos",
        "Porto de Santos – Atracados":  "Porto de Santos",
        "Porto de Itaqui":              "Porto de Itaqui",
        "Porto de Paranaguá":           "Porto de Paranaguá",
        "Porto de São Sebastião":       "Porto de São Sebastião",
        "Porto de Suape":               "Porto de Suape",
    }

    fontes = [
        ("Porto de Santos – Esperados",  buscar_santos_esperados),
        ("Porto de Santos – Atracados",  buscar_santos_atracados),
        ("Porto de Itaqui",              buscar_itaqui),
        ("Porto de Paranaguá",           buscar_paranagua),
        ("Porto de São Sebastião",       buscar_sao_sebastiao),
        ("Porto de Suape",               buscar_suape),
    ]

    tabelas = []
    portos_com_erro: set[str] = set()
    for nome, fn in fontes:
        print(f"Buscando {nome}...")
        try:
            t = fn()
            print(f"  {len(t)} registro(s).")
            tabelas.append(t)
        except Exception as e:
            print(f"  ERRO: {e}")
            tabelas.append(pd.DataFrame())
            portos_com_erro.add(_FONTE_PORTO[nome])

    resultado = consolidar(*tabelas)

    # Adicionar linhas sentinela para portos sem nenhum dado coletado
    portos_no_resultado = set(resultado["Porto"].unique()) if not resultado.empty else set()
    portos_sem_dados = portos_com_erro - portos_no_resultado
    if portos_sem_dados:
        sentinelas = []
        for porto in sorted(portos_sem_dados):
            row = {col: pd.NA for col in COLS_PADRAO}
            row["Porto"]  = porto
            row["Status"] = "ERRO_COLETA"
            sentinelas.append(row)
        resultado = pd.concat(
            [resultado, pd.DataFrame(sentinelas)],
            ignore_index=True,
        )

    # Salvar CSV
    csv_path = salvar_csv(resultado)
    print(f"\nCSV salvo em: {csv_path}")

    # Exibir no console
    cols_exibir = [c for c in COLS_PADRAO
                   if c in resultado.columns and resultado[c].notna().any()]

    pd.set_option("display.max_rows",    None)
    pd.set_option("display.max_columns", None)
    pd.set_option("display.width",       None)
    pd.set_option("display.max_colwidth", 45)
    pd.set_option("display.float_format", "{:,.1f}".format)

    print(f"\n{'='*110}")
    print(f"TABELA CONSOLIDADA – {len(resultado)} navios | quantidades em m³")
    print(f"{'='*110}\n")
    print(resultado[cols_exibir].to_string(index=False))
