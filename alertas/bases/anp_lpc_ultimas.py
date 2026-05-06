import re
from pathlib import Path

import pandas as pd

from .base import BaseMonitor

_PARQUET = Path(__file__).parent.parent.parent / "DADOS" / "anp_lpc_ultimas" / "lpc_consolidado.parquet"

_ESTADO_PARA_UF = {
    "ACRE": "AC", "ALAGOAS": "AL", "AMAPA": "AP", "AMAZONAS": "AM",
    "BAHIA": "BA", "CEARA": "CE", "DISTRITO FEDERAL": "DF",
    "ESPIRITO SANTO": "ES", "GOIAS": "GO", "MARANHAO": "MA",
    "MATO GROSSO": "MT", "MATO GROSSO DO SUL": "MS", "MINAS GERAIS": "MG",
    "PARA": "PA", "PARAIBA": "PB", "PARANA": "PR", "PERNAMBUCO": "PE",
    "PIAUI": "PI", "RIO DE JANEIRO": "RJ", "RIO GRANDE DO NORTE": "RN",
    "RIO GRANDE DO SUL": "RS", "RONDONIA": "RO", "RORAIMA": "RR",
    "SANTA CATARINA": "SC", "SAO PAULO": "SP", "SERGIPE": "SE",
    "TOCANTINS": "TO",
}

_UF_PARA_REGIAO = {
    "AC": "N", "AM": "N", "AP": "N", "PA": "N", "RO": "N", "RR": "N", "TO": "N",
    "AL": "NE", "BA": "NE", "CE": "NE", "MA": "NE", "PB": "NE",
    "PE": "NE", "PI": "NE", "RN": "NE", "SE": "NE",
    "DF": "CO", "GO": "CO", "MS": "CO", "MT": "CO",
    "ES": "SE", "MG": "SE", "RJ": "SE", "SP": "SE",
    "PR": "S", "RS": "S", "SC": "S",
}

_COLS_XLSX = {
    "CNPJ":               "cnpj",
    "MUNICÍPIO":          "municipio",
    "ESTADO":             "estado_nome",
    "BANDEIRA":           "bandeira",
    "PRODUTO":            "produto",
    "UNIDADE DE MEDIDA":  "unidade",
    "PREÇO DE REVENDA":   "preco_venda",
    "DATA DA COLETA":     "data_coleta",
}


class AnpLpcUltimas(BaseMonitor):
    slug = "anp_lpc_ultimas"
    nome = "ANP LPC — Últimas Semanas Pesquisadas"
    url  = (
        "https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia"
        "/precos/levantamento-de-precos-de-combustiveis-ultimas-semanas-pesquisadas"
    )

    _PAT = re.compile(
        r"((?:resumo_semanal_|revendas_)lpc_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.xlsx)",
        re.IGNORECASE,
    )

    def verificar(self):
        soup = self.fetch(self.url)

        # Collect ALL weeks available on the page: data_fim -> {tipo: url}
        entries: dict[str, dict[str, str]] = {}
        for a in soup.find_all("a", href=True):
            m = self._PAT.search(a["href"])
            if m:
                tipo     = "resumo" if "resumo_semanal" in m.group(1).lower() else "revendas"
                data_fim = m.group(3)
                href     = a["href"]
                url      = href if href.startswith("http") else "https://www.gov.br" + href
                entries.setdefault(data_fim, {})[tipo] = url

        if not entries:
            raise ValueError("Nenhum arquivo LPC encontrado na página")

        estado       = self.ler_estado()
        ultima_vista = estado.get("ultima_data_fim", "")

        # Semanas novas = todas que ainda não foram processadas
        novas = {d: urls for d, urls in entries.items() if d > ultima_vista}

        if not novas:
            return False, estado, ""

        ultima = max(novas)
        n      = len(novas)
        msg    = (
            f"Nova semana disponível: até {ultima}"
            if n == 1
            else f"{n} semanas novas disponíveis: {min(novas)} → {ultima}"
        )
        return (
            True,
            {"ultima_data_fim": ultima, "semanas_novas": novas},
            msg,
        )

    def baixar(self, novo_estado):
        semanas_novas: dict[str, dict] = novo_estado.get("semanas_novas", {})
        arquivos = []

        for data_fim in sorted(semanas_novas):
            urls = semanas_novas[data_fim]
            for tipo, url in urls.items():
                nome = url.split("/")[-1].split("?")[0]
                try:
                    path = self.baixar_arquivo(url, nome)
                    arquivos.append(path)
                except Exception as e:
                    print(f"    [aviso] Falha ao baixar {nome}: {e}")

            # Append revendas da semana ao Parquet
            revendas = next(
                (a for a in arquivos if f"revendas" in Path(a).name and data_fim in Path(a).name),
                None,
            )
            if revendas and _PARQUET.exists():
                try:
                    n = self._append_parquet(revendas)
                    print(f"    Parquet [{data_fim}]: +{n:,} linhas")
                except Exception as e:
                    print(f"    [aviso] Append Parquet [{data_fim}] falhou: {e}")

        return arquivos

    def _append_parquet(self, revendas_path: str) -> int:
        df = pd.read_excel(revendas_path, skiprows=9, dtype=str)

        df = df.rename(columns=_COLS_XLSX)
        cols_presentes = [c for c in _COLS_XLSX.values() if c in df.columns]
        df = df[cols_presentes].copy()

        df["estado"] = (
            df["estado_nome"].str.strip().str.upper().map(_ESTADO_PARA_UF)
        )
        df = df.drop(columns=["estado_nome"], errors="ignore")
        df["regiao"] = df["estado"].map(_UF_PARA_REGIAO)

        df["data_coleta"] = pd.to_datetime(df["data_coleta"], errors="coerce")
        df["preco_venda"] = (
            pd.to_numeric(
                df["preco_venda"].astype(str).str.replace(",", ".", regex=False),
                errors="coerce",
            ).astype("float32")
        )
        df["preco_compra"] = float("nan")

        for col in ("municipio", "produto", "bandeira", "unidade", "cnpj"):
            if col in df.columns:
                df[col] = df[col].str.strip()

        df = df.dropna(subset=["data_coleta", "produto"])

        # Dedup: skip dates already in Parquet
        existente       = pd.read_parquet(_PARQUET, columns=["data_coleta"])
        datas_existentes = set(existente["data_coleta"].dt.date.astype(str))
        datas_novas      = set(df["data_coleta"].dt.date.astype(str))
        a_adicionar      = datas_novas - datas_existentes

        if not a_adicionar:
            return 0

        df_novo = df[df["data_coleta"].dt.date.astype(str).isin(a_adicionar)]

        base         = pd.read_parquet(_PARQUET)
        df_novo      = df_novo.reindex(columns=base.columns)
        consolidado  = pd.concat([base, df_novo], ignore_index=True)
        consolidado.to_parquet(_PARQUET, index=False, compression="snappy")

        return len(df_novo)
