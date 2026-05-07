"""
Base de alertas: ANP Precos de Distribuicao de Combustiveis

Fonte: tabela `anp_precos_distribuicao` no Supabase (populada pelo pipeline ETL).
Deteccao: compara data_referencia maxima por periodicidade (semanal/mensal)
com o estado salvo em alertas/estado/precos_distribuicao.json.

Nao faz scraping — e uma base leve (so consulta Supabase via supabase-py).
"""

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from .base import BaseMonitor

_ALERTAS_DIR = Path(__file__).parent.parent
_URL_FONTE = (
    "https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia"
    "/precos/precos-de-distribuicao-de-combustiveis"
)


class PrecosDistribuicao(BaseMonitor):
    slug = "precos_distribuicao"
    nome = "ANP — Precos de Distribuicao de Combustiveis"
    url  = _URL_FONTE

    # ── consulta ao Supabase ──────────────────────────────────────────────────

    def _query_max_datas(self) -> dict:
        """
        Retorna dict com data_referencia maxima por periodicidade e lista de
        produtos distintos atualizados, ou {} se Supabase nao configurado.

        Exemplo de retorno:
          {
            "semanal": {"data_max": "2026-04-27", "produtos": ["Gasolina C", "Etanol"]},
            "mensal":  {"data_max": "2026-04-01", "produtos": ["GLP"]},
          }
        """
        if self._sb is None:
            print(f"  [{self.slug}] Supabase nao configurado — nao e possivel consultar.")
            return {}

        resultado = {}
        for periodicidade in ("semanal", "mensal"):
            try:
                res = (
                    self._sb.table("anp_precos_distribuicao")
                    .select("data_referencia, produto")
                    .eq("periodicidade", periodicidade)
                    .order("data_referencia", desc=True)
                    .limit(200)
                    .execute()
                )
                rows = res.data if res else []
                if not rows:
                    continue

                # data maxima e produtos distintos nessa data
                data_max = rows[0]["data_referencia"]
                if isinstance(data_max, datetime):
                    data_max = data_max.strftime("%Y-%m-%d")
                else:
                    data_max = str(data_max)[:10]

                produtos_na_data = sorted({
                    r["produto"]
                    for r in rows
                    if str(r["data_referencia"])[:10] == data_max
                    and r.get("produto")
                })

                resultado[periodicidade] = {
                    "data_max": data_max,
                    "produtos": produtos_na_data,
                }
            except Exception as e:
                print(f"  [{self.slug}] Erro ao consultar periodicidade={periodicidade}: {e}")

        return resultado

    # ── interface BaseMonitor ─────────────────────────────────────────────────

    def verificar(self):
        """
        Retorna (tem_novidade: bool, novo_estado: dict, mensagem: str).

        Compara data_max de cada periodicidade com o estado salvo.
        Retorna True se qualquer periodicidade tiver data nova.
        """
        datas = self._query_max_datas()
        if not datas:
            return False, self.ler_estado(), ""

        estado = self.ler_estado()
        ultima_semanal = estado.get("ultima_data_semanal")
        ultima_mensal  = estado.get("ultima_data_mensal")

        nova_semanal = datas.get("semanal", {}).get("data_max")
        nova_mensal  = datas.get("mensal",  {}).get("data_max")

        atualizou_semanal = nova_semanal and nova_semanal != ultima_semanal
        atualizou_mensal  = nova_mensal  and nova_mensal  != ultima_mensal

        if not atualizou_semanal and not atualizou_mensal:
            return False, estado, ""

        # Monta mensagem descritiva
        partes = []
        if atualizou_semanal:
            partes.append(f"semanal ate {nova_semanal}")
        if atualizou_mensal:
            partes.append(f"mensal ate {nova_mensal}")
        mensagem = "Precos de distribuicao atualizados: " + "; ".join(partes)

        # Novo estado com todas as datas consolidadas
        produtos_atualizados = sorted(set(
            datas.get("semanal", {}).get("produtos", []) +
            datas.get("mensal",  {}).get("produtos", [])
        ))

        novo_estado = {
            "ultima_data_semanal": nova_semanal or ultima_semanal,
            "ultima_data_mensal":  nova_mensal  or ultima_mensal,
            "ultima_verificacao":  datetime.now(timezone.utc).isoformat(),
            "produtos_atualizados": produtos_atualizados,
        }

        return True, novo_estado, mensagem

    def baixar(self, novo_estado: dict) -> list:
        """
        Esta base nao baixa arquivos — os dados ja estao no Supabase via pipeline ETL.
        Retorna lista vazia para satisfazer a interface.
        """
        return []

    # ── run() customizado para emitir payload estruturado ────────────────────

    def run(self) -> bool:
        print(f"[{self.slug}] {self.nome}...")

        try:
            tem_novidade, novo_estado, mensagem = self.verificar()
        except Exception as e:
            print(f"  >> ERRO ao verificar: {e}")
            return False

        if not tem_novidade:
            print(f"  >> Sem novidade")
            return False

        print(f"  >> NOVO: {mensagem}")

        self.salvar_estado(novo_estado)
        self.registrar_historico(mensagem, novo_estado, [])

        sys.path.insert(0, str(_ALERTAS_DIR))
        from notificador import enviar_alerta  # type: ignore

        # Monta corpo do email com os detalhes estruturados
        data_semanal = novo_estado.get("ultima_data_semanal", "—")
        data_mensal  = novo_estado.get("ultima_data_mensal",  "—")
        produtos     = novo_estado.get("produtos_atualizados", [])
        produtos_str = ", ".join(produtos) if produtos else "N/D"

        corpo = (
            f"Novos dados de precos de distribuicao publicados pela ANP.\n\n"
            f"Data mais recente (semanal): {data_semanal}\n"
            f"Data mais recente (mensal):  {data_mensal}\n"
            f"Produtos: {produtos_str}\n\n"
            f"Os dados ja estao disponiveis no banco (tabela anp_precos_distribuicao)."
        )

        enviar_alerta(
            self.nome,
            corpo,
            link=self.url,
            arquivo="",
        )

        return True
