# Detection package.
# Each module registers its detector class via the BaseDetector metaclass.
# Import all detector modules here so the registry is populated on package import.

from scripts.alerts.detection.base import BaseDetector, DetectedEvent, DETECTOR_REGISTRY  # noqa: F401

# Trigger registration by importing every detector module.
from scripts.alerts.detection import (  # noqa: F401
    anp_ppi,
    anp_precos_produtores,
    anp_glp,
    anp_lpc,
    anp_precos_distribuicao,
    anp_sintese_semanal,
    anp_painel_combustiveis,
    anp_dados_abertos_ie,
    mdic_comex,
    sindicom,
    anp_cdp_producao,
    anp_desembaracos_daie,
    anp_cdp_diaria,
    anp_voip,
    vendas,
    navios_diesel,
    ais_candidates,
    d_g_margins,
    price_bands,
    anp_subsidy,
)

__all__ = ["BaseDetector", "DetectedEvent", "DETECTOR_REGISTRY"]
