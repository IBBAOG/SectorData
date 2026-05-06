import csv
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

from .base import BaseMonitor

_ALERTAS_DIR  = Path(__file__).parent.parent
_SCRIPTS_DIR  = _ALERTAS_DIR.parent / "scripts"
_DADOS_DIR    = _ALERTAS_DIR.parent / "DADOS" / "anp_cdp_producao_poco"

# Assume Frente B criou este módulo no path indicado.
# Se não existir em runtime, o ImportError será propagado com mensagem clara.
sys.path.insert(0, str(_SCRIPTS_DIR / "pipelines" / "anp" / "cdp"))
try:
    from _replay import replay_download  # type: ignore
except ImportError as _replay_import_err:
    replay_download = None  # type: ignore
    _REPLAY_MISSING_MSG = str(_replay_import_err)

# GitHub dispatch settings
_GITHUB_REPO  = "IBBAOG/SectorData"
_WORKFLOW_ID  = "etl_anp_cdp.yml"
_DEBOUNCE_HOURS = 6


def _mes_esperado() -> str:
    hoje = datetime.now(timezone.utc)
    mes  = hoje.month - 2
    ano  = hoje.year
    if mes <= 0:
        mes += 12
        ano -= 1
    return f"{mes:02d}/{ano}"


class AnpCdpProducaoPoco(BaseMonitor):
    slug = "anp_cdp_producao_poco"
    nome = "ANP CDP — Producao por Poco"
    url  = (
        "https://cdp.anp.gov.br/ords/r/cdp_apex/"
        "consulta-dados-publicos-cdp/consulta-producao-por-poco"
    )

    def __init__(self):
        super().__init__()
        _DADOS_DIR.mkdir(parents=True, exist_ok=True)

    # ── Supabase session ──────────────────────────────────────────────────────

    def _get_session_from_db(self, slug: str) -> dict | None:
        """
        Lê a linha de alertas_session para o slug. Retorna None se:
        - Linha inexistente
        - expires_at < now (sessão expirada)
        """
        if self._sb is None:
            print(f"[{self.slug}]   Supabase não configurado — não é possível ler sessão.")
            return None
        try:
            res = (
                self._sb.table("alertas_session")
                .select("*")
                .eq("base", slug)
                .single()
                .execute()
            )
        except Exception as e:
            print(f"[{self.slug}]   Erro ao consultar alertas_session: {e}")
            return None

        row = res.data if res else None
        if not row:
            return None

        # Verificar expiração
        expires_at_str = row.get("expires_at")
        if expires_at_str:
            try:
                expires_at = datetime.fromisoformat(expires_at_str.replace("Z", "+00:00"))
                if datetime.now(timezone.utc) >= expires_at:
                    print(f"[{self.slug}]   Sessão expirada em {expires_at_str}.")
                    return None
            except ValueError:
                pass  # Se não conseguir parsear, trata como válida e continua

        return row

    # ── Workflow dispatch com debounce ────────────────────────────────────────

    def _trigger_capture_workflow_with_debounce(self, slug: str) -> bool:
        """
        Dispara etl_anp_cdp.yml via GitHub API com debounce de 6h.
        Usa metadata.last_capture_attempt no Supabase para controlar debounce.
        Retorna True se disparou, False se ainda dentro do debounce.
        """
        pat = os.environ.get("GITHUB_PAT_WORKFLOW_DISPATCH", "")
        if not pat:
            print(f"[{self.slug}]   GITHUB_PAT_WORKFLOW_DISPATCH não configurado — não é possível disparar workflow.")
            return False

        # Verificar debounce via estado local
        estado = self._estado_atual
        last_attempt_str = estado.get("last_capture_attempt")
        if last_attempt_str:
            try:
                last_attempt = datetime.fromisoformat(last_attempt_str.replace("Z", "+00:00"))
                elapsed_hours = (datetime.now(timezone.utc) - last_attempt).total_seconds() / 3600
                if elapsed_hours < _DEBOUNCE_HOURS:
                    return False
            except ValueError:
                pass

        # Disparar workflow
        url = f"https://api.github.com/repos/{_GITHUB_REPO}/actions/workflows/{_WORKFLOW_ID}/dispatches"
        headers = {
            "Authorization": f"Bearer {pat}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
        }
        try:
            resp = requests.post(url, json={"ref": "main"}, headers=headers, timeout=15)
            resp.raise_for_status()
            # Atualizar timestamp do debounce no estado
            estado["last_capture_attempt"] = datetime.now(timezone.utc).isoformat()
            self.salvar_estado(estado)
            print(f"[{self.slug}]   Workflow {_WORKFLOW_ID} disparado via GitHub API.")
            return True
        except requests.HTTPError as e:
            print(f"[{self.slug}]   Erro ao disparar workflow: {e}")
            return False

    # ── Download dos CSVs do mês via _replay ─────────────────────────────────

    def _baixar_csvs_mes(self, session_data: dict, periodo: str) -> dict:
        """
        Chama replay_download para cada ambiente (M, S, T).
        Retorna {"M": path, "S": path, "T": path} ou levanta RuntimeError.
        """
        if replay_download is None:
            raise ImportError(
                f"Frente B não criou scripts/pipelines/anp/cdp/_replay.py ainda. "
                f"Erro original: {_REPLAY_MISSING_MSG}"
            )

        download_dir = str(_DADOS_DIR / "_downloads")
        os.makedirs(download_dir, exist_ok=True)

        resultado = {}
        for ambiente in ("M", "S", "T"):
            res = replay_download(
                session_data=session_data,
                periodo=periodo,
                ambiente=ambiente,
                output_dir=download_dir,
            )
            if res in ("expired", "error") or res is None:
                raise RuntimeError(
                    f"replay_download retornou '{res}' para ambiente={ambiente}, periodo={periodo}."
                )
            resultado[ambiente] = res

        return resultado

    # ── Extração de campos do CSV ─────────────────────────────────────────────

    def _extrair_campos(self, csv_path: str) -> set:
        campos = set()
        try:
            with open(csv_path, encoding="utf-8", errors="ignore") as f:
                amostra = f.read(1024)
                f.seek(0)
                sep = ";" if amostra.count(";") >= amostra.count(",") else ","
                reader = csv.DictReader(f, delimiter=sep)
                for row in reader:
                    for col in ("CAMPO", "Campo", "campo", "NM_CAMPO"):
                        val = (row.get(col) or "").strip()
                        if val:
                            campos.add(val)
                            break
        except Exception as e:
            print(f"    [aviso] Erro ao parsear CSV: {e}")
        return campos

    # ── Lógica principal ──────────────────────────────────────────────────────

    def run(self) -> bool:
        print(f"[{self.slug}] {self.nome}...")

        # Carregar estado atual para uso em _trigger_capture_workflow_with_debounce
        self._estado_atual = self.ler_estado()

        # 1. Tentar obter sessão do Supabase
        session_row = self._get_session_from_db(self.slug)

        if session_row is None:
            # Sem sessão válida — tenta disparar o capture workflow (com debounce)
            if self._trigger_capture_workflow_with_debounce(self.slug):
                print(f"[{self.slug}]   Sessão expirada/ausente; capture workflow disparado. Pulando esta rodada.")
            else:
                print(f"[{self.slug}]   Sessão expirada/ausente; capture já foi disparado nas últimas {_DEBOUNCE_HOURS}h (debounce). Pulando.")
            return False

        # 2. Verificar se a sessão é do mês esperado
        periodo = _mes_esperado()
        captured_periodo = (session_row.get("metadata") or {}).get("captured_periodo")
        if periodo != captured_periodo:
            print(
                f"[{self.slug}]   Sessão é de {captured_periodo!r}, "
                f"mês esperado é {periodo!r}. Pulando até nova captura."
            )
            return False

        # 3. Baixar CSVs do mês usando _replay
        try:
            csvs = self._baixar_csvs_mes(session_row["session"], periodo)
        except Exception as e:
            print(f"[{self.slug}]   ERRO ao baixar CSVs: {e}")
            return False

        # 4. Comparar campos por ambiente com baseline no estado
        novidades = []
        novo_estado = dict(self._estado_atual)
        for ambiente, csv_path in csvs.items():
            baseline_key = f"campos_{ambiente.lower()}"  # campos_m, campos_s, campos_t
            baseline = set(self._estado_atual.get(baseline_key, []))
            atuais   = self._extrair_campos(csv_path)
            novos    = sorted(atuais - baseline)
            if novos:
                novidades.append((ambiente, novos))
                novo_estado[baseline_key] = sorted(atuais)

        if not novidades:
            print(f"[{self.slug}]   >> Sem campos novos")
            return False

        # 5. Enviar alerta(s)
        sys.path.insert(0, str(_ALERTAS_DIR))
        from notificador import enviar_alerta  # type: ignore

        total_campos = sum(len(novos) for _, novos in novidades)

        if total_campos <= 10:
            # 1 email por campo (granular — CEO quer cada novo campo)
            for ambiente, novos in novidades:
                for campo in novos:
                    print(f"[{self.slug}]   >> Novo campo: {campo} ({ambiente})")
                    enviar_alerta(
                        f"ANP CDP — Novo campo identificado: {campo} ({ambiente})",
                        (
                            f"Campo '{campo}' apareceu pela primeira vez no ambiente "
                            f"{ambiente} para o período {periodo}."
                        ),
                        link=self.url,
                    )
        else:
            # Digest único quando há mais de 10 campos novos
            print(f"[{self.slug}]   >> {total_campos} campos novos — enviando digest")
            msg = f"{total_campos} campos novos no período {periodo}:\n\n"
            for ambiente, novos in novidades:
                msg += f"## {ambiente}\n" + "\n".join(f"  - {c}" for c in novos) + "\n\n"
            enviar_alerta(
                f"ANP CDP — {total_campos} campos novos no período {periodo}",
                msg,
                link=self.url,
            )

        # 6. Salvar estado atualizado
        novo_estado["ultimo_periodo"] = periodo
        self.salvar_estado(novo_estado)
        self.registrar_historico(
            f"{total_campos} campo(s) novo(s) em {periodo}",
            novo_estado,
            list(csvs.values()),
        )

        # 7. Atualizar last_used_at na tabela alertas_session
        if self._sb is not None:
            try:
                self._sb.table("alertas_session").update(
                    {"last_used_at": datetime.now(timezone.utc).isoformat()}
                ).eq("base", self.slug).execute()
            except Exception as e:
                print(f"[{self.slug}]   [aviso] Falha ao atualizar last_used_at: {e}")

        return True

    # ── Stubs para interface abstrata (lógica completa está em run()) ─────────

    def verificar(self):
        return False, {}, ""

    def baixar(self, novo_estado):
        return []
