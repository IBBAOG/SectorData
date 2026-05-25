"""
Detector: anp_sintese_semanal
Source: ANP Weekly Fuel Synthesis — scrapes ANP website for new PDF edition.
event_key pattern: edition:NNN/YYYY

This detector does an HTTP HEAD/GET to the ANP synthesis page and parses the
latest edition number. It stores the last-seen edition in alert_events.
NOTE: No Accept-Encoding: br (pegadinha #12 — Brotli not advertised).
"""
from __future__ import annotations

import logging
import re
import requests
from scripts.alerts.detection.base import BaseDetector, DetectedEvent
from scripts.alerts.supabase_client import get_client

logger = logging.getLogger(__name__)

# TODO(v1.1): auto-detect current year instead of hardcoding 2025 in the URL.
# When the year rolls over, this URL stops receiving new editions.
# Fix: try current-year URL first; fall back to previous year if HTTP 404.
ANP_SINTESE_URL = (
    "https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia"
    "/precos/precos-revenda-e-de-distribuicao-combustiveis/sintese-dos-precos"
    "-praticados/sintese-dos-precos-praticados-2025"
)

# Pattern: "Síntese dos Preços Praticados - NNN/YYYY"
_EDITION_RE = re.compile(r"(\d{3,4})/(\d{4})")


class AnpSinteseSemanal(BaseDetector):
    source_slug = "anp_sintese_semanal"

    def detect(self) -> list[DetectedEvent]:
        client = get_client()

        try:
            # Use explicit Accept-Encoding without br (pegadinha #12)
            resp = requests.get(
                ANP_SINTESE_URL,
                timeout=20,
                headers={
                    "Accept-Encoding": "gzip, deflate",
                    "User-Agent": "Mozilla/5.0 (compatible; SectorData-Alerts/1.0)",
                },
            )
            resp.raise_for_status()
        except Exception as exc:
            logger.warning("anp_sintese_semanal: HTTP request failed: %s", exc)
            return []

        # Find the highest edition number on the page
        matches = _EDITION_RE.findall(resp.text)
        if not matches:
            logger.warning("anp_sintese_semanal: no edition found on page")
            return []

        # Pick the highest edition number
        latest_num, latest_year = max(
            matches, key=lambda m: (int(m[1]), int(m[0]))
        )
        event_key = f"edition:{latest_num}/{latest_year}"

        existing = (
            client.table("alert_events")
            .select("id")
            .eq("source_slug", self.source_slug)
            .eq("event_key", event_key)
            .limit(1)
            .execute()
        )
        if existing.data:
            return []

        logger.info("anp_sintese_semanal: new edition detected — %s", event_key)
        return [
            DetectedEvent(
                event_key=event_key,
                payload={
                    "edition": f"{latest_num}/{latest_year}",
                    "source": "ANP Weekly Fuel Synthesis",
                    "url": ANP_SINTESE_URL,
                    "frontend_route": "/anp-sintese-semanal",
                    "message": f"ANP Weekly Synthesis edition {latest_num}/{latest_year} published",
                },
            )
        ]
