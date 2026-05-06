"""
Compatibility shim — kept after the R1-R9 reorganization (commit 9ae02889).

Original location: scripts/anp_auto.py (deleted in R1-R9).
Current location: scripts/pipelines/anp/cdp/01_extract.py (numeric prefix
prevents normal `import 01_extract`, hence this shim).

Used by alertas/bases/anp_cdp_producao_poco.py for the ANP CDP captcha-solver
download flow. Without this shim, the alertas_monitor.yml workflow fails with
ModuleNotFoundError when iterating over the anp_cdp_producao_poco base.
"""
import importlib.util
from pathlib import Path

_extract_path = Path(__file__).parent / "pipelines" / "anp" / "cdp" / "01_extract.py"
_spec = importlib.util.spec_from_file_location("_anp_cdp_extract_legacy", _extract_path)
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)

# Re-export the symbols expected by alertas/bases/anp_cdp_producao_poco.py
extract_one = _module.extract_one
SESSION_FILENAME = _module.SESSION_FILENAME
