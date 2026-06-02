"""Client Alerts wrapper for the 'port_arrivals' base.

Thin entry point so an ETL can run a single base directly:

    python -m scripts.client_alerts.port_arrivals

Equivalent to:

    python -m scripts.client_alerts.run_base --source port_arrivals
"""
from scripts.client_alerts.run_base import run_one

if __name__ == "__main__":
    run_one("port_arrivals")
