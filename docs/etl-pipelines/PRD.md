# PRD — Departamento ETL / Pipelines

Pipelines automáticas que coletam dados de fontes externas (ANP, MDIC, navios, AIS, news) e populam o Supabase. Rodam via GitHub Actions em schedule, ou em repos separados.

## Escopo

### Scripts (organizados por natureza em `scripts/`)

Convenção (R3, R9): `<domain>_<scope>_<action>.{py|mjs}`. Chains usam subpasta + prefixo numérico `01_, 02_, ...`.

```
scripts/pipelines/                  # rodam via GitHub Actions (todos os ETL)
  ais/
    candidates_discover.py          AIS global scan → score 0-100 → import_candidates
    positions_sync.py               AISStream WebSocket → vessel_registry, vessel_positions, port_arrivals

  anp/
    cdp/                            chain (workflow etl_anp_cdp.yml)
      01_extract_powerbi.py         Power BI public API (no CAPTCHA) → output/anp/ CSVs (active script)
      01_extract.py                 [LEGACY] Selenium + ddddocr CAPTCHA — replaced by 01_extract_powerbi.py
                                    (kept for reference; not called by workflow)
      _replay.py                    Módulo standalone (zero Selenium): replay_download() → usado por alertas/
      02_upload.py                  CSVs → Supabase. Post-upload: calls `refresh_mv_production()` RPC to keep the `/well-by-well` MVs fresh (Round 5). Since `20260618000000`, `mv_production_monthly` also feeds the blended stakes of the `/anp-cdp-diaria` company RPCs — this refresh updates BOTH dashboards.
    fase3/                          chain (workflow etl_anp_fase3.yml)
      01_daie_sync.py               Dados Abertos IE
      02_desembaracos_sync.py       Desembaraços (preserves importador/cnpj/uf_cnpj since 2026-05-25)
      # 03_painel_imp_sync.py — REMOVED by Imports & Exports reform (2026-05-25)
    precos/                         chain (workflow etl_anp_precos.yml — junto com glp_sync)
      02_precos_produtores_sync.py  Preços Produtores
    producao/                       (workflow etl_dg_margins.yml — input D&G Margins)
      anp_producao_derivados_sync.py  Produção mensal de derivados (Gasolina A / Óleo Diesel, m³) → anp_producao_derivados
    glp_sync.py                     GLP (rodado em etl_anp_precos.yml)
    lpc_sync.py                     Levantamento Preços ao Consumidor
    vendas_watch.py                 ANP vendas combustíveis (vintage anp-watcher)

  cepea/                            (workflow etl_dg_margins.yml — input D&G Margins)
    cepea_etanol_anidro_sync.py     CEPEA/ESALQ preço semanal do etanol anidro (R$/L) → cepea_etanol_anidro.
                                    Weekly path is browser-free (requests-only): widget oficial CEPEA
                                    (id_indicador 104, Anidro-SP R$/L, 4 casas) → fallback HTML/JSON
                                    noticiasagricolas. Guards: range [1.5,5.0], precision sniff (≥3 dec),
                                    Saturday/ISO-week invariant, staleness >14d (loud exit), cross-source
                                    agreement. Deep history (2002→) só via `--backfill` (Chrome+Excel,
                                    lazy import, NUNCA em CI).

  navios/                           chain de 5 stages (3 workflows traversam)
    01_lineup_scrape.py             Scrape portos → CSV (era navios_esperados.py)
    02_diesel_import.mjs            CSV → navios_diesel (era import_navios_diesel.mjs)
    03_imo_lookup.py                VF + MarineTraffic → resolver IMO/MMSI (era vessel_lookup.py)
    04_cabotage_cleanup.py          Limpeza de cabotagem em navios_diesel
    05_positions_sync.py            VF port-call → vessel_positions, port_arrivals

  mdic_comex_sync.py                MDIC Comex (+ sync_months() reused by drift check)
  mdic_comex_drift_check.py         MDIC Comex drift detector (retroactive revisions)
  anp/
    precos_distribuicao_sync.py     ANP PDC — Preços de Distribuição → anp_precos_distribuicao

scripts/extractors/                 # extratores reutilizáveis (não são scripts de pipeline direto)
  _powerbi_common.py                Helper compartilhado para requisições à API querydata do Power BI
  anp_cdp_powerbi.py                ANP CDP Power BI público → anp_cdp_diaria / _instalacao / _poco. CLI: --level campo|instalacao|poco|all. 3 levels extraídos por run (pages 4, 5, 6 do Power BI).

scripts/client_alerts/              # Client Alerts engine — invocado como último step de cada ETL + digest (ver § "Client Alerts")
  _core/                            lógica parametrizada pelo catálogo alert_sources
    config.py                       lê SUPABASE_SERVICE_KEY OU SUPABASE_SERVICE_ROLE_KEY (workflows divergem) + GMAIL_ADDRESS/GMAIL_APP_PASSWORD
    supabase_client.py              singleton service-role
    emit.py                         emit_event_if_new(): watermark + INSERT alert_events + UPDATE alert_source_state
    fanout.py                       fanout_event(): resolve recipientes via alerts_active_recipients, insere alert_outbox
    deliver.py                      send_pending_outbox(): lê outbox 'queued' → envia via gmail_client → grava alert_email_log
    gmail_client.py                 ATIVO — Gmail SMTP (smtp.gmail.com:587 STARTTLS) + App Password
    resend_client.py                dormente (backend antigo; deliver.py importa gmail_client)
    render.py                       Jinja2 (immediate + digest)
    digest.py                       sweep_digests(): roll-up diário das bases 'digest' em 1 email/subscriber
  templates/                        alert_immediate.{html,txt}, alert_digest.{html,txt}, _layout.html
  run_base.py                       runner: --source <slug> (repeatable) | --digest [--batch-limit N]
  vendas.py, navios_diesel.py, ...  1 wrapper fino por base (chamam run_one(slug))

scripts/manual/                     # humano-no-loop (dept Dados Locais)
  # dg_margins_upload.py — DELETED 2026-06-05 (D&G Margins automation: d_g_margins agora computado via etl_dg_margins.yml)
  price_bands_upload.py             Excel data/price_bands.xlsx → price_bands

scripts/utils/                      # one-shots (não-ETL)
  capture_previews.mjs              Headless Chrome → screenshots autenticados
  deploy_migration.mjs              Aplicar migration via service key (legado)
  deploy_profiles_visibility.mjs    Aplicar sql/create_profiles_and_visibility.sql (legado)
```

### Workflows GitHub Actions

| Workflow | Schedule | Script(s) | Tabela alvo |
|---|---|---|---|
| `etl_ais_candidates.yml` | Cada 4h | `pipelines/ais/candidates_discover.py` | `import_candidates` |
| `etl_ais_positions.yml` | Cada 6h+15min | `pipelines/ais/positions_sync.py` | `vessel_registry`, `vessel_positions`, `port_arrivals` |
| `etl_anp_vendas.yml` | Trigger externo (cron-job.org via `workflow_dispatch`) | `pipelines/anp/vendas_watch.py --force` | (vendas combustíveis ANP) |
| `etl_anp_fase3.yml` | Mensal — 1º dia, 13:00 UTC | `pipelines/anp/fase3/01_daie_sync.py` → `02_desembaracos_sync.py` | `anp_daie` (6.912 rows), `anp_desembaracos` (enriched with `importador`/`cnpj`/`uf_cnpj`; PK extended to `(ano,mes,ncm_codigo,pais_origem,cnpj)` since 2026-05-25). `03_painel_imp_sync.py` + `anp_painel_imp_dist` removed by Imports & Exports reform. |
| `etl_anp_lpc.yml` | Daily 14:30 UTC (`30 14 * * *`) — changed from weekly Wed on 2026-06-09 (incident) | `pipelines/anp/lpc_sync.py` | `anp_lpc` (160.243 rows — histórico 2004–2026 após backfill). ANP publishes the weekly "Levantamento de Preços" on an **unstable weekday** (assumed Wed; on 2026-06-09 it was a Tuesday) — a Wed-only cron silently lagged `anp_lpc` by up to a week. The scrape is incremental (downloads only weeks newer than `MAX(data_fim)`) + idempotent (`ON CONFLICT data_fim,produto,estado`), so daily is a clean no-op when nothing new is published and ingests the new week within ~24h on whatever weekday ANP drops it. Upstream half of the dg-margins fix: `etl_dg_margins.yml` now runs downstream of this via `workflow_run`. |
| `etl_anp_precos.yml` | Semanal — segunda, 12:00 UTC (`0 12 * * 1`) | `pipelines/anp/glp_sync.py` + `precos/02_precos_produtores_sync.py` | `anp_glp` (3.106), `anp_precos_produtores` (54.738 — histórico 2002–2026 após backfill) |
| `etl_anp_cdp.yml` | Cron interno mensal (5º), 08:00 UTC (`0 8 5 * *`) como fallback + trigger externo via cron-job.org (`workflow_dispatch`) a cada ~2h — pipeline desenhado para rodar incrementalmente com alta frequência | `pipelines/anp/cdp/01_extract_powerbi.py` (Power BI, no CAPTCHA) → `02_upload.py` | `output/anp/` + `anp_cdp_producao` (2.045.515+ rows). Power BI poco-level data aggregated daily→monthly; local derived from DB lookup + basin heuristic. Replaces Selenium/CAPTCHA (01_extract.py) which had an undocumented APEX row cap (~197 offshore wells vs ~937 in Power BI for 04/2026). **Inputs `workflow_dispatch`**: `force_upload=true` passes `--no-incremental` AND implies `--purge` automatically — never re-upload over an already-loaded period without it (prevents the PK-overlap duplicate-`local` bug, Apr/2026). |
| `etl_mdic_comex.yml` | Diário 14:00 UTC (`0 14 * * *`, trailing 3 meses) **+** semanal Dom 06:00 UTC (`0 6 * * 0`, trailing 12 meses = *revision sweep*) | `pipelines/mdic_comex_sync.py` | `mdic_comex` (10.029 rows — histórico 1997–2026 após backfill) |
| `etl_mdic_comex_drift.yml` | Mensal — dia 5, 07:00 UTC (`0 7 5 * *`) + `workflow_dispatch` | `pipelines/mdic_comex_drift_check.py` | `mdic_comex` (self-heal só dos meses derivados). *Drift detector* das revisões retroativas do ComexStat — ver seção "MDIC Comex — drift detector" abaixo |
| `etl_navios_lineup.yml` | Cada 6h | `pipelines/navios/01_lineup_scrape.py` → `02_diesel_import.mjs` | `navios_diesel`. Portos cobertos: Santos, Itaqui, Paranaguá, São Sebastião, Suape, **Maceió** (`buscar_maceio`, desde 2026-06-03). **Filtro de direção por porto** — cada scraper só mantém **descarga (importação)**: Paranaguá filtra `Sentido == "IMP"`; Santos esperados filtra operação `DESC`; **Suape** (desde 2026-06-03) filtra por `Tipo da Operação`; **Maceió** NÃO publica coluna de direção → captura todo diesel e confia no `04_cabotage_cleanup` para remover tráfego de bandeira brasileira (limitação documentada inline). **Pegadinha — Suape "Tipo da Operação"**: a aba "Dados Brutos" (Google Sheets, formato wide) repete blocos `Produto`/`Quantidade`/`Unidade`/`Tipo da Operação` (pandas sufixa `.1 … .6` as colunas duplicadas), **posicionalmente alinhados** (`Produto.N` ↔ `Tipo da Operação.N`). Valores: `DG`=Descarga (import), `TB DG`=transbordo descarga, `CG`=Carga/embarque (saída), `TB CG`=transbordo carga. `buscar_suape()` só conta um bloco como diesel-importação se `_diesel_puro(produto)` **E** `Tipo da Operação ∈ {DG, TB DG}` (upper/strip) — pareado por bloco, não "qualquer produto é diesel". Volume (`_qtd_e_unidade`) e `Carga` somam/listam só os blocos diesel-E-descarga. Antes do fix, navios de carga doméstica (ex.: ATLANTIC PRIDE, IMO 9797266 — 3 blocos diesel todos `CG`) entravam como falso-positivo de importação. Não suavizar para "qualquer DIESEL" de novo. **Watchdog (hardened 2026-06-03)**: a exceção `FetchError` distingue **fetch quebrado** (encoding/Brotli/WAF/schema break — a falha que zerou Itaqui silenciosamente por 9 dias em maio, Pegadinha #12) de **0-diesel legítimo**. `buscar_itaqui`/`buscar_maceio` levantam `FetchError` quando a página não decodifica numa lineup confiável → o porto vira sentinela `ERRO_COLETA` e o watchdog falha (exit 2) destacando os fetches quebrados. Portos EXPECTED que fetcharam OK mas retornaram 0 diesel emitem `[WARN]` a cada run (silent-zero fica visível). |
| ~~`manual_dg_margins.yml`~~ | **RETIRED 2026-06-05** (deletado) | ~~`manual/dg_margins_upload.py`~~ | substituído por `etl_dg_margins.yml` (D&G Margins automation) |
| `etl_dg_margins.yml` | **PRIMARY:** `workflow_run` after a successful `etl_anp_lpc.yml`. **FALLBACK:** daily 15:00 UTC (`0 15 * * *`, after the 14:30 LPC scrape). **MANUAL:** `workflow_dispatch` with inputs `full_backfill` (boolean, default false) + `week_start` (optional `W/YYYY` override). Re-ordered from the old weekly Tue 15:00 UTC on 2026-06-09 (incident). | `cepea/cepea_etanol_anidro_sync.py` → `anp/producao/anp_producao_derivados_sync.py` → RPC `recompute_dg_margins(week_start, week_end)` | `cepea_etanol_anidro`, `anp_producao_derivados`, e (computado) `d_g_margins`. Decomposição R$/L por semana ISO: `base_fuel = (import_parity×import% + petrobras×production%)×(1−blend)`; `biofuel` = etanol anidro (lag week−1)×ethanol_blend (gasolina) / Biodiesel B-100 (mesma semana)×biodiesel_blend (diesel); `federal_tax`+`state_tax` de `fuel_tax_reference` (ANP Síntese + CONFAZ ad-rem); `distribution_and_resale_margin` = pump − componentes (residual); `total` = pump = `anp_lpc` station-weighted national avg. `import%` = imports(`anp_desembaracos`/`mdic_comex`, kg→m³ via densidade)/(imports+`anp_producao_derivados`). Cutover: era ad-rem ICMS (gasolina Jun/2023, diesel Mai/2023) computada; pré-ad-rem (2021→meados 2023) preservado da série manual (arquivo em `d_g_margins_manual_bak`). Fontes: ANP · CEPEA/ESALQ · CONFAZ. **Routine recompute is bounded to the last ~12 ISO weeks** (computed dynamically) — see § "D&G Margins — ordering & bounded recompute (incident 2026-06-09)" below. |
| `etl_navios_imo_lookup.yml` | Após `etl_navios_lineup` | `pipelines/navios/03_imo_lookup.py` → `04_cabotage_cleanup.py` | `navios_diesel.imo/mmsi` |
| `etl_navios_positions.yml` | Após `etl_navios_imo_lookup` | `pipelines/navios/05_positions_sync.py` | `vessel_positions`, `port_arrivals` |
| `etl_anp_precos_distribuicao.yml` | Mensal — dia 5, 14:00 UTC (`0 14 5 * *`) + Semanal — terça, 14:30 UTC (`30 14 * * 2`) | `pipelines/anp/precos_distribuicao_sync.py` | `anp_precos_distribuicao` |
| `etl_anp_subsidy_diesel.yml` | Diário — `30 11 * * *` UTC (8:30 BRT). `workflow_dispatch` com input `mode: {incremental, backfill}` | `pipelines/anp/subsidy_diesel_sync.py` (PDF flow + HTML scrape stage). CLI: `--mode {incremental,backfill}`, `--skip-commercialization`, `--commercialization-only`, `--all-pdfs`, `--dry-run` | `anp_subsidy_diesel_reference` (preços de referência diários por região; PDF flow legado) + `anp_subsidy_commercialization` (preço de comercialização período × região × tipo_agente; **stage HTML novo desde 2026-05-27** — ver § "Subsidy commercialization HTML scrape"). HTML stage roda antes do PDF para garantir que os triggers AFTER em `reference` encontrem `commercialization` populada (`compute_subsidy_reimbursement` retorna real, não NULL). |
| `etl_anp_cdp_diaria.yml` | 3×/dia — `0 10,15,20 * * *` UTC (7h/12h/17h BRT) | `scripts/extractors/anp_cdp_powerbi.py --level all --upload` (via `_powerbi_common.py`) | `anp_cdp_diaria` (~16.5k rows; upsert `(data, campo, bacia)`), `anp_cdp_diaria_instalacao` (~16.3k rows; upsert `(data, instalacao)`), `anp_cdp_diaria_poco` (~180.7k rows; upsert `(data, poco)`). Timeout workflow: 25min. **Upsert semantics — split per level (since 2026-06-10)**: `campo` stays **append-only** (`ignore_duplicates=True` → `ON CONFLICT DO NOTHING`; immutable snapshot, user decision 2026-05-08, verified byte-identical to the live panel on 2026-06-10); `instalacao` + `poco` are **DO UPDATE** (`DO_UPDATE_BY_LEVEL`) so every full-range run self-heals the historical damage from the two 2026-06-10 bug fixes below (trade-off: at these two levels ANP retroactive revisions now propagate). Base point: `--start` default = `2025-11-09` (first date with Power BI data). **Fix 1 — DSR `Ø` null-mask (2026-06-10)**: the DSR compression marks NULL columns with a `Ø` (U+00D8) bitmask key and omits them from the `C` value array; the parser ignored it, shifting every value one slot left on Ø rows. Effect at the installation level: the daily unattributed row (Campo+Instalação both NULL — production of wells whose installation is missing from `v_instalacoes_final`) put a measure string into `instalacao`/`campo` and poisoned all subsequent rows of the day via R-mask inheritance → `campo` was numeric garbage for most rows AND petroleo/gas were mis-assigned on every Ø row. Fixed in `_parse_dsr_cdp_generic` (R-bit → inherit; Ø-bit → NULL; else next from C). Healing: DO UPDATE re-paints sane-keyed rows; zombie rows keyed by numeric garbage (`instalacao ~ '^[0-9.]+$'`, NULL measures) are deleted by `purge_instalacao_garbage()` inside the pipeline (idempotent, service key — no manual DML). The unattributed daily row is **skipped + logged** (PK forbids NULL instalacao); that production remains visible at field and well levels. `campo=NULL` (offshore FPSOs) is normalized to `''` (NOT NULL contract, historical convention — field attribution comes from the well mapping, migration `20260508130001`). **Fix 2 — well-level join drops (2026-06-10)**: the well query joined `v_instalacoes_final` just to fetch `Instalação`; wells whose installation was missing/late in that ANP view were silently dropped (measured live: −40 kbpd of Búzios wells on 2026-06-01, −17.9 on 06-02 — exactly the NULL-installation wells `7-BUZ-71D-RJS`/`9-MRO-1-RJS`). The join was removed; `instalacao` now comes from the well entity's own `nome_instalacao` property (verified via the public `conceptualschema` endpoint; live old-vs-new comparison was value-identical and the new query reconciles to the field-level daily totals to the decimal). Wells with NULL `nome_instalacao` keep `instalacao=NULL` (column is nullable; the installation-level Campo filter via well mapping simply doesn't cover them). **Pegadinha 1 — property names**: property names Power BI são case-sensitive e diferem do display name — ex: nível Poço usa `Campo (Poço)` (property) e não `NOME CAMPO` (display name); retorna 0 linhas se property errada. A property inválida NÃO retorna erro em `results[0].error` — o erro vem aninhado em `dsr.DataShapes[0]['odata.error']` (`CouldNotResolveSemanticQueryDefinition`); valide a resposta inteira, não só o status. Schema real do modelo: POST `wabi-brazil-south-api.../public/reports/conceptualschema` com `{"modelIds":[MODEL_ID]}` + header `X-PowerBI-ResourceKey`. **Pegadinha 2 — atribuição 1:1 vs N:N**: entity `v_poco_instalacao_sigep_ultimo` (páginas 5/6, níveis Installation e Well) faz atribuição "última" — cada poço linka a apenas 1 campo. Entity `v_campos_detalhe` (página 4, nível Field) faz N:N. Resultado: filtro Campo mostra 94 campos em Field mas apenas 76 em Installation/Well (19 campos Field-only com poços 100% compartilhados com outro campo "principal"). Não é bug do ETL. Documentado em [`docs/app/anp-cdp-diaria.md`](../app/anp-cdp-diaria.md). **Pegadinha 3 — dimension lag (P-78 case)**: ANP's daily panel can lag its own monthly CDP on the DIMENSION side — FPSO P-78 ('PETROBRAS 78' in `anp_cdp_producao.instalacao_destino`) and its wells (`7-BUZ-79-RJS`, `7-BUZ-94D-RJS`, ~50 kbpd in 03/2026) were absent from the daily panel's well/installation dimensions for ~5 months while present in the monthly data. Every workflow stays green and every base advances daily — no freshness/failure monitor can see it. Coverage: `cdp_roster_canary.yml` (see § "Monitoring & testing"). |

> Workflows confirmados ativos em 2026-05-05. Row counts atualizados após backfill histórico de 2026-05-06. README está desatualizado (não os menciona). Quando atualizar README, incluir.

### D&G Margins — ordering & bounded recompute (incident 2026-06-09)

The "Distribution & Resale Margin" component is a residual driven by the ANP pump
price, which lives in `anp_lpc` (fed by `etl_anp_lpc.yml`). Two problems compounded
into a single incident on 2026-06-09 and were fixed together:

**Problem 1 — wrong ordering.** ANP publishes the weekly LPC survey on an unstable
weekday (assumed Wed; on 2026-06-09 it was a Tuesday). The old setup ran the
recompute on Tue 15:00 UTC, but `anp_lpc` only scraped Wed 14:30 UTC — so the
margins ran a full day **before** the freshest pump price even landed, freezing the
dashboard at the prior week and starving the Client Alert of a new week to fire.

**Problem 2 — full-timeline recompute timed out.** The scheduled run died at the
recompute step with PostgREST error `57014` (`canceling statement due to statement
timeout`) ~31s in (GitHub run 27223589112).

**Fix (the four pieces that actually matter):**

1. `etl_anp_lpc.yml` now scrapes **daily** (`30 14 * * *`), incremental + idempotent,
   so `anp_lpc` tracks ANP's publish day within ~24h whatever weekday they choose.
2. `etl_dg_margins.yml` **primary trigger is `workflow_run`** downstream of a
   *successful* `etl_anp_lpc.yml` (the job gates on
   `github.event.workflow_run.conclusion == 'success'` since `workflow_run` fires on
   every completion, including failure). The recompute — and its Client Alert hook —
   therefore always runs on the freshest pump price the same day ANP publishes.
3. **Daily 15:00 UTC fallback cron** (`0 15 * * *`), strictly after the 14:30 LPC
   scrape, backstops the `workflow_run` path if it is ever skipped and still picks up
   fresh Monday producer prices / CEPEA.
4. **Routine recompute is bounded to the last ~12 ISO weeks.** The window start is
   computed dynamically in-workflow (not hardcoded): `today − 12 weeks → isocalendar()`
   → `p_week_start = "<iso_week>/<iso_year>"` (unpadded ISO `W/YYYY`, e.g. `12/2026`),
   with `p_week_end = NULL` so the window stays open-ended through the newest week.
   This finishes in seconds. The **full-timeline recompute** (both params NULL) is
   reachable only via the manual `workflow_dispatch` input `full_backfill=true`; the
   `week_start` dispatch input overrides the 12-week start for an explicit bounded run.

> **Why the bounded window + set-based optimization — not just the function-level
> `SET statement_timeout` — is what fixes the prod path:** the recompute is called
> over PostgREST as `service_role`. PostgREST connects as the `authenticator` login
> role, whose role config carries `statement_timeout=30s`; `SET ROLE service_role`
> does **not** pick up `service_role`'s config (its `rolconfig` is NULL), and the
> `SELECT recompute_dg_margins(...)` statement's timer is armed at 30s *before* the
> function body runs. A `SET` inside an already-running statement does not re-arm its
> timer, so the function-level `SET statement_timeout='300s'` (migration
> `20260616100000`) only protects **direct in-database callers** (psql / pg_cron /
> a SECURITY DEFINER caller). The PostgREST path is rescued by (a) the set-based
> `imp_pct` optimization that brings the full recompute well under 30s, and (b) the
> ETL's bounded-window call (a 12-week recompute runs in ~2s). See
> `docs/supabase/PRD.md` for the RPC-side detail.

### Navios — backfill de maio/2026 (one-shot, 2026-06-03)

Reparo retroativo de `navios_diesel` para maio/2026. Duas falhas deixaram o mês
abaixo do que realmente transitou nos lineups (a fonte da verdade — AIS **não** é
usada em `navios_diesel`):

1. **Apagão de Itaqui, 12–20/05/2026** — o scraper retornou 0 navios por 9 dias
   (falha silenciosa de Brotli, Pegadinha #12; encoding corrigido em 21/05 no
   commit `5efe3077`; watchdog endurecido no mesmo commit do backfill). Confirmado
   no banco: Itaqui tem dados até 11/05, some 12–20, volta 21/05. **MITERA** foi
   perdido por completo (0 linhas em qualquer porto).
2. **Maceió nunca foi raspado** antes de 2026-06-03 (porto adicionado no mesmo
   commit). Seus navios de diesel jamais chegaram a `navios_diesel`.

**Reconciliação (diferença de conjuntos, não "adicionar tudo").** Referência: um
manifesto de lineup de porto capturado à época por um colega
(`manifesto_diesel_2026-06-03.xlsx`, aba "Manifesto", 40 navios em 2 seções). Para
cada navio do manifesto atribuído a maio/2026, checou-se se `navios_diesel` já tinha
aquele `(porto, navio)` em maio. Tínhamos 24; estes **7** faltavam. Santos/Paranaguá
carregam **mais** navios que o manifesto (cobrimos melhor) — por isso é diferença de
conjuntos, só as faltantes entram. Nenhum endpoint retroativo de porto cobre o gap
(Itaqui só expõe estado-ao-vivo; `/desembarcados` e `/historico` dão 404; Maceió é
ao-vivo) — Paranaguá expõe `relLineUpRetroativo`, mas a reconciliação achou 0 navios
de Paranaguá faltando, então nada veio dele.

**Linhas inseridas (7):**

| Porto | Navio | Volume (m³) | ETA | collected_at (último rel.) | Fonte |
|---|---|---:|---|---|---|
| Porto de Itaqui | MITERA | 60.218 | — | 2026-05-19T09:32-03 | manifesto (apagão Itaqui) |
| Porto de Maceió | ELANDRA MAPLE | 23.400 | — | 2026-05-21T09:34-03 | manifesto (Maceió sem cobertura) |
| Porto de Santos | ISABELLA M II | 35.503 | 2026-05-07 | 2026-05-07T20:52-03 | manifesto (escala Santos 07/05) |
| Porto de Santos | PACIFIC AZUR | 47.337 | 2026-05-07 | 2026-05-07T20:52-03 | manifesto (escala Santos 07/05) |
| Porto de Suape | ELANDRA MAPLE | 18.840 | 2026-05-11 | 2026-05-15T09:31-03 | manifesto (escala Suape) |
| Porto de Suape | SUPER G | 10.150 | 2026-05-16 | 2026-05-19T09:32-03 | manifesto (escala Suape) |
| Porto de Suape | MERSEY | 50.000 | 2026-05-20 | 2026-05-21T09:34-03 | manifesto (escala Suape) |

**Semântica.** `collected_at` = o timestamp "último rel." do manifesto (meio de maio,
**não** o anchor 2026-05-31T19:00Z), de modo que `get_nd_volume_mensal_historico`
conta cada linha como **descarregada** no mês fechado de maio (navio ausente do
último snapshot do mês mas visto antes = descarregou e partiu). `eta` = ETA do
manifesto quando presente (meio-dia BRT pra evitar TZ shift), senão NULL. Volume já
em m³ → `quantidade`/`quantidade_convertida` iguais, `unidade='m³'`. `status='Atracado'`
(estado de chegada concreto, nunca `ERRO_COLETA`/`Despachado`). `imo`/`mmsi` NULL —
`03_imo_lookup` preenche no próximo run. `origem` NULL (todas as 7 são importação de
bandeira estrangeira; passaram pelo `04_cabotage_cleanup` sem serem filtradas). Mesmos
filtros canônicos da raspagem ao vivo (`_diesel_puro`, só importação) valem.

**Idempotência.** Upsert `ON CONFLICT (collected_at, porto, navio) DO NOTHING` —
re-rodar nunca duplica nem sobrescreve uma raspagem real que caia na mesma chave.

**Distintos por porto em maio (antes → depois):** Itaqui 9→10 (= manifesto 10, MITERA
recuperado), Maceió 0→1 (manifesto lista 2 mas STI JARDINS é ao-vivo/junho), Suape
5→8 (já tínhamos mais que os 6 do manifesto), Santos 17→19, Paranaguá 9→9. Total 40→47.

**Artefatos** (`scripts/pipelines/navios/backfill/`): `backfill_maio2026.py`
(self-documenting; gera o SQL e aplica via service-role com `--apply`) +
`backfill_maio2026.sql` (idempotente, versionado). **Query de reversão** (também no
rodapé do `.sql`):

```sql
DELETE FROM public.navios_diesel
WHERE (collected_at, porto, navio) IN (
  ('2026-05-19T09:32:00-03:00', 'Porto de Itaqui', 'MITERA'),
  ('2026-05-21T09:34:00-03:00', 'Porto de Maceió', 'ELANDRA MAPLE'),
  ('2026-05-07T20:52:00-03:00', 'Porto de Santos', 'ISABELLA M II'),
  ('2026-05-07T20:52:00-03:00', 'Porto de Santos', 'PACIFIC AZUR'),
  ('2026-05-15T09:31:00-03:00', 'Porto de Suape',  'ELANDRA MAPLE'),
  ('2026-05-19T09:32:00-03:00', 'Porto de Suape',  'SUPER G'),
  ('2026-05-21T09:34:00-03:00', 'Porto de Suape',  'MERSEY')
);
```

Aplicado via service-role em 2026-06-03 (7 linhas inseridas, 0 duplicatas;
`04_cabotage_cleanup` rodado em seguida não removeu nenhuma).

#### Reconciliation pass 2 — data-quality cleanup (one-shot, 2026-06-03)

Final May-2026 reconciliation after the 7-row add above. Two surgical fixes,
both scoped to the May window (`collected_at >= '2026-05-01' AND < '2026-06-01'`),
applied via service role. Source of truth: port line-ups + the same colleague
manifest (`manifesto_diesel_2026-06-03.xlsx`).

**Adjustment 1 — remove the ATLANTIC PRIDE / Porto de Suape false-positive (−4 rows).**
ATLANTIC PRIDE (IMO 9797266) was captured by the OLD Suape scraper before the
discharge-only fix. All its diesel blocks on Suape's "Dados Brutos" sheet are
`CG` (Carga/embarque = load-out, an export — not an import discharge), and its
ETA is 2026-06-01 (not even a May discharge). Absent from the manifest entirely.
This is exactly the bug fixed forward in `buscar_suape()` (pairs `Produto.N` with
`Tipo da Operação.N`, keeps only `DG`/`TB DG`); only stale history remained.
Business rule (Eduardo): keep ONLY discharges (imports); `CG` never enters.
**Deleted 4 rows** (all `status='Esperado'`, `eta` 2026-06-01, `imo` NULL; ids
28005 / 28014 / 28023 / 28032 at deletion time).

**Adjustment 2 — Itaqui blackout (12–20 May): 0 new rows.** Recomputed the set
difference between the manifest's `Desembarcado` rows (any `Terceiros` excluded)
attributed to May and what `navios_diesel` now holds — **empty**. Every genuine
May discharge is already present:
- **MITERA / Itaqui** — the only blackout casualty — already backfilled (pass 1).
- **MERSEY / Itaqui** (manifest 39 300 m³, último rel. 29/05) is the vessel's
  LATE-May call (25–29 May, IMO 9865752, ~39 222 m³ `quantidade_convertida`),
  which landed AFTER the scraper recovered on 21/05 — never lost, already
  live-scraped (its earlier 01–04 May Itaqui call is in the DB too). The Suape
  leg (50 000 m³) was already backfilled in pass 1. Multi-port is real (Itaqui
  AND Suape = two legitimate port-calls, not a duplicate).
- **ELANDRA MAPLE / Itaqui** (manifest 37 892 m³) is flagged `Terceiros` →
  excluded from backfill by rule; it is independently present from the live
  Itaqui feed (01–02 May, status Atracado) and left untouched.

**Not touched (intentional):** Suape / PINE OLIA (uncertain — may be a legit
discharge the colleague just did not list; not removed on speculation);
Santos / PACIFIC AZUR & ISABELLA M II (07 May — the manifest's lowest-confidence
May entries, marked `Status=Esperado` by the colleague; left in place here
pending an explicit Eduardo decision, then **removed in pass 3 below**); the 5
prior backfill rows.

**Distinct port-calls in May (before → after pass 2):** Suape 8→7 (ATLANTIC
PRIDE removed), all others unchanged (Itaqui 10, Maceió 1, Paranaguá 9, Santos
20, São Sebastião 1). Total 49→48.

**Idempotency.** The DELETE matches the natural key (porto + navio + May window)
and is a no-op once the rows are gone. Adjustment 2 inserts nothing → cabotage
cleanup has nothing new to evaluate; the manifest was all foreign-flag imports,
so `04_cabotage_cleanup` had nothing to remove for May either.

**Artifacts** (`scripts/pipelines/navios/backfill/`): `reconcile_maio2026_cleanup.py`
(self-documenting; dry-run prints the Adjustment-2 manifest-vs-DB report as a
live regression guard, `--apply` performs the DELETE via service role) +
`reconcile_maio2026_cleanup.sql` (idempotent DELETE, versioned). **Reversal of
Adjustment 1** (re-insert the 4 deleted rows exactly as captured — note the old
scraper's `unidade='c'`):

```sql
INSERT INTO public.navios_diesel
  (collected_at, porto, status, navio, produto, quantidade, unidade,
   quantidade_convertida, eta, berco)
VALUES
  ('2026-05-27T13:01:00+00:00','Porto de Suape','Esperado','ATLANTIC PRIDE','Óleo Diesel',16200,'c',16200,'2026-06-01T09:00:00+00:00','PGL-3A'),
  ('2026-05-27T19:01:00+00:00','Porto de Suape','Esperado','ATLANTIC PRIDE','Óleo Diesel',16200,'c',16200,'2026-06-01T09:00:00+00:00','PGL-3A'),
  ('2026-05-28T01:00:00+00:00','Porto de Suape','Esperado','ATLANTIC PRIDE','Óleo Diesel',16200,'c',16200,'2026-06-01T09:00:00+00:00','PGL-3A'),
  ('2026-05-28T07:00:00+00:00','Porto de Suape','Esperado','ATLANTIC PRIDE','Óleo Diesel',16200,'c',16200,'2026-06-01T09:00:00+00:00','PGL-3A')
ON CONFLICT (collected_at, porto, navio) DO NOTHING;
```

Applied via service-role on 2026-06-03 (4 rows deleted; Adjustment 2 added 0).

#### Reconciliation pass 3 — Santos low-confidence removal (one-shot, 2026-06-03)

Resolves the one item pass 2 left open "pending an explicit Eduardo decision".
Decision made (Eduardo, 2026-06-03): **remove the two lowest-confidence Santos
entries** that came from the colleague manifest. Scoped to the May window and
applied via service role.

**Removed (−2 rows, both `imo IS NULL`):**

| Porto | Navio | Volume (m³) | collected_at | status | eta | id (at deletion) |
|---|---|---:|---|---|---|---|
| Porto de Santos | PACIFIC AZUR | 47.337 | 2026-05-07T23:52Z (= 20:52-03) | Atracado | 2026-05-07 | 28241 |
| Porto de Santos | ISABELLA M II | 35.503 | 2026-05-07T23:52Z (= 20:52-03) | Atracado | 2026-05-07 | 28240 |

Both were inserted by `backfill_maio2026` (pass 1). On the manifest they are the
only Santos vessels flagged `Status=Esperado` (EXPECTED — discharge **not**
confirmed), i.e. the colleague's lowest-confidence rows. Our own Santos scraper
ran normally the whole month (**19 distinct vessels live-scraped — already more
than the colleague's 14 Santos entries**) and never captured either vessel.
Decision rationale: with our first-party source both healthy and broader than the
manifest for Santos, prioritise the accuracy of our own feed over inflating the
count with two unconfirmed `Esperado` rows. This is the **opposite** trade-off
from the Itaqui blackout (where our feed had a real 9-day hole and the manifest
was the only record) — here there is no gap to fill, so the manifest's weakest
rows are dropped.

**Safety — strict natural key.** Both vessels ALSO have legitimate, live-scraped
rows that carry a real IMO and MUST survive: PACIFIC AZUR has a June Itaqui call
(IMO 9788540, 3 rows) and ISABELLA M II has April Santos calls (IMO 9836440,
8 rows). The DELETE is scoped to `porto='Porto de Santos' AND navio IN (…) AND
May window AND imo IS NULL`, so only the two manifest-backfill rows match.
Verified in-DB pre-delete: each target had exactly 1 May Santos row and it was
the imo-NULL one; verified post-delete: the 3 + 8 real-IMO rows all survived.

**Not touched:** the other pass-1 backfill rows stay (MITERA/Itaqui,
ELANDRA MAPLE/Maceió, ELANDRA MAPLE/Suape, SUPER G/Suape, MERSEY/Suape) and every
live-scraped Santos vessel.

**Distinct port-calls in May (before → after pass 3):** Santos **20 → 18** (both
removed vessels had only this single May Santos row), all others unchanged
(Itaqui 10, Maceió 1, Paranaguá 9, Suape 7, São Sebastião 1). Total 48→46.

**Idempotency.** The DELETE matches the natural key (porto + navio + May window +
`imo IS NULL`) and is a no-op once the rows are gone — safe to re-run.

**Artifacts** (`scripts/pipelines/navios/backfill/`): `reconcile_maio2026_santos.py`
(self-documenting; dry-run prints the exact targeted rows + before/after Santos
distinct and aborts unless exactly 2 rows match, `--apply` performs the DELETE via
service role) + `reconcile_maio2026_santos.sql` (idempotent DELETE, versioned).
**Reversal** (re-insert the 2 deleted rows exactly as captured — volume already in
m³, `unidade='m³'`, `imo` NULL so `03_imo_lookup` re-fills it):

```sql
INSERT INTO public.navios_diesel
  (collected_at, porto, status, navio, produto, quantidade, unidade,
   quantidade_convertida, eta, inicio_descarga, fim_descarga, origem, berco, imo)
VALUES
  ('2026-05-07T20:52:00-03:00','Porto de Santos','Atracado','PACIFIC AZUR','Óleo Diesel',47337,'m³',47337,'2026-05-07T12:00:00-03:00',NULL,NULL,NULL,NULL,NULL),
  ('2026-05-07T20:52:00-03:00','Porto de Santos','Atracado','ISABELLA M II','Óleo Diesel',35503,'m³',35503,'2026-05-07T12:00:00-03:00',NULL,NULL,NULL,NULL,NULL)
ON CONFLICT (collected_at, porto, navio) DO NOTHING;
```

Applied via service-role on 2026-06-03 (2 rows deleted, ids 28241 / 28240;
Santos distinct 20 → 18; the 3 + 8 real-IMO rows preserved).

### Itaqui scraper — diesel quantity over-count (root cause + sanity guard, 2026-06-05)

**Symptom.** A ComexStat-URF backtest showed Porto de Itaqui over-counting diesel
by **2.38×** vs the official São Luís clearance. The smoking gun in `navios_diesel`
was **HAFNIA LARISSA** (April 2026, Itaqui) with `quantidade = 125,194 t` →
`quantidade_convertida = 149,933 m³`, `produto = 'Óleo Diesel'`. That single row
exceeded the entire official monthly diesel clearance of São Luís (~135,250 m³)
and, combined Apr+May, accounted for **exactly the 2.38× anomaly** (it was 48% of
the two-month official diesel volume by itself).

**Root cause = corrupt SOURCE value, not a parsing bug.** Investigated live
against the real Itaqui page (`portodoitaqui.com.br/porto-agora/navios/esperados`,
fetched via the scraper's own requests-Session path — HTTP 200, 60 KB):

- The Itaqui lineup table carries BOTH a `DWT` column **and** a `Qtd.Carga`
  column. `buscar_itaqui()` reads `Qtd.Carga` (via `_col("Qtd")`, which matches
  only that column) — and `Qtd.Carga` IS the correct cargo **parcel**, validated
  on live rows: `HORIZON THETIS` "DIESEL S500" `Qtd.Carga=15,980 t` with
  `DWT=49,999`; `VELOS POLARIS` "DIESEL" `Qtd.Carga=34,220 t` with `DWT=50,000`
  (realistic diesel parcels, well below each ship's deadweight). So the column
  choice, the BR-thousands parsing (`_parse_numero("125.194") → 125194`), the
  unit (`t`) and the m³ conversion are all correct.
- The `produto='Óleo Diesel'` tag is legitimate: the source `Carga` cell for
  HAFNIA LARISSA said DIESEL; `consolidar()` then normalises the label to
  "Óleo Diesel". Not a default-tagging artefact.
- HAFNIA LARISSA is a crude/oil tanker of **109,990 t DWT** (IMO 9800300). A
  125,194 t cargo is **physically impossible** — it exceeds the ship's own
  deadweight by ~15 kt. The Itaqui portal simply published a corrupt `Qtd.Carga`
  value for that vessel (cumulative/throughput or a data-entry error). It flowed
  straight into the DB because there was **no sanity check** on parcel size.

**Fix — physical sanity guard** (`01_lineup_scrape.py`):

- Constants `_MAX_DIESEL_PARCEL_T = 90_000 t` (≈ `_MAX_DIESEL_PARCEL_M3 ≈ 107,784 m³`).
  Threshold rationale: across the whole `navios_diesel` history, the **only** row
  above 90 kt was the HAFNIA LARISSA outlier; the next-highest plausible parcel
  was 67,972 t. 90 kt cleanly isolates impossible values without false-tripping
  any legitimate large LR1/LR2 parcel.
- `_sanity_check_parcel_t(valor_t, navio, porto)` **rejects** (drops the quantity,
  returns `None`) any parcel above the ceiling and logs a loud `[WARN][sanity]`.
  Rejection — not capping — is deliberate: a corrupt source value carries no
  information about the true parcel size, so any cap would be a fabrication. The
  ship still appears as a lineup row, but contributes **zero** inflated volume.
- Applied at **two layers**: (1) inside `buscar_itaqui()` right after the
  `Qtd.Carga` rename (per-ship, with the vessel name); (2) a unit-agnostic
  backstop in `_aplicar_conversao()` (post-conversion, on m³) that protects
  **every** tonne/volume-reporting port (Santos, Paranaguá, Maceió, São Sebastião,
  Suape) — so a future corrupt value above the ceiling can never silently inflate
  a month again. **Never soften this guard back to "trust any Qtd.Carga".**

**Historical data correction** (service role, idempotent, reversible). Only
**HAFNIA LARISSA** breached the ceiling — it was the single offending vessel
across the entire table (19 snapshot rows, all `quantidade=125194`, April 2026,
ids 5023–8000; no other port affected). Applied via PATCH on 2026-06-05, setting
`quantidade = NULL` and `quantidade_convertida = NULL` on exactly those rows
(mirrors the new scraper behaviour: reject → quantity dropped, ship row kept).
The PATCH filters on `porto='Porto de Itaqui' AND navio='HAFNIA LARISSA' AND
quantidade=125194`, so it is a **no-op on re-run**. Pre-change snapshot of all 19
rows saved to `scripts/pipelines/navios/output/itaqui_hafnia_reversal.json` for
exact reversal. **Reversal:**

```sql
UPDATE public.navios_diesel
SET quantidade = 125194, quantidade_convertida = 149932.93
WHERE porto = 'Porto de Itaqui'
  AND navio = 'HAFNIA LARISSA'
  AND quantidade IS NULL
  AND collected_at >= '2026-04-01' AND collected_at < '2026-04-06';
```

**Validation (Itaqui diesel volume, RPC `get_nd_volume_mensal_historico`
last-seen-per-discharged-ship method):**

| Month | Before (m³) | After (m³) | Official ComexStat (m³) | Before/off | After/off |
|-------|------------:|-----------:|------------------------:|-----------:|----------:|
| 2026-04 | 465,776 | 315,843 | 135,250 | 3.44× | 2.34× |
| 2026-05 | 271,587 | 271,587 | 175,000 | 1.55× | 1.55× (HAFNIA not in May) |
| **Apr+May combined** | **737,363** | **587,430** | **310,250** | **2.38×** | **1.89×** |

The headline **2.38× anomaly is gone** (combined ratio drops to 1.89×). The
residual ~1.9× is the expected structural gap between a lineup-snapshot estimate
and official desembaraço (timing of clearance-vs-discharge + the discharged-volume
attribution heuristic), **not** a parsing defect — no other vessel breaches a
physically plausible parcel size.

### Itaqui scraper — import-only direction filter (2026-06-08)

**Symptom.** A vessel on a non-import call was leaking into the diesel import
lineup: **DALLAS** (IMO 9390020, `OPERAÇÃO=TRANSBORDO`, `CARGA=DIESEL`, 70,000 t)
showed up in `/navios-diesel` for Porto de Itaqui. The `/navios-diesel` lineup must
contain **only imports** (diesel discharged into the country).

**Root cause.** `buscar_itaqui()` filtered each status table (Atracado/Fundeado/
Esperado) **only** by `Carga` containing "DIESEL" and **ignored the `OPERAÇÃO`
column entirely**. The Itaqui `OPERAÇÃO` column carries `IMPORTAÇÃO` / `EXPORTAÇÃO`
/ `TRANSBORDO` / `CONSUMO`, so EXPORTAÇÃO and TRANSBORDO diesel rows passed through.
Itaqui was the **only** port without a direction filter — every other port already
filters direction at the source (see table below).

**Fix** (`01_lineup_scrape.py`, `buscar_itaqui()`): compose the mask as
`diesel & df[col_op].str.contains("IMPORTA")`, with `col_op = _col(df, "Opera",
required=False)`. `"IMPORTA"` is used (not the full accented string) for encoding
robustness — `"IMPORTAÇÃO"` matches, `"EXPORTAÇÃO"` does not. The `OPERAÇÃO`
column is **not** persisted to `navios_diesel`, so an already-stored leak
(e.g. DALLAS) only drops out on the **next** scrape (the dashboard shows the latest
`collected_at` snapshot); no DB cleanup is required — `etl_navios_lineup.yml` runs
every 6h, or trigger it manually for an immediate refresh.

**Follow-up — per-table direction asymmetry (2026-06-08, diagnosed against the live
page).** The first fix assumed `OPERAÇÃO` was present on all three tables and
**skipped** any table lacking it (anti-false-positive default). The live-page
diagnosis showed the three Itaqui tables have **different schemas**:

| Table (index) | Status | Has `OPERAÇÃO`? | Columns (abridged) |
|---|---|---|---|
| `[0]` | **Atracado** (berthed) | **NO** | Berço, IMO, Navio, **Bordo**, Comp, DWT, Carga, Qtd.Carga, … |
| `[1]` | **Fundeado** (anchored) | **YES** | IMO, Navio, **Operação**, Comp, DWT, Carga, Qtd.Carga, … |
| `[2]` | **Esperado** (expected) | **YES** | IMO, Navio, **Operação**, …, Carga, Qtd.Carga, **Prev Chegada**, … |

(The `[0]` Atracado table's `Bordo` = BORESTE/BOMBORDO = physical berthing side,
**not** a cargo direction.) The index map `{0:Atracado, 1:Fundeado, 2:Esperado}` is
correct — no page-furniture tables shift the indices.

So the "skip when `OPERAÇÃO` is absent" branch was **silently dropping the entire
Atracado table** on every run — a sub-capture regression in the opposite direction
(legitimate diesel imports at berth, e.g. VELOS POLARIS 34,220 t, were discarded).
The branch is now **asymmetric per table**:

- **Tables WITH `OPERAÇÃO`** (Fundeado, Esperado) → keep the `IMPORTAÇÃO`-only
  filter (drops the DALLAS TRANSBORDO and any EXPORTAÇÃO row — original intent).
- **The Atracado table WITHOUT `OPERAÇÃO`** → capture diesel **Maceió-style**
  (`buscar_maceio`): a diesel ship at berth is physically discharging into the
  terminal (an import in practice), and the page gives no direction to filter on.
  Brazilian-flag coastal traffic is removed downstream by `04_cabotage_cleanup`.

This keeps DALLAS dropped **and** restores VELOS POLARIS. The summary log now
reports three counters (`linhas diesel mantidas: N (… atracados sem coluna de
direção: K), diesel não-importação descartado …: M`) so both leak directions stay
visible. Verified live: DALLAS (TRANSBORDO) discarded, VELOS POLARIS (Atracado)
captured, BRAGE R (TRANSBORDO) discarded.

**Direction filter per port** (all ports keep imports / discharge only):

| Port | Direction filter (source column → kept value) |
|---|---|
| Porto de Santos | `Opera == "DESC"` (discharge) |
| Porto de Paranaguá | `Sentido == "IMP"` |
| Porto de Suape | `Tipo da Operação ∈ {DG, TB DG}` (discharge / transhipment-discharge) |
| Porto de Itaqui | Fundeado/Esperado: `OPERAÇÃO contains "IMPORTA"`; Atracado (no `OPERAÇÃO`): capture all diesel + downstream cabotage filter — **added 2026-06-08** |
| Porto de Maceió | none (no direction column) — capture all diesel + downstream cabotage filter |

### ComexStat backtest harness (offline validation, 2026-06)

**Purpose.** `scripts/pipelines/navios/comex_backtest.py` is an **offline** harness
that validates the `/navios-diesel` monthly diesel-volume methodology (derived from
the port lineup) against the official **ComexStat-by-URF** ruler, for **closed months
only**. It is a validation tool, **not** an ingestion pipeline: it READS
`navios_diesel` (service-role) and READS the ComexStat public API, and writes ONLY a
local parquet/CSV in `DADOS/` (gitignored). It NEVER writes to Supabase.

**Lag caveat — desembaraço ≠ descarga.** ComexStat counts **customs clearance**
(desembaraço aduaneiro), which lags **physical discharge** at the berth by days to
weeks (a cargo discharged at the end of month M is often cleared in M+1). Therefore
ComexStat is **useless as a live feed** and is used here **only** to backtest closed
past months, where the lag has washed out. CTO decision (2026-06): ComexStat is the
backtest ruler, never the dashboard feed. **The harness must not feed the dashboard.**

**What it computes.** A per-port × month bias table:

| field | meaning |
|---|---|
| `ours_m3` (a) | our methodology: discharged m³ from the lineup, **per port** |
| `comex_m3` (b) | ComexStat-URF cleared kg → m³, summed over URFs mapping to that port |
| `diff_b_minus_a` | absolute gap `b − a` |
| `ratio_a_over_b` | `a / b` — `>1` over-count, `<1` under-count |
| `covered` | whether the port is one we scrape into `navios_diesel` |

**Methodology replication.** The per-port `ours_m3` faithfully replicates the
discharged logic of `supabase/migrations/20260527700000_nd_volume_mensal_historico_past_only_discharged.sql`,
broken down per port (the RPC returns only the month total): anchor = last snapshot
whose SP-local month == target month; exclude `error_ports` (ERRO_COLETA at anchor)
and `anchor_set` (vessels still pending at anchor); sum the last row per
(navio, porto) ≤ anchor, with the `attribution_month` filter (vessel's last-seen
SP-month == target). A built-in **sanity check** asserts the per-port sum equals the
RPC discharged total for each month (the script exits 3 if it drifts). Validated
2026-06: May 2026 per-port sum = **960,343.02** = RPC, April = RPC, both exact.

**Density (832 vs 835).** ComexStat reports mass; we convert kg → m³ with **832
kg/m³** — the production-side density in `ncm_densidade_kg_m3` for NCM `27101921`,
the same density the production/imports pipelines use. The `/navios-diesel` lineup
itself uses **835 kg/m³** when converting tonnes to m³ during scraping; we align the
ComexStat side to 832 so both sides of the ratio sit on the same ruler. The 832 vs
835 spread is `< 0.4 %` and does not move the bias verdict. Our `quantidade_convertida`
is already stored in m³ and is used as-is.

**URF → canonical port map (15 entries).** ComexStat returns URF as
`"<code> - <NAME>"` with inconsistent dashes/accents (e.g. `0317903 - IRF SAO LUIS`,
`0417902 - IRF - PORTO DE SUAPE`, `0217800 - ALF - BELÉM`); a normalizer strips the
code, drops accents, uppercases and collapses dashes/whitespace before lookup.

| URF (normalized) | Canonical port | Covered |
|---|---|---|
| IRF SÃO LUÍS | Porto de Itaqui | yes |
| PORTO DE SANTOS | Porto de Santos | yes |
| PORTO DE PARANAGUÁ | Porto de Paranaguá | yes |
| SÃO SEBASTIÃO | Porto de São Sebastião | yes |
| IRF PORTO DE SUAPE | Porto de Suape | yes |
| MACEIÓ | Porto de Maceió | yes |
| PORTO DE MANAUS | Manaus | no |
| ALF BELÉM | Belém/Vila do Conde | no |
| ALF SALVADOR | Salvador | no |
| ALF FORTALEZA | Fortaleza/Mucuripe | no |
| IRF CAMPOS DOS GOYTACAZES | Açu-RJ | no |
| PORTO DE RIO GRANDE | Rio Grande | no |
| IRF NATAL | Natal | no |
| PORTO DO RIO DE JANEIRO | Rio de Janeiro | no |

Unmapped URFs are recorded (prefixed `(unmapped)`) for visibility but never gate the
exit code.

**Bias monitor / thresholds.** Covered ports whose `a/b > 1.5` (over-count, e.g.
Itaqui) or `< 0.6` (under-count) are flagged; a breach persisting `≥ 2` consecutive
closed months is the real signal of a scraper/methodology bug. A single covered-port
breach in the run trips a **non-zero exit (code 4)** so a future workflow/CI can gate
on it; uncovered ports never affect the exit code. Validated 2026-06: **Itaqui flagged
as a persistent over-count (a/b 2.33 in Apr, 1.55 in May)** — exactly the known Itaqui
scraper super-count that the parallel scraper fix addresses (see "Itaqui scraper").

**Output (in-place upsert).** Writes `DADOS/navios_comex_backtest.parquet` (+ sibling
`.csv`), **appended/upserted by (mes, porto)** — never deleted and rebuilt, preserving
the running history (project standard). De-duped on `(mes, porto)` before write.

**How to run.**

```bash
python scripts/pipelines/navios/comex_backtest.py                       # all closed months (baseline 2026-04 ..)
python scripts/pipelines/navios/comex_backtest.py --from 2026-04 --to 2026-05
python scripts/pipelines/navios/comex_backtest.py --dry-run             # print + monitor, no file write
python scripts/pipelines/navios/comex_backtest.py --quiet               # suppress progress chatter
```

Credentials: `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (env or a `.env` walked up the
tree — works from a worktree). The ComexStat API 429s aggressively; the harness reuses
`mdic_comex_sync.py`'s backoff and spaces month legs ~13 s apart. **No GitHub Actions
workflow yet** (CTO decides whether to schedule it); the script is written so a future
job only needs `pip install -r requirements.txt` and one call, gating on the exit code.

### MDIC Comex — source revises prior months → weekly revision sweep (2026-06-09)

**Root cause.** ComexStat revises already-published months as more customs
declarations are processed (FOB drifts a few percent; volume usually stable).
The daily `etl_mdic_comex.yml` run pulled only a **trailing 3 months**
(`--meses 3`), so once a month fell out of that rolling window it was **frozen at
whatever value it had on its last refresh** and never absorbed later revisions.

**Symptom (confirmed 2026-06-09).** Russia / Mar-2026 / NCM `27101921` / import:
our `mdic_comex` held `valor_fob_usd = 505,862,730` while live ComexStat had
`529,067,402` (+4.59%; volume unchanged at `653,501,838`). This produced wrong
unit prices on `/imports-exports` (Import Unit Price by Origin Country + price
summary) for any month that had aged out of the window but was later revised.

**Fix.** `etl_mdic_comex.yml` now has **two schedules**: the daily `--meses 3`
freshness run (unchanged) **plus** a weekly Sunday 06:00 UTC *revision sweep* that
re-pulls a **trailing 12 months** (`--meses 12`), so revisions to months 4–12 back
get re-upserted. Idempotent (PK `(ano,mes,flow,ncm_codigo,pais)` upsert). The
`workflow_dispatch` now also accepts a `meses` input (alongside `desde`) for
ad-hoc one-off re-syncs without editing code. Corrective re-sync for the live bug
above was run once with `mdic_comex_sync.py --desde 2025-06` (13 months, ~24 legs).
Bump `WIDE_MONTHS` in the workflow if revisions are ever observed further back.

### MDIC Comex — drift detector (self-heals any-horizon revisions, 2026-06-09)

**Gap the sweeps leave.** The daily 3-month + weekly 12-month sweeps absorb
recent revisions, but the annual "fechamento" — a final revision to the prior
year's late months around Q1 — can land **just outside** the 12-month window.
Re-extracting everything is wasteful (months ≥ ~13 months old match the live
source to the dollar, verified 2022→2025). A cheap monthly **drift detector**
closes the gap for **any horizon** and surfaces revisions as a signal.

**Script.** `scripts/pipelines/mdic_comex_drift_check.py`. Algorithm:

1. **Fetch lightweight live monthly aggregates** for both flows over a trailing
   window (`--meses`, default **24**). The call uses `details: ["ncm"]` (NO
   country detail) so each response is tiny (≤ 12 mo × 3 NCM per flow) — only
   monthly FOB + KG per `(ano, mes)`. Reuses `mdic_comex_sync.py`'s endpoint,
   browser-like headers, `_RETRIES`/`_BACKOFF`/Retry-After backoff and the 12 s
   inter-request sleep; **does not advertise `br`** (Pegadinha #12).
2. **Read stored aggregates** from `mdic_comex` (paginated `SELECT`, summed per
   month, service-role client — same creds as the sync script).
3. **Compare** per `(flow, ano, mes)`. Flags **DRIFT** when the relative delta on
   FOB **or** KG exceeds the tolerance (`--tolerancia`, default **0.5%**), with an
   absolute floor (`_FLOOR_FOB`/`_FLOOR_KG` = 100k each) to ignore rounding noise
   on tiny months — a month is skipped only if **both** stored and live are below
   the floor (so a newly-appeared month, stored=0/live large, is still surfaced).
4. **Self-heals** each drifted month via a targeted full re-pull
   (`mdic_comex_sync.sync_months(sb, months)` — the shared per-month pull+upsert
   path extracted from the sync script; no duplicated upsert logic). Heals are
   capped at `--heal-cap` (default **12**, mirrors the cross-local heal-cap
   pattern); if the cap is hit, the most-recent months heal first and the rest
   defer to the next run (logged + annotated).
5. **Signals** the revision (half the value): prints a summary, emits
   `::warning::` annotations and a `$GITHUB_STEP_SUMMARY` table listing each
   revised month + % delta (e.g. *"ComexStat revised import 2025-12 FOB by
   +1.8% — re-pulled"*). **Exit policy**: non-zero **only** if a heal was
   attempted and **FAILED** — a clean heal (or `--dry-run`, or cap-deferred) is a
   **loud-but-green** signal, so green = no drift or drift cleanly healed, red =
   needs a human.
6. Idempotent; safe to re-run.

**API period pegadinha (verified empirically 2026-06-09).** The ComexStat
`period {from, to}` is **NOT a contiguous span** — the *month* component is
applied as a recurring window across the *year* range. A naive trailing window
like `from=2024-06, to=2025-05` returns **0 rows** (month range 06..05 is empty).
The drift checker therefore requests **full calendar years**
(`from=<startYear>-01` to `to=<endYear>-12`, 1 call/flow) and filters client-side
to the trailing N months — verified `from=2024-01, to=2025-12` returns all 24
months. Same trap applies to anyone writing a new ComexStat query; prefer
full-calendar-year requests or month-by-month iteration like the sync script.

**Schedule.** Separate workflow `.github/workflows/etl_mdic_comex_drift.yml`
(kept distinct from `etl_mdic_comex.yml` so the revision signal is its own
clean green/red monitoring job). Monthly on the **5th at 07:00 UTC** (after the
month-1st heavy ETLs, off-peak) — sufficient given daily-3 + weekly-12 already
cover recent months, and the check is cheap. `workflow_dispatch` accepts
`meses` / `tolerancia` / `dry_run` inputs. Same secrets as the other ComexStat
jobs (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`); a final `continue-on-error` Client
Alerts hook fires `--source mdic_comex` when a heal revised values.

**Follow-up flagged to CTO (cross-domain, alerts owner).** Wiring a *proper
subscriber-facing* "ComexStat revised month X" alert through `scripts/client_alerts/`
is intentionally **not** done here (cross-domain — owned by the Client Alerts
product). The current signal is the GHA annotation/summary + a red run on heal
failure. If a dedicated alert base is wanted, that is a follow-up for the alerts
owner; this script must not touch `scripts/client_alerts/` or alert workflows.

### Client Alerts (logged-in product — hook no fim do ETL, 2026-06-02)

Produto de alertas por email **só-logado**, event-driven. Substitui o produto cloud antigo (anon double-opt-in, detectores em polling de 2h, `scripts/alerts/`) que foi **deletado**. Engine em `scripts/client_alerts/` (ver árvore acima); schema/RPCs em `docs/supabase/PRD.md` § "Alerts v2"; frontend em `docs/app/alerts.md`.

**Trigger = último step de cada ETL.** ~15 workflows ganharam um step final `continue-on-error` (gated por `if: success()`) que roda `python -m scripts.client_alerts.run_base --source <slug>`:

```yaml
      # Client Alerts hook — emit + (immediate) deliver for the bases this ETL updates.
      - name: Client Alerts — notify subscribers (<slug>)
        continue-on-error: true   # non-critical side-effect — never fail the data pipeline
        if: success()
        run: python -m scripts.client_alerts.run_base --source <slug>
        env:
          SUPABASE_URL:              ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY:      ${{ secrets.SUPABASE_SERVICE_KEY }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          GMAIL_ADDRESS:      ${{ vars.GMAIL_ADDRESS || 'ibbaogproject@gmail.com' }}
          GMAIL_APP_PASSWORD: ${{ secrets.GMAIL_APP_PASSWORD }}
          ALERTS_SENDER_EMAIL: ${{ vars.ALERTS_SENDER_EMAIL || 'SectorData Alerts <ibbaogproject@gmail.com>' }}
          ALERTS_FRONTEND_URL: ${{ vars.ALERTS_FRONTEND_URL || 'https://oilandgasdata.vercel.app' }}
```

- **`continue-on-error: true`**: o alerta é side-effect não-crítico — uma falha de envio **nunca** marca o pipeline de dados como vermelho.
- **`run_one(slug)`**: `emit_event_if_new(slug)` (watermark + UNIQUE `(source_slug, event_key)` = idempotência dupla). Se nada novo → no-op. Se a base é `immediate` → `fanout_event` + `send_pending_outbox` inline (email em segundos). Se é `digest` → só emite; o cron diário entrega.
- **Secrets divergentes**: a maioria dos workflows passa `SUPABASE_SERVICE_KEY`; `etl_anp_cdp_diaria`/`etl_anp_vendas` passam `SUPABASE_SERVICE_ROLE_KEY`. `_core/config.py` lê os dois.
- **Bases multi-tabela**: `etl_anp_fase3` chama `--source anp_daie --source anp_desembaracos`; `etl_anp_precos` chama `--source anp_precos_produtores --source anp_glp`. Navios: `import_candidates` em `etl_ais_candidates`; `vessel_positions`/`port_arrivals` em ambos `etl_navios_positions` e `etl_ais_positions` (watermark dedupe); `navios_diesel` em `etl_navios_lineup`.
- **Sem workflow**: `price_bands` (upload manual via `scripts/manual/price_bands_upload.py`) e `anp_subsidy_caps` (admin-edit, inativa no launch) — rede de segurança via digest diário.

Workflows com o hook: `etl_anp_vendas`, `etl_anp_cdp`, `etl_anp_cdp_diaria`, `etl_anp_voip`, `etl_anp_precos`, `etl_anp_lpc`, `etl_anp_precos_distribuicao`, `etl_anp_subsidy_diesel`, `etl_anp_fase3`, `etl_mdic_comex`, `etl_navios_lineup`, `etl_navios_positions`, `etl_ais_positions`, `etl_ais_candidates`, `etl_dg_margins` (15). O hook do `d_g_margins` migrou de `manual_dg_margins` (retirado) para `etl_dg_margins` em 2026-06-05.

**Digest workflow** — `client_alerts_digest.yml` (`cron: '30 23 * * *'` = 23:30 UTC / 20:30 BRT, após o último ETL do dia):

| Item | Valor |
|---|---|
| Comando | `python -m scripts.client_alerts.run_base --digest --batch-limit 200` |
| O que faz | `sweep_digests()` agrupa os eventos do dia (`DIGEST_TIMEZONE=America/Sao_Paulo`) das bases `digest` (vessels, produção diária, ou qualquer inscrição com `cadence_override='digest'`) em **1 email por subscriber**. Digest vazio → não envia. |
| Concurrency | grupo `client-alerts-digest`, `cancel-in-progress: false` |

**Sender — Gmail SMTP + App Password** (`_core/gmail_client.py`):

- `smtp.gmail.com:587` + STARTTLS, login com `GMAIL_ADDRESS` (default `ibbaogproject@gmail.com`) + `GMAIL_APP_PASSWORD` (16-char Google App Password — **nunca expira**).
- **Por que não Resend nem OAuth Gmail API**: não há domínio de envio verificado (Resend sandbox só entrega ao dono da conta); o refresh token OAuth expirava (app Google em modo Testing → `invalid_grant`). App Password sobre SMTP elimina ambos os problemas — zero token plumbing.
- `From` **deve** ser o dono do App Password (Gmail reescreve um From divergente). Quota free Gmail ~500 emails/dia.
- `validate_api_key()` faz login probe 1× por processo; falha → `raise SystemExit(1)` para o step falhar visível. SMTP não tem suppression API (`list_suppressions()` → set vazio, fail-open). Idempotência entre runs = estado terminal `sent`/`failed`/`skipped` no `alert_outbox` (SMTP não tem idempotency key).

**Secret obrigatório (GHA):** `GMAIL_APP_PASSWORD`. Vars opcionais (têm default no workflow): `GMAIL_ADDRESS`, `ALERTS_SENDER_EMAIL`, `ALERTS_FRONTEND_URL` (default `https://oilandgasdata.vercel.app`).

### Monitoring & testing (ops coverage + test harness, 2026-06)

Three ops monitors cover the ETL fleet: a **freshness guardian** (catches a *silent* stall — workflow green but data not advancing), a **failure pager** (catches a *loud* failure — workflow red and staying red), and a **roster canary** (catches an *upstream completeness gap* — workflow green AND data advancing, but the source itself is missing dimensions, e.g. ANP's daily panel lagging a new FPSO's wells). Plus a **safety-net poll** and a **production-safe test harness** for the Client Alerts product. All of them email the ops team / send via the same Gmail SMTP sender used by Client Alerts (`scripts/client_alerts/_core/gmail_client.py`). They are ops/admin alerts, **independent of the client Alerts product** (which emails *subscribers* when a base *gets* new data; these fire when a base *fails* to, a workflow breaks, or a source goes incomplete).

| Workflow | Schedule | Script / command | What it does |
|---|---|---|---|
| `freshness_monitor.yml` | Daily `0 12 * * *` UTC | `scripts/freshness_monitor.py` | **Freshness guardian.** Reads `get_data_sources_freshness()` (service-role), compares each base's `last_update` vs a per-source `OVERDUE_HOURS` threshold tuned to the source's REAL publication cadence (not its cron). Emails ONE ops digest to `ALERTAS_DEST_EMAIL` only when a base is genuinely overdue; logs the full per-base snapshot every run. Catches silent green-but-stale stalls (source went quiet, scraper returns 0 rows behind a 200, CAPTCHA path degraded). |
| `workflow_failure_monitor.yml` | Every 6h `0 */6 * * *` UTC | `scripts/workflow_failure_monitor.py` | **Failure pager.** Polls the GitHub Actions API for 16 critical workflows (`CRITICAL_WORKFLOWS`); pages ops on **≥3 consecutive non-cancelled failures**. Debounced via `alertas_estado` (key `workflow_failure_monitor`): pages once `ok→stuck`, recovery note `stuck→ok`, no re-page while still stuck. `cancelled`/`skipped`/in-flight runs are ignored. Needs `actions:read` on `GITHUB_TOKEN`. Re-homes the retired `etl_workflow_stuck` capability. |
| `cdp_roster_canary.yml` | Daily `15 12 * * *` UTC | `scripts/cdp_roster_canary.py` | **CDP daily-panel roster canary** (built 2026-06-10 after the P-78 case — Pegadinha 3 of `etl_anp_cdp_diaria`). Pure read-only SQL over our own tables (no Power BI calls): compares the well roster of the latest COMPLETE month in `anp_cdp_producao` (a month is complete when its producing-well count ≥ 70% of the previous month's; steps back up to 3 months) against the wells seen in `anp_cdp_diaria_poco` over the last **10 days of data** (relative to `MAX(data)` — the frontier lags D-6/D-8). Reference roster = wells > 1 kbpd monthly avg (~250–400 wells, server-side filter); well match = normalized exact (both sources use the standard ANP well code; parenthetical designations stripped). Also compares `instalacao_destino` vs `anp_cdp_diaria_instalacao.instalacao` with a fuzzy **digit-aware** match (both fleets use 'PETROBRAS NN' naming — the NUMBER is the identity, so 'PETROBRAS 78' must NOT match 'PETROBRAS 08'; unnumbered installations match on any shared alpha token / substring) — informational only. **Emails ops only when the missing wells' aggregate monthly production exceeds 10 kbpd** (lists each well, kbpd, field, installation); below threshold = log-only. Red run only when the CHECK ITSELF breaks (env/RPC/SMTP); a roster gap emails and exits 0. Offline simulation on real data (2026-06-10): flags exactly the 5 genuinely-missing wells, 62.4 kbpd aggregate, 'PETROBRAS 78' as the unmatched installation — fires on day 1 for the known P-78 case by design. Known benign listings: wells shut in after the reference month; name-format drift. |
| `client_alerts_poll.yml` | Every 20 min `*/20 * * * *` | `run_base --all-active` | **Safety-net poll.** Runs the immediate path for every active source. Detects new periods for the **hook-less Data Input base** (`price_bands` — admin-edited, no ETL hook) within ~20 min, and backstops every base if an ETL hook is ever skipped (`d_g_margins` now has its hook in `etl_dg_margins`). Idempotent (period-watermark + UNIQUE-deduped outbox) → a no-op poll sends nothing, a poll racing an ETL hook never double-sends. |
| `client_alerts_test.yml` | `workflow_dispatch` (inputs: `source`, optional `to`) | `run_base --test --source <slug> [--to <email>]` | **Production-safe test harness.** Simulates a base update by inserting a synthetic `test:`-keyed `alert_events` row for the real current period → fanout → SMTP send, **without writing the data table or touching the watermark** (`alert_source_state`). Always delivers immediately (even for digest bases); `--to` mails an extra copy to one address. The method to test any base in production. Per-base test plan: [`docs/alerts/TEST_PLAN.md`](../alerts/TEST_PLAN.md). |

**Threshold tuning (freshness guardian).** `OVERDUE_HOURS` in `scripts/freshness_monitor.py` is keyed by the `source_key` returned by `get_data_sources_freshness()`; every key must have an entry or be in `EXCLUDED_KEYS` (a coverage check warns on any gap each run). Buckets, sized to the source's true upstream lag (generous so a legitimately-slow source never false-positives):

| Bucket | Threshold | Bases |
|---|---|---|
| Monthly fuel/trade (publish M+1) | 75d | `vendas`, `anp_glp`, `anp_daie`, `anp_desembaracos`, `mdic_comex`, `anp_precos_distribuicao`, `anp_cdp_producao` |
| Weekly | 21d | `anp_precos_produtores`, `anp_lpc`, `d_g_margins` |
| Daily — subsidy | 5d | `anp_subsidy_diesel_reference`, `anp_subsidy_commercialization` |
| Daily — `anp_cdp_diaria*` | 9d | tracks `MAX(data)` with ANP's structural D-6 production-date lag (D-8 worst case over weekends) |
| Vessels 6h/4h | 36h | `navios_diesel`, `vessel_positions` |
| Event-driven vessels (sparse) | 10d | `port_arrivals`, `import_candidates` (a row appears only on a real-world event — a long gap is normal quiet, not a stall) |
| News (~5 min) | 6h | `news_articles` |
| Annual | 550d | `anp_voip` (annual + ~6mo baseline lag + Apr–Jun window) |
| Admin ad-hoc | 120d | `anp_subsidy_caps` |
| **Excluded** | — | `price_bands` (no defined cadence → never flagged) |

**Together:** `freshness_monitor` (stall) + `workflow_failure_monitor` (failure) + `cdp_roster_canary` (upstream completeness) = full ops coverage of the data fleet. All fail-open (a missing env exits non-zero with a clear message and no stack trace; a runtime/SMTP error surfaces as a red run; an overdue/failing/gap condition is a *data* condition and does NOT fail the job itself).

### Legacy `alertas/` monitor retirement (2026-06)

The legacy local-only Gmail monitor (`alertas/`, driven by `.github/workflows/alertas_monitor.yml`) is **retired**. The workflow is **DISABLED** via `gh workflow disable` (reversible — the YAML stays on disk). It was made redundant by the work above:

- Its CDP-replay/session machinery (`alertas/bases/.../_replay.py`, Selenium session re-dispatch) was already unnecessary — `etl_anp_cdp.yml` self-loads via the Power BI public API (no CAPTCHA, no session expiry).
- Its 48h stale-canary is subsumed by the freshness guardian (per-source cadence-tuned thresholds, not a flat 48h).
- Its `etl_workflow_stuck` pager was re-homed into `workflow_failure_monitor.yml` (above), against the live `IBBAOG/SectorData` repo with the current SMTP sender.

**Recipient migration.** The 3 internal recipients (`monique.greco`, `eric.mello`, `eduardo.mendes` @itaubba.com) were migrated to the new Client Alerts product — each subscribed to the 7 ANP bases they previously got from the legacy monitor. The legacy delivery path is now gone entirely: the `alert_recipients` table was DROPPED in prod on 2026-06-09 (migration `20260616000000_drop_alert_recipients_legacy.sql`), along with the `/admin-panel` "Alert Emails" section. Ops digests (freshness/failure) still go to `ALERTAS_DEST_EMAIL` (default `eduardo.mendes@itaubba.com`).

### Scripts de backfill histórico (one-shot, rodar localmente)

Scripts criados em 2026-05-06 para preencher gaps históricos entre `DADOS/` e Supabase.
São idempotentes (ON CONFLICT DO UPDATE) — seguros de re-rodar.

```
scripts/pipelines/
  mdic_comex_backfill.py              DADOS/mdic_comex/comex_consolidado.parquet → mdic_comex
                                      Flags: --parquet PATH, --desde ANO, --ate ANO
  mdic_comex_drift_check.py           Detects retroactive ComexStat revisions vs mdic_comex,
                                      self-heals only drifted months (reuses sync.sync_months).
                                      Flags: --meses (24), --tolerancia (0.5), --heal-cap (12), --dry-run
  anp/
    precos/precos_produtores_backfill.py  DADOS/anp_precos_produtores/...parquet → anp_precos_produtores
                                          Flags: --parquet PATH, --desde YYYY-MM-DD, --ate YYYY-MM-DD
    lpc_backfill.py                   DADOS/anp_lpc_ultimas/lpc_consolidado.parquet → anp_lpc
                                      Flags: --parquet PATH, --from-date, --to-date, --full
```

**Resultado do backfill em 2026-05-06:**

| Tabela | Rows antes | Rows depois | Periodo ganho |
|---|---|---|---|
| `anp_lpc` | 29.736 | 160.243 | +2004-05 a 2022-09 (1.095 semanas) |
| `anp_precos_produtores` | 38.392 | 54.738 | +produtos adicionais (asfaltenos, QAV, etc.) 2002–2026 |
| `mdic_comex` | 1.238 | 10.029 | +1997-01 a 2023-12 |

### Redundância alertas/ vs ETL pipelines (tech debt rastreado)

Os scripts em `alertas/bases/<base>.py` fazem download das mesmas fontes ANP/MDIC
que os pipelines em `scripts/pipelines/`. Há duplicação de lógica de download, mas os
objetivos são distintos:
- **ETL pipelines**: populam Supabase (incrementais, via GHA).
- **alertas/**: consolidam parquet local em `DADOS/` para detecção de alertas (leitura local).

**Status**: redundância documentada, refactor não planejado. Unificação futura implicaria
fazer alertas/ consumir diretamente do Supabase em vez dos parquets — avaliação de escopo
necessária antes de iniciar.

### Subsidy commercialization HTML scrape (2026-05-27)

`scripts/pipelines/anp/subsidy_diesel_sync.py` ganhou um stage HTML novo que roda **antes** do flow PDF de referência. Stage popula `anp_subsidy_commercialization` (tabela criada pela Subsidy Reform — ver `docs/supabase/PRD.md` § "Subsidy Reform").

| Item | Valor |
|---|---|
| Função interna | `_scrape_commercialization(year: int, sb, *, dry_run: bool=False) -> int` |
| URL alvo (template) | `https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia/subvencao-a-comercializacao-de-oleo-diesel-rodoviario-<year>` |
| Parser | BeautifulSoup + lxml. Walk em document order pra agrupar tabelas em "período de apuração"; cada período produz até 2 tabelas (importador, produtor) × 5 regiões = até 10 rows. |
| Categorias do PDF | 3 (importador / produtor com petróleo nacional próprio / produtor com petróleo importado). **Só armazenamos 2**: `importador` + `produtor` (mapeado da categoria "nacional próprio"). A 3ª categoria — "petróleo importado" — é descartada por decisão de produto. |
| Upsert | `ON CONFLICT (data_inicio, regiao, tipo_agente) DO UPDATE`. Filtros sanitários: `_PRICE_MIN=2.0`, `_PRICE_MAX=12.0` BRL/L. |
| Encoding | Header `Accept-Encoding: gzip, deflate` (**não** advertise `br` — Pegadinha #12). Header `User-Agent` Chrome desktop pra evitar tarpit. |
| Defesa silent-empty | Se a página retornar `< 2000` chars OU 0 períodos detectados após parse, **`raise RuntimeError`** (CLAUDE.md Pegadinha #12). Empty = real bug, não silent skip. |
| 404 handling | Soft-skip com log + `return 0`. Permite backfill em anos futuros que ainda não têm página publicada. |

**CLI flags novas:**

| Flag | Default | Efeito |
|---|---|---|
| `--mode {incremental,backfill}` | `incremental` (alias do flow legado) | `backfill` itera 2025 + ano corrente; `incremental` só ano corrente. |
| `--skip-commercialization` | `False` | Pula o stage HTML novo. PDF flow normal. |
| `--commercialization-only` | `False` | Roda só o stage HTML, pula o PDF. Mutuamente exclusivo com `--skip-commercialization`. |

**Wiring:** stage HTML roda **antes** do flow PDF (`anp_subsidy_diesel_reference`) pra garantir que quando os triggers AFTER em `reference` dispararem `recompute_pb_on_reference_change`, a `commercialization` já esteja populada e a fórmula compute_subsidy_reimbursement retorne valor real (não NULL).

**Schedule:** mantém o cron diário `30 11 * * *` UTC do workflow `etl_anp_subsidy_diesel.yml`. Sem aumento de carga — adiciona ~1 GET HTML por execução, ~50 rows/run em regime normal.

**Tolerância:** 50 rows extraídos na 1ª execução real é aceitável (~5 períodos × 10 rows). 0 rows é exception.

### Imports & Exports reform — 2026-05-25

Three dashboards (`/anp-daie`, `/anp-desembaracos`, `/anp-painel-importacoes`) were consolidated into a single `/imports-exports`. ETL changes owned by this department:

- **`02_desembaracos_sync.py`** — line 171 used to drop `Importador`, `CNPJ`, and `UF do CNPJ*` from the raw XLSX before aggregating. These are now preserved:
  - `_COLS_RENAME` maps `"UF DO CNPJ*"` → `uf_cnpj` (was `uf`).
  - `_ler_arquivo` strips whitespace, replaces `'nan'`/`'None'`/`''` with `None`, and normalises CNPJ to digits-only.
  - `_aggregate` groups by `(ano, mes, ncm_codigo, ncm_nome, pais_origem, importador, cnpj, uf_cnpj)`.
  - Missing CNPJ in pre-2020 XLSXs is coalesced to the sentinel `__legacy__` so the composite PK resolves uniquely.
  - `on_conflict` is now `ano,mes,ncm_codigo,pais_origem,cnpj` (matches the new Supabase PK extended by Worktree A).
- **`03_painel_imp_sync.py`** — deleted. The `anp_painel_imp_dist` table is dropped by Worktree A.
- **`etl_anp_fase3.yml`** — Painel Imp step removed. Workflow is now 2 steps (DAIE + Desembaraços).

Backfill (rerunning the modified ETL over historical XLSXs) is triggered by `workflow_dispatch` on `etl_anp_fase3.yml` after the reform merges to `main`.

### Fixes aplicados na Fase 3 (já em main)

| Script | Problema | Fix |
|---|---|---|
| `pipelines/anp/precos/02_precos_produtores_sync.py` | `ON CONFLICT cannot affect row a second time` — séries ANP 2002–2012 e 2013+ se sobrepunham ao concatenar | Dedupe por chave PK `(data_inicio, produto, regiao)` antes do upsert |
| `pipelines/anp/lpc_sync.py` | `TypeError: ExternalReference.__init__() missing 1 required positional argument: 'id'` — bug do openpyxl 3.1.x com XLSXs legados da ANP LPC | Substituiu `engine="openpyxl"` por `engine="calamine"` |
| `requirements.txt` | Dependência ausente para o fix acima | Adicionada `python-calamine>=0.2.0` |

> **Doc de arquitetura News Hunter:** [`news-hunter-architecture.md`](news-hunter-architecture.md) (movido da raiz em 2026-05-05).

### Dados consolidados

```
DADOS/
  anp_cdp_producao_poco/           cdp_consolidado.parquet + historico.csv + session.json
  anp_dados_abertos_ie/
  anp_desembaracos/
  anp_glp/
  anp_lpc_ultimas/
  anp_painel_combustiveis/
  anp_precos_produtores/
  anp_sintese_semanal/
  mdic_comex/
  historico_alertas.csv            (compartilhado com Alertas — append-only)
```

`output/` armazena extrações brutas (intermediárias):

```
output/
  anp/                              CSVs mensais ANP por fase
  navios_diesel.csv                 Output do pipelines/navios/01_lineup_scrape.py
  lineup_2026-04.xlsx               Export ad-hoc
```

### Repo separado

`IBBAOG/news-hunter-scanner` — News Hunter scanner. Roda via cron-job.org cada ~5min. Usa `SUPABASE_SERVICE_KEY` (bypass RLS). Keywords sourced da UNION da lista default (`get_default_news_keywords_with_flags`) com `news_hunter_keywords` (per-user, todos os usuários). Matching contra título + RSS-summary com lede-rescue (PR #4, 2026-06-09) para near-misses de RSS. Frontend (APP) faz polling em `news_articles` cada 60s incremental por `found_at`. Detalhes: [`news-hunter-architecture.md`](news-hunter-architecture.md).

## Princípios

1. **`DADOS/` é fonte da verdade dos consolidados.** Nunca delete parquet — corrija **in-place**. (Memória do CEO: já houve incidente com perder fontes intermediárias por delete-and-recreate.)
2. **`output/` é descartável** mas evite limpar arbitrariamente — alguns scripts esperam idempotência.
3. **Pipelines usam `SUPABASE_SERVICE_KEY`** (bypassam RLS). Frontend usa anon. Nunca confunda.
4. **Workflow novo** precisa: schedule cron, secrets registrados, e linha na tabela acima.
5. **Idempotência sempre** — re-rodar 2x não duplica linhas. Use `ON CONFLICT (chave) DO UPDATE`.
6. **Deduplique antes do upsert** quando ler parquet/CSV. (Memória do CEO sobre erro `ON CONFLICT DO UPDATE` com linhas duplicadas.)
7. **News Hunter está em repo separado** — coordenação por contrato (`news_articles` schema).

## Tarefas comuns

### Incidente Apr/2026 — triplicação cross-local (Phase B1)

Em 2026-05-21 detectou-se a 3ª ocorrência do mesmo bug em `anp_cdp_producao`: produção
Apr/2026 inflada para 12.853 kbpd (vs ~4.337 kbpd correto). Causa raiz: o ANP CDP
APEX portal por vezes retorna o MESMO CSV para cliques contra filtros M/S/T diferentes
(observado quando a sessão APEX expira silenciosamente — vide `feedback_apex_silent_expiry`).
O script `02_upload.py` confiava no nome do arquivo (`_M`, `_S`, `_T`) para atribuir
`local` ∈ {PosSal, PreSal, Terra}, resultando em 3 cópias do mesmo poço com locais
diferentes — triplicando os KPIs em qualquer agregação por `SUM(petroleo_bbl_dia)`.

A função pré-existente `_deduplicate_m_vs_s` só removia overlap M↔S quando ambos os
frames chegavam no MESMO run; runs incrementais a cada ~2h (cron-job.org) carregavam
M/S/T em runs separados, contornando o dedup.

**Defesas adicionadas em `02_upload.py` (Phase B1):**

1. `_validate_ambiente_consistency(frames_by_period)` — RAISE pré-upload se T overlap
   com M/S > 5% (T deveria ser disjoint), ou se M ≈ S em ambas direções (ANP devolveu CSV idêntico).
2. `_check_cross_local_duplicates(sb, ano, mes)` — RAISE pós-upload se algum
   `(poco, campo, bacia)` tiver rows em >1 local no período recém-tocado.
3. `_warn_spike_upward(sb, ano, mes)` — RAISE pós-upload se soma mensal > 1.8x a média
   trimestral móvel (irmão simétrico de `_warn_partial_offshore`).

**Quarentena (Phase A — DML):** 2.076 rows movidas para `_quarantine_anp_cdp_apr2026`
para post-mortem. Não deletadas; ficam disponíveis para reconstrução caso necessário.

**Acompanhar:** se o pipeline falhar com qualquer das mensagens
`CROSS-LOCAL DUPLICATE DETECTED`, `SPIKE UPWARD ANOMALY`, `AMBIENTE OVERLAP ANOMALY`,
ou `safety cap exceeded`, **não force re-run** sem investigar — provavelmente é
nova variante do mesmo bug.

**Hardening Phase B2 (2026-05-21):**

- `_check_cross_local_duplicates` agora RAISE em vez de `break` ao bater a safety
  cap de 50k rows: silent truncation poderia mascarar a própria quadruplicação
  que a função detecta (GROUP BY rodando sobre sample parcial).
- `etl_anp_cdp.yml` ganhou bloco `concurrency: { group: anp-cdp,
  cancel-in-progress: false }` para evitar runs simultâneos. Cron-job.org dispara
  a cada ~2h; um run Selenium lento (CAPTCHA retry) pode sobrepor o próximo
  dispatch e causar `unique_violation` no commit, deixando o mês parcial.

**Hardening Phase B3 (2026-05-25) — `02_upload._upsert` self-heal:**

Entre 2026-05-23 e 2026-05-25, 57 de 60 runs de `etl_anp_cdp.yml` falharam.
Causa imediata: o trigger DB `trg_anp_cdp_guard_cross_local` (migration
`20260521130000_anp_cdp_cross_local_guard.sql`) corretamente bloqueava cada
INSERT cross-local — mas, como o batch upsert do PostgREST é atômico, **uma
única row republicada (PosSal ↔ PreSal) abortava o batch inteiro de ~200 rows
e a pipeline saía com erro**, deixando o mês parcial e re-quebrando a cada
~2h. ANP republica wells normalmente quando reclassifica o ambiente do campo,
então o trigger estava certo — o `_upsert` é que precisava tratar essa exceção
como esperada.

Fix em `_upsert`:

1. `_parse_cross_local_conflict(e)` extrai `(ano, mes, poco, campo, bacia, local_antigo, local_novo)` da
   mensagem do trigger (regex sobre `e.message` do `postgrest.APIError`, com fallback para `str(e)`).
2. `_delete_stale_local(sb, conflict)` faz DELETE explícito da row antiga (não DELETE+INSERT no mesmo
   batch — o trigger ainda atuaria).
3. O batch é re-tentado. O trigger só reporta o primeiro conflito por INSERT,
   então conflitos múltiplos no mesmo batch são resolvidos um a um (loop até
   `_MAX_CROSS_LOCAL_HEALS_PER_BATCH = 10`).
4. **Não consome attempts de retry transitório**: heals contam separadamente;
   o backoff exponencial pra timeout/network continua 3-strike.
5. Cada heal emite log INFO: `[self-heal] Resolved cross-local republish: ano=X
   mes=Y poco=Z campo=W bacia=B (was: local=L1 -> now: local=L2). Deleted N old row(s). Retrying batch.`

A intenção é: o trigger é a fonte de verdade do invariante (1 well = 1 local
por período); quando ANP republica legitimamente, o pipeline absorve a mudança
e continua. Quando o conflito é sintoma de um bug real (cross-local triplication
real), o `_check_cross_local_duplicates` pós-upload + `_warn_spike_upward`
continuam raise-on-failure.

Cleanup de backlog após o fix: `worker_supabase` aplicou migration paralela
(`supabase/migrations/20260525000020_*.sql`) limpando rows órfãs acumuladas
durante o outage.

### Debug de falha ANP CDP

O workflow `etl_anp_cdp.yml` usa `01_extract_powerbi.py` (Power BI public API, sem CAPTCHA, sem Selenium).
Se o run falhar:

1. **Verificar artifact** `anp-producao-poco` — contém os CSVs gerados (ou ausência deles indica falha na extração).
2. **Verificar logs** do step "Extract via Power BI" — erros comuns:
   - `HTTPError 4xx/5xx` → API Power BI temporariamente indisponível (re-dispatch manual geralmente resolve).
   - `AVISO: TRUNCADO` → chunk mensal excedeu window=100_000 linhas (pouco plausível para 1 mês, mas aumentar `--window` se ocorrer).
   - `0 rows returned` → `RESOURCE_KEY` ou `MODEL_ID` mudou (ANP atualizou o relatório Power BI — veja `scripts/extractors/anp_cdp_powerbi.py`).
3. **Dispatch manual** com `periodo` explícito se o problema foi transitório.
4. Se o Power BI mudou estrutura (novos campos no modelo semântico), atualizar constantes em `scripts/extractors/anp_cdp_powerbi.py` (`RESOURCE_KEY`, `MODEL_ID`, `DATASET_ID`, `REPORT_ID`).

**Nota (histórico)**: o script legado `01_extract.py` (Selenium + ddddocr CAPTCHA) foi mantido no repositório mas não é chamado pelo workflow. Revelou-se que o APEX CDP tinha um limite implícito de ~197 linhas no export CSV, enquanto o Power BI retorna ~937 wells offshore para 04/2026. O Power BI é a fonte correta.

### Adicionar pipeline novo

1. Criar script em `scripts/pipelines/<domain>/<scope>_<action>.py` (segue R3/R9 de nomenclatura). Se for chain, criar subpasta + prefixo numérico `01_, 02_, ...`.
2. Coordenar com APP a criação da tabela-alvo + RPC de leitura (se o dashboard for consumir).
3. Criar workflow `.github/workflows/<fonte>_sync.yml` com schedule cron.
4. Registrar secrets necessários (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, eventuais API keys da fonte).
5. Atualizar este PRD (linha nova na tabela de pipelines).
6. Atualizar `master.md` se cria contrato cross-dept (geralmente sim — a tabela alvo é cross-dept).
7. Se vai virar base de Alertas, avisar o dept Alertas.

### Adicionar coluna no parquet consolidado

1. Atualizar script que produz o parquet (lê fonte → escreve `DADOS/<fonte>/<nome>.parquet`).
2. Atualizar script de upload para mapear nova coluna.
3. Coordenar com APP: migration adiciona coluna na tabela; RPC pode precisar atualizar.
4. Rodar in-place sobre parquet existente. **Não deletar e refazer.**
5. Dry run primeiro se possível.
6. Documentador atualiza este PRD + `docs/app/PRD.md`.

### Debug de scraper quebrado

Ordem de diagnóstico:

1. Logs do GitHub Action (run mais recente).
2. Mudou HTML/API da fonte? (ANP, MDIC mudam UI sem aviso.)
3. CAPTCHA falhando? (`ddddocr` falha às vezes — re-rodar costuma resolver; se persistir, investigar.)
4. Selenium driver desatualizado vs Chromium da Action.
5. Quota/rate limit (especialmente VesselFinder/MarineTraffic).
6. RLS bloqueando upsert? Confirme que o workflow usa `SUPABASE_SERVICE_KEY`, não anon.

## Security audit cadence

Workflow `security_audit.yml` runs every Monday at 06:00 UTC (`cron: "0 6 * * 1"`) and on `workflow_dispatch`.

- **npm audit**: runs `npm audit --audit-level=high`. Opens a GitHub issue (labels: `security`, `automated`) if any `high` or `critical` finding is found.
- **pip-audit**: runs against `requirements.txt` and `alertas/requirements.txt`. Opens a GitHub issue if either audit exits non-zero (i.e., any known CVE detected).

Baseline audit (2026-05-14): both pip audits exit 0 with 0 vulnerabilities. No npm high/critical findings post F1.1.

Maintenance: review open `security` issues monthly. When a CVE is found, bump the affected package in `requirements.txt` (or `alertas/requirements.txt`) and re-run pip-audit locally to confirm clean before pushing.

## Anti-padrões

- Deletar parquet inteiro pra "começar do zero". **Sempre in-place.**
- Re-introduzir duplicatas removendo o dedupe no upsert.
- Usar anon key no scraper (vai falhar silenciosamente por RLS).
- Schedule muito agressivo em fonte com rate limit.
- Esquecer secrets ao criar workflow novo.
- Comitar credenciais (`session.json`, `credentials.json`).
- Misturar utilitários (`deploy_migration.mjs`) com scrapers no mesmo workflow.

## Contratos com outros departamentos

- **APP** é dono das tabelas-alvo. Você popula. Mudança de schema é geralmente **iniciada por você** (precisa de coluna nova) e **executada pelo APP** (cria migration).
- **Dados Locais** é separado por design. Não toque em `data/*.xlsx` nem em `scripts/manual/*` (estes são deles).
- **Alertas** lê do Supabase ou de `DADOS/historico_alertas.csv`. Mudanças de schema/coluna que Alertas usa precisam aviso via Gerente.
- **`supabase_deploy.yml`** é do dept `worker_supabase`, não deste dept (deploya migrations, não dados).
- **`_replay.py`**: módulo standalone (`scripts/pipelines/anp/cdp/_replay.py`) usado por `alertas/bases/anp_cdp_producao_poco.py` para leitura do DB local. Não é chamado pelo workflow ETL — o workflow usa `01_extract.py --capture` diretamente com Selenium.
