import base64
import os
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

SCOPES = ["https://www.googleapis.com/auth/gmail.send"]

_DIR = Path(__file__).parent
_CREDENTIALS = _DIR / "credentials.json"
_TOKEN = _DIR / "token.json"

# Destination email: env var takes priority (GitHub Actions secret ALERTAS_DEST_EMAIL),
# falls back to the hard-coded address for local development.
DESTINATARIO = os.environ.get("ALERTAS_DEST_EMAIL", "eduardo.mendes@itaubba.com")


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
            # NOTE: In GitHub Actions there is no browser, so if the refresh
            # token is revoked the run will still fail (no interactive flow
            # possible).  This try/except only helps local re-authentication.
            try:
                creds.refresh(Request())
                refreshed = True
            except RefreshError as e:
                # Refresh token revoked / invalid — fall through to interactive flow.
                print(f"  [auth] Refresh token revogado ({e}). Iniciando fluxo OAuth interativo...")
                creds = None
        if not refreshed:
            # Interactive OAuth flow — only works locally (GHA has no browser).
            flow = InstalledAppFlow.from_client_secrets_file(str(_CREDENTIALS), SCOPES)
            creds = flow.run_local_server(port=0)
        _TOKEN.write_text(creds.to_json())
    return build("gmail", "v1", credentials=creds)


def enviar_alerta(nome_base: str, mensagem: str, link: str = "", arquivo: str = ""):
    """Envia email de alerta para nova publicação de base de dados."""
    service = _get_service()

    assunto = f"[ALERTA ANP] {nome_base} — nova publicação"

    corpo = f"<h2>Nova publicação detectada</h2>\n<p><b>Base:</b> {nome_base}</p>\n<p><b>Detalhe:</b> {mensagem}</p>\n"
    if link:
        corpo += f'<p><b>Link:</b> <a href="{link}">{link}</a></p>\n'
    if arquivo:
        corpo += f"<p><b>Arquivo baixado:</b> <code>{arquivo}</code></p>\n"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = assunto
    msg["To"] = DESTINATARIO
    msg.attach(MIMEText(corpo, "html"))

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    service.users().messages().send(userId="me", body={"raw": raw}).execute()
    print(f"  [email] Enviado → {DESTINATARIO} | {assunto}")
