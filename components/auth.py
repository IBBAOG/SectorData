import streamlit as st
from supabase import create_client
import os
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = st.secrets.get("SUPABASE_URL") if hasattr(st, "secrets") else None
SUPABASE_URL = SUPABASE_URL or os.getenv("SUPABASE_URL")
SUPABASE_KEY = st.secrets.get("SUPABASE_KEY") if hasattr(st, "secrets") else None
SUPABASE_KEY = SUPABASE_KEY or os.getenv("SUPABASE_KEY")

LOGO_URL = "https://upload.wikimedia.org/wikipedia/commons/thumb/8/84/Ita%C3%BA_logo.svg/320px-Ita%C3%BA_logo.svg.png"

def login():
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    st.markdown("""
    <style>
    #MainMenu { visibility: hidden; }
    footer { visibility: hidden; }
    .stButton > button {
        background-color: #f26522 !important;
        color: #ffffff !important;
        border: none !important;
        border-radius: 6px !important;
        font-weight: 600 !important;
        width: 100% !important;
    }
    .stButton > button:hover {
        background-color: #d4561a !important;
    }
    </style>
    """, unsafe_allow_html=True)

    col1, col2, col3 = st.columns([1, 1.2, 1])
    with col2:
        st.markdown("<br><br>", unsafe_allow_html=True)
        st.image(LOGO_URL, width=80)
        st.markdown("### Acesse sua conta")
        st.markdown("Entre com suas credenciais para continuar.")
        st.markdown("---")

        email = st.text_input("E-mail", placeholder="nome@email.com")
        senha = st.text_input("Senha", type="password", placeholder="••••••••")

        st.markdown("<br>", unsafe_allow_html=True)
        if st.button("Continuar →", use_container_width=True):
            try:
                resposta = supabase.auth.sign_in_with_password({
                    "email": email,
                    "password": senha
                })
                st.session_state["usuario"] = resposta.user
                st.session_state["token"] = resposta.session.access_token
                st.rerun()
            except Exception:
                st.error("E-mail ou senha incorretos.")

def logout():
    st.sidebar.image(LOGO_URL, width=60)
    st.sidebar.markdown("---")

    usuario = st.session_state.get("usuario")
    if usuario:
        st.sidebar.markdown(
            f"<small style='color:#666;'>Logado como<br/>"
            f"<b style='color:#1a1a1a;'>{usuario.email}</b></small>",
            unsafe_allow_html=True
        )
        st.sidebar.markdown("<br>", unsafe_allow_html=True)

    if st.sidebar.button("🚪 Sair", use_container_width=True):
        st.session_state.clear()
        st.rerun()

def requer_login():
    if "usuario" not in st.session_state:
        login()
        st.stop()
    else:
        logout()