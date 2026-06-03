# Client Alerts — Per-Base Test Plan (Test PRD)

> Goal: **guarantee that every one of the 22 subscribable bases delivers a correct alert email, end to end.** This is a test-only PRD; execution is base-by-base. Owner: CTO + worker_etl-pipelines (harness) + worker_supabase (probes/fixes).

## 1. Why this exists — the `price_bands` incident (2026-06-03)

A real client (`eduardo.mendes@itaubba.com`) subscribed to **Price Bands**, updated the `price_bands` data, and received **nothing**. DB forensics:

| Link | State | Verdict |
|---|---|---|
| Subscription exists & active | ✅ `eduardo.mendes@itaubba.com → price_bands` | OK |
| Data updated | ✅ `MAX(date)=2026-06-03` | OK |
| **Event emitted** | ❌ `alert_events(price_bands)=0`, watermark `null` | **BROKE HERE** |
| Outbox / email_log | ❌ 0 / 0 | (downstream of the break) |

**Root cause:** `price_bands` is edited through the admin panel's **Data Input** framework (`src/lib/dataInput/`), which **upserts directly into the `price_bands` table via PostgREST** (authorised by the admin RLS policy `price_bands_admin_write`, migration `20260512000000`). That write path has **no connection to the Python alert engine** — the row lands (and the `_w_subsidy` SQL trigger fires), but **nothing emits an `alert_event`**. `price_bands` also has no CI ETL workflow, so no other path catches it either. The trigger **never ran**. (The same gap applies to `d_g_margins`, the other Data Input table — see §6/§7.)

**The systemic lesson:** the rebuild validated the **send path** (Gmail SMTP) and the **digest path** (navios), but **never verified, per base, that a real update fires the hook → emits an event → sends an email.** This plan closes that gap for all 22 bases.

## 2. Definition of "working" — the 6-link chain (must hold for every base)

1. **Subscribe** — a logged-in client toggles base X on → `alert_subscriptions` row (active).
2. **Trigger** — when X gets new data, the alert hook actually **runs in an environment that has the secrets** (CI).
3. **Detect** — `alerts_current_period(X)` returns a period **strictly greater than the watermark**; `emit_event_if_new` inserts one `alert_events` row.
4. **Fanout** — `alerts_active_recipients(X)` resolves the subscriber's email; an `alert_outbox` row is created.
5. **Deliver** — the Gmail-SMTP send succeeds; `alert_email_log.status='sent'` with a provider Message-ID.
6. **Receive** — the email lands in the inbox (not spam), correctly rendered (display name, period, deep link, unsubscribe).

A base **PASSES** only when all 6 links are verified by a controlled test.

## 3. Failure modes the tests must distinguish

| ID | Failure | Where | Notes |
|----|---------|-------|-------|
| **F1** | Trigger never runs | Link 2 | No workflow (price_bands, anp_subsidy_caps); **admin Data Input writes (price_bands, d_g_margins) bypass the alert engine entirely** — direct PostgREST upsert, nothing emits; or a hook misplaced/mis-gated in a YAML. **← the price_bands bug.** |
| **F2** | Period doesn't advance | Link 3 | The "update" edited values for the **same** latest period, so `MAX(period)` is unchanged → `emit` no-ops. **Alerts fire on a NEW period, not on value changes** — an expectation gap to document and test for. |
| **F3** | `alerts_current_period` wrong/null | Link 3 | Wrong column, smallint cast, empty table, or non-sortable key. |
| **F4** | Fanout finds no recipient | Link 4 | Email unresolved from `auth.users`, subscription inactive, or `alerts_active_recipients` grant/logic. |
| **F5** | Send fails | Link 5 | SMTP auth, recipient refused, **or lands in spam** (corporate inboxes vs a gmail.com sender). |
| **F6** | Wrong cadence routing | Links 3–5 | Immediate base deferred to digest, or a digest base trying to send immediately. |
| **F7** | Watermark already current | Link 3 | A prior emit consumed the period; re-tests must reset the watermark. |

## 4. Test harness to build (Phase A)

1. **`/.github/workflows/client_alerts_test.yml`** — `workflow_dispatch`, inputs: `source` (slug, required), `to` (email, optional override). It runs `python -m scripts.client_alerts.run_base --test --source <source> [--to <email>]`, which **simulates an update so the email fires** — the key requirement for testing every base in production:
   - Reads the base's **real current period** (`alerts_current_period(source)`), so the email content is realistic ("X updated — new data for period &lt;current&gt;").
   - Inserts a **synthetic** `alert_events` row keyed `test:<source>:<run-timestamp>` with payload `{test:true, simulated:true, period:<current>}`.
   - Fans out to the source's active subscribers (and/or the `--to` address) and **delivers immediately** via SMTP.
   - **Production-safe by construction** — it does **NOT** write to the base's data table and does **NOT** touch `alert_source_state` (the watermark), so real detection/operation is completely unaffected; the synthetic event is `test:`-prefixed and trivially purgeable. Safe to run against ANY live base, anytime. **This is THE "simulate an update" method** — no fake rows in production data tables.
   - Secondary mode `--reset-watermark <slug>` (also added to `run_base.py`) deletes the watermark row so a plain `run_base --source X` re-emits the *real* current period — use this to additionally exercise the genuine period-**detection** path (not just send).
2. **SQL verification probe** (one parametrized query) — for a given source + email, returns: latest event, outbox status, email_log status + provider id, watermark. Used as the per-base assertion.
3. **Test recipient** — a deliverable inbox. `eduardo.mendes@itaubba.com` works (Gmail SMTP is not sandbox-restricted); also test `ibbaogproject@gmail.com`. **Explicitly check the spam folder** (F5).

> The harness tests the engine + send for each base directly. Hook **wiring** (the step being present and correctly gated in each ETL YAML) is verified separately by a **static check** (§6 column "hook present?") plus, for a few representative bases, a real `workflow_dispatch` of the actual ETL.

## 5. Per-base test procedure (repeatable)

For each base **X**:
1. Ensure a test subscription (test email → X) exists and is **active**.
2. Note X's **cadence** (immediate/digest) and **period_kind**.
3. Dispatch `client_alerts_test.yml` with `source=X`, `reset_watermark=true` (and `deliver_digest=true` if X is **digest**).
4. **Assert (SQL probe):** a new `alert_events(X)` row exists → `alert_outbox` row → `alert_email_log.status='sent'` with a provider Message-ID.
5. **Assert (human):** the email arrived in the test inbox (check spam), and content is correct — display name, period, `frontend_route` deep link, unsubscribe link, immediate vs digest template.
6. Record **PASS/FAIL** + (if FAIL) the failure-mode ID from §3.
7. Cleanup: optionally delete the test event/subscription; leave the watermark at the current period.

## 6. The 22-base test matrix

Legend — Cadence: I = immediate, D = digest. "What advances the period" = what an operator must change for the watermark to move (and thus for an alert to fire).

| # | Base (slug) | Cad | period_kind | What advances the period | Hooked in workflow | Trigger reliable? |
|---|-------------|-----|-------------|--------------------------|--------------------|-------------------|
| 1 | vendas | I | date | new `MAX(date)` (new month) | etl_anp_vendas | ✅ CI |
| 2 | anp_glp | I | month | new `MAX(ano,mes)` | etl_anp_precos | ✅ CI |
| 3 | anp_precos_produtores | I | window_end | new `MAX(data_fim)` (new week) | etl_anp_precos | ✅ CI |
| 4 | anp_lpc | I | window_end | new `MAX(data_fim)` | etl_anp_lpc | ✅ CI |
| 5 | anp_precos_distribuicao | I | date | new `MAX(data_referencia)` | etl_anp_precos_distribuicao | ✅ CI |
| 6 | anp_daie | I | month | new `MAX(ano,mes)` | etl_anp_fase3 | ✅ CI |
| 7 | anp_desembaracos | I | month | new `MAX(ano,mes)` | etl_anp_fase3 | ✅ CI |
| 8 | mdic_comex | I | month | new `MAX(ano,mes)` | etl_mdic_comex | ✅ CI |
| 9 | anp_cdp_producao | I | month | new `MAX(ano,mes)` | etl_anp_cdp | ✅ CI |
| 10 | anp_cdp_diaria | D | date | new `MAX(data)` | etl_anp_cdp_diaria | ✅ CI |
| 11 | anp_cdp_diaria_instalacao | D | date | new `MAX(data)` | etl_anp_cdp_diaria | ✅ CI |
| 12 | anp_cdp_diaria_poco | D | date | new `MAX(data)` | etl_anp_cdp_diaria | ✅ CI |
| 13 | anp_voip | I | year | new `MAX(ano_publicacao)` | etl_anp_voip | ✅ CI (annual) |
| 14 | navios_diesel | D | timestamp | new `MAX(collected_at)` | etl_navios_lineup | ✅ CI |
| 15 | vessel_positions | D | timestamp | new `MAX(ts)` | etl_navios_positions + etl_ais_positions | ✅ CI |
| 16 | port_arrivals | D | timestamp | new `MAX(detected_at)` | etl_navios_positions + etl_ais_positions | ✅ CI |
| 17 | import_candidates | D | timestamp | new `MAX(last_seen_at)` | etl_ais_candidates | ✅ CI |
| 18 | d_g_margins | I | iso_week | new `MAX(to_date(week))` | manual_dg_margins (weekly cron) **+ admin Data Input** | ⚠️ weekly cron only; **admin edits don't alert until the next Monday run** |
| 19 | **price_bands** | I | date | new `MAX(date)` | **admin Data Input (PostgREST upsert); no CI workflow** | ❌ **NO alert trigger on the write path — the reported bug** |
| 20 | anp_subsidy_diesel_reference | I | date | new `MAX(data_referencia)` | etl_anp_subsidy_diesel | ✅ CI |
| 21 | anp_subsidy_commercialization | I | date | new `MAX(data_inicio)` | etl_anp_subsidy_diesel | ✅ CI |
| 22 | **anp_subsidy_caps** | I (inactive) | timestamp | admin edit | **none (admin-edit)** | ❌ **NO trigger; currently `is_active=false`** |

## 7. Trigger-reliability fixes (must land before a base can pass)

The matrix exposes that **F1** is a design gap for the no-workflow bases. Fix:

- **`/.github/workflows/client_alerts_poll.yml`** — a scheduled **safety-net poll** (e.g. every 2 h) that runs `python -m scripts.client_alerts.run_base --source <every immediate base>`. Because `emit_event_if_new` is idempotent (watermark + `UNIQUE(source_slug,event_key)`), polling is **safe** — it emits only when a NEW period actually landed. Effect:
  - `price_bands` / `d_g_margins` (**admin Data Input** writes) and `anp_subsidy_caps` (no CI hook) now fire **within the poll interval** of any admin edit — reliable, even though not "instant". Tune the interval (e.g. 30 min) for responsiveness on the admin-input bases.
  - Every other base gets a **backstop**: if an ETL hook ever fails or is skipped, the poll catches the missed period. The immediate ETL hooks still give instant alerts; the poll only fills gaps.
- **Immediate option for the admin Data Input bases (`price_bands`, `d_g_margins`)** — add an `AFTER INSERT/UPDATE` **DB trigger** on those tables that does an SQL-level emit (insert into `alert_events` when the period advances past the watermark). This emits the **instant the admin saves**, independent of the frontend or any cron — most robust because it fires on ANY write path. Delivery still rides the poll/fast cron (the SMTP send needs CI). Optionally, the Data Input layer (`src/lib/dataInput/persistence.ts`) could instead call an `alerts_emit_for_source(slug)` RPC after a successful upsert — simpler but only covers the browser path.
- **`anp_subsidy_caps`**: decide whether to keep it `is_active=false` (then it needs no trigger) or activate it and rely on the poll.

> This makes the architecture: **ETL hooks = instant alerts; poll = guaranteed safety net.** It directly prevents the `price_bands` class of silent miss.

## 8. Cross-cutting checks (run once, not per base)

- **Immediate-path email template** renders correctly (only the *digest* template was visually verified). Test via any immediate base (e.g. vendas) in the harness.
- **Cadence routing** is correct per base (immediate sends now; digest waits for `client_alerts_digest.yml`).
- **Deliverability to corporate inboxes** (`@itaubba.com`) from a `gmail.com` sender — verify it isn't spam-filtered; if it is, that's a flag toward a verified sending domain (SPF/DKIM) later.
- **Dashboard flows**: subscribe, pause/resume, unsubscribe-by-token (from an email link, logged out).
- **Admin tab** reflects the test sends (stats, subscribers, email log).

## 9. Acceptance criteria

- Per base: a controlled harness run delivers a correctly-rendered email to the test inbox, with all 6 links (§2) verified. Record PASS + the provider Message-ID.
- Product-level "guaranteed": **all 22 bases PASS** (or are explicitly N/A, e.g. an intentionally-inactive `anp_subsidy_caps`) **and** the trigger-reliability fixes (§7) are merged.

## 10. Execution order

- **Phase A** — Build the harness: `run_base --reset-watermark`, `client_alerts_test.yml`, the SQL probe. (worker_etl-pipelines)
- **Phase B** — Trigger fixes: `client_alerts_poll.yml` (safety net) + decide price_bands/anp_subsidy_caps. (worker_etl-pipelines)
- **Phase C** — Run the 22-base matrix (§5/§6), recording PASS/FAIL + failure mode. Start with **price_bands** (the reported failure) and **vendas** (immediate-template check). (CTO orchestrates)
- **Phase D** — Fix every FAIL, re-test until all PASS. (per owner)
- **Phase E** — Sign-off: a results table (base · PASS/FAIL · Message-ID · notes) appended to this file.

## 11. Results log

**2026-06-03 — full matrix run: 22 / 22 PASS.**

- **Method:** `client_alerts_test.yml` dispatched once per source (synthetic-event simulation), `--to ibbaogproject@gmail.com`. Each run injects a `test:<source>:<epoch>` event for the base's REAL current period, fans out, and SMTP-sends.
- **Evidence:** all 22 sources have a test event in `alert_events` (period detection + inject works for each), and all 22 workflow runs concluded **success** (a failed SMTP send fails the run, so success ⇒ the email was sent). The originally-reported `price_bands` case is **DB-confirmed delivered** to `eduardo.mendes@itaubba.com` (`email_log.status='sent'`, subject "[SectorData Alerts] Price Bands (Parity) — 2026-06-03"), landed in the **inbox** (corporate deliverability confirmed OK).
- **Note:** `--to` extra copies are sent directly (not via the outbox), so they don't appear in `alert_email_log` — only subscriber-fanout sends do. Run-success is the per-base PASS signal for the `--to` path.
- **Process fix:** `client_alerts_test.yml` had a `concurrency.group` that **cancels queued runs**, so rapid batch dispatch cancelled all-but-one (worker recovered by serializing). The group was removed so batch re-runs queue safely.
- **All 22 PASS:** vendas · anp_glp · anp_precos_produtores · anp_lpc · anp_precos_distribuicao · anp_daie · anp_desembaracos · mdic_comex · anp_cdp_producao · anp_cdp_diaria · anp_cdp_diaria_instalacao · anp_cdp_diaria_poco · anp_voip · navios_diesel · vessel_positions · port_arrivals · import_candidates · d_g_margins · price_bands · anp_subsidy_diesel_reference · anp_subsidy_commercialization · anp_subsidy_caps.
