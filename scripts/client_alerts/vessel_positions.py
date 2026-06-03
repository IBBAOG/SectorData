"""Client Alerts wrapper for the 'vessel_positions' base.

Thin entry point so an ETL can run a single base directly:

    python -m scripts.client_alerts.vessel_positions

Equivalent to:

    python -m scripts.client_alerts.run_base --source vessel_positions
"""
from scripts.client_alerts.run_base import run_one

if __name__ == "__main__":
    run_one("vessel_positions")
