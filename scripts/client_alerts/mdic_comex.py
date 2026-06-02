"""Client Alerts wrapper for the 'mdic_comex' base.

Thin entry point so an ETL can run a single base directly:

    python -m scripts.client_alerts.mdic_comex

Equivalent to:

    python -m scripts.client_alerts.run_base --source mdic_comex
"""
from scripts.client_alerts.run_base import run_one

if __name__ == "__main__":
    run_one("mdic_comex")
