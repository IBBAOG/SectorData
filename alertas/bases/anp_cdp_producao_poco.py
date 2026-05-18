import csv
import json
import os
import subprocess
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
_DEBOUNCE_HOURS = 0.5


def _mes_esperado() -> str:
    hoje = datetime.now(timezone.utc)
    mes  = hoje.month - 1
    ano  = hoje.year
    if mes <= 0:
        mes += 12
        ano -= 1
    return f"{mes:02d}/{ano}"


class _SessionExpiredError(RuntimeError):
    """Raised when replay_download signals the APEX session is expired on the server side.

    Callers should treat this differently from a generic download error: an expired session
    requires re-capture via Selenium (etl_anp_cdp.yml), while a generic error may be
    transient (network, parsing) and can be retried on the next run.
    """


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

    def _get_sessions_by_ambiente(self, slug: str) -> dict:
        """
        Le rows de alertas_session para o slug, indexadas por ambiente valido (M/S/T)
        e nao expirado. Retorna dict parcial -- pode ter 0, 1, 2 ou 3 entradas.

        Caller deve decidir o que fazer baseado no que voltou:
        - dict vazio -> nenhuma session -> dispara recaptura
        - dict parcial -> ANP pode nao ter dados em todos os ambientes; processa o que tem
        - dict cheio -> todos os 3 ambientes prontos
        """
        if self._sb is None:
            print(f"[{self.slug}]   Supabase nao configurado -- nao e possivel ler sessao.")
            return {}
        try:
            res = (
                self._sb.table("alertas_session")
                .select("*")
                .eq("base", slug)
                .in_("ambiente", ["M", "S", "T"])
                .execute()
            )
        except Exception as e:
            print(f"[{self.slug}]   Erro ao consultar alertas_session: {e}")
            return {}

        rows = res.data if res else []
        by_amb = {row["ambiente"]: row for row in rows if row.get("ambiente") in ("M", "S", "T")}

        # Filtrar expirados (mas nao tudo-ou-nada -- so remove o expirado)
        now_utc = datetime.now(timezone.utc)
        for amb in list(by_amb.keys()):
            expires_at_str = by_amb[amb].get("expires_at")
            if not expires_at_str:
                continue
            try:
                expires_at = datetime.fromisoformat(expires_at_str.replace("Z", "+00:00"))
                if now_utc >= expires_at:
                    print(f"[{self.slug}]   Sessao {amb} expirada em {expires_at_str} -- removendo.")
                    del by_amb[amb]
            except ValueError:
                pass

        return by_amb

    # ── Workflow dispatch com debounce ────────────────────────────────────────

    def _trigger_capture_workflow_with_debounce(self, slug: str) -> bool:
        """
        Dispara etl_anp_cdp.yml via GitHub API com debounce de 6h.
        Usa metadata.last_capture_attempt no Supabase para controlar debounce.
        Retorna True se disparou, False se ainda dentro do debounce.
        """
        pat = os.environ.get("WORKFLOW_DISPATCH_PAT", "")
        if not pat:
            print(f"[{self.slug}]   WORKFLOW_DISPATCH_PAT nao configurado -- nao e possivel disparar workflow.")
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
            resp = requests.post(
                url,
                json={"ref": "main", "inputs": {"capture_session": "true"}},
                headers=headers,
                timeout=15,
            )
            resp.raise_for_status()
            # Atualizar timestamp do debounce no estado
            estado["last_capture_attempt"] = datetime.now(timezone.utc).isoformat()
            self.salvar_estado(estado)
            print(f"[{self.slug}]   Workflow {_WORKFLOW_ID} disparado via GitHub API.")
            return True
        except requests.HTTPError as e:
            print(f"[{self.slug}]   Erro ao disparar workflow: {e}")
            return False

    # ── Download dos CSVs do mes via _replay ──────────────────────────────────

    def _baixar_csvs_mes(self, sessions_by_ambiente: dict, periodo: str) -> dict:
        """
        Chama replay_download usando a session especifica de cada ambiente.
        sessions_by_ambiente = {"M": row, "S": row, "T": row} (cada row tem .session jsonb).
        Retorna {"M": path, "S": path, "T": path}.
        Levanta _SessionExpiredError quando replay retorna status="expired" (re-capture needed).
        Levanta RuntimeError para outros erros de download.
        """
        if replay_download is None:
            raise ImportError(
                f"Frente B nao criou scripts/pipelines/anp/cdp/_replay.py ainda. "
                f"Erro original: {_REPLAY_MISSING_MSG}"
            )

        download_dir = str(_DADOS_DIR / "_downloads")
        os.makedirs(download_dir, exist_ok=True)

        resultado = {}
        for ambiente in sorted(sessions_by_ambiente.keys()):
            row = sessions_by_ambiente[ambiente]
            session_data = row["session"]
            res = replay_download(
                session_data=session_data,
                periodo=periodo,
                ambiente=ambiente,
                output_dir=download_dir,
            )
            # replay_download returns a ReplayResult dataclass (status, csv_path, message).
            # Guard against both the dataclass API and old string-return fallback.
            if hasattr(res, "status"):
                # ReplayResult dataclass
                if res.status == "expired":
                    raise _SessionExpiredError(
                        f"replay_download returned status='expired' for "
                        f"ambiente={ambiente}, periodo={periodo}: {res.message}"
                    )
                if res.status == "error":
                    raise RuntimeError(
                        f"replay_download returned status='error' for "
                        f"ambiente={ambiente}, periodo={periodo}: {res.message}"
                    )
                csv_path = res.csv_path
            else:
                # Legacy: function returned a string path or sentinel string
                if res == "expired":
                    raise _SessionExpiredError(
                        f"replay_download returned 'expired' for ambiente={ambiente}, periodo={periodo}."
                    )
                if res in ("error", None):
                    raise RuntimeError(
                        f"replay_download returned '{res}' for ambiente={ambiente}, periodo={periodo}."
                    )
                csv_path = res

            if not csv_path:
                raise RuntimeError(
                    f"replay_download returned no csv_path for ambiente={ambiente}, periodo={periodo}."
                )
            resultado[ambiente] = csv_path

        return resultado

    # ── Extracao de campos do CSV ─────────────────────────────────────────────

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

    # ── Logica principal ──────────────────────────────────────────────────────

    def run(self) -> bool:
        print(f"[{self.slug}] {self.nome}...")

        # Carregar estado atual para uso em _trigger_capture_workflow_with_debounce
        self._estado_atual = self.ler_estado()

        # 1. Tentar obter sessions (M, S, T) do Supabase -- pode vir parcial
        sessions = self._get_sessions_by_ambiente(self.slug)
        periodo = _mes_esperado()

        # 2. Filtrar sessions cujo captured_periodo bate com o mes esperado.
        # Sessions de meses passados sao consideradas invalidas pra esta rodada.
        sessions_validas = {}
        for amb, row in sessions.items():
            captured_periodo = (row.get("metadata") or {}).get("captured_periodo")
            if captured_periodo == periodo:
                sessions_validas[amb] = row
            else:
                print(
                    f"[{self.slug}]   Session {amb} e de {captured_periodo!r}, "
                    f"mes esperado e {periodo!r} -- descartada."
                )

        # 3. Se 0 sessions validas, dispara recaptura (com debounce)
        if not sessions_validas:
            if self._trigger_capture_workflow_with_debounce(self.slug):
                print(f"[{self.slug}]   Sem sessions validas para {periodo}; capture workflow disparado.")
            else:
                print(f"[{self.slug}]   Sem sessions validas; capture ja disparado nas ultimas {_DEBOUNCE_HOURS}h (debounce). Pulando.")
            return False

        # 4. Logar o que vai processar (parcial ou cheio)
        ambientes_presentes = sorted(sessions_validas.keys())
        ambientes_ausentes  = sorted(set(["M", "S", "T"]) - set(ambientes_presentes))
        if ambientes_ausentes:
            print(f"[{self.slug}]   Processando {ambientes_presentes}; ausentes: {ambientes_ausentes}.")
            # Dispara ETL pra retentar capturar os ambientes faltantes -- talvez ANP publicou
            # algo desde a ultima captura. Debounce de 6h evita spam de dispatches.
            if self._trigger_capture_workflow_with_debounce(self.slug):
                print(f"[{self.slug}]   ETL re-disparado pra tentar capturar {ambientes_ausentes}.")

        # 5. Baixar CSVs apenas dos ambientes com session valida
        try:
            csvs = self._baixar_csvs_mes(sessions_validas, periodo)
        except _SessionExpiredError as e:
            # Session expired on the ANP server side (HTTP 200 but returned APEX page HTML).
            # Trigger a fresh Selenium capture run to obtain new sessions.
            print(f"[{self.slug}]   SESSAO EXPIRADA (servidor ANP): {e}")
            self.registrar_historico(
                f"Sessao APEX expirada para {periodo} -- recaptura disparada",
                self._estado_atual,
                [],
            )
            if self._trigger_capture_workflow_with_debounce(self.slug):
                print(f"[{self.slug}]   Workflow de recaptura disparado.")
            else:
                print(f"[{self.slug}]   Recaptura dentro do debounce de {_DEBOUNCE_HOURS}h. Aguardando.")
            return False
        except Exception as e:
            print(f"[{self.slug}]   ERRO ao baixar CSVs: {e}")
            # Log the failure in history so consecutive failures are visible.
            # Do NOT advance ultimo_periodo on download failure -- we need to retry.
            self.registrar_historico(
                f"ERRO ao baixar CSVs para {periodo}: {e}",
                self._estado_atual,
                [],
            )
            return False

        # 5b. Upload dos CSVs para Supabase (idempotente -- sempre roda, nao so quando ha campo novo)
        # Antes esse passo vivia em etl_anp_cdp.yml; unificado aqui pra eliminar duplicacao.
        try:
            upload_script = _SCRIPTS_DIR / "pipelines" / "anp" / "cdp" / "02_upload.py"
            csv_dir       = str(_DADOS_DIR / "_downloads")
            print(f"[{self.slug}]   Upload pro Supabase: {csv_dir}")
            result = subprocess.run(
                [sys.executable, str(upload_script), "--from-csv-dir", csv_dir],
                capture_output=True, text=True, timeout=300,
            )
            if result.returncode == 0:
                print(f"[{self.slug}]   Upload OK")
            else:
                print(
                    f"[{self.slug}]   Upload falhou (rc={result.returncode}): "
                    f"{(result.stderr or result.stdout)[:500]}"
                )
        except Exception as e:
            print(f"[{self.slug}]   Erro ao chamar upload: {e}")

        # 6. Comparar campos por ambiente com baseline NO MESMO PERIODO.
        # Semantica: alerta = "dados de producao do mes X para o campo Y foram divulgados".
        # Se mes mudou desde o ultimo run, baseline e resetada -- o que existia em meses
        # anteriores nao importa, queremos saber quando cada campo aparece NESTE mes.
        novidades = []
        novo_estado = dict(self._estado_atual)
        ultimo_periodo = self._estado_atual.get("ultimo_periodo")
        if ultimo_periodo != periodo:
            print(f"[{self.slug}]   Periodo mudou ({ultimo_periodo!r} -> {periodo!r}); resetando baseline de campos.")
            for amb in ("M", "S", "T"):
                novo_estado[f"campos_{amb.lower()}"] = []

        for ambiente, csv_path in csvs.items():
            baseline_key = f"campos_{ambiente.lower()}"  # campos_m, campos_s, campos_t
            baseline = set(novo_estado.get(baseline_key, []))
            atuais   = self._extrair_campos(csv_path)
            novos    = sorted(atuais - baseline)
            if novos:
                novidades.append((ambiente, novos))
            # Always update baseline for successfully downloaded ambientes.
            # This prevents stale baselines even when 0 new fields are found.
            if atuais:
                novo_estado[baseline_key] = sorted(atuais)

        # Persist estado whenever CSVs were downloaded successfully, even with 0 novelties.
        # This advances ultimo_periodo so the state does not get stuck on the previous month
        # if replay succeeds but no new fields are found (e.g. no changes since last run).
        novo_estado["ultimo_periodo"] = periodo
        self.salvar_estado(novo_estado)

        if not novidades:
            print(f"[{self.slug}]   >> Sem campos novos")
            return False

        # 7. Enviar alerta(s)
        sys.path.insert(0, str(_ALERTAS_DIR))
        from notificador import enviar_alerta  # type: ignore

        total_campos = sum(len(novos) for _, novos in novidades)

        if total_campos <= 10:
            # 1 email por campo (granular -- CEO quer cada novo campo)
            for ambiente, novos in novidades:
                for campo in novos:
                    print(f"[{self.slug}]   >> Novo campo: {campo} ({ambiente})")
                    enviar_alerta(
                        f"ANP CDP -- Novo campo identificado: {campo} ({ambiente})",
                        (
                            f"Campo '{campo}' apareceu pela primeira vez no ambiente "
                            f"{ambiente} para o periodo {periodo}."
                        ),
                        link=self.url,
                    )
        else:
            # Digest unico quando ha mais de 10 campos novos
            print(f"[{self.slug}]   >> {total_campos} campos novos -- enviando digest")
            msg = f"{total_campos} campos novos no periodo {periodo}:\n\n"
            for ambiente, novos in novidades:
                msg += f"## {ambiente}\n" + "\n".join(f"  - {c}" for c in novos) + "\n\n"
            enviar_alerta(
                f"ANP CDP -- {total_campos} campos novos no periodo {periodo}",
                msg,
                link=self.url,
            )

        # 8. Registrar historico (estado ja foi salvo antes do bloco de envio)
        self.registrar_historico(
            f"{total_campos} campo(s) novo(s) em {periodo}",
            novo_estado,
            list(csvs.values()),
        )

        # 9. Atualizar last_used_at nas 3 rows de alertas_session (M, S, T)
        if self._sb is not None:
            try:
                self._sb.table("alertas_session").update(
                    {"last_used_at": datetime.now(timezone.utc).isoformat()}
                ).eq("base", self.slug).in_("ambiente", ["M", "S", "T"]).execute()
            except Exception as e:
                print(f"[{self.slug}]   [aviso] Falha ao atualizar last_used_at: {e}")

        return True

    # ── Stubs para interface abstrata (logica completa esta em run()) ──────────

    def verificar(self):
        return False, {}, ""

    def baixar(self, novo_estado):
        return []
