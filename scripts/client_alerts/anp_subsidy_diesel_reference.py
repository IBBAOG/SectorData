"""Client Alerts wrapper for the 'anp_subsidy_diesel_reference' base.

Thin entry point so an ETL can run a single base directly:

    python -m scripts.client_alerts.anp_subsidy_diesel_reference

Equivalent to:

    python -m scripts.client_alerts.run_base --source anp_subsidy_diesel_reference
"""
from scripts.client_alerts.run_base import run_one

if __name__ == "__main__":
    run_one("anp_subsidy_diesel_reference")
