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
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap');
    html, body, [class*="css"] { font-family: 'Inter', sans-serif; }

    .stApp {
        background-color: #1a1a1a;
    }

    .login-container {
        max-width: 420px;
        margin: 0 auto;
        background: #ffffff;
        border-radius: 12px;
        padding: 2.5rem;
        box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    }

    .login-logo {
        text-align: center;
        margin-bottom: 1.5rem;
    }

    .login-title {
        font-size: 1.4rem;
        font-weight: 600;
        color: #1a1a1a;
        margin-bottom: 0.3rem;
    }

    .login-subtitle {
        font-size: 0.9rem;
        color: #666;
        margin-bottom: 1.8rem;
    }

    .stTextInput > div > div > input {
        border: 1px solid #ddd !important;
        border-radius: 6px !important;
        padding: 0.6rem 0.8rem !important;
        font-size: 0.95rem !important;
    }

    .stTextInput > div > div > input:focus {
        border-color: #f26522 !important;
        box-shadow: 0 0 0 2px rgba(242,101,34,0.15) !important;
    }

    .stButton > button {
        background-color: #f26522 !important;
        color: #ffffff !important;
        border: none !important;
        border-radius: 6px !important;
        font-weight: 600 !important;
        font-size: 1rem !important;
        padding: 0.65rem 1rem !important;
        width: 100% !important;
        transition: background-color 0.2s !important;
    }

    .stButton > button:hover {
        background-color: #d4561a !important;
    }

    #MainMenu { visibility: hidden; }
    footer { visibility: hidden; }
    </style>
    """, unsafe_allow_html=True)

    # Fundo escuro com card centralizado
    st.markdown("""
    <div style="min-height: 100vh; display: flex; align-items: center;
                justify-content: center; padding: 2rem;">
    """, unsafe_allow_html=True)

    col1, col2, col3 = st.columns([1, 1.4, 1])
    with col2:
        st.markdown(f"""
        <div class="login-container">
            <div class="login-logo">
                <img src="{LOGO_URL}" width="80"/>
                <div style="font-size:0.75rem;color:#888;margin-top:4px;
                            letter-spacing:0.1em;text-transform:uppercase;">
                    Dashboard
                </div>
            </div>
            <div class="login-title">Acesse sua conta</div>
            <div class="login-subtitle">Entre com suas credenciais para continuar</div>
        </div>
        """, unsafe_allow_html=True)

        email = st.text_input("E-mail", placeholder="nome@email.com")
        senha = st.text_input("Senha", type="password", placeholder="••••••••")

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
    with st.sidebar:
        st.markdown(f"""
        <div style="display:flex;align-items:center;gap:10px;padding:1rem 0 0.5rem;">
            <img src="{LOGO_URL}" width="36"/>
            <span style="color:#f26522;font-weight:600;font-size:1rem;">Dashboard</span>
        </div>
        <hr style="border-color:#333;margin:0.5rem 0 1rem;"/>
        """, unsafe_allow_html=True)

        usuario = st.session_state.get("usuario")
        if usuario:
            st.markdown(f"""
            <div style="font-size:0.75rem;color:#aaa;margin-bottom:1rem;">
                Logado como<br/>
                <span style="color:#fff;font-weight:500;">
                    {usuario.email}
                </span>
            </div>
            """, unsafe_allow_html=True)

        if st.button("🚪 Sair", use_container_width=True):
            st.session_state.clear()
            st.rerun()

def requer_login():
    if "usuario" not in st.session_state:
        login()
        st.stop()
    else:
        logout()