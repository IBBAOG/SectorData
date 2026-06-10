#!/usr/bin/env python3
"""
anp_producao_derivados_sync.py
==============================
Downloads the ANP open-data CSV of refined-product production per refinery
(unit m3) and upserts NATIONAL monthly totals for Gasoline A and Diesel into
``anp_producao_derivados``.

Source (ANP "Dados Abertos" — PPPD):
    https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/arquivos/pppd/
    producao-derivados-petroleo-por-refinaria-m3-1990-2025.csv

Despite the ``-1990-2025`` suffix in the filename the file currently carries
data through ~2026-04. If ANP later publishes a ``-1990-2026`` variant it is
preferred automatically (see ``_CSV_URL_CANDIDATES``).

CSV schema (semicolon-delimited, latin-1, BOM-prefixed):
    ANO;MES;UNIDADE DA FEDERACAO;REFINARIA;PRODUTO;PRODUCAO
  - MES is a PT abbreviation (JAN..DEZ) -> mapped to 1..12.
  - PRODUCAO is an integer/decimal in m3 (decimal separator may be a comma).

We keep PRODUTO in {'GASOLINA A', 'OLEO DIESEL'} (accent/case-insensitive match;
the source spells diesel 'ÓLEO DIESEL' which we store as 'OLEO DIESEL'), then
aggregate the NATIONAL monthly total = SUM(PRODUCAO) grouped by
(ANO, MES_num, PRODUTO) and upsert on (ano, mes, produto).

Idempotent: ON CONFLICT (ano, mes, produto) DO UPDATE.

Usage:
    python scripts/pipelines/anp/producao/anp_producao_derivados_sync.py
    python scripts/pipelines/anp/producao/anp_producao_derivados_sync.py --desde 2021
    python scripts/pipelines/anp/producao/anp_producao_derivados_sync.py --dump-json output/dg_margins_backfill/anp_producao_derivados.json

Credentials: SUPABASE_URL + SUPABASE_SERVICE_KEY (env or .env walked up the tree)
"""

import argparse
import csv
import io
import json
import math
import os
import socket
import sys
import time
import unicodedata
from collections import defaultdict
from pathlib import Path

import requests
import urllib3.util.connection as urllib3_conn

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Prefer a -1990-2026 variant if/when ANP publishes one, else fall back to the
# current -1990-2025 file (which already carries 2026 data).
_CSV_URL_CANDIDATES = [
    "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/arquivos/"
    "pppd/producao-derivados-petroleo-por-refinaria-m3-1990-2026.csv",
    "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/arquivos/"
    "pppd/producao-derivados-petroleo-por-refinaria-m3-1990-2025.csv",
]

# IMPORTANT: do NOT advertise "br" in Accept-Encoding (CLAUDE.md Pegadinha #12).
# requests handles gzip/deflate transparently; ANP serves this CSV uncompressed.
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept": "text/csv,*/*;q=0.8",
    "Accept-Encoding": "gzip, deflate",
}

_TABLE = "anp_producao_derivados"
_BATCH = 500
_FONTE = "ANP — Produção de derivados de petróleo por refinaria (m³)"

# Download resilience (transient gov.br hiccups / IPv6 route flaps observed in CI).
# The CSV is tens of MB, so the timeout is generous; (connect, read) split keeps a
# stalled connect from eating the whole window.
_TIMEOUT = (30, 240)            # (connect, read) seconds
_BACKOFF_SECONDS = (2, 5, 12)   # waits BETWEEN attempts -> up to 4 attempts/URL

# Capture urllib3's stock address-family resolver ONCE so we can restore it after
# an IPv4-forced attempt (see _force_ipv4 / IPv6 dead-route fallback below).
_DEFAULT_GAI_FAMILY = urllib3_conn.allowed_gai_family

# PT month abbreviation -> month number. Accent/case-normalised before lookup.
_MESES = {
    "JAN": 1, "FEV": 2, "MAR": 3, "ABR": 4, "MAI": 5, "JUN": 6,
    "JUL": 7, "AGO": 8, "SET": 9, "OUT": 10, "NOV": 11, "DEZ": 12,
}

# Canonical produto labels we keep. Keyed by the accent-stripped, uppercased
# form of the raw PRODUTO value so 'ÓLEO DIESEL' and 'OLEO DIESEL' both match.
# NOTE: we match EXACTLY 'GASOLINA A' / 'OLEO DIESEL' — never the prefix — so
# 'GASOLINA DE AVIAÇÃO' / 'GASOLINA C' are excluded.
_PRODUTO_CANONICAL = {
    "GASOLINA A": "GASOLINA A",
    "OLEO DIESEL": "OLEO DIESEL",
}

# Minimum year to keep. d_g_margins starts 1/2021; we keep full history >=1990
# by default (cheap), but allow trimming via --desde.
_DEFAULT_DESDE = 1990


def _strip_accents_upper(s: str) -> str:
    return (
        unicodedata.normalize("NFKD", s)
        .encode("ascii", "ignore")
        .decode("ascii")
        .strip()
        .upper()
    )


def _get_creds():
    """Return (url, key), reading from env or walking up the tree for a .env."""
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if url and key:
        return url, key
    # Walk up from this file looking for a .env (works from a worktree too).
    for parent in Path(__file__).resolve().parents:
        env = parent / ".env"
        if env.exists():
            for line in env.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                k, v = k.strip(), v.strip()
                if k == "SUPABASE_URL" and not url:
                    url = v
                if k == "SUPABASE_SERVICE_KEY" and not key:
                    key = v
            if url and key:
                break
    return url, key


def _force_ipv4(enabled: bool) -> None:
    """Toggle urllib3's global address-family preference to IPv4-only.

    On some CI runners DNS resolves an AAAA record but there is no working IPv6
    route, so the connection fails with ``[Errno 101] Network is unreachable``.
    Pinning ``allowed_gai_family`` to ``AF_INET`` makes urllib3 (and therefore
    requests) skip the dead IPv6 candidates entirely. We flip it only for the
    retry that follows an IPv6-smelling error, then restore the default.
    """
    if enabled:
        urllib3_conn.allowed_gai_family = lambda: socket.AF_INET
    else:
        # Restore the library default (dual-stack, honours HAS_IPV6).
        urllib3_conn.allowed_gai_family = _DEFAULT_GAI_FAMILY


def _looks_like_ipv6_route_failure(err: Exception) -> bool:
    """Heuristic: does this connection error smell like a dead IPv6 route?"""
    msg = str(err).lower()
    return (
        "network is unreachable" in msg
        or "errno 101" in msg
        or "[errno -9]" in msg            # getaddrinfo AF mismatch (rare)
        or "no route to host" in msg
    )


def _fetch_once(url: str, force_ipv4: bool) -> requests.Response:
    """One HTTP GET, optionally forcing IPv4 for the duration of the call."""
    if force_ipv4:
        _force_ipv4(True)
    try:
        return requests.get(url, headers=_HEADERS, timeout=_TIMEOUT)
    finally:
        if force_ipv4:
            _force_ipv4(False)


def _download_csv() -> bytes:
    """Download the ANP production CSV, resilient to transient gov.br failures.

    For EACH candidate URL we retry with exponential backoff on
    ``requests.RequestException`` (covers ConnectionError /
    "Network is unreachable") and on HTTP 5xx. A 404 means the candidate does
    not exist -> move straight to the next candidate (no retry). When a
    connection error smells like a dead IPv6 route (Errno 101), the *next*
    attempt forces IPv4 to dodge the runner-resolves-AAAA-but-no-route failure.
    """
    last_err = None
    max_attempts = len(_BACKOFF_SECONDS) + 1  # backoffs are the waits BETWEEN tries

    for url in _CSV_URL_CANDIDATES:
        name = url.rsplit("/", 1)[-1]
        force_ipv4 = False  # sticky once an IPv6 failure is seen for this URL

        for attempt in range(1, max_attempts + 1):
            mode = "IPv4-forced" if force_ipv4 else "dual-stack"
            print(
                f"Downloading {name} (attempt {attempt}/{max_attempts}, {mode}) ...",
                end=" ",
                flush=True,
            )
            try:
                r = _fetch_once(url, force_ipv4)
                if r.status_code == 404:
                    print("404 (trying next candidate)")
                    break  # candidate absent -> next URL, do not retry/backoff
                if r.status_code >= 500:
                    # Transient server-side error -> retry with backoff.
                    raise requests.HTTPError(f"HTTP {r.status_code}", response=r)
                r.raise_for_status()
                # Guard against a silent Brotli/garbage body (Pegadinha #12): we
                # never advertise "br", and requests handles gzip/deflate.
                enc = r.headers.get("Content-Encoding", "")
                print(f"{len(r.content) / 1024:.0f} KB (enc={enc or 'none'})")
                return r.content
            except requests.RequestException as e:
                last_err = e
                print(f"error: {e}")
                # If this looks like an IPv6 dead route, force IPv4 from now on.
                if not force_ipv4 and _looks_like_ipv6_route_failure(e):
                    force_ipv4 = True
                    print("  -> IPv6 route looks dead; forcing IPv4 on next attempt")
                if attempt < max_attempts:
                    wait = _BACKOFF_SECONDS[attempt - 1]
                    print(f"  -> retrying in {wait}s")
                    time.sleep(wait)
                # else: attempts for this URL exhausted -> fall through to next URL

    raise SystemExit(f"[anp-producao] ERROR: could not download CSV ({last_err})")


def _decode(content: bytes) -> str:
    """Decode robustly.

    The ANP file is currently UTF-8 with a BOM (verified 2026-06): the bytes
    ``EF BB BF`` then ``M\\xc3\\x8aS`` = 'MÊS'. ``utf-8-sig`` strips the BOM and
    decodes the accents losslessly. We fall back to latin-1 only if a future
    re-encode breaks UTF-8 (some legacy ANP dumps are latin-1).
    """
    try:
        return content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return content.decode("latin-1").lstrip("﻿")


def _parse_producao(valor: str) -> float | None:
    """Parse a PRODUCAO cell. Decimal separator may be comma; thousands dot."""
    valor = (valor or "").strip()
    if not valor:
        return None
    # Brazilian numeric forms: '1.234,56' or '1234,56' or '1234'.
    if "," in valor:
        valor = valor.replace(".", "").replace(",", ".")
    try:
        return float(valor)
    except ValueError:
        return None


def _aggregate(text: str, desde: int) -> dict[tuple[int, int, str], float]:
    """SUM(PRODUCAO) over the nation grouped by (ano, mes_num, produto)."""
    rd = csv.reader(io.StringIO(text), delimiter=";")
    header = next(rd, None)
    if not header:
        raise SystemExit("[anp-producao] ERROR: empty CSV (no header)")
    # Validate header shape (accent-insensitive) — fail loudly if ANP reshuffles.
    norm_header = [_strip_accents_upper(h) for h in header]
    expected = ["ANO", "MES", "UNIDADE DA FEDERACAO", "REFINARIA", "PRODUTO", "PRODUCAO"]
    if norm_header[:6] != expected:
        raise SystemExit(
            f"[anp-producao] ERROR: unexpected CSV header {norm_header[:6]} "
            f"(expected {expected}) — source schema changed."
        )

    agg: dict[tuple[int, int, str], float] = defaultdict(float)
    bad_mes = 0
    for row in rd:
        if len(row) < 6:
            continue
        produto_raw = row[4]
        produto_key = _strip_accents_upper(produto_raw)
        produto = _PRODUTO_CANONICAL.get(produto_key)
        if produto is None:
            continue
        try:
            ano = int(row[0].strip())
        except (ValueError, AttributeError):
            continue
        if ano < desde:
            continue
        mes_num = _MESES.get(_strip_accents_upper(row[1]))
        if mes_num is None:
            bad_mes += 1
            continue
        vol = _parse_producao(row[5])
        if vol is None:
            continue
        agg[(ano, mes_num, produto)] += vol

    if bad_mes:
        print(f"  [warn] {bad_mes} rows had an unrecognised MES abbreviation (skipped)")
    return agg


def _records_from_agg(agg) -> list[dict]:
    records = []
    for (ano, mes, produto), vol in agg.items():
        records.append(
            {
                "ano": ano,
                "mes": mes,
                "produto": produto,
                # Round to whole m3 — the source is integer m3; commas are rare.
                "volume_m3": round(vol, 3),
                "fonte": _FONTE,
            }
        )
    # Deterministic order (and a defensive de-dupe by PK before upsert).
    seen: dict[tuple, dict] = {}
    for r in records:
        seen[(r["ano"], r["mes"], r["produto"])] = r
    out = list(seen.values())
    out.sort(key=lambda r: (r["ano"], r["mes"], r["produto"]))
    return out


def _upsert(sb, records: list[dict]) -> int:
    total = 0
    n_batches = math.ceil(len(records) / _BATCH)
    for i in range(0, len(records), _BATCH):
        batch = records[i : i + _BATCH]
        sb.table(_TABLE).upsert(batch, on_conflict="ano,mes,produto").execute()
        total += len(batch)
        print(f"  [{i // _BATCH + 1}/{n_batches}] {total:,}/{len(records):,}")
    return total


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--desde", type=int, default=_DEFAULT_DESDE,
                    help="minimum year to keep (default: 1990 = full history)")
    ap.add_argument("--dump-json", metavar="PATH",
                    help="write parsed records to a JSON file instead of (or in "
                         "addition to) upserting; if creds are missing, JSON only")
    ap.add_argument("--dry-run", action="store_true",
                    help="parse + report counts, do not upsert")
    args = ap.parse_args()

    content = _download_csv()
    text = _decode(content)
    agg = _aggregate(text, args.desde)
    records = _records_from_agg(agg)

    # Per-product reporting + min/max period.
    by_prod: dict[str, list[dict]] = defaultdict(list)
    for r in records:
        by_prod[r["produto"]].append(r)
    print(f"\nParsed {len(records):,} national monthly rows (since {args.desde}):")
    for prod in sorted(by_prod):
        rows = by_prod[prod]
        periods = sorted((r["ano"], r["mes"]) for r in rows)
        lo, hi = periods[0], periods[-1]
        print(f"  {prod:<14} {len(rows):>4} months  "
              f"[{lo[0]}-{lo[1]:02d} .. {hi[0]}-{hi[1]:02d}]")

    # Pegadinha #12 / project rule: zero rows is a HARD error.
    if not records:
        raise SystemExit("[anp-producao] ERROR: 0 rows parsed — source empty or "
                         "schema changed (hard error, not a silent skip).")
    if "GASOLINA A" not in by_prod or "OLEO DIESEL" not in by_prod:
        raise SystemExit("[anp-producao] ERROR: one of the required products is "
                         f"missing from the parse (got {sorted(by_prod)}).")

    if args.dump_json:
        out_path = Path(args.dump_json)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(records, ensure_ascii=False, indent=2),
                            encoding="utf-8")
        print(f"\nWrote {len(records):,} records to {out_path}")

    if args.dry_run:
        print("\n[dry-run] not upserting.")
        return

    url, key = _get_creds()
    if not url or not key:
        if args.dump_json:
            print("\n[no creds] SUPABASE_URL/SUPABASE_SERVICE_KEY missing — "
                  "JSON dump written, skipping upsert.")
            return
        raise SystemExit("[anp-producao] ERROR: SUPABASE_URL / SUPABASE_SERVICE_KEY "
                         "not set and no --dump-json fallback.")

    from supabase import create_client

    sb = create_client(url, key)
    total = _upsert(sb, records)
    print(f"\nDone: upserted {total:,} rows into {_TABLE}.")


if __name__ == "__main__":
    main()
