import subprocess
import sys
from pathlib import Path

from .base import BaseMonitor


class AnpPrecosProdutores(BaseMonitor):
    slug = "anp_precos_produtores"
    nome = "ANP Preços de Produtores e Importadores"
    url  = (
        "https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia"
        "/precos/precos-de-produtores-e-importadores-de-derivados-de-petroleo-e-biodiesel"
    )

    def verificar(self):
        soup  = self.fetch(self.url)
        data  = self.extrair_data_atualizacao(soup)
        links = self.get_file_links(soup, {".xls", ".xlsx"})

        # Apenas o arquivo da série corrente (a partir de 2013)
        # Nome do arquivo: "precos-medios-ponderados-semanais-2013.xls"
        file_url = next(
            (l for l in links if "ponderados-semanais-2013" in l.lower()),
            None,
        )
        last_mod = self.head_headers(file_url).get("Last-Modified", "") if file_url else ""

        estado = self.ler_estado()
        if estado.get("data_atualizacao") == data and estado.get("last_modified") == last_mod:
            return False, estado, ""
        if not data and not last_mod:
            return False, estado, ""

        return (
            True,
            {"data_atualizacao": data, "last_modified": last_mod, "file_url": file_url},
            f"Preços de produtores atualizados em {data or last_mod}",
        )

    def baixar(self, novo_estado):
        # consolidar.py:
        #   - reusa cache local de 2002-2012 (série fechada, não baixa de novo)
        #   - rebaixa o 2013+ (série corrente)
        #   - gera Parquet e remove o 2013+
        self._consolidar()

        # Retorna o Parquet como "arquivo baixado"
        parquet = self.dados_dir / "precos_produtores_consolidado.parquet"
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
                ultimas = [l for l in r.stdout.splitlines() if l.strip()][-5:]
                for l in ultimas:
                    print(f"    {l.strip()}")
            else:
                print(f"    [aviso] consolidar falhou (rc={r.returncode}):")
                print(f"    {r.stderr[:300]}")
        except Exception as e:
            print(f"    [aviso] consolidar erro: {e}")
