"""
Detector: anp_dados_abertos_ie
Source: ANP open data — Imports & Exports (DAIE) bulk file.
event_key pattern: file:<filename>

Scrapes the ANP open data portal for the latest I&E CSV/XLSX file name.
Uses filename as the event_key (changes on each release).
NOTE: No Accept-Encoding: br (pegadinha #12).
"""
from __future__ import annotations

import logging
import re
import requests
from scripts.alerts.detection.base import BaseDetector, DetectedEvent
from scripts.alerts.supabase_client import get_client

logger = logging.getLogger(__name__)

ANP_DAIE_URL = (
    "https://www.gov.br/anp/pt-br/assuntos/exportacao-e-importacao"
    "/exportacoes-e-importacoes-de-derivados-de-petroleo"
)

_FILE_RE = re.compile(r'href="([^"]*daie[^"]*\.(csv|xlsx|xls|zip))"', re.IGNORECASE)


class AnpDadosAbertosIE(BaseDetector):
    source_slug = "anp_dados_abertos_ie"

    def detect(self) -> list[DetectedEvent]:
        client = get_client()

        try:
            resp = requests.get(
                ANP_DAIE_URL,
                timeout=20,
                headers={
                    "Accept-Encoding": "gzip, deflate",
                    "User-Agent": "Mozilla/5.0 (compatible; SectorData-Alerts/1.0)",
                },
            )
            resp.raise_for_status()
        except Exception as exc:
            logger.warning("anp_dados_abertos_ie: HTTP request failed: %s", exc)
            return []

        matches = _FILE_RE.findall(resp.text)
        if not matches:
            logger.warning("anp_dados_abertos_ie: no file link found on page")
            return []

        # Use the last (most recent) matching href
        latest_href = matches[-1][0]
        filename = latest_href.rsplit("/", 1)[-1]
        event_key = f"file:{filename}"

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

        logger.info("anp_dados_abertos_ie: new file detected — %s", event_key)
        return [
            DetectedEvent(
                event_key=event_key,
                payload={
                    "filename": filename,
                    "url": latest_href if latest_href.startswith("http") else f"https://www.gov.br{latest_href}",
                    "source": "ANP Open Data — Imports & Exports",
                    "frontend_route": "/imports-exports",
                    "message": f"ANP I&E open data file updated: {filename}",
                },
            )
        ]
