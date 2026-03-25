import streamlit as st
from supabase import create_client
import os
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

def login():
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    st.title("📊 Meu Dashboard")
    st.markdown("### Acesso restrito — faça login para continuar")
    st.markdown("---")

    col1, col2, col3 = st.columns([1, 2, 1])
    with col2:
        email = st.text_input("E-mail")
        senha = st.text_input("Senha", type="password")

        if st.button("Entrar", use_container_width=True):
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
    if st.sidebar.button("🚪 Sair"):
        st.session_state.clear()
        st.rerun()

def requer_login():
    if "usuario" not in st.session_state:
        login()
        st.stop()
    else:
        logout()