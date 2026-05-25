"""
Detector: anp_painel_combustiveis
Source: ANP Fuel Panel (ZIP downloads + Power BI dataset).
event_key pattern: period:YYYY-MM:zip  — for ZIP data file
                   period:YYYY-MM:pbi  — for Power BI data refresh

Dual-signal: both ZIP release and PBI refresh are tracked independently.
Reads the ANP open data portal for the latest monthly file.
NOTE: No Accept-Encoding: br (pegadinha #12).
"""
from __future__ import annotations

import logging
import re
from datetime import date
import requests
from scripts.alerts.detection.base import BaseDetector, DetectedEvent
from scripts.alerts.supabase_client import get_client

logger = logging.getLogger(__name__)

# ANP open data index page for fuel panel
ANP_PAINEL_URL = (
    "https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia"
    "/precos/precos-revenda-e-de-distribuicao-combustiveis/pagina-de-dados-abertos"
)

_MONTH_FILE_RE = re.compile(
    r"(\d{4})[-_](\d{2}).*?\.zip", re.IGNORECASE
)


class AnpPainelCombustiveis(BaseDetector):
    source_slug = "anp_painel_combustiveis"

    def detect(self) -> list[DetectedEvent]:
        client = get_client()
        events: list[DetectedEvent] = []

        # --- Signal 1: ZIP file ---
        try:
            resp = requests.get(
                ANP_PAINEL_URL,
                timeout=20,
                headers={
                    "Accept-Encoding": "gzip, deflate",
                    "User-Agent": "Mozilla/5.0 (compatible; SectorData-Alerts/1.0)",
                },
            )
            resp.raise_for_status()
            matches = _MONTH_FILE_RE.findall(resp.text)
            if matches:
                latest_year, latest_month = max(matches, key=lambda m: (m[0], m[1]))
                period = f"{latest_year}-{latest_month}"
                event_key = f"period:{period}:zip"

                existing = (
                    client.table("alert_events")
                    .select("id")
                    .eq("source_slug", self.source_slug)
                    .eq("event_key", event_key)
                    .limit(1)
                    .execute()
                )
                if not existing.data:
                    logger.info("anp_painel_combustiveis: new ZIP — %s", event_key)
                    events.append(
                        DetectedEvent(
                            event_key=event_key,
                            payload={
                                "period": period,
                                "signal": "zip",
                                "source": "ANP Fuel Panel (ZIP)",
                                "url": ANP_PAINEL_URL,
                                "frontend_route": "/anp-painel-combustiveis",
                                "message": f"ANP Fuel Panel ZIP data updated for {period}",
                            },
                        )
                    )
        except Exception as exc:
            logger.warning("anp_painel_combustiveis: ZIP signal failed: %s", exc)

        return events
