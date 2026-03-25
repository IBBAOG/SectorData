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

# Renomeia colunas
df.columns = [
    "ano", "mes", "agente_regulado", "codigo_produto",
    "nome_produto", "descricao_produto", "regiao_origem",
    "uf_origem", "regiao_destinatario", "uf_destino",
    "mercado_destinatario", "quantidade_produto"
]

# Converte quantidade
df["quantidade_produto"] = (
    df["quantidade_produto"]
    .astype(str)
    .str.replace(",", ".", regex=False)
    .str.replace("[^0-9.]", "", regex=True)
)
df["quantidade_produto"] = pd.to_numeric(df["quantidade_produto"], errors="coerce")

# Segmento baseado no mercado_destinatario
MAPA_SEGMENTO = {
    "CONSUMIDOR FINAL":                        "B2B",
    "Posto de Combustíveis - Bandeirado":      "Retail",
    "Posto de Combustíveis - Bandeira Branca": "Retail",
    "TRR":                                     "TRR",
    "TRRNI":                                   "TRR",
}
df["segmento"] = df["mercado_destinatario"].map(MAPA_SEGMENTO).fillna("Outros")

# Classificação
MAPA_CLASSIFICACAO = {
    "VIBRA ENERGIA S.A":                                        "Vibra",
    "IPIRANGA PRODUTOS DE PETRÓLEO S.A":                        "Ipiranga",
    "RAIZEN S.A.":                                              "Raizen",
    "RAIZEN MIME COMBUSTIVEIS S/A.":                            "Raizen",
    "PETRÓLEO SABBÁ S.A.":                                      "Raizen",
    "CENTROESTE DISTRIBUICAO DE DERIVADOS DE PETROLEO S/A":     "Raizen",
}
df["classificacao"] = df["agente_regulado"].map(MAPA_CLASSIFICACAO).fillna("Others")

# Coluna date
df["date"] = (
    df["ano"].astype(str) + "-" + df["mes"].astype(str).str.zfill(2) + "-01"
)

# Remove colunas irrelevantes (mantém nome_produto)
df = df.drop(columns=["codigo_produto", "descricao_produto", "regiao_origem",
                       "uf_origem", "agente_regulado"])

# Agrupa por dimensões + combustível + classificação, somando quantidade
COLUNAS_GRUPO = [
    "ano", "mes", "date",
    "nome_produto",
    "regiao_destinatario", "uf_destino", "mercado_destinatario",
    "classificacao", "segmento"
]
df = df.groupby(COLUNAS_GRUPO, as_index=False)["quantidade_produto"].sum()
df = df[df["quantidade_produto"].notna() & (df["quantidade_produto"] != float("inf"))]
df = df.where(pd.notnull(df), None)

print(f"Total de linhas: {len(df):,}")

# Importa em lotes
LOTE = 1000
total_lotes = math.ceil(len(df) / LOTE)

for i in range(total_lotes):
    inicio = i * LOTE
    fim = inicio + LOTE
    lote = df.iloc[inicio:fim].to_dict(orient="records")
    supabase.table("market_share").insert(lote).execute()
    print(f"  Lote {i+1}/{total_lotes} importado ({min(fim, len(df)):,} linhas)")

print("\nImportação concluída!")
