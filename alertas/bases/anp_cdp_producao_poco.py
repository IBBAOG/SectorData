import csv
import json
import os
import shutil
import sys
from datetime import date
from pathlib import Path

from .base import BaseMonitor

_SCRIPTS_DIR  = Path(__file__).parent.parent.parent / "scripts"
_DADOS_DIR    = Path(__file__).parent.parent.parent / "DADOS" / "anp_cdp_producao_poco"
_CHECKLIST    = Path(__file__).parent.parent / "cdp_campos_importantes.json"
_SESSION_SRC  = Path(__file__).parent.parent.parent / "output" / "anp" / "session.json"


def _mes_esperado() -> str:
    hoje = date.today()
    mes  = hoje.month - 2
    ano  = hoje.year
    if mes <= 0:
        mes += 12
        ano -= 1
    return f"{mes:02d}/{ano}"


def _carregar_checklist() -> list:
    try:
        data = json.loads(_CHECKLIST.read_text(encoding="utf-8"))
        return [c.strip() for c in data.get("campos", []) if c.strip()]
    except Exception:
        return []


class AnpCdpProducaoPoco(BaseMonitor):
    slug = "anp_cdp_producao_poco"
    nome = "ANP CDP — Producao por Poco (Mar)"
    url  = (
        "https://cdp.anp.gov.br/ords/r/cdp_apex/"
        "consulta-dados-publicos-cdp/consulta-producao-por-poco"
    )

    def __init__(self):
        super().__init__()
        _DADOS_DIR.mkdir(parents=True, exist_ok=True)
        # Copy existing session.json to DADOS dir if not already there
        dest_session = _DADOS_DIR / "session.json"
        if not dest_session.exists() and _SESSION_SRC.exists():
            shutil.copy(_SESSION_SRC, dest_session)
            print(f"  [cdp] session.json copiado de output/anp/")

    # ── download ──────────────────────────────────────────────────────────────

    def _executar_download(self, periodo: str, ambiente: str = "M") -> str | None:
        sys.path.insert(0, str(_SCRIPTS_DIR))
        import ddddocr as _ddddocr
        from anp_auto import extract_one, SESSION_FILENAME

        download_dir = str(_DADOS_DIR / "_downloads")
        os.makedirs(download_dir, exist_ok=True)

        session_data = None
        session_path = _DADOS_DIR / SESSION_FILENAME
        if session_path.exists():
            session_data = json.loads(session_path.read_text())
            print(f"    Sessao: capturada em {session_data.get('captured_at', '?')}")

        ocr = _ddddocr.DdddOcr(show_ad=False)
        ok  = extract_one(
            periodo=periodo,
            ambiente=ambiente,
            output_dir=str(_DADOS_DIR),
            download_dir=download_dir,
            session_data=session_data,
            ocr_engine=ocr,
            use_selenium=True,
        )
        dest = _DADOS_DIR / f"producao_poco_{periodo.replace('/', '-')}_{ambiente}.csv"
        return str(dest) if ok and dest.exists() else None

    # ── parsing ───────────────────────────────────────────────────────────────

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

    # ── checklist ─────────────────────────────────────────────────────────────

    def _verificar_checklist(self, campos_presentes: set, estado: dict) -> bool:
        checklist = _carregar_checklist()
        if not checklist:
            return False

        faltando = [c for c in checklist if c not in campos_presentes]
        if faltando:
            print(f"    Checklist: {len(checklist) - len(faltando)}/{len(checklist)} campos presentes")
            print(f"    Faltando: {', '.join(faltando)}")
            return False

        # All important campos present — check if full download already triggered
        if estado.get("checklist_completo"):
            return False

        print(f"    ** CHECKLIST COMPLETO — disparando download completo **")
        return True

    def _download_completo(self, periodo: str):
        print(f"    Baixando ambientes Pre-Sal e Terra para {periodo}...")
        for amb in ("S", "T"):
            self._executar_download(periodo, amb)

    # ── main logic ────────────────────────────────────────────────────────────

    def run(self) -> bool:
        print(f"[{self.slug}] {self.nome}...")
        periodo = _mes_esperado()
        estado  = self.ler_estado()
        hoje    = date.today().isoformat()

        print(f"    Periodo: {periodo} | Ambiente: Mar")
        csv_path = self._executar_download(periodo)
        if not csv_path:
            print(f"  >> ERRO: download falhou para {periodo}")
            return False

        campos_hoje  = self._extrair_campos(csv_path)
        campos_antes = set(estado.get("campos_mar", []))
        novos        = sorted(campos_hoje - campos_antes)

        novo_estado = {
            **estado,
            "campos_mar":           sorted(campos_hoje),
            "ultimo_periodo":       periodo,
            "ultimo_download_data": hoje,
        }

        # First run — save baseline silently
        if not campos_antes:
            self.salvar_estado(novo_estado)
            print(f"  >> Baseline salvo: {len(campos_hoje)} campos em {periodo}")
            return False

        # Check checklist
        checklist_completo = self._verificar_checklist(campos_hoje, estado)
        if checklist_completo:
            novo_estado["checklist_completo"] = True
            self._download_completo(periodo)

        self.salvar_estado(novo_estado)

        if not novos and not checklist_completo:
            print(f"  >> Sem novos campos ({len(campos_hoje)} total em {periodo})")
            return False

        # Build notification
        sys.path.insert(0, str(Path(__file__).parent.parent))
        from notificador import enviar_alerta

        if novos:
            print(f"  >> {len(novos)} novo(s) campo(s): {', '.join(novos)}")
            lista = "\n".join(f"• {c}" for c in novos)
            mensagem = f"{len(novos)} novo(s) campo(s) em {periodo}:\n\n{lista}"
            if checklist_completo:
                mensagem += "\n\n*** CHECKLIST COMPLETO — download Mar+Pre-Sal+Terra iniciado ***"
            self.registrar_historico(mensagem, novo_estado, [csv_path])
            enviar_alerta(self.nome, mensagem, link=self.url)
        elif checklist_completo:
            mensagem = f"Checklist completo para {periodo} — download Mar+Pre-Sal+Terra concluido."
            self.registrar_historico(mensagem, novo_estado, [csv_path])
            enviar_alerta(self.nome, mensagem, link=self.url)

        return True

    # ── unused abstract methods (logic is in run()) ───────────────────────────

    def verificar(self):
        return False, {}, ""

    def baixar(self, novo_estado):
        return []
