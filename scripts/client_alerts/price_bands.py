"""Client Alerts wrapper for the 'price_bands' base.

Thin entry point so an ETL can run a single base directly:

    python -m scripts.client_alerts.price_bands

Equivalent to:

    python -m scripts.client_alerts.run_base --source price_bands
"""
from scripts.client_alerts.run_base import run_one

if __name__ == "__main__":
    run_one("price_bands")
