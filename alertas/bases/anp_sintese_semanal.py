import re
from .base import BaseMonitor


class AnpSinteseSemanal(BaseMonitor):
    slug = "anp_sintese_semanal"
    nome = "ANP Síntese Semanal de Preços dos Combustíveis"
    url  = (
        "https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia"
        "/precos/sintese-semanal-do-comportamento-dos-precos-dos-combustiveis"
    )

    _EDICAO_RE = re.compile(r'Edi[çc][ãa]o\s+N[°º]?\s*(\d+)/(\d{4})', re.IGNORECASE)

    def verificar(self):
        soup   = self.fetch(self.url)
        estado = self.ler_estado()

        matches = self._EDICAO_RE.findall(soup.get_text())
        if matches:
            # Sort by (ano DESC, num DESC) so the most recent year+edition wins
            edicoes = sorted(
                [(int(n), int(a)) for n, a in matches],
                key=lambda x: (x[1], x[0]),
                reverse=True,
            )
            num, ano = edicoes[0]
            chave = f"{num}/{ano}"
            if estado.get("ultima_edicao") == chave:
                return False, estado, ""

            # Find PDF links that are in the current-year/edition folder
            ano_str = str(ano)
            all_pdf = self.get_file_links(soup, {".pdf"})
            # Prefer PDFs whose URL contains the current year
            pdf_links = [l for l in all_pdf if ano_str in l][:3]
            if not pdf_links:
                pdf_links = [l for l in all_pdf if "sintese" in l.lower()][:3]

            return (
                True,
                {"ultima_edicao": chave, "pdf_links": pdf_links},
                f"Nova edição: Nº {chave}",
            )

        # Fallback: page update date
        data = self.extrair_data_atualizacao(soup)
        if not data or estado.get("data_atualizacao") == data:
            return False, estado, ""
        pdf_links = [l for l in self.get_file_links(soup, {".pdf"}) if "sintese" in l.lower()][:3]
        return (
            True,
            {"data_atualizacao": data, "pdf_links": pdf_links},
            f"Síntese semanal atualizada em {data}",
        )

    def baixar(self, novo_estado):
        arquivos = []
        for url in novo_estado.get("pdf_links", []):
            nome = url.split("/")[-1].split("?")[0]
            arquivos.append(self.baixar_arquivo(url, nome))
        return arquivos
