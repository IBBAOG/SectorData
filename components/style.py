def aplicar_estilo():
    import streamlit as st
    st.markdown("""
    <style>
    /* ─── Fonte e fundo geral ─── */
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap');

    html, body, [class*="css"] {
        font-family: 'Inter', sans-serif;
    }

    .stApp {
        background-color: #f5f5f5;
    }

    /* ─── Header superior ─── */
    header[data-testid="stHeader"] {
        background-color: #1a1a1a;
        border-bottom: 2px solid #f26522;
    }

    /* ─── Sidebar ─── */
    section[data-testid="stSidebar"] {
        background-color: #1a1a1a;
        border-right: 1px solid #333;
    }

    section[data-testid="stSidebar"] * {
        color: #ffffff !important;
    }

    section[data-testid="stSidebar"] .stMultiSelect > div {
        background-color: #2a2a2a !important;
        border: 1px solid #444 !important;
        border-radius: 6px !important;
    }

    section[data-testid="stSidebar"] .stMultiSelect span {
        background-color: #f26522 !important;
        color: #ffffff !important;
        border-radius: 4px !important;
    }

    /* ─── Botões ─── */
    .stButton > button {
        background-color: #f26522 !important;
        color: #ffffff !important;
        border: none !important;
        border-radius: 6px !important;
        font-weight: 500 !important;
        padding: 0.5rem 1rem !important;
        transition: background-color 0.2s ease !important;
    }

    .stButton > button:hover {
        background-color: #d4561a !important;
    }

    /* ─── Métricas ─── */
    [data-testid="metric-container"] {
        background-color: #ffffff;
        border: 1px solid #e0e0e0;
        border-left: 4px solid #f26522;
        border-radius: 8px;
        padding: 1rem 1.2rem;
        box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    }

    [data-testid="metric-container"] label {
        color: #666666 !important;
        font-size: 0.8rem !important;
        font-weight: 500 !important;
        text-transform: uppercase !important;
        letter-spacing: 0.05em !important;
    }

    [data-testid="metric-container"] [data-testid="stMetricValue"] {
        color: #1a1a1a !important;
        font-size: 1.6rem !important;
        font-weight: 600 !important;
    }

    /* ─── Títulos ─── */
    h1, h2, h3 {
        color: #1a1a1a !important;
        font-weight: 600 !important;
    }

    /* ─── Divisor ─── */
    hr {
        border-color: #e0e0e0 !important;
    }

    /* ─── Tabela ─── */
    [data-testid="stDataFrame"] {
        border-radius: 8px;
        overflow: hidden;
        border: 1px solid #e0e0e0;
    }

    /* ─── Spinner ─── */
    .stSpinner > div {
        border-top-color: #f26522 !important;
    }

    /* ─── Esconde menu e footer padrão do Streamlit ─── */
    #MainMenu { visibility: hidden; }
    footer { visibility: hidden; }
    </style>
    """, unsafe_allow_html=True)