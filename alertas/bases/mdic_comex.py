import os
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

import requests

from .base import BaseMonitor

_API     = "https://api-comexstat.mdic.gov.br/general"
_HEADERS = {"Content-Type": "application/json", "Accept": "application/json"}
_NCMS    = ["27090010", "27101259", "27101921"]


def _janela() -> tuple[str, str]:
    """Last 4 months as (from, to) in YYYY-MM format."""
    inicio = date.today().replace(day=1)
    for _ in range(3):
        inicio = (inicio - timedelta(days=1)).replace(day=1)
    return inicio.strftime("%Y-%m"), date.today().strftime("%Y-%m")


def _post(flow: str, pf: str, pt: str) -> list[dict]:
    payload = {
        "flow":        flow,
        "monthDetail": True,
        "period":      {"from": pf, "to": pt},
        "filters":     [{"filter": "ncm", "values": _NCMS}],
        "details":     ["ncm"],
        "metrics":     ["metricFOB", "metricKG"],
    }
    r = requests.post(_API, headers=_HEADERS, json=payload, timeout=30)
    r.raise_for_status()
    return r.json().get("data", {}).get("list", []) or []


def _ultimo_mes(rows: list[dict]) -> str | None:
    meses = set()
    for row in rows:
        y  = str(row.get("year", "")).strip()
        mn = str(row.get("monthNumber", "")).strip()
        if y.isdigit() and mn.isdigit():
            meses.add(f"{y}-{int(mn):02d}")
    return max(meses) if meses else None


class MdicComex(BaseMonitor):
    slug = "mdic_comex"
    nome = "MDIC Comex Stat — Petroleo, Gasolina e Diesel (NCM filtrado)"
    url  = (
        "https://www.gov.br/mdic/pt-br/assuntos/comercio-exterior"
        "/estatisticas/base-de-dados-bruta"
    )

    def verificar(self):
        estado = self.ler_estado()
        pf, pt = _janela()

        try:
            rows = _post("import", pf, pt) + _post("export", pf, pt)
        except Exception as e:
            print(f"    [aviso] API Comex falhou: {e}")
            return False, estado, ""

        if not rows:
            return False, estado, ""

        ultimo = _ultimo_mes(rows)
        if not ultimo:
            print(f"    [aviso] Periodo nao identificado. Exemplo: {rows[0]}")
            return False, estado, ""

        if estado.get("ultimo_periodo") == ultimo:
            return False, estado, ""

        return (
            True,
            {"ultimo_periodo": ultimo},
            f"MDIC Comex: dados de {ultimo} disponiveis (petroleo, gasolina, diesel)",
        )

    def baixar(self, novo_estado):
        # consolidar.py --mes YYYY-MM apenas atualiza o mês detectado
        # e faz append/dedup no Parquet. Histórico é construído em backfill manual.
        periodo = novo_estado.get("ultimo_periodo")
        if not periodo:
            return []

        self._consolidar_mes(periodo)
        self._upload_supabase()

        parquet = self.dados_dir / "comex_consolidado.parquet"
        return [str(parquet)] if parquet.exists() else []

    def _upload_supabase(self):
        if not os.environ.get("SUPABASE_SERVICE_KEY"):
            return
        script = Path(__file__).parent.parent / "scripts" / self.slug / "upload_supabase.py"
        if not script.exists():
            return
        try:
            r = subprocess.run(
                [sys.executable, str(script)],
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                timeout=300,
            )
            if r.returncode == 0:
                ultimas = [l for l in r.stdout.splitlines() if l.strip()][-3:]
                for l in ultimas:
                    print(f"    {l.strip()}")
            else:
                print(f"    [aviso] upload_supabase falhou (rc={r.returncode}):")
                print(f"    {r.stderr[:300]}")
        except Exception as e:
            print(f"    [aviso] upload_supabase erro: {e}")

    def _consolidar_mes(self, periodo: str):
        script = Path(__file__).parent.parent / "scripts" / self.slug / "consolidar.py"
        if not script.exists():
            print(f"    [aviso] consolidar.py não encontrado em {script}")
            return
        try:
            r = subprocess.run(
                [sys.executable, str(script), "--mes", periodo],
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                timeout=600,
            )
            if r.returncode == 0:
                ultimas = [l for l in r.stdout.splitlines() if l.strip()][-6:]
                for l in ultimas:
                    print(f"    {l.strip()}")
            else:
                print(f"    [aviso] consolidar falhou (rc={r.returncode}):")
                print(f"    {r.stderr[:300]}")
        except Exception as e:
            print(f"    [aviso] consolidar erro: {e}")
