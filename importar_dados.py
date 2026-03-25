import pandas as pd
import os
import math
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))

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

# Converte quantidade para float (troca vírgula por ponto se necessário)
df["quantidade_produto"] = (
    df["quantidade_produto"]
    .astype(str)
    .str.replace(",", ".", regex=False)
    .str.replace("[^0-9.]", "", regex=True)
)
df["quantidade_produto"] = pd.to_numeric(df["quantidade_produto"], errors="coerce")

# Remove linhas completamente vazias
df = df.dropna(how="all")

# Substitui NaN por None (compatível com JSON do Supabase)
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