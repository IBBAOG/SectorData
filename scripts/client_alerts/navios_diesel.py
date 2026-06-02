"""Client Alerts wrapper for the 'navios_diesel' base.

Thin entry point so an ETL can run a single base directly:

    python -m scripts.client_alerts.navios_diesel

Equivalent to:

    python -m scripts.client_alerts.run_base --source navios_diesel
"""
from scripts.client_alerts.run_base import run_one

if __name__ == "__main__":
    run_one("navios_diesel")
