"""Client Alerts wrapper for the 'vendas' base.

Thin entry point so an ETL can run a single base directly:

    python -m scripts.client_alerts.vendas

Equivalent to:

    python -m scripts.client_alerts.run_base --source vendas
"""
from scripts.client_alerts.run_base import run_one

if __name__ == "__main__":
    run_one("vendas")
