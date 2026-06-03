"""Client Alerts wrapper for the 'import_candidates' base.

Thin entry point so an ETL can run a single base directly:

    python -m scripts.client_alerts.import_candidates

Equivalent to:

    python -m scripts.client_alerts.run_base --source import_candidates
"""
from scripts.client_alerts.run_base import run_one

if __name__ == "__main__":
    run_one("import_candidates")
