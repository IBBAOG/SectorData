"""Client Alerts wrapper for the 'anp_precos_distribuicao' base.

Thin entry point so an ETL can run a single base directly:

    python -m scripts.client_alerts.anp_precos_distribuicao

Equivalent to:

    python -m scripts.client_alerts.run_base --source anp_precos_distribuicao
"""
from scripts.client_alerts.run_base import run_one

if __name__ == "__main__":
    run_one("anp_precos_distribuicao")
