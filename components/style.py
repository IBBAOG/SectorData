def aplicar_estilo():
    import streamlit as st
    st.markdown("""
    <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap');

    html, body, [class*="css"] {
        font-family: 'Inter', sans-serif;
        color: #1a1a1a;
    }

    /* Fundo branco geral */
    .stApp {
        background-color: #ffffff;
    }

    /* Sidebar */
    section[data-testid="stSidebar"] {
        background-color: #fafafa;
        border-right: 1px solid #e0e0e0;
    }

    /* Tags laranja nos multiselect selecionados */
    section[data-testid="stSidebar"] .stMultiSelect span[data-baseweb="tag"] {
        background-color: #f26522 !important;
        color: #ffffff !important;
    }

    /* Botões laranja — usados na sidebar e na tela de login */
    .stButton > button {
        background-color: #f26522 !important;
        color: #ffffff !important;
        border: none !important;
        border-radius: 6px !important;
        font-weight: 500 !important;
    }

    .stButton > button:hover {
        background-color: #d4561a !important;
    }

    /* Métricas com borda laranja à esquerda */
    [data-testid="metric-container"] {
        background-color: #ffffff;
        border: 1px solid #e0e0e0;
        border-left: 4px solid #f26522;
        border-radius: 8px;
        padding: 1rem 1.2rem;
        box-shadow: 0 1px 4px rgba(0,0,0,0.05);
    }

    /* Esconde menu e footer do Streamlit */
    #MainMenu { visibility: hidden; }
    footer { visibility: hidden; }
    </style>
    """, unsafe_allow_html=True)
