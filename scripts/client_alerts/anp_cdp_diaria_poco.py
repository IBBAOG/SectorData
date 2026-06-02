"""Client Alerts wrapper for the 'anp_cdp_diaria_poco' base.

Thin entry point so an ETL can run a single base directly:

    python -m scripts.client_alerts.anp_cdp_diaria_poco

Equivalent to:

    python -m scripts.client_alerts.run_base --source anp_cdp_diaria_poco
"""
from scripts.client_alerts.run_base import run_one

if __name__ == "__main__":
    run_one("anp_cdp_diaria_poco")
