import streamlit as st
import streamlit.components.v1 as components
import json
from components.auth import requer_login
from components.style import aplicar_estilo
from components.database import carregar_opcoes, carregar_dados_pivot

st.set_page_config(
    page_title="Itaú BBA | Tabela Dinâmica",
    page_icon="https://upload.wikimedia.org/wikipedia/commons/thumb/8/84/Ita%C3%BA_logo.svg/32px-Ita%C3%BA_logo.svg.png",
    layout="wide",
)

aplicar_estilo()
requer_login()

st.markdown("""
<div style="font-size:1.5rem;font-weight:600;color:#1a1a1a;margin-bottom:0.25rem;">
    Tabela Dinâmica
</div>
<div style="font-size:0.85rem;color:#888;margin-bottom:1rem;">
    Arraste os campos para linhas e colunas para montar sua análise
</div>
""", unsafe_allow_html=True)
st.markdown("---")

# ─── Filtros ──────────────────────────────────────────────────────────────────
opcoes = carregar_opcoes()

st.sidebar.markdown("## Filtros")
anos           = st.sidebar.multiselect("Ano",           opcoes.get("anos", []),  default=[])
meses          = st.sidebar.multiselect("Mês",           opcoes.get("meses", []), default=[])
classificacoes = st.sidebar.multiselect("Classificação", ["Vibra", "Ipiranga", "Raizen", "Others"], default=[])

st.sidebar.markdown("---")
st.sidebar.info("Aplique ao menos um filtro para garantir carregamento rápido.")

if not anos and not classificacoes and not meses:
    st.info("Selecione pelo menos um filtro na sidebar para carregar os dados.")
    st.stop()

# ─── Carregamento ─────────────────────────────────────────────────────────────
with st.spinner("Carregando dados..."):
    df = carregar_dados_pivot(tuple(anos), tuple(meses), tuple(classificacoes))

if df.empty:
    st.warning("Nenhum dado para os filtros selecionados.")
    st.stop()

st.caption(f"{len(df):,} linhas carregadas.")

df = df.rename(columns={
    "ano":                  "Ano",
    "mes":                  "Mês",
    "agente_regulado":      "Agente Regulado",
    "nome_produto":         "Produto",
    "regiao_destinatario":  "Região Dest.",
    "uf_destino":           "UF Dest.",
    "mercado_destinatario": "Mercado",
    "classificacao":        "Classificação",
    "quantidade_produto":   "Quantidade (mil m³)",
})

# ─── Renderiza pivot table via JS (sem dependência de IPython) ────────────────
data_json = df.to_json(orient="records", force_ascii=False)

html = f"""
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/pivottable/2.23.0/pivot.min.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/jqueryui/1.13.2/themes/base/jquery-ui.min.css">
  <style>
    body {{ font-family: 'Inter', sans-serif; font-size: 13px; margin: 8px; }}
    .pvtUi select {{ font-size: 12px; }}
    .pvtFilterBox {{ z-index: 9999; }}
  </style>
</head>
<body>
  <div id="pivot"></div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.0/jquery.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jqueryui/1.13.2/jquery-ui.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pivottable/2.23.0/pivot.min.js"></script>
  <script>
    $(function() {{
      var data = {data_json};
      $("#pivot").pivotUI(data, {{
        rows: ["Classificação"],
        cols: ["Ano"],
        vals: ["Quantidade (mil m³)"],
        aggregatorName: "Sum",
        rendererName: "Table",
        unusedAttrsVertical: true,
      }});
    }});
  </script>
</body>
</html>
"""

components.html(html, height=700, scrolling=True)
