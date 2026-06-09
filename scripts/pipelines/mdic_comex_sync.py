#!/usr/bin/env python3
"""
mdic_comex_sync.py
==================
Script de CI para sincronizar os últimos meses do MDIC Comex Stat com o Supabase.

Baixa import + export dos 3 NCMs de petróleo/combustíveis para os últimos N meses
e faz upsert na tabela mdic_comex (ON CONFLICT DO UPDATE). Idempotente.

Uso:
    python scripts/mdic_comex_sync.py               # últimos 3 meses
    python scripts/mdic_comex_sync.py --meses 6     # últimos 6 meses
    python scripts/mdic_comex_sync.py --desde 2026-01  # a partir de YYYY-MM

Credenciais (env vars; fallback para .env na raiz):
    SUPABASE_URL
    SUPABASE_SERVICE_KEY
"""
import argparse
import math
import os
import sys
import time
from datetime import date
from pathlib import Path

import requests
from supabase import create_client

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_API     = "https://api-comexstat.mdic.gov.br/general"
_HEADERS = {
    "Content-Type": "application/json",
    "Accept":       "application/json",
    # A browser-like UA + Origin/Referer reduces the chance of being throttled
    # as an anonymous bot; the public ComexStat UI calls the same endpoint.
    "User-Agent":   "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Origin":       "https://comexstat.mdic.gov.br",
    "Referer":      "https://comexstat.mdic.gov.br/",
}
_NCMS    = ["27090010", "27101259", "27101921"]
_BATCH   = 500
# The API enforces a tight per-IP rate limit and replies HTTP 429 with
# "tente novamente em 10 segundos". Back off generously and honor Retry-After.
_RETRIES = 6
_BACKOFF = [10, 15, 25, 40, 60, 90]
# Pause between every (flow, month) leg to stay under the rate limit even on a
# successful run — cheap insurance against 429 cascades.
_INTER_REQUEST_SLEEP = 12


# ── Credentials ───────────────────────────────────────────────────────────────

def _get_creds() -> tuple[str, str]:
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        env_path = Path(__file__).parent.parent / ".env"
        if env_path.exists():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                k, v = k.strip(), v.strip()
                if k == "SUPABASE_URL" and not url:
                    url = v
                if k == "SUPABASE_SERVICE_KEY" and not key:
                    key = v
    if not url or not key:
        print("Erro: SUPABASE_URL ou SUPABASE_SERVICE_KEY nao definidos")
        sys.exit(1)
    return url, key


# ── MDIC API ──────────────────────────────────────────────────────────────────

def _post_retry(flow: str, pf: str, pt: str) -> tuple[list[dict], bool]:
    """POST to the ComexStat API with retries.

    Returns ``(rows, http_ok)`` where:
      * ``rows``    is the (possibly empty) ``data.list`` payload, and
      * ``http_ok`` is True iff at least one attempt returned HTTP 200.

    Distinguishing the two lets the caller tell a *legitimate* empty result
    (HTTP 200 with an empty list — e.g. a future month with no data yet) from
    a *masked failure* (every attempt was a non-200 such as 429/5xx, which
    used to be silently swallowed as ``[]`` — see CLAUDE.md Pegadinha #12).
    """
    payload = {
        "flow":        flow,
        "monthDetail": True,
        "period":      {"from": pf, "to": pt},
        "filters":     [{"filter": "ncm", "values": _NCMS}],
        "details":     ["ncm", "country"],
        "metrics":     ["metricFOB", "metricKG", "metricStatistic"],
    }
    http_ok = False
    for attempt in range(_RETRIES):
        try:
            r = requests.post(_API, headers=_HEADERS, json=payload, timeout=60)
            if r.status_code == 200:
                http_ok = True
                rows = r.json().get("data", {}).get("list", []) or []
                if rows:
                    return rows, True
                # HTTP 200 + empty list: legitimate "no data" — stop retrying.
                return [], True
            print(f"    [warn] attempt {attempt + 1}: HTTP {r.status_code} "
                  f"({r.text[:120].strip()})")
            # Honor an explicit Retry-After (seconds) if the server sends one.
            retry_after = r.headers.get("Retry-After")
            wait = _BACKOFF[attempt]
            if retry_after and retry_after.isdigit():
                wait = max(wait, int(retry_after))
        except Exception as e:
            print(f"    [warn] attempt {attempt + 1} failed: {e}")
            wait = _BACKOFF[attempt]
        if attempt < _RETRIES - 1:
            time.sleep(wait)
    return [], http_ok


def _normalizar(rows: list[dict], flow: str) -> list[dict]:
    out = []
    for r in rows:
        try:
            ano = int(str(r.get("year", "")).strip())
            mes = int(str(r.get("monthNumber", "")).strip())
        except (ValueError, TypeError):
            continue
        ncm_codigo = str(r.get("coNcm") or r.get("ncm_codigo") or "").strip()
        ncm_nome   = str(r.get("ncm") or r.get("ncm_nome") or "").strip() or None
        pais       = str(r.get("country") or r.get("pais") or "").strip()

        def _num(key):
            v = r.get(key)
            try:
                f = float(v)
                return None if math.isnan(f) else f
            except (TypeError, ValueError):
                return None

        volume_kg     = _num("metricKG")    or _num("volume_kg")
        valor_fob_usd = _num("metricFOB")   or _num("valor_fob_usd")
        quantidade_estatistica = _num("metricStatistic") or _num("quantidade_estatistica")
        unidade_estatistica = (
            str(
                r.get("metricStatisticUnit")
                or r.get("unidadeEstatistica")
                or r.get("unidade_estatistica")
                or ""
            ).strip() or None
        )

        if not ncm_codigo or not pais:
            continue
        out.append({
            "ano": ano, "mes": mes, "flow": flow,
            "ncm_codigo": ncm_codigo, "ncm_nome": ncm_nome,
            "pais": pais,
            "volume_kg": volume_kg, "valor_fob_usd": valor_fob_usd,
            "quantidade_estatistica": quantidade_estatistica,
            "unidade_estatistica": unidade_estatistica,
        })
    return out


def _meses_range(desde: str | None, n: int) -> list[tuple[str, str]]:
    """Retorna lista de períodos (pf, pt) = (YYYY-MM, YYYY-MM) para cada mês."""
    hoje = date.today().replace(day=1)
    if desde:
        ano_i, mes_i = map(int, desde.split("-"))
        inicio = date(ano_i, mes_i, 1)
    else:
        inicio = hoje
        for _ in range(n - 1):
            inicio = (inicio.replace(day=1) - __import__("datetime").timedelta(days=1)).replace(day=1)

    meses = []
    cur = inicio
    while cur <= hoje:
        meses.append(cur.strftime("%Y-%m"))
        # avança um mês
        if cur.month == 12:
            cur = date(cur.year + 1, 1, 1)
        else:
            cur = date(cur.year, cur.month + 1, 1)
    return [(m, m) for m in meses]


# ── Upsert ────────────────────────────────────────────────────────────────────

def _upsert(sb, records: list[dict]):
    total = 0
    batches = math.ceil(len(records) / _BATCH)
    for i in range(0, len(records), _BATCH):
        batch = records[i : i + _BATCH]
        sb.table("mdic_comex").upsert(
            batch, on_conflict="ano,mes,flow,ncm_codigo,pais"
        ).execute()
        total += len(batch)
        print(f"  [{i // _BATCH + 1}/{batches}] {total:,}/{len(records):,}")
    return total


# ── Targeted per-month pull + upsert (reused by the drift checker) ──────────────

def sync_months(sb, months: list[str]) -> tuple[int, list[str]]:
    """Full re-pull + upsert of an explicit list of ``YYYY-MM`` months.

    For each month we pull BOTH flows (import + export) at full
    ``["ncm", "country"]`` detail and upsert the normalized rows. This is the
    same per-month leg the daily/weekly sync uses, exposed so callers such as
    ``mdic_comex_drift_check.py`` can self-heal a specific drifted month without
    duplicating the request/normalize/upsert logic.

    Returns ``(total_upserted, errors)`` where ``errors`` lists ``"<month> <flow>"``
    legs whose every HTTP attempt failed (non-200) — i.e. the heal could not be
    completed and the caller should treat the month as still drifted.
    """
    all_records: list[dict] = []
    errors: list[str] = []
    legs = [(m, flow) for m in months for flow in ("import", "export")]
    for idx, (pf, flow) in enumerate(legs):
        print(f"  API {flow} {pf}...", end=" ", flush=True)
        rows, http_ok = _post_retry(flow, pf, pf)
        normed = _normalizar(rows, flow)
        print(f"{len(normed):,} rows" + ("" if http_ok else "  [HTTP FAILED]"))
        if not http_ok:
            errors.append(f"{pf} {flow}")
        all_records.extend(normed)
        if idx < len(legs) - 1:
            time.sleep(_INTER_REQUEST_SLEEP)

    total = 0
    if all_records:
        total = _upsert(sb, all_records)
    return total, errors


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--meses",  type=int, default=3,
                    help="Quantos meses recentes baixar (default: 3)")
    ap.add_argument("--desde",  type=str, default=None,
                    help="Mês inicial YYYY-MM (ignora --meses)")
    args = ap.parse_args()

    periodos = _meses_range(args.desde, args.meses)
    print(f"Períodos: {periodos[0][0]} → {periodos[-1][1]} ({len(periodos)} meses)")

    url, key = _get_creds()
    sb = create_client(url, key)

    all_records: list[dict] = []
    # Per-month bookkeeping so we can detect the silent-empty failure mode:
    #   counts[(pf, flow)]  = number of normalized rows obtained
    #   http_failed[(pf, flow)] = True if every HTTP attempt was a non-200
    counts: dict[tuple[str, str], int] = {}
    http_failed: dict[tuple[str, str], bool] = {}
    legs = [(pf, flow) for pf, _ in periodos for flow in ("import", "export")]
    for idx, (pf, flow) in enumerate(legs):
        print(f"  API {flow} {pf}...", end=" ", flush=True)
        rows, http_ok = _post_retry(flow, pf, pf)
        normed = _normalizar(rows, flow)
        print(f"{len(normed):,} rows" + ("" if http_ok else "  [HTTP FAILED]"))
        counts[(pf, flow)] = len(normed)
        http_failed[(pf, flow)] = not http_ok
        all_records.extend(normed)
        # Space out requests to stay under the per-IP rate limit.
        if idx < len(legs) - 1:
            time.sleep(_INTER_REQUEST_SLEEP)

    # ── Silent-empty / asymmetry detection (CLAUDE.md Pegadinha #12) ──────────
    # A month that returns rows for one flow but an *empty* result for the other
    # is the classic silent-empty signal. We also flag any flow whose every HTTP
    # attempt failed (e.g. sustained 429), which previously looked identical to
    # a legitimate empty.
    warnings: list[str] = []
    for pf, _ in periodos:
        imp = counts.get((pf, "import"), 0)
        exp = counts.get((pf, "export"), 0)
        for flow in ("import", "export"):
            if http_failed.get((pf, flow)):
                warnings.append(
                    f"{pf} {flow}: every HTTP attempt failed (non-200) — "
                    f"data may exist at source but was not fetched"
                )
        if imp == 0 and exp > 0:
            warnings.append(
                f"{pf}: export has {exp} rows but import is EMPTY — likely "
                f"silent-empty (publication lag or fetch failure), not a true zero"
            )
        elif exp == 0 and imp > 0:
            warnings.append(
                f"{pf}: import has {imp} rows but export is EMPTY — likely "
                f"silent-empty (publication lag or fetch failure), not a true zero"
            )

    for w in warnings:
        print(f"  [WARNING] {w}")

    if not all_records:
        print("No data obtained. Exiting.")
        # Empty across the board with HTTP failures is an error, not a no-op.
        sys.exit(1 if any(http_failed.values()) else 0)

    print(f"\nTotal: {len(all_records):,} records")
    print("Upserting to Supabase...")
    total = _upsert(sb, all_records)
    print(f"Done: {total:,} records upserted into mdic_comex")

    # Make the asymmetry visible to CI and to alerting: a green job with a
    # missing flow is the real bug we are guarding against here.
    if warnings:
        print(f"\n[ERROR] {len(warnings)} data-completeness warning(s) above "
              f"— failing the job so the gap is not silently green.")
        sys.exit(2)


if __name__ == "__main__":
    main()
