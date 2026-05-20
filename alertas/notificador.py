import base64
import os
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

import requests as _requests

from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

SCOPES = ["https://www.googleapis.com/auth/gmail.send"]

_DIR = Path(__file__).parent
_CREDENTIALS = _DIR / "credentials.json"
_TOKEN = _DIR / "token.json"

_FALLBACK_EMAIL = os.environ.get("ALERTAS_DEST_EMAIL", "eduardo.mendes@itaubba.com")

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


def _get_service():
    """Build an authenticated Gmail API service.

    In GitHub Actions the credentials and token are written to disk from
    secrets (GMAIL_CREDENTIALS_JSON / GMAIL_TOKEN_JSON) before this runs.
    Locally they live in alertas/credentials.json and alertas/token.json.
    """
    creds = None
    if _TOKEN.exists():
        creds = Credentials.from_authorized_user_file(str(_TOKEN), SCOPES)
    if not creds or not creds.valid:
        refreshed = False
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                refreshed = True
            except RefreshError as e:
                print(f"  [auth] Refresh token revogado ({e}). Iniciando fluxo OAuth interativo...")
                creds = None
        if not refreshed:
            if os.environ.get("GITHUB_ACTIONS") == "true" or not os.environ.get("DISPLAY"):
                raise RuntimeError(
                    "Gmail OAuth token expired/revoked and cannot be refreshed in a "
                    "headless environment. Regenerate alertas/token.json locally "
                    "(python alertas/auth_gmail.py) and update the GMAIL_TOKEN_JSON "
                    "secret at https://github.com/IBBAOG/SectorData/settings/secrets/actions"
                )
            flow = InstalledAppFlow.from_client_secrets_file(str(_CREDENTIALS), SCOPES)
            creds = flow.run_local_server(port=0)
        _TOKEN.write_text(creds.to_json())
    return build("gmail", "v1", credentials=creds)


def enviar_alerta(nome_base: str, mensagem: str, link: str = "", arquivo: str = ""):
    """Envia email de alerta para nova publicação de base de dados."""
    service = _get_service()

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
    msg["To"] = to_header
    msg.attach(MIMEText(corpo, "html"))

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    service.users().messages().send(userId="me", body={"raw": raw}).execute()
    print(f"  [email] Enviado → {to_header} | {assunto}")
