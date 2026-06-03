import os
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import requests as _requests

_FALLBACK_EMAIL = os.environ.get("ALERTAS_DEST_EMAIL", "eduardo.mendes@itaubba.com")

# Gmail SMTP + App Password — the ACTIVE email backend for the legacy ANP alerts.
#
# Why SMTP + an App Password (not the OAuth Gmail API): the OAuth refresh token
# kept expiring/getting revoked (the Google Cloud app is in Testing mode, so its
# refresh tokens are short-lived → `invalid_grant`). An App Password over plain
# SMTP (smtp.gmail.com:587, STARTTLS) never expires and needs no token plumbing —
# just two env vars: the login address and the app password.
#
#   GMAIL_ADDRESS       — the Gmail account used as the SMTP login user. Must match
#                         the From address (Gmail rewrites a mismatched From).
#                         Defaults to ibbaogproject@gmail.com.
#   GMAIL_APP_PASSWORD  — a 16-character Google App Password (generated at
#                         https://myaccount.google.com/apppasswords). Never expires.
#   ALERTAS_SENDER_EMAIL — the From header. Must be the account that owns the app
#                         password. Defaults to "Alertas ANP <ibbaogproject@gmail.com>".
_GMAIL_ADDRESS = os.environ.get("GMAIL_ADDRESS", "ibbaogproject@gmail.com")
_GMAIL_APP_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD", "")
_SENDER_EMAIL = os.environ.get(
    "ALERTAS_SENDER_EMAIL", "Alertas ANP <ibbaogproject@gmail.com>"
)

_SMTP_HOST = "smtp.gmail.com"
_SMTP_PORT = 587
_SMTP_TIMEOUT = 30  # seconds — never hang a CI step on a stuck connection

# Configure no ambiente local ou no .env do alertas:
#   SUPABASE_URL=https://<ref>.supabase.co
#   SUPABASE_SERVICE_KEY=<service-role key>
_SUPABASE_URL = (
    os.environ.get("SUPABASE_URL")
    or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    or ""
).strip()
# .strip() é essencial: GitHub Secrets podem ter \n ou whitespace invisível,
# e a lib `requests` rejeita header values com return characters
# ("Invalid leading whitespace, reserved character(s), or return character(s)").
_SUPABASE_SERVICE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()


def get_alert_recipients() -> list[str]:
    """Busca destinatários ativos de alertas no Supabase. Fallback: email hardcoded."""
    fallback = [_FALLBACK_EMAIL]

    if not _SUPABASE_URL or not _SUPABASE_SERVICE_KEY:
        print(
            "[alertas] Aviso: SUPABASE_URL ou SUPABASE_SERVICE_KEY não configurados. "
            "Usando fallback."
        )
        return fallback

    try:
        base_url = _SUPABASE_URL.rstrip("/")
        resp = _requests.get(
            f"{base_url}/rest/v1/alert_recipients",
            headers={
                "apikey": _SUPABASE_SERVICE_KEY,
                "Authorization": f"Bearer {_SUPABASE_SERVICE_KEY}",
            },
            params={"is_active": "eq.true", "select": "email"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        # Sanitize: strip whitespace/newlines de cada email (defensivo)
        emails = [row["email"].strip() for row in data if row.get("email")]
        emails = [e for e in emails if e]
        if emails:
            print(f"[alertas] {len(emails)} destinatário(s) carregado(s) do Supabase: {emails}")
            return emails
        print("[alertas] Nenhum destinatário ativo no Supabase. Usando fallback.")
        return fallback
    except Exception as exc:
        print(
            f"[alertas] Aviso: não foi possível buscar destinatários ({exc}). "
            "Usando fallback."
        )
        return fallback


def enviar_alerta(nome_base: str, mensagem: str, link: str = "", arquivo: str = ""):
    """Envia email de alerta para nova publicação de base de dados via Gmail SMTP."""
    if not _GMAIL_APP_PASSWORD:
        raise RuntimeError(
            "GMAIL_APP_PASSWORD não configurado. Gere um App Password em "
            "https://myaccount.google.com/apppasswords e configure o secret "
            "GMAIL_APP_PASSWORD (confirme que GMAIL_ADDRESS bate com a conta dona "
            "do app password)."
        )

    destinatarios = get_alert_recipients()
    to_header = ", ".join(destinatarios)

    assunto = f"[ALERTA ANP] {nome_base} — nova publicação"

    corpo = f"<h2>Nova publicação detectada</h2>\n<p><b>Base:</b> {nome_base}</p>\n<p><b>Detalhe:</b> {mensagem}</p>\n"
    if link:
        corpo += f'<p><b>Link:</b> <a href="{link}">{link}</a></p>\n'
    if arquivo:
        corpo += f"<p><b>Arquivo baixado:</b> <code>{arquivo}</code></p>\n"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = assunto
    msg["From"] = _SENDER_EMAIL
    msg["To"] = to_header
    msg.attach(MIMEText(corpo, "html"))

    # smtp.gmail.com:587 + STARTTLS + login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD).
    # A fresh connection per send is simpler and robust enough for this low-volume
    # monitor. The From must equal GMAIL_ADDRESS or Gmail rewrites it.
    with smtplib.SMTP(_SMTP_HOST, _SMTP_PORT, timeout=_SMTP_TIMEOUT) as smtp:
        smtp.starttls(context=ssl.create_default_context())
        smtp.login(_GMAIL_ADDRESS, _GMAIL_APP_PASSWORD)
        smtp.send_message(msg)
    print(f"  [email] Enviado → {to_header} | {assunto}")
