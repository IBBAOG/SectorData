"""
Workflow-failure pager (OPS alert).

The LOUD-failure counterpart to the Data Freshness Guardian. The freshness
guardian (scripts/freshness_monitor.py) catches a SILENT stall — a workflow that
stays GREEN while its data stops advancing. It does NOT catch a workflow that
goes RED and stays RED. That capability used to live in the now-disabled
alertas/bases/etl_workflow_stuck.py (driven by the retired Alertas Monitor
workflow, alertas_monitor.yml). This script re-homes it onto the repo with the
current SMTP email sender.

What it does
  * Polls the GitHub REST API for the last few runs of each CRITICAL_WORKFLOWS
    entry (GET /repos/<repo>/actions/workflows/<wf>.yml/runs).
  * Counts LEADING consecutive failures, ignoring 'cancelled'/'skipped'/in-flight
    runs (a user-initiated cancel must not look like a failure, nor break the
    streak). A run conclusion in {failure, timed_out, startup_failure} counts as
    a failure; a 'success' breaks the streak.
  * A workflow with >= 3 consecutive failures is STUCK.

State machine (debounced — pages on TRANSITIONS only)
  * ok    -> stuck : page once (this workflow is now failing).
  * stuck -> ok    : send a recovery note (close the loop).
  * stuck -> stuck : no re-page (debounce).
  Transition state lives in the Supabase `alertas_estado` table under the single
  key 'workflow_failure_monitor' (a jsonb map of workflow_file -> {status,...}),
  kept DISTINCT from the legacy 'etl_workflow_stuck' key so the two never collide.

Email
  * Sent via the proven Gmail SMTP sender (scripts/client_alerts/_core/
    gmail_client.send_email) to ALERTAS_DEST_EMAIL (default
    eduardo.mendes@itaubba.com).
  * Subject: "[SectorData] WARNING N ETL workflow(s) failing" with a table
    (workflow / consecutive failures / last success). A recovery transition adds
    a short "back to OK" section.
  * Sends NOTHING when there is no transition (all healthy, or only still-stuck).
  * ALWAYS logs the full per-workflow status to stdout so the run log is a
    complete snapshot every run.

Env gate (reuses scripts/client_alerts/_core/config.validate):
  Required: SUPABASE_URL, a service key (SUPABASE_SERVICE_KEY or
  SUPABASE_SERVICE_ROLE_KEY), GMAIL_APP_PASSWORD; PLUS GITHUB_TOKEN to read the
  Actions API. With an incomplete env the CLI prints the missing vars and exits
  non-zero — no stack trace.

Run:  python -m scripts.workflow_failure_monitor
"""
from __future__ import annotations

import html as html_lib
import logging
import os
import sys
from datetime import datetime, timezone

from scripts.client_alerts._core import config
from scripts.client_alerts._core.gmail_client import send_email, validate_api_key
from scripts.client_alerts._core.supabase_client import get_client

logger = logging.getLogger("workflow_failure_monitor")

# ── Repo / API ────────────────────────────────────────────────────────────────
# The repository that OWNS the workflows (where this script runs). The legacy
# detector pointed at IBBAOG/dashboard_projeto; the live repo is IBBAOG/SectorData.
GITHUB_REPO = os.environ.get("GITHUB_REPOSITORY", "IBBAOG/SectorData")
GITHUB_API = "https://api.github.com"

# ── Recipient ─────────────────────────────────────────────────────────────────
# Ops page goes to the team, not to client subscribers. Defaults to Eduardo's
# work inbox (the primary recipient of operational alerts).
DEST_EMAIL: str = os.environ.get("ALERTAS_DEST_EMAIL", "eduardo.mendes@itaubba.com")

# ── State key ─────────────────────────────────────────────────────────────────
# Single row in alertas_estado holding the transition state for ALL monitored
# workflows. DISTINCT from the legacy 'etl_workflow_stuck' key so re-homing here
# never collides with any stale legacy entry.
STATE_KEY = "workflow_failure_monitor"

# ── Critical workflows ────────────────────────────────────────────────────────
# The legacy CRITICAL_WORKFLOWS list, refreshed to today's .github/workflows/:
#   * Dropped vs legacy: etl_sindicom.yml (no longer exists in the repo).
#   * Added vs legacy: etl_anp_precos_distribuicao.yml, etl_ais_candidates.yml,
#     client_alerts_digest.yml, client_alerts_poll.yml, freshness_monitor.yml.
# Every entry below was confirmed against the actual files in .github/workflows/.
# supabase_deploy.yml is intentionally EXCLUDED (failures are normal during
# development and would be noise).
CRITICAL_WORKFLOWS = [
    # ── ANP ───────────────────────────────────────────────────────────────────
    "etl_anp_cdp.yml",
    "etl_anp_cdp_diaria.yml",
    "etl_anp_fase3.yml",
    "etl_anp_precos.yml",
    "etl_anp_precos_distribuicao.yml",
    "etl_anp_lpc.yml",
    "etl_anp_vendas.yml",
    "etl_anp_voip.yml",
    "etl_anp_subsidy_diesel.yml",
    # ── Trade ─────────────────────────────────────────────────────────────────
    "etl_mdic_comex.yml",
    # ── Vessels / AIS ─────────────────────────────────────────────────────────
    "etl_navios_lineup.yml",
    "etl_ais_positions.yml",
    "etl_ais_candidates.yml",
    # ── Client Alerts product + OPS monitors ──────────────────────────────────
    "client_alerts_digest.yml",
    "client_alerts_poll.yml",
    "freshness_monitor.yml",
]

# Minimum LEADING consecutive failures before a workflow is considered STUCK.
FAILURE_THRESHOLD = 3

# Conclusions that count as a failure (NOT 'cancelled' — a user may cancel a run
# deliberately and that must not look like a failure).
_FAILURE_CONCLUSIONS = {"failure", "timed_out", "startup_failure"}

# Conclusions that count as a success (a run that completed and passed).
_SUCCESS_CONCLUSIONS = {"success"}

# Conclusions / states that are IGNORED — they neither count as a failure nor
# break the failure streak (transparently skipped). Empty conclusion == the run
# is still in flight (queued / in_progress) and has no verdict yet.
_IGNORED_CONCLUSIONS = {"cancelled", "skipped", ""}

# How many recent runs to fetch per workflow.
RUNS_LIMIT = 10

# HTTP timeout per Actions API call (seconds).
_HTTP_TIMEOUT = 20


# ── GitHub API ────────────────────────────────────────────────────────────────
def _workflow_link(workflow_file: str) -> str:
    """Build the GitHub Actions URL for a specific workflow file."""
    return f"https://github.com/{GITHUB_REPO}/actions/workflows/{workflow_file}"


def fetch_runs(workflow_file: str, token: str) -> list[dict] | None:
    """
    Fetch the most recent runs of a workflow via the GitHub REST API.

    GET /repos/<repo>/actions/workflows/<wf>.yml/runs?per_page=<RUNS_LIMIT>

    Returns a list of normalized dicts {conclusion, created_at, id} ordered
    newest-first (the API default), [] when the workflow is not found (404 — e.g.
    renamed since this list was written), or None on any other error so the
    caller can leave that workflow's state untouched this run.
    """
    import requests

    url = f"{GITHUB_API}/repos/{GITHUB_REPO}/actions/workflows/{workflow_file}/runs"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    try:
        resp = requests.get(
            url, headers=headers, params={"per_page": RUNS_LIMIT}, timeout=_HTTP_TIMEOUT
        )
    except Exception as exc:  # noqa: BLE001 — network error: skip this workflow, keep state
        logger.warning("  %s: request error — %s", workflow_file, exc)
        return None

    if resp.status_code == 404:
        # Workflow file not found — possibly renamed. Treat as no data (skip),
        # never as a failure.
        logger.warning("  %s: 404 (workflow not found) — skipping.", workflow_file)
        return []
    if resp.status_code != 200:
        logger.warning(
            "  %s: HTTP %s — %s",
            workflow_file, resp.status_code, (resp.text or "")[:200],
        )
        return None

    try:
        raw_runs = resp.json().get("workflow_runs", [])
    except ValueError as exc:
        logger.warning("  %s: bad JSON — %s", workflow_file, exc)
        return None

    return [
        {
            "conclusion": (r.get("conclusion") or ""),
            "created_at": (r.get("created_at") or ""),
            "id": r.get("id"),
        }
        for r in raw_runs
    ]


# ── Detection ─────────────────────────────────────────────────────────────────
def count_consecutive_failures(runs: list[dict]) -> tuple[int, str | None]:
    """
    Count LEADING consecutive failures (newest-first), ignoring cancelled /
    skipped / in-flight runs.

    Returns (failure_count, date_of_first_failure_in_streak).
      * A run whose conclusion is in _IGNORED_CONCLUSIONS is skipped transparently
        (neither counted nor streak-breaking).
      * A run in _FAILURE_CONCLUSIONS increments the count.
      * A run in _SUCCESS_CONCLUSIONS BREAKS the streak (stop).
      * Any other (neutral) conclusion does not break the streak and is not
        counted (continue scanning).
    """
    count = 0
    first_failure_date: str | None = None

    for run in runs:
        conclusion = (run.get("conclusion") or "").lower()
        if conclusion in _IGNORED_CONCLUSIONS:
            continue
        if conclusion in _FAILURE_CONCLUSIONS:
            count += 1
            raw_date = (run.get("created_at") or "")[:10]  # YYYY-MM-DD
            if raw_date:
                first_failure_date = first_failure_date or raw_date
        elif conclusion in _SUCCESS_CONCLUSIONS:
            break
        # else: neutral conclusion — continue without breaking the streak.

    return count, first_failure_date


def last_success_date(runs: list[dict]) -> str:
    """Return the date of the most recent successful run, or 'never'."""
    for run in runs:
        if (run.get("conclusion") or "").lower() in _SUCCESS_CONCLUSIONS:
            return (run.get("created_at") or "")[:10] or "unknown"
    return "never"


# ── Supabase state (alertas_estado) ───────────────────────────────────────────
def read_state(client) -> dict:
    """
    Read the transition-state map from alertas_estado[STATE_KEY].

    Returns {workflow_file: {"status": "ok"|"stuck", ...}, ...} or {} on miss.
    """
    try:
        res = (
            client.table("alertas_estado")
            .select("estado")
            .eq("base", STATE_KEY)
            .maybe_single()
            .execute()
        )
        data = getattr(res, "data", None)
        if data and isinstance(data.get("estado"), dict):
            return data["estado"]
    except Exception as exc:  # noqa: BLE001 — missing row / transient read error
        logger.warning("could not read alertas_estado[%s]: %s", STATE_KEY, exc)
    return {}


def save_state(client, estado: dict) -> None:
    """Upsert the transition-state map into alertas_estado[STATE_KEY]."""
    client.table("alertas_estado").upsert(
        {
            "base": STATE_KEY,
            "estado": estado,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        on_conflict="base",
    ).execute()


# ── Per-workflow verdict ──────────────────────────────────────────────────────
class WorkflowStatus:
    """Single workflow's verdict for one run."""

    __slots__ = (
        "workflow",
        "state",  # "STUCK" | "OK" | "NO_DATA"
        "consecutive_failures",
        "since",
        "last_success",
        "link",
        "transition",  # None | "newly_stuck" | "newly_recovered" | "still_stuck"
    )

    def __init__(
        self,
        workflow: str,
        state: str,
        consecutive_failures: int,
        since: str | None,
        last_success: str,
        link: str,
        transition: str | None,
    ) -> None:
        self.workflow = workflow
        self.state = state
        self.consecutive_failures = consecutive_failures
        self.since = since
        self.last_success = last_success
        self.link = link
        self.transition = transition


def evaluate(
    client, token: str, now: datetime | None = None
) -> tuple[list[WorkflowStatus], dict]:
    """
    Poll every critical workflow, classify it against the failure threshold, and
    compute the transition vs the previously-saved state.

    Returns (statuses, new_state_map). `new_state_map` is the jsonb to persist to
    alertas_estado[STATE_KEY]; a workflow with NO data this run keeps its prior
    state entry untouched (so a transient API hiccup never flips ok<->stuck).
    """
    now = now or datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")

    prev_state = read_state(client)
    new_state = dict(prev_state)  # start from prior, update per-workflow below
    statuses: list[WorkflowStatus] = []

    for wf in CRITICAL_WORKFLOWS:
        runs = fetch_runs(wf, token)
        if runs is None:
            # API error: leave this workflow's prior state untouched, report it as
            # NO_DATA for this run (no transition).
            statuses.append(
                WorkflowStatus(wf, "NO_DATA", 0, None, "unknown", _workflow_link(wf), None)
            )
            continue
        if not runs:
            # 404 / never ran: also leave prior state untouched.
            statuses.append(
                WorkflowStatus(wf, "NO_DATA", 0, None, "never", _workflow_link(wf), None)
            )
            continue

        consecutive, first_date = count_consecutive_failures(runs)
        last_ok = last_success_date(runs)
        prev = prev_state.get(wf, {})
        prev_status = prev.get("status", "ok")

        if consecutive >= FAILURE_THRESHOLD:
            since = first_date or prev.get("since") or today
            new_state[wf] = {
                "status": "stuck",
                "since": since,
                "consecutive_failures": consecutive,
            }
            transition = "newly_stuck" if prev_status != "stuck" else "still_stuck"
            statuses.append(
                WorkflowStatus(
                    wf, "STUCK", consecutive, since, last_ok, _workflow_link(wf), transition
                )
            )
        else:
            new_state[wf] = {"status": "ok"}
            transition = "newly_recovered" if prev_status == "stuck" else None
            statuses.append(
                WorkflowStatus(
                    wf, "OK", consecutive, None, last_ok, _workflow_link(wf), transition
                )
            )

    return statuses, new_state


# ── Logging ───────────────────────────────────────────────────────────────────
def log_statuses(statuses: list[WorkflowStatus]) -> None:
    """Always emit the complete per-workflow snapshot for the run log."""
    stuck = [s for s in statuses if s.state == "STUCK"]
    no_data = [s for s in statuses if s.state == "NO_DATA"]
    logger.info(
        "── Workflow failure snapshot (%d workflows · %d stuck · %d no-data) ──",
        len(statuses), len(stuck), len(no_data),
    )
    for s in statuses:
        extra = f" [{s.transition}]" if s.transition else ""
        logger.info(
            "  [%-8s] %-35s fails=%-2d since=%-10s last_success=%-10s%s",
            s.state,
            s.workflow,
            s.consecutive_failures,
            s.since or "—",
            s.last_success,
            extra,
        )


# ── Rendering ─────────────────────────────────────────────────────────────────
def render_text(
    newly_stuck: list[WorkflowStatus],
    still_stuck: list[WorkflowStatus],
    recovered: list[WorkflowStatus],
    generated_at: datetime,
) -> str:
    """Plain-text ops page body."""
    lines: list[str] = []
    lines.append("SectorData — Workflow Failure Pager")
    lines.append(f"Run: {generated_at.strftime('%Y-%m-%d %H:%M UTC')}")
    lines.append("")

    if newly_stuck:
        lines.append(
            f"{len(newly_stuck)} ETL workflow(s) now have "
            f"{FAILURE_THRESHOLD}+ consecutive failures:"
        )
        lines.append("")
        for s in newly_stuck:
            lines.append(
                f"  - {s.workflow}: {s.consecutive_failures} consecutive failures · "
                f"since {s.since} · last success {s.last_success}"
            )
        lines.append("")
        lines.append("Action links:")
        for s in newly_stuck:
            lines.append(f"  {s.workflow}: {s.link}")
        lines.append("")

    if recovered:
        lines.append(f"{len(recovered)} previously stuck workflow(s) recovered (back to OK):")
        for s in recovered:
            lines.append(f"  - {s.workflow}: {s.link}")
        lines.append("")

    if still_stuck:
        lines.append(
            f"Still stuck (already paged, no re-page): "
            f"{', '.join(s.workflow for s in still_stuck)}"
        )
        lines.append("")

    lines.append(
        "Note: 'cancelled' runs are ignored (user-initiated cancellations do not "
        "count as failures)."
    )
    lines.append(
        "Automated OPS alert from scripts/workflow_failure_monitor.py "
        "(.github/workflows/workflow_failure_monitor.yml). Independent of the "
        "client Alerts product."
    )
    return "\n".join(lines)


def render_html(
    newly_stuck: list[WorkflowStatus],
    still_stuck: list[WorkflowStatus],
    recovered: list[WorkflowStatus],
    generated_at: datetime,
) -> str:
    """HTML ops page body."""

    def esc(x: object) -> str:
        return html_lib.escape(str(x))

    th = (
        "padding:6px 10px;border:1px solid #ddd;background:#fafafa;"
        "text-align:left;font-size:12px;color:#555"
    )
    td = "padding:6px 10px;border:1px solid #eee"

    parts: list[str] = []
    parts.append(
        "<div style='font-family:Arial,Helvetica,sans-serif;color:#222;max-width:760px'>"
    )
    parts.append(
        "<h2 style='margin:0 0 4px'>Workflow Failure Pager</h2>"
        f"<p style='margin:0 0 16px;color:#666'>Run "
        f"{esc(generated_at.strftime('%Y-%m-%d %H:%M UTC'))} · "
        f"{len(newly_stuck)} newly failing · {len(recovered)} recovered · "
        f"{len(still_stuck)} still failing</p>"
    )

    if newly_stuck:
        parts.append("<h3 style='color:#c0392b;margin:18px 0 6px'>Newly failing</h3>")
        rows = "".join(
            "<tr>"
            f"<td style='{td}'><b><a href='{esc(s.link)}'>{esc(s.workflow)}</a></b></td>"
            f"<td style='{td};text-align:right'>{esc(s.consecutive_failures)}</td>"
            f"<td style='{td}'>{esc(s.since)}</td>"
            f"<td style='{td}'>{esc(s.last_success)}</td>"
            "</tr>"
            for s in newly_stuck
        )
        parts.append(
            "<table style='border-collapse:collapse;font-size:13px;width:100%'>"
            f"<tr><th style='{th}'>Workflow</th>"
            f"<th style='{th}'>Consecutive failures</th>"
            f"<th style='{th}'>Since</th>"
            f"<th style='{th}'>Last success</th></tr>"
            f"{rows}</table>"
        )

    if recovered:
        parts.append("<h3 style='color:#1e7e34;margin:18px 0 6px'>Recovered</h3>")
        rows = "".join(
            "<tr>"
            f"<td style='{td}'><b><a href='{esc(s.link)}'>{esc(s.workflow)}</a></b></td>"
            f"<td style='{td}'>{esc(s.last_success)}</td>"
            "</tr>"
            for s in recovered
        )
        parts.append(
            "<table style='border-collapse:collapse;font-size:13px;width:100%'>"
            f"<tr><th style='{th}'>Workflow</th>"
            f"<th style='{th}'>Last success</th></tr>"
            f"{rows}</table>"
        )

    if still_stuck:
        parts.append(
            "<p style='margin:16px 0 0;color:#999;font-size:12px'>Still failing "
            "(already paged, no re-page): "
            f"{esc(', '.join(s.workflow for s in still_stuck))}</p>"
        )

    parts.append(
        "<p style='margin:20px 0 0;color:#999;font-size:11px'>Automated OPS alert "
        "from scripts/workflow_failure_monitor.py "
        "(.github/workflows/workflow_failure_monitor.yml). 'cancelled' runs are "
        "ignored. Independent of the client Alerts product.</p>"
    )
    parts.append("</div>")
    return "".join(parts)


# ── Entry point ───────────────────────────────────────────────────────────────
def run() -> int:
    """
    Execute one monitor pass. Returns a process exit code:
      0  ran fine (whether or not it paged — a failing workflow is a data
         condition, not a failure of THIS job)
      2  missing required env (printed clearly, no stack trace)
      3  unexpected runtime error (Supabase/SMTP) — surfaces as a red run
    """
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    # Env gate: reuse the client_alerts validator (SUPABASE_URL + service key +
    # GMAIL_APP_PASSWORD), then additionally require GITHUB_TOKEN for the API.
    missing = config.validate()
    token = (os.environ.get("GITHUB_TOKEN") or "").strip()
    if not token:
        missing.append("GITHUB_TOKEN")
    if missing:
        logger.error(
            "Missing required environment variable(s): %s. Set SUPABASE_URL, a "
            "service key (SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY), "
            "GMAIL_APP_PASSWORD and GITHUB_TOKEN.",
            ", ".join(missing),
        )
        return 2

    now = datetime.now(timezone.utc)

    try:
        client = get_client()
    except Exception as exc:  # noqa: BLE001 — surface as a red run, not a crash dump
        logger.error("Failed to create Supabase client: %s", exc, exc_info=True)
        return 3

    try:
        statuses, new_state = evaluate(client, token, now=now)
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to evaluate workflows: %s", exc, exc_info=True)
        return 3

    log_statuses(statuses)

    newly_stuck = [s for s in statuses if s.transition == "newly_stuck"]
    recovered = [s for s in statuses if s.transition == "newly_recovered"]
    still_stuck = [s for s in statuses if s.transition == "still_stuck"]

    # Persist the new transition map regardless of whether we email — so a
    # still-stuck workflow is not re-paged next run, and a recovery is recorded.
    try:
        save_state(client, new_state)
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to save state to alertas_estado: %s", exc, exc_info=True)
        return 3

    # Page only on a TRANSITION (newly stuck OR newly recovered).
    if not newly_stuck and not recovered:
        if still_stuck:
            logger.info(
                "%d workflow(s) still failing — no re-page (debounce): %s",
                len(still_stuck), ", ".join(s.workflow for s in still_stuck),
            )
        else:
            logger.info("All %d monitored workflows healthy — sending nothing.", len(statuses))
        return 0

    # Verify SMTP before composing — a clean ERROR + red run beats a silent
    # zero-send.
    if not validate_api_key():
        logger.error("Gmail SMTP login failed — cannot send the workflow-failure page.")
        return 3

    n_failing = len(newly_stuck)
    if n_failing:
        subject = f"[SectorData] WARNING {n_failing} ETL workflow(s) failing"
    else:
        subject = f"[SectorData] {len(recovered)} ETL workflow(s) recovered"

    text = render_text(newly_stuck, still_stuck, recovered, now)
    html = render_html(newly_stuck, still_stuck, recovered, now)

    logger.info(
        "Emailing ops page to %s — %d newly failing, %d recovered, %d still failing",
        DEST_EMAIL, len(newly_stuck), len(recovered), len(still_stuck),
    )
    result = send_email(to=DEST_EMAIL, subject=subject, html=html, text=text)
    if not result.get("success"):
        logger.error(
            "Ops page send FAILED (status_code=%s): %s",
            result.get("status_code"), result.get("error"),
        )
        return 3

    logger.info("Ops page sent (message_id=%s).", result.get("provider_message_id"))
    return 0


def main() -> None:
    sys.exit(run())


if __name__ == "__main__":
    main()
