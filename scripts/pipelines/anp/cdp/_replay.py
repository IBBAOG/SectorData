#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
_replay.py — ANP/CDP APEX session replay (pure requests, zero Selenium).

Módulo standalone importável pelo ETL e pelo monitor de alertas.
Única dependência de runtime: requests, json, re, urllib.parse, os, pathlib, time.
Sem Selenium, sem ddddocr, sem PIL.

Contrato público:
    replay_download(session_data, periodo, ambiente, output_dir) -> ReplayResult

Onde ReplayResult é um dataclass com:
    status  : Literal["ok", "expired", "error"]
    csv_path: str | None   (preenchido apenas quando status == "ok")
    message : str          (descrição legível do resultado)
"""

import json
import os
import re
import time
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Optional

import requests

# ─── Constantes ──────────────────────────────────────────────────────────────

ORDS_BASE = "https://cdp.anp.gov.br/ords"

# Padrões que indicam sessão APEX inválida / redirect para login
_EXPIRED_PATTERNS = [
    re.compile(r"ORA-20876", re.IGNORECASE),       # APEX session expired
    re.compile(r"Session expired", re.IGNORECASE),
    re.compile(r"Your session has expired", re.IGNORECASE),
    re.compile(r"/ords/r/cdp_apex/.*?/login", re.IGNORECASE),
    re.compile(r"f\?p=\d+:LOGIN", re.IGNORECASE),
    re.compile(r"apex_authentication\.process_credentials", re.IGNORECASE),
]

# Padrões que indicam que a resposta é a página APEX completa (form HTML) em vez do CSV.
# Isso acontece quando a sessão expirou no servidor mas retorna HTTP 200 sem redirect para login.
# Detectado em 2026-05-18: strategy 2 (f?p:CSV) retornava a página de busca como HTML.
_APEX_PAGE_PATTERNS = [
    re.compile(r'<form[^>]+action="wwv_flow\.accept', re.IGNORECASE),
    re.compile(r'id="wwvFlowForm"', re.IGNORECASE),
    re.compile(r'wwv_flow\.accept\?p_context=', re.IGNORECASE),
]


# ─── Result type ─────────────────────────────────────────────────────────────

@dataclass
class ReplayResult:
    status: Literal["ok", "expired", "error"]
    csv_path: Optional[str]
    message: str


# ─── Internal helpers ─────────────────────────────────────────────────────────

def _build_requests_session(session_data: dict) -> requests.Session:
    """Build a requests.Session with cookies from the Selenium capture."""
    s = requests.Session()
    # Do NOT set a browser User-Agent — Cloudflare detects the TLS fingerprint mismatch
    # and returns 403. The default python-requests UA passes through fine.

    # Use full cookie objects (with domain/path) when available
    cookies_full = session_data.get("cookies_full", [])
    if cookies_full:
        for c in cookies_full:
            domain = c.get("domain", "cdp.anp.gov.br").lstrip(".")
            s.cookies.set(c["name"], c["value"], domain=domain, path=c.get("path", "/"))
    else:
        for name, value in session_data.get("cookies", {}).items():
            s.cookies.set(name, value, domain="cdp.anp.gov.br", path="/")
    return s


def _looks_like_expired(response: requests.Response) -> bool:
    """Return True if the response body/headers indicate an expired APEX session.

    Covers two cases:
    1. Explicit redirect/message: ORA-20876, 'Session expired', login redirect URL.
    2. Silent expiry: server returns HTTP 200 with the full APEX page (form HTML)
       instead of a CSV or JSON download link. This happens when the APEX session token
       is no longer valid on the server side but there is no redirect.
       Detected in production on 2026-05-18 (f?p:CSV strategy returned page-54 HTML).
    """
    # Redirect to login URL
    if response.history:
        for redir in response.history:
            loc = redir.headers.get("Location", "")
            if "login" in loc.lower() or "f?p=" in loc.lower():
                return True

    content_type = response.headers.get("Content-Type", "").lower()
    # Only inspect HTML bodies for expiry patterns
    if "text/html" in content_type:
        snippet = response.text[:4096]
        for pat in _EXPIRED_PATTERNS:
            if pat.search(snippet):
                return True
        # Detect silent expiry: APEX returned the full page form instead of CSV/JSON
        for pat in _APEX_PAGE_PATTERNS:
            if pat.search(snippet):
                return True
    return False


def _looks_like_csv(text: str) -> bool:
    """
    Heuristic check: first non-empty line should look like a CSV header, not HTML.
    Guards against silently accepting an APEX error page or login redirect as CSV data.
    """
    for line in text.splitlines():
        stripped = line.strip()
        if stripped:
            # HTML documents start with '<!', '<html', or '<!' (BOM may precede)
            low = stripped.lower().lstrip("﻿")
            if low.startswith("<!") or low.startswith("<html") or low.startswith("<head"):
                return False
            # A CSV header should contain at least one comma
            return "," in stripped or ";" in stripped
    return False


def _try_download_url(
    s: requests.Session,
    url: str,
    label: str,
    download_dir: str,
    periodo: str,
    ambiente: str,
) -> Optional[str]:
    """
    GET a URL and return the path to the saved CSV if it yields valid data.
    Returns None otherwise (does NOT raise).
    """
    try:
        r = s.get(url, timeout=30, allow_redirects=True)
        ct = r.headers.get("Content-Type", "")
        cd = r.headers.get("Content-Disposition", "")

        if r.status_code == 200 and ("csv" in ct.lower() or "attachment" in cd.lower()):
            lines = [line for line in r.text.splitlines() if line.strip()]
            if len(lines) > 1 and _looks_like_csv(r.text):
                print(f"    [fast] {label} funcionou ({len(lines)-1} linhas)")
                safe_periodo = periodo.replace("/", "-")
                p = os.path.join(download_dir, f"fast_{safe_periodo}_{ambiente}.csv")
                Path(download_dir).mkdir(parents=True, exist_ok=True)
                with open(p, "wb") as f:
                    f.write(r.content)
                return p
            elif len(lines) > 1:
                print(f"    [fast] {label}: response has {len(lines)} lines but does not look like CSV "
                      f"(first line: {lines[0][:100]!r})")

        print(f"    [fast] {label}: HTTP {r.status_code} ct={ct!r} cd={cd!r}")
    except Exception as e:
        print(f"    [fast] {label} erro: {e}")
    return None


def _strategy_1_apex_get_download_link(
    s: requests.Session,
    session_data: dict,
    periodo: str,
    ambiente: str,
    download_dir: str,
) -> tuple[Literal["ok", "expired", "error", "miss"], Optional[str]]:
    """
    Replay the captured XHR (GET_DOWNLOAD_LINK) with updated pageItems,
    parse the returned JSON for a download URL, then GET that URL.

    Returns ("ok", path) | ("expired", None) | ("error", None) | ("miss", None).
    "miss" means the strategy simply didn't find a result — caller should try next strategy.
    """
    apex_env = session_data.get("apex_env", {})
    dl_req = session_data.get("download_req")
    base_url = session_data.get("base_url", ORDS_BASE)
    p_instance = apex_env.get("p_instance", "")

    if not dl_req:
        return ("miss", None)

    raw_url = dl_req.get("url") or dl_req.get("__action__", "")
    method = (dl_req.get("method") or dl_req.get("__method__", "POST")).upper()
    body = dl_req.get("body") or ""

    # Fix relative URL
    if raw_url and not raw_url.startswith("http"):
        raw_url = f"{base_url}/{raw_url.lstrip('/')}"

    # Update p_instance in URL
    old_inst = apex_env.get("p_instance", "")
    if old_inst and old_inst in raw_url:
        raw_url = raw_url.replace(old_inst, p_instance)

    try:
        params_list = urllib.parse.parse_qsl(body, keep_blank_values=True)

        # Update p_instance in body params
        params_list = [
            (k, p_instance if k == "p_instance" else v)
            for k, v in params_list
        ]

        # Inject pageItems to update P54_PERIODO in session state
        new_list = []
        for k, v in params_list:
            if k == "p_json":
                try:
                    pj = json.loads(v)
                except Exception:
                    pj = {}
                pj["pageItems"] = "#P54_PERIODO,#P54_AMBIENTE"
                v = json.dumps(pj)
            new_list.append((k, v))
        params_list = new_list
        params_list.extend([("P54_PERIODO", periodo), ("P54_AMBIENTE", ambiente)])

        if method == "POST":
            r = s.post(raw_url, data=params_list, timeout=30)
        else:
            r = s.get(raw_url, params=params_list, timeout=30)

        print(
            f"    [fast] GET_DOWNLOAD_LINK -> HTTP {r.status_code} "
            f"ct={r.headers.get('Content-Type','')!r}"
        )

        # Check for session expiry before anything else
        if _looks_like_expired(r):
            return ("expired", None)

        if r.status_code != 200:
            return ("miss", None)

        # ── Try to parse JSON response ────────────────────────────────────────
        try:
            resp_json = r.json()
            dl_url = (
                resp_json.get("url")
                or resp_json.get("redirectUrl")
                or resp_json.get("download_url")
                or resp_json.get("fileUrl")
            )
            if not dl_url:
                for v in resp_json.values():
                    if isinstance(v, str) and ("wwv_flow" in v or "/ords/" in v):
                        dl_url = v
                        break

            if dl_url:
                host = base_url.split("/ords")[0]
                if not dl_url.startswith("http"):
                    dl_url = host + dl_url if dl_url.startswith("/") else f"{host}/{dl_url}"
                print(f"    [fast] Download URL: {dl_url[:100]}")
                result = _try_download_url(s, dl_url, "GET_DOWNLOAD_LINK->GET", download_dir, periodo, ambiente)
                if result:
                    return ("ok", result)
                return ("miss", None)
            else:
                print(f"    [fast] Resposta JSON sem URL de download: {str(resp_json)[:200]}")
                return ("miss", None)

        except Exception:
            # Not JSON — try direct CSV or plain-text URL
            ct = r.headers.get("Content-Type", "")
            cd = r.headers.get("Content-Disposition", "")

            if "csv" in ct.lower() or "attachment" in cd.lower():
                lines = [line for line in r.text.splitlines() if line.strip()]
                if len(lines) > 1:
                    print(f"    [fast] GET_DOWNLOAD_LINK retornou CSV diretamente")
                    safe_periodo = periodo.replace("/", "-")
                    p = os.path.join(download_dir, f"fast_{safe_periodo}_{ambiente}.csv")
                    Path(download_dir).mkdir(parents=True, exist_ok=True)
                    with open(p, "wb") as f:
                        f.write(r.content)
                    return ("ok", p)

            dl_path = r.text.strip()
            if dl_path.startswith("/") or dl_path.startswith("http"):
                host = base_url.split("/ords")[0]
                dl_url = host + dl_path if not dl_path.startswith("http") else dl_path
                print(f"    [fast] Download URL (text): {dl_url[:200]}")
                result = _try_download_url(s, dl_url, "GET_DOWNLOAD_LINK->GET(text)", download_dir, periodo, ambiente)
                if result:
                    return ("ok", result)

            print(f"    [fast] Resposta não é JSON nem CSV: {r.text[:200]}")
            return ("miss", None)

    except Exception as e:
        print(f"    [fast] Estratégia 1 erro: {e}")
        return ("error", None)


def _strategy_2_fp_csv(
    s: requests.Session,
    session_data: dict,
    periodo: str,
    ambiente: str,
    download_dir: str,
) -> tuple[Literal["ok", "expired", "miss"], Optional[str]]:
    """
    Standard f?p:CSV trigger. Works only if session state has the right P54_PERIODO.
    Returns ("ok", path) | ("expired", None) | ("miss", None).
    """
    apex_env = session_data.get("apex_env", {})
    base_url = session_data.get("base_url", ORDS_BASE)
    app_id = apex_env.get("app_id", "")
    page_id = apex_env.get("page_id", "")
    p_instance = apex_env.get("p_instance", "")

    dl_url = f"{base_url}/f?p={app_id}:{page_id}:{p_instance}:CSV"
    try:
        r = s.get(dl_url, timeout=30, allow_redirects=True)
        if _looks_like_expired(r):
            return ("expired", None)
    except Exception:
        pass  # fall through to _try_download_url which handles errors

    result = _try_download_url(s, dl_url, "f?p:CSV", download_dir, periodo, ambiente)
    if result:
        return ("ok", result)
    return ("miss", None)


# ─── Public API ───────────────────────────────────────────────────────────────

def replay_download(
    session_data: dict,
    periodo: str,
    ambiente: str,
    output_dir: str,
) -> ReplayResult:
    """
    Attempt to download a CSV for the given periodo/ambiente using only the saved
    APEX session — no Selenium, no CAPTCHA.

    Parameters
    ----------
    session_data : dict
        Content of session.json as a Python dict (loaded by the caller).
    periodo : str
        Period in MM/YYYY format (e.g. "01/2025").
    ambiente : str
        Environment code: "M" (Mar), "S" (Pre-Sal), "T" (Terra).
    output_dir : str
        Directory where the downloaded CSV should be written.

    Returns
    -------
    ReplayResult
        .status   : "ok"      — CSV downloaded successfully; .csv_path is set
                    "expired" — APEX session is invalid (cookies rejected, redirect
                                to login, ORA-20876, etc.); alertas should trigger
                                a new --capture run
                    "error"   — any other failure (network, parsing, etc.)
        .csv_path : absolute path to the downloaded CSV, or None
        .message  : human-readable description of the outcome
    """
    apex_env = session_data.get("apex_env", {})
    if not apex_env.get("p_instance"):
        return ReplayResult(
            status="error",
            csv_path=None,
            message="session_data missing apex_env.p_instance — not a valid session",
        )

    # The FILE_ID embedded in the captured XHR is tied to the specific Buscar query
    # (periodo + ambiente). Replaying for a different periodo/ambiente would return
    # the captured period's data — we skip Strategy 1 silently in that case.
    cap_periodo = session_data.get("captured_periodo")
    cap_ambiente = session_data.get("captured_ambiente")
    same_period = (not cap_periodo or not cap_ambiente
                   or (periodo == cap_periodo and ambiente == cap_ambiente))

    download_dir = str(Path(output_dir) / "_downloads")
    Path(download_dir).mkdir(parents=True, exist_ok=True)

    s = _build_requests_session(session_data)
    base_url = session_data.get("base_url", ORDS_BASE)

    # ── Strategy 1: APEX GET_DOWNLOAD_LINK (only for exact same periodo/ambiente) ──
    if same_period:
        status1, path1 = _strategy_1_apex_get_download_link(
            s, session_data, periodo, ambiente, download_dir
        )
        if status1 == "ok" and path1:
            # Move to final destination
            safe = periodo.replace("/", "-")
            final = os.path.join(output_dir, f"producao_poco_{safe}_{ambiente}.csv")
            import shutil
            shutil.move(path1, final)
            return ReplayResult(status="ok", csv_path=final, message=f"Strategy 1 ok: {final}")
        if status1 == "expired":
            return ReplayResult(
                status="expired",
                csv_path=None,
                message="Strategy 1: APEX session expired (ORA-20876 / login redirect)",
            )
        if status1 == "error":
            return ReplayResult(
                status="error",
                csv_path=None,
                message="Strategy 1: network/parsing error",
            )
        # "miss" — fall through to strategy 2
    else:
        print(
            f"    [replay] Período/ambiente diferente do capturado "
            f"({cap_periodo}/{cap_ambiente}), pulando Strategy 1"
        )

    # ── Strategy 2: f?p:CSV ───────────────────────────────────────────────────
    status2, path2 = _strategy_2_fp_csv(s, session_data, periodo, ambiente, download_dir)
    if status2 == "ok" and path2:
        safe = periodo.replace("/", "-")
        final = os.path.join(output_dir, f"producao_poco_{safe}_{ambiente}.csv")
        import shutil
        shutil.move(path2, final)
        return ReplayResult(status="ok", csv_path=final, message=f"Strategy 2 ok: {final}")
    if status2 == "expired":
        return ReplayResult(
            status="expired",
            csv_path=None,
            message="Strategy 2: APEX session expired (login redirect on f?p:CSV)",
        )

    return ReplayResult(
        status="error",
        csv_path=None,
        message="All strategies exhausted without downloading a valid CSV",
    )
