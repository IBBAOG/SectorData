import subprocess
import sys
from datetime import date
from pathlib import Path

from .base import BaseMonitor


class AnpDesembaracos(BaseMonitor):
    slug = "anp_desembaracos"
    nome = "ANP Desembaraços de Importações"
    url  = (
        "https://www.gov.br/anp/pt-br/assuntos/importacoes-e-exportacoes"
        "/relatorio-de-desembaracos-de-importacoes-de-petroleo-gas-derivados-e-biocombustiveis"
    )

    def verificar(self):
        soup  = self.fetch(self.url)
        data  = self.extrair_data_atualizacao(soup)
        ano   = str(date.today().year)
        links = self.get_file_links(soup, {".xlsx"})

        file_url = next(
            (l for l in links if f"desembaraco-{ano}" in l.lower()),
            next((l for l in links if ano in l), links[-1] if links else None),
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
            f"Desembaraços atualizados em {data}",
        )

    def baixar(self, novo_estado):
        # consolidar.py:
        #   - reusa cache local de anos fechados (não baixa de novo)
        #   - rebaixa o ano corrente
        #   - gera Parquet e remove o xlsx do ano corrente
        self._consolidar()

        parquet = self.dados_dir / "desembaracos_consolidado.parquet"
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
                timeout=600,
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
