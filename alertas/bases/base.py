import csv
import json
import os
import re
import sys
from abc import ABC, abstractmethod
from datetime import datetime
from pathlib import Path

import requests
from bs4 import BeautifulSoup

_ALERTAS_DIR     = Path(__file__).parent.parent
_DADOS_DIR       = _ALERTAS_DIR.parent / "DADOS"
_ESTADO_DIR      = _ALERTAS_DIR / "estado"
_HISTORICO_GLOBAL = _DADOS_DIR / "historico_alertas.csv"
_HISTORICO_COLS  = ["timestamp", "slug", "nome", "periodo", "mensagem", "arquivos", "url"]

# ---------------------------------------------------------------------------
# Supabase state backend (used when SUPABASE_URL + SUPABASE_SERVICE_KEY are set)
# ---------------------------------------------------------------------------

def _supabase_client():
    """Return a supabase-py client using the service-role key, or None if not configured."""
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        return None
    try:
        from supabase import create_client  # type: ignore
        return create_client(url, key)
    except ImportError:
        return None


def _sb_ler_estado(client, base: str) -> dict:
    """Read estado from Supabase alertas_estado table. Returns {} on miss."""
    try:
        res = client.table("alertas_estado").select("estado").eq("base", base).single().execute()
        data = res.data
        if data and "estado" in data:
            estado = data["estado"]
            # supabase-py returns jsonb as dict already
            return estado if isinstance(estado, dict) else json.loads(estado)
    except Exception:
        pass
    return {}


def _sb_salvar_estado(client, base: str, estado: dict):
    """Upsert estado into Supabase alertas_estado table."""
    client.table("alertas_estado").upsert(
        {"base": base, "estado": estado, "updated_at": datetime.utcnow().isoformat()},
        on_conflict="base",
    ).execute()


def _extrair_periodo(estado: dict) -> str:
    for key in ("ultimo_periodo", "data_atualizacao", "powerbi_periodo",
                "ultima_edicao", "ultima_data_fim", "ultimos_dados",
                "ultimo_arquivo", "last_modified"):
        v = str(estado.get(key, "")).strip()
        if v:
            return v
    # fallback: first non-empty string value in the dict (handles nested states)
    for v in estado.values():
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def _append_csv(path: Path, row: dict):
    escrever_header = not path.exists() or path.stat().st_size == 0
    with open(path, "a", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=_HISTORICO_COLS)
        if escrever_header:
            w.writeheader()
        w.writerow(row)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

_DATE_RE = re.compile(
    r'Atualizado em\s+(\d{1,2}/\d{1,2}/\d{4}(?:\s+\d+h\d*)?)', re.IGNORECASE
)


class BaseMonitor(ABC):
    slug: str
    nome: str
    url:  str

    def __init__(self):
        self.dados_dir = _DADOS_DIR / self.slug
        self.dados_dir.mkdir(parents=True, exist_ok=True)
        self.estado_path = _ESTADO_DIR / f"{self.slug}.json"
        self._sb = _supabase_client()  # None when running locally without env vars

    # ── state ────────────────────────────────────────────────────────────────
    # Priority: Supabase (cloud runs) → filesystem (local dev)

    def ler_estado(self) -> dict:
        if self._sb is not None:
            estado = _sb_ler_estado(self._sb, self.slug)
            if estado:
                return estado
            # Supabase configured but no row yet: fall through to filesystem seed
        if self.estado_path.exists():
            return json.loads(self.estado_path.read_text(encoding="utf-8"))
        return {}

    def salvar_estado(self, estado: dict):
        if self._sb is not None:
            _sb_salvar_estado(self._sb, self.slug, estado)
            print(f"  [estado] Salvo no Supabase ({self.slug})")
        else:
            _ESTADO_DIR.mkdir(parents=True, exist_ok=True)
            self.estado_path.write_text(
                json.dumps(estado, indent=2, ensure_ascii=False), encoding="utf-8"
            )
            print(f"  [estado] Salvo em disco ({self.estado_path})")

    # ── network helpers ───────────────────────────────────────────────────────

    def fetch(self, url: str) -> BeautifulSoup:
        r = requests.get(url, headers=HEADERS, timeout=30)
        r.raise_for_status()
        r.encoding = r.apparent_encoding or "utf-8"
        return BeautifulSoup(r.text, "lxml")

    def head_headers(self, url: str) -> dict:
        try:
            r = requests.head(url, headers=HEADERS, timeout=15, allow_redirects=True)
            return dict(r.headers)
        except Exception:
            return {}

    def extrair_data_atualizacao(self, soup: BeautifulSoup) -> str:
        m = _DATE_RE.search(soup.get_text())
        return m.group(1).strip() if m else ""

    def get_file_links(self, soup: BeautifulSoup, extensions=None) -> list:
        if extensions is None:
            extensions = {".xlsx", ".xls", ".xlsb", ".csv", ".pdf", ".zip"}
        links = []
        for a in soup.find_all("a", href=True):
            href = a["href"].strip()
            ext  = Path(href.split("?")[0]).suffix.lower()
            if ext in extensions:
                if href.startswith("http"):
                    links.append(href)
                elif href.startswith("/"):
                    links.append("https://www.gov.br" + href)
        return list(dict.fromkeys(links))

    def baixar_arquivo(self, url: str, nome: str) -> str:
        dest = self.dados_dir / nome
        r = requests.get(url, headers=HEADERS, stream=True, timeout=120)
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_content(chunk_size=65536):
                f.write(chunk)
        print(f"    ✓ {dest.name} ({dest.stat().st_size / 1024:.0f} KB)")
        return str(dest)

    # ── interface ─────────────────────────────────────────────────────────────

    @abstractmethod
    def verificar(self) -> tuple:
        """Returns (tem_novidade: bool, novo_estado: dict, mensagem: str)"""
        pass

    @abstractmethod
    def baixar(self, novo_estado: dict) -> list:
        """Downloads new files. Returns list of local paths."""
        pass

    def registrar_historico(self, mensagem: str, novo_estado: dict, arquivos: list):
        row = {
            "timestamp": datetime.now().isoformat(timespec="seconds"),
            "slug":      self.slug,
            "nome":      self.nome,
            "periodo":   _extrair_periodo(novo_estado),
            "mensagem":  mensagem,
            "arquivos":  "|".join(Path(a).name for a in arquivos) if arquivos else "",
            "url":       self.url,
        }
        _append_csv(self.dados_dir / "historico.csv", row)
        _append_csv(_HISTORICO_GLOBAL, row)

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
        try:
            arquivos = self.baixar(novo_estado)
        except Exception as e:
            print(f"  >> ERRO ao baixar: {e}")
            arquivos = []

        self.salvar_estado(novo_estado)
        self.registrar_historico(mensagem, novo_estado, arquivos)

        sys.path.insert(0, str(_ALERTAS_DIR))
        from notificador import enviar_alerta
        enviar_alerta(
            self.nome,
            mensagem,
            link=self.url,
            arquivo=", ".join(Path(a).name for a in arquivos) if arquivos else "",
        )
        return True
