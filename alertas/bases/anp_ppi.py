import subprocess
import sys
from pathlib import Path

from .base import BaseMonitor


class AnpPpi(BaseMonitor):
    slug = "anp_ppi"
    nome = "ANP Preços de Paridade de Importação (PPI)"
    url  = (
        "https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia"
        "/precos/precos-de-paridade-de-importacao"
    )

    def verificar(self):
        soup     = self.fetch(self.url)
        data     = self.extrair_data_atualizacao(soup)
        xlsx     = self.get_file_links(soup, {".xlsx"})
        file_url = next((l for l in xlsx if "ppi" in l.lower()), xlsx[0] if xlsx else None)
        last_mod = self.head_headers(file_url).get("Last-Modified", "") if file_url else ""

        estado = self.ler_estado()
        if estado.get("data_atualizacao") == data and estado.get("last_modified") == last_mod:
            return False, estado, ""
        if not data and not last_mod:
            return False, estado, ""

        return (
            True,
            {"data_atualizacao": data, "last_modified": last_mod, "file_url": file_url},
            f"PPI atualizado em {data or last_mod}",
        )

    def baixar(self, novo_estado):
        url = novo_estado.get("file_url")
        if not url:
            return []

        # Remove xlsx antigos — só queremos o mais recente em disco
        for antigo in self.dados_dir.glob("ppi_*.xlsx"):
            try:
                antigo.unlink()
                print(f"    [limpeza] removido {antigo.name}")
            except Exception as e:
                print(f"    [aviso] falha ao remover {antigo.name}: {e}")

        data = novo_estado.get("data_atualizacao", "").replace("/", "-").replace(" ", "_")
        path = self.baixar_arquivo(url, f"ppi_{data}.xlsx")

        # Reconstroi o Parquet a partir do xlsx recém-baixado
        self._consolidar()

        return [path]

    def _consolidar(self):
        script = Path(__file__).parent.parent / "scripts" / "anp_ppi" / "consolidar.py"
        if not script.exists():
            print(f"    [aviso] consolidar.py não encontrado em {script}")
            return
        try:
            r = subprocess.run(
                [sys.executable, str(script)],
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                timeout=180,
            )
            if r.returncode == 0:
                # Imprime apenas a última linha resumindo o resultado
                ultimas = [l for l in r.stdout.splitlines() if l.strip()][-3:]
                for l in ultimas:
                    print(f"    {l.strip()}")
            else:
                print(f"    [aviso] consolidar falhou (rc={r.returncode}):")
                print(f"    {r.stderr[:300]}")
        except Exception as e:
            print(f"    [aviso] consolidar erro: {e}")
