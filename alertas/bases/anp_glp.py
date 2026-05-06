import subprocess
import sys
from pathlib import Path

from .base import BaseMonitor


class AnpGlp(BaseMonitor):
    slug = "anp_glp"
    nome = "ANP Dados de Mercado GLP"
    url  = (
        "https://www.gov.br/anp/pt-br/assuntos/distribuicao-e-revenda"
        "/distribuidor/dados-de-mercado-glp"
    )

    def verificar(self):
        soup   = self.fetch(self.url)
        links  = self.get_file_links(soup, {".xlsx"})
        estado = self.ler_estado()

        file_url = next(
            (l for l in links if "relatorio_vendas_por_recipiente" in l.lower()),
            None,
        )

        if not file_url:
            data = self.extrair_data_atualizacao(soup)
            if not data or estado.get("data_atualizacao") == data:
                return False, estado, ""
            return True, {"data_atualizacao": data, "file_url": None}, f"GLP atualizado em {data}"

        filename = file_url.split("/")[-1].split("?")[0]
        if estado.get("ultimo_arquivo") == filename:
            return False, estado, ""

        data = self.extrair_data_atualizacao(soup)
        return (
            True,
            {"ultimo_arquivo": filename, "file_url": file_url, "data_atualizacao": data},
            f"Novo arquivo GLP: {filename}",
        )

    def baixar(self, novo_estado):
        # consolidar.py:
        #   - baixa o xlsx mais recente da página
        #   - lê as 2 sheets (formato antigo + novo)
        #   - gera Parquet com 4 categorias
        #   - remove o xlsx
        self._consolidar()

        parquet = self.dados_dir / "glp_consolidado.parquet"
        return [str(parquet)] if parquet.exists() else []

    def _consolidar(self):
        script = Path(__file__).parent.parent / "scripts" / self.slug / "consolidar.py"
        if not script.exists():
            print(f"    [aviso] consolidar.py não encontrado em {script}")
            return
        try:
            r = subprocess.run(
                [sys.executable, str(script)],
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                timeout=300,
            )
            if r.returncode == 0:
                ultimas = [l for l in r.stdout.splitlines() if l.strip()][-7:]
                for l in ultimas:
                    print(f"    {l.strip()}")
            else:
                print(f"    [aviso] consolidar falhou (rc={r.returncode}):")
                print(f"    {r.stderr[:300]}")
        except Exception as e:
            print(f"    [aviso] consolidar erro: {e}")
