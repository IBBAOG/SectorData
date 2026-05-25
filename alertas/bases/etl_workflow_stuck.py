"""
Alert base: ETL Workflow Stuck Detector

Detects GitHub Actions workflows that have N>=3 consecutive failures.
Uses `gh run list` (GitHub CLI) or GitHub REST API (GITHUB_TOKEN env var) as fallback.

Transition logic:
  - "ok" -> "stuck": sends alert email with markdown table of stuck workflows.
  - "stuck" -> "ok": sends recovery email (closes the mental loop).
  - "stuck" -> "stuck": no re-alert (debounce — only notifies on state transition).

State format (alertas/estado/etl_workflow_stuck.json):
  {
    "etl_anp_cdp.yml": { "status": "stuck", "since": "2026-05-23", "consecutive_failures": 8 },
    "etl_mdic_comex.yml": { "status": "ok" }
  }
"""

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from .base import BaseMonitor

_ALERTAS_DIR = Path(__file__).parent.parent

# Repo that owns the workflows. Used for building action links.
_GITHUB_REPO = "IBBAOG/dashboard_projeto"
_GITHUB_API  = "https://api.github.com"

# Workflows monitored for consecutive failures.
CRITICAL_WORKFLOWS = [
    "etl_anp_cdp.yml",
    "etl_anp_cdp_diaria.yml",
    "etl_anp_fase3.yml",
    "etl_anp_precos.yml",
    "etl_anp_lpc.yml",
    "etl_anp_vendas.yml",
    "etl_anp_voip.yml",
    "etl_anp_subsidy_diesel.yml",
    "etl_mdic_comex.yml",
    "etl_sindicom.yml",
    "etl_navios_lineup.yml",
    "etl_ais_positions.yml",
    # supabase_deploy.yml intentionally excluded: failures are normal during development.
]

# Minimum consecutive failures before alerting.
_FAILURE_THRESHOLD = 3

# Conclusions that count as failure (not cancelled — user may cancel deliberately).
_FAILURE_CONCLUSIONS = {"failure", "timed_out", "startup_failure"}

# Conclusions that count as success (workflow ran and passed).
_SUCCESS_CONCLUSIONS = {"success"}

# How many recent runs to fetch per workflow.
_RUNS_LIMIT = 10


def _workflow_link(workflow_file: str) -> str:
    """Build GitHub Actions URL for a specific workflow file."""
    return f"https://github.com/{_GITHUB_REPO}/actions/workflows/{workflow_file}"


def _fetch_runs_gh_cli(workflow_file: str) -> list[dict] | None:
    """
    Fetch recent runs using `gh run list`.
    Returns list of dicts with keys: conclusion, createdAt, databaseId.
    Returns None on error (caller should try fallback).
    """
    try:
        result = subprocess.run(
            [
                "gh", "run", "list",
                "--workflow", workflow_file,
                "--limit", str(_RUNS_LIMIT),
                "--json", "conclusion,createdAt,databaseId",
                "--repo", _GITHUB_REPO,
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
        )
        if result.returncode != 0:
            print(f"    [gh cli] {workflow_file}: rc={result.returncode} — {result.stderr[:200]}")
            return None
        return json.loads(result.stdout)
    except FileNotFoundError:
        # gh CLI not installed
        return None
    except Exception as e:
        print(f"    [gh cli] {workflow_file}: unexpected error — {e}")
        return None


def _fetch_runs_github_api(workflow_file: str, token: str) -> list[dict] | None:
    """
    Fetch recent runs using GitHub REST API.
    Returns list of dicts (normalized to same shape as gh CLI output).
    Returns None on error.
    """
    try:
        import requests as _req
        url = f"{_GITHUB_API}/repos/{_GITHUB_REPO}/actions/workflows/{workflow_file}/runs"
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        resp = _req.get(url, headers=headers, params={"per_page": _RUNS_LIMIT}, timeout=20)
        if resp.status_code == 404:
            # Workflow not found — might have been renamed; treat as no data.
            print(f"    [github api] {workflow_file}: 404 — workflow not found, skipping.")
            return []
        resp.raise_for_status()
        raw_runs = resp.json().get("workflow_runs", [])
        # Normalize to the same keys used by gh CLI output
        return [
            {
                "conclusion": r.get("conclusion") or "",
                "createdAt":  r.get("created_at") or "",
                "databaseId": r.get("id"),
            }
            for r in raw_runs
        ]
    except Exception as e:
        print(f"    [github api] {workflow_file}: error — {e}")
        return None


def _get_runs(workflow_file: str, github_token: str | None) -> list[dict]:
    """
    Try gh CLI first, fall back to GitHub REST API if CLI unavailable.
    Returns empty list on complete failure (base will skip this workflow gracefully).
    """
    runs = _fetch_runs_gh_cli(workflow_file)
    if runs is not None:
        return runs

    if github_token:
        runs = _fetch_runs_github_api(workflow_file, github_token)
        if runs is not None:
            return runs
        print(f"    [warn] {workflow_file}: both gh CLI and API failed — skipping.")
    else:
        print(f"    [warn] {workflow_file}: gh CLI unavailable and no GITHUB_TOKEN — skipping.")
    return []


def _count_consecutive_failures(runs: list[dict]) -> tuple[int, str | None]:
    """
    Count leading consecutive failures (ignoring cancelled runs).
    Returns (failure_count, date_of_first_failure_in_streak).
    'cancelled' runs are skipped transparently (not counted as failure or success).
    """
    count = 0
    first_failure_date: str | None = None

    for run in runs:
        conclusion = (run.get("conclusion") or "").lower()
        if conclusion in ("cancelled", "skipped", ""):
            # Ignore — user may have cancelled deliberately; does not break the streak.
            continue
        if conclusion in _FAILURE_CONCLUSIONS:
            count += 1
            raw_date = (run.get("createdAt") or "")[:10]  # YYYY-MM-DD
            if raw_date:
                first_failure_date = first_failure_date or raw_date
        elif conclusion in _SUCCESS_CONCLUSIONS:
            # Streak broken by a success
            break
        # Other conclusions (neutral) continue to next run without breaking streak

    return count, first_failure_date


def _last_success_date(runs: list[dict]) -> str:
    """Return the createdAt date of the most recent successful run, or 'never'."""
    for run in runs:
        conclusion = (run.get("conclusion") or "").lower()
        if conclusion in _SUCCESS_CONCLUSIONS:
            return (run.get("createdAt") or "")[:10] or "unknown"
    return "never"


class EtlWorkflowStuck(BaseMonitor):
    slug = "etl_workflow_stuck"
    nome = "ETL Workflows — Consecutive Failures Detector"
    url  = f"https://github.com/{_GITHUB_REPO}/actions"

    # ── interface BaseMonitor ─────────────────────────────────────────────────

    def verificar(self) -> tuple:
        """
        Returns (tem_novidade: bool, novo_estado: dict, mensagem: str).
        tem_novidade=True when ANY workflow transitions to/from stuck, or a new
        stuck workflow is detected that was not previously known.
        """
        token = (os.environ.get("GITHUB_TOKEN") or "").strip()
        estado = self.ler_estado()

        newly_stuck:     list[dict] = []  # "ok"|unknown -> "stuck"
        newly_recovered: list[dict] = []  # "stuck" -> "ok"
        still_stuck:     list[dict] = []  # "stuck" -> "stuck" (no re-alert)
        novo_estado = dict(estado)         # will be updated in place

        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        for wf in CRITICAL_WORKFLOWS:
            print(f"    checking {wf}...")
            try:
                runs = _get_runs(wf, token)
            except Exception as e:
                print(f"    [warn] {wf}: exception getting runs — {e}")
                continue

            if not runs:
                # No data: leave existing state untouched.
                continue

            consecutive, first_date = _count_consecutive_failures(runs)
            prev = estado.get(wf, {})
            prev_status = prev.get("status", "ok")

            if consecutive >= _FAILURE_THRESHOLD:
                wf_info = {
                    "workflow": wf,
                    "consecutive_failures": consecutive,
                    "since": first_date or prev.get("since") or today,
                    "last_success": _last_success_date(runs),
                    "link": _workflow_link(wf),
                }
                novo_estado[wf] = {
                    "status": "stuck",
                    "since": wf_info["since"],
                    "consecutive_failures": consecutive,
                }
                if prev_status != "stuck":
                    newly_stuck.append(wf_info)
                else:
                    still_stuck.append(wf_info)
            else:
                novo_estado[wf] = {"status": "ok"}
                if prev_status == "stuck":
                    newly_recovered.append({
                        "workflow": wf,
                        "link": _workflow_link(wf),
                    })

        # There's a novelty if any workflow newly became stuck OR newly recovered.
        tem_novidade = bool(newly_stuck) or bool(newly_recovered)

        if not tem_novidade:
            if still_stuck:
                print(
                    f"  >> {len(still_stuck)} workflow(s) still stuck — no re-alert (debounce)."
                )
            return False, novo_estado, ""

        # Build summary message for historico (plain text).
        partes = []
        if newly_stuck:
            names = ", ".join(w["workflow"] for w in newly_stuck)
            partes.append(f"{len(newly_stuck)} newly stuck: {names}")
        if newly_recovered:
            names = ", ".join(w["workflow"] for w in newly_recovered)
            partes.append(f"{len(newly_recovered)} recovered: {names}")
        mensagem = " | ".join(partes)

        # Attach structured data for use in run().
        novo_estado["_newly_stuck"]     = newly_stuck
        novo_estado["_newly_recovered"] = newly_recovered

        return True, novo_estado, mensagem

    def baixar(self, novo_estado: dict) -> list:
        """No files to download — GitHub is the source of truth."""
        return []

    # ── run() override for structured HTML email ──────────────────────────────

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

        newly_stuck:     list[dict] = novo_estado.pop("_newly_stuck",     [])
        newly_recovered: list[dict] = novo_estado.pop("_newly_recovered", [])

        # Save state BEFORE sending email to minimise duplicate sends on transient errors.
        # (Unlike data bases, there are no large files to download, so fail-fast is fine.)
        self.salvar_estado(novo_estado)
        self.registrar_historico(mensagem, novo_estado, [])

        sys.path.insert(0, str(_ALERTAS_DIR))
        from notificador import enviar_alerta  # type: ignore

        if newly_stuck:
            self._send_stuck_email(newly_stuck, enviar_alerta)

        if newly_recovered:
            self._send_recovery_email(newly_recovered, enviar_alerta)

        return True

    # ── private email helpers ─────────────────────────────────────────────────

    def _send_stuck_email(self, stuck_list: list[dict], enviar_alerta) -> None:
        """Send the 'N workflows stuck' alert email."""
        n = len(stuck_list)
        subject_tag = f"{n} workflow(s) ETL with consecutive failures"

        # Markdown-style table rendered as plain text (notificador wraps in HTML).
        table_rows = "\n".join(
            f"  {w['workflow']:<45} | last {w['consecutive_failures']} runs failed"
            f" | since {w['since']}"
            f" | last success: {w['last_success']}"
            for w in stuck_list
        )

        links = "\n".join(
            f"  {w['workflow']}: {w['link']}" for w in stuck_list
        )

        corpo = (
            f"{n} critical ETL workflow(s) have {_FAILURE_THRESHOLD}+ consecutive failures:\n\n"
            f"{table_rows}\n\n"
            f"Action links:\n{links}\n\n"
            f"Check the run logs for errors and re-trigger if needed:\n"
            f"  gh workflow run <name> --repo {_GITHUB_REPO}\n\n"
            f"Tip: 'cancelled' runs are ignored (user-initiated cancellations do not count)."
        )

        try:
            enviar_alerta(subject_tag, corpo, link=self.url)
        except Exception as e:
            print(f"  >> ERRO ao enviar email stuck: {e}")

    def _send_recovery_email(self, recovered_list: list[dict], enviar_alerta) -> None:
        """Send a recovery confirmation email."""
        n = len(recovered_list)
        subject_tag = f"{n} ETL workflow(s) recovered (back to OK)"

        names_links = "\n".join(
            f"  {w['workflow']}: {w['link']}" for w in recovered_list
        )

        corpo = (
            f"{n} previously stuck workflow(s) are now back to OK:\n\n"
            f"{names_links}\n\n"
            f"No action needed — just keeping you in the loop."
        )

        try:
            enviar_alerta(subject_tag, corpo, link=self.url)
        except Exception as e:
            print(f"  >> ERRO ao enviar email recovery: {e}")
