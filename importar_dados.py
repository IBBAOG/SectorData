import pandas as pd
import os
import math
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_KEY"))

print("Carregando CSV...")
df = pd.read_csv(
    "data/Liquidos_Vendas_Atual.csv",
    sep=None,
    engine="python",
    encoding="latin-1",
    on_bad_lines="skip"
)

# Renomeia colunas para bater com a tabela do Supabase
df.columns = [
    "ano", "mes", "agente_regulado", "codigo_produto",
    "nome_produto", "descricao_produto", "regiao_origem",
    "uf_origem", "regiao_destinatario", "uf_destino",
    "mercado_destinatario", "quantidade_produto"
]

# Remove colunas irrelevantes
df = df.drop(columns=["codigo_produto", "descricao_produto", "regiao_origem", "uf_origem"])

# 1. Converte quantidade para float antes de qualquer agregação
df["quantidade_produto"] = (
    df["quantidade_produto"]
    .astype(str)
    .str.replace(",", ".", regex=False)
    .str.replace("[^0-9.]", "", regex=True)
)
df["quantidade_produto"] = pd.to_numeric(df["quantidade_produto"], errors="coerce")

# 2. Gera coluna date a partir de ano e mes
df["date"] = pd.to_datetime(df["ano"].astype(str) + "-" + df["mes"].astype(str).str.zfill(2) + "-01").dt.strftime("%Y-%m-%d")

# 3. Segmento baseado no mercado_destinatario
MAPA_SEGMENTO = {
    "CONSUMIDOR FINAL":                          "B2B",
    "POSTO DE COMBUSTÍVEIS - BANDEIRADO":        "Retail",
    "POSTO DE COMBUSTÍVEIS - BANDEIRA BRANCA":   "Retail",
    "TRR":                                       "TRR",
    "TRRNI":                                     "TRR",
}
df["segmento"] = (
    df["mercado_destinatario"]
    .str.strip()
    .str.upper()
    .map(MAPA_SEGMENTO)
    .fillna("Outros")
)

# 4. Classificação baseada no agente_regulado
MAPA_CLASSIFICACAO = {
    "VIBRA ENERGIA S.A":                                        "Vibra",
    "IPIRANGA PRODUTOS DE PETRÓLEO S.A":                        "Ipiranga",
    "RAIZEN S.A.":                                              "Raizen",
    "RAIZEN MIME COMBUSTIVEIS S/A.":                            "Raizen",
    "PETRÓLEO SABBÁ S.A.":                                      "Raizen",
    "CENTROESTE DISTRIBUICAO DE DERIVADOS DE PETROLEO S/A":     "Raizen",
}
df["classificacao"] = df["agente_regulado"].map(MAPA_CLASSIFICACAO).fillna("Others")

# 5. Agrupa pelas dimensões relevantes somando a quantidade
COLUNAS_GRUPO = [
    "ano", "mes", "date", "agente_regulado", "nome_produto",
    "regiao_destinatario", "uf_destino", "mercado_destinatario",
    "classificacao", "segmento"
]
df = df.groupby(COLUNAS_GRUPO, as_index=False)["quantidade_produto"].sum()

# 6. Remove linhas com quantidade inválida e substitui NaN/inf por None
df = df[df["quantidade_produto"].notna() & (df["quantidade_produto"] != float("inf"))]
df = df.where(pd.notnull(df), None)

print(f"Total de linhas: {len(df):,}")

# Importa em lotes de 1000 linhas
LOTE = 1000
total_lotes = math.ceil(len(df) / LOTE)

for i in range(total_lotes):
    inicio = i * LOTE
    fim = inicio + LOTE
    lote = df.iloc[inicio:fim].to_dict(orient="records")

    supabase.table("vendas").insert(lote).execute()
    print(f"  Lote {i+1}/{total_lotes} importado ({fim if fim < len(df) else len(df):,} linhas)")

print("\nImportação concluída!")