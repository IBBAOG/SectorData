import importlib.util
import os
import subprocess
import sys
from datetime import date
from pathlib import Path

from .base import BaseMonitor

# Resolve path relativo a este arquivo: alertas/bases/X.py → ../../scripts/extractors/anp_painel_powerbi.py
_EXTRACTOR_PATH = Path(__file__).parent.parent.parent / "scripts" / "extractors" / "anp_painel_powerbi.py"


def _powerbi_periodo() -> str | None:
    """Queries the ANP Power BI API and returns the latest period as 'YYYY-MM', or None on failure."""
    if not _EXTRACTOR_PATH.exists():
        print("    [aviso] Extrator Power BI não encontrado — sinal PBI ignorado")
        return None
    try:
        spec = importlib.util.spec_from_file_location("anp_extrator", _EXTRACTOR_PATH)
        ext  = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(ext)

        _orig = sys.stdout
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
        try:
            resource_key, model_id, app_ctx = ext.resolve_config()
            ano, mes = ext.get_ultimo_mes(resource_key, model_id, app_ctx)
        finally:
            sys.stdout.close()
            sys.stdout = _orig

        mes_num = ext.MESES_ORDER.index(mes) + 1
        return f"{ano}-{mes_num:02d}"
    except Exception as e:
        print(f"    [aviso] Power BI check falhou: {e}")
        return None


class AnpPainelCombustiveis(BaseMonitor):
    slug = "anp_painel_combustiveis"
    nome = "ANP Painel — Mercado Brasileiro de Combustíveis Líquidos"
    url  = (
        "https://www.gov.br/anp/pt-br/centrais-de-conteudo/paineis-dinamicos-da-anp"
        "/paineis-dinamicos-do-abastecimento"
        "/painel-dinamico-do-mercado-brasileiro-de-combustiveis-liquidos"
    )
    _ZIP_URL = (
        "https://www.gov.br/anp/pt-br/centrais-de-conteudo"
        "/dados-abertos/arquivos/mdpg/liquidos.zip"
    )

    def verificar(self):
        soup     = self.fetch(self.url)
        data     = self.extrair_data_atualizacao(soup)
        last_mod = self.head_headers(self._ZIP_URL).get("Last-Modified", "")
        pbi      = _powerbi_periodo()

        estado = self.ler_estado()

        zip_mudou = (
            (data     and estado.get("data_atualizacao") != data) or
            (last_mod and estado.get("last_modified")    != last_mod)
        )
        pbi_mudou = pbi and estado.get("powerbi_periodo") != pbi

        if not zip_mudou and not pbi_mudou:
            return False, estado, ""

        if not data and not last_mod and not pbi:
            return False, estado, ""

        partes = []
        if zip_mudou:
            partes.append(f"ZIP atualizado em {data or '?'}")
        if pbi_mudou:
            partes.append(f"Power BI avancou para {pbi}")

        novo_estado = {
            "data_atualizacao": data,
            "last_modified":    last_mod,
            "powerbi_periodo":  pbi,
        }
        return True, novo_estado, " | ".join(partes)

    def baixar(self, novo_estado):
        # consolidar.py:
        #   - baixa o liquidos.zip
        #   - extrai os 6 CSVs em pasta temporária
        #   - gera 3 Parquets (vendas, entregas, importacoes_distribuidores)
        #   - remove ZIP, pasta temp e CSVs (mantém só os Parquets)
        self._consolidar()

        gerados = [self.dados_dir / "vendas.parquet",
                   self.dados_dir / "entregas.parquet",
                   self.dados_dir / "importacoes_distribuidores.parquet"]
        return [str(p) for p in gerados if p.exists()]

    def _consolidar(self):
        script = Path(__file__).parent.parent / "scripts" / self.slug / "consolidar.py"
        if not script.exists():
            print(f"    [aviso] consolidar.py não encontrado em {script}")
            return
        try:
            r = subprocess.run(
                [sys.executable, str(script)],
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                timeout=900,
            )
            if r.returncode == 0:
                ultimas = [l for l in r.stdout.splitlines() if l.strip()][-10:]
                for l in ultimas:
                    print(f"    {l.strip()}")
            else:
                print(f"    [aviso] consolidar falhou (rc={r.returncode}):")
                print(f"    {r.stderr[:300]}")
        except Exception as e:
            print(f"    [aviso] consolidar erro: {e}")
