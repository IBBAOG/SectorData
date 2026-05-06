import re
import subprocess
import sys
from pathlib import Path

from .base import BaseMonitor


class AnpDadosAbertosIE(BaseMonitor):
    slug = "anp_dados_abertos_ie"
    nome = "ANP Dados Abertos — Importações/Exportações (Petróleo e Derivados)"
    url  = (
        "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos"
        "/importacoes-e-exportacoes"
    )

    _TARGETS = {
        "petroleo":  re.compile(r"importacoes-exportacoes-petroleo",  re.I),
        "derivados": re.compile(r"importacoes-exportacoes-derivados", re.I),
    }

    def verificar(self):
        soup     = self.fetch(self.url)
        csv_links = self.get_file_links(soup, {".csv"})
        estado   = self.ler_estado()

        encontrados = {}
        for key, pat in self._TARGETS.items():
            match = next((l for l in csv_links if pat.search(l)), None)
            if match:
                encontrados[key] = match

        if not encontrados:
            raise ValueError("Links petróleo/derivados não encontrados na página")

        novos = {}
        for key, url in encontrados.items():
            filename = url.split("/")[-1].split("?")[0]
            last_mod = self.head_headers(url).get("Last-Modified", "")
            prev = estado.get(key, {})
            if prev.get("filename") != filename or prev.get("last_modified") != last_mod:
                novos[key] = {"url": url, "filename": filename, "last_modified": last_mod}

        if not novos:
            return False, estado, ""

        novo_estado = {**estado, **novos}
        nomes = " + ".join(novos.keys())
        return True, novo_estado, f"Dataset(s) atualizado(s): {nomes}"

    def baixar(self, novo_estado):
        # consolidar.py baixa os 2 CSVs e gera Parquet, depois remove os CSVs
        self._consolidar()

        parquet = self.dados_dir / "dados_abertos_ie_consolidado.parquet"
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
