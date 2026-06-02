"""Client Alerts wrapper for the 'd_g_margins' base.

Thin entry point so an ETL can run a single base directly:

    python -m scripts.client_alerts.d_g_margins

Equivalent to:

    python -m scripts.client_alerts.run_base --source d_g_margins
"""
from scripts.client_alerts.run_base import run_one

if __name__ == "__main__":
    run_one("d_g_margins")
