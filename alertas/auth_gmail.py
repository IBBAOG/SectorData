#!/usr/bin/env python3
"""
Autorização Gmail — rode UMA VEZ para gerar token.json.

    python alertas/auth_gmail.py

Abre o browser para você aceitar as permissões. Depois disso
o monitor envia emails automaticamente sem precisar de interação.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from notificador import _get_service, DESTINATARIO

if __name__ == "__main__":
    _get_service()
    print(f"\nAutenticacao concluida! token.json salvo em alertas/")
    print(f"Alertas serao enviados para: {DESTINATARIO}")
