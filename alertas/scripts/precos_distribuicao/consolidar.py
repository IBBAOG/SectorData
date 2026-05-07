"""
Wrapper de execucao manual para a base precos_distribuicao.

Uso:
    python alertas/scripts/precos_distribuicao/consolidar.py

O que faz:
- Instancia PrecosDistribuicao e chama run().
- Se ha novidade, envia email via notificador e salva estado.
- Esta base nao baixa arquivos locais — os dados vivem no Supabase.

Requer variaveis de ambiente:
    SUPABASE_URL          URL do projeto Supabase
    SUPABASE_SERVICE_KEY  Chave de servico (service_role)
"""

import sys
from pathlib import Path

# Adiciona raiz do repo e alertas/ ao path
_REPO_ROOT    = Path(__file__).parent.parent.parent.parent
_ALERTAS_ROOT = Path(__file__).parent.parent.parent

sys.path.insert(0, str(_REPO_ROOT))
sys.path.insert(0, str(_ALERTAS_ROOT))

from bases.precos_distribuicao import PrecosDistribuicao  # type: ignore


def main():
    monitor = PrecosDistribuicao()
    teve_novidade = monitor.run()
    if not teve_novidade:
        print("[precos_distribuicao] Nenhuma novidade detectada — nenhum email enviado.")
    else:
        print("[precos_distribuicao] Novidade detectada e email enviado.")


if __name__ == "__main__":
    main()
