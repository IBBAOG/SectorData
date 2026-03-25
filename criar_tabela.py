import pandas as pd
import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Carrega apenas as primeiras linhas para detectar colunas
df = pd.read_csv(
    "data/Liquidos_Vendas_Atual.csv",
    sep=None,
    engine="python",
    encoding="latin-1",
    on_bad_lines="skip",
    nrows=5
)

print("Colunas detectadas:")
for col in df.columns:
    tipo = df[col].dtype
    if pd.api.types.is_integer_dtype(tipo):
        tipo_sql = "bigint"
    elif pd.api.types.is_float_dtype(tipo):
        tipo_sql = "float8"
    else:
        tipo_sql = "text"
    print(f"  {col} → {tipo_sql}")

print("\nCopie o SQL acima e ajuste se necessário.")