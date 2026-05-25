# PRD — Departamento ETL / Pipelines

Pipelines automáticas que coletam dados de fontes externas (ANP, SINDICOM, MDIC, navios, AIS, news) e populam o Supabase. Rodam via GitHub Actions em schedule, ou em repos separados.

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
      02_upload.py                  CSVs → Supabase
    fase3/                          chain (workflow etl_anp_fase3.yml)
      01_daie_sync.py               Dados Abertos IE
      02_desembaracos_sync.py       Desembaraços (preserves importador/cnpj/uf_cnpj since 2026-05-25)
      # 03_painel_imp_sync.py — REMOVED by Imports & Exports reform (2026-05-25)
    precos/                         chain (workflow etl_anp_precos.yml — junto com glp_sync)
      01_ppi_sync.py                PPI
      02_precos_produtores_sync.py  Preços Produtores
    glp_sync.py                     GLP (rodado em etl_anp_precos.yml)
    lpc_sync.py                     Levantamento Preços ao Consumidor
    vendas_watch.py                 ANP vendas combustíveis (vintage anp-watcher)

  navios/                           chain de 5 stages (3 workflows traversam)
    01_lineup_scrape.py             Scrape portos → CSV (era navios_esperados.py)
    02_diesel_import.mjs            CSV → navios_diesel (era import_navios_diesel.mjs)
    03_imo_lookup.py                VF + MarineTraffic → resolver IMO/MMSI (era vessel_lookup.py)
    04_cabotage_cleanup.py          Limpeza de cabotagem em navios_diesel
    05_positions_sync.py            VF port-call → vessel_positions, port_arrivals

  mdic_comex_sync.py                MDIC Comex
  sindicom_sync.py                  SINDICOM (Playwright)
  anp/
    precos_distribuicao_sync.py     ANP PDC — Preços de Distribuição → anp_precos_distribuicao

scripts/extractors/                 # extratores reutilizáveis (não são scripts de pipeline direto)
  _powerbi_common.py                Helper compartilhado para requisições à API querydata do Power BI
  anp_cdp_powerbi.py                ANP CDP Power BI público → anp_cdp_diaria / _instalacao / _poco. CLI: --level campo|instalacao|poco|all. 3 levels extraídos por run (pages 4, 5, 6 do Power BI).

scripts/manual/                     # humano-no-loop (dept Dados Locais)
  dg_margins_upload.py              Excel data/d_g_margins.xlsx → d_g_margins
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
| `etl_anp_lpc.yml` | Semanal — quarta, 14:30 UTC (`30 14 * * 3`) | `pipelines/anp/lpc_sync.py` | `anp_lpc` (160.243 rows — histórico 2004–2026 após backfill) |
| `etl_anp_precos.yml` | Semanal — segunda, 12:00 UTC (`0 12 * * 1`) | `pipelines/anp/glp_sync.py` + `precos/01_ppi_sync.py` → `02_precos_produtores_sync.py` | `anp_glp` (3.106), `anp_ppi` (18.131), `anp_precos_produtores` (54.738 — histórico 2002–2026 após backfill) |
| `etl_anp_cdp.yml` | Cron interno mensal (5º), 08:00 UTC (`0 8 5 * *`) como fallback + trigger externo via cron-job.org (`workflow_dispatch`) a cada ~2h — pipeline desenhado para rodar incrementalmente com alta frequência | `pipelines/anp/cdp/01_extract_powerbi.py` (Power BI, no CAPTCHA) → `02_upload.py` | `output/anp/` + `anp_cdp_producao` (2.045.515+ rows). Power BI poco-level data aggregated daily→monthly; local derived from DB lookup + basin heuristic. Replaces Selenium/CAPTCHA (01_extract.py) which had an undocumented APEX row cap (~197 offshore wells vs ~937 in Power BI for 04/2026). **Inputs `workflow_dispatch`**: `force_upload=true` passes `--no-incremental` AND implies `--purge` automatically — never re-upload over an already-loaded period without it (prevents the PK-overlap duplicate-`local` bug, Apr/2026). |
| `etl_mdic_comex.yml` | Diário, 14:00 UTC (`0 14 * * *`) | `pipelines/mdic_comex_sync.py` | `mdic_comex` (10.029 rows — histórico 1997–2026 após backfill) |
| `etl_navios_lineup.yml` | Cada 6h | `pipelines/navios/01_lineup_scrape.py` → `02_diesel_import.mjs` | `navios_diesel` |
| `etl_sindicom.yml` | Mensal — dia 5, 15:00 UTC (`0 15 5 * *`) | `pipelines/sindicom_sync.py` | `sindicom` — BLOQUEADO por Cloudflare em IP residencial; só roda via GitHub Actions runner. Aguardando dispatch manual. |
| `manual_dg_margins.yml` | Semanal | `manual/dg_margins_upload.py` | `d_g_margins` (este é Dados Locais, não ETL) |
| `etl_navios_imo_lookup.yml` | Após `etl_navios_lineup` | `pipelines/navios/03_imo_lookup.py` → `04_cabotage_cleanup.py` | `navios_diesel.imo/mmsi` |
| `etl_navios_positions.yml` | Após `etl_navios_imo_lookup` | `pipelines/navios/05_positions_sync.py` | `vessel_positions`, `port_arrivals` |
| `etl_anp_precos_distribuicao.yml` | Mensal — dia 5, 14:00 UTC (`0 14 5 * *`) + Semanal — terça, 14:30 UTC (`30 14 * * 2`) | `pipelines/anp/precos_distribuicao_sync.py` | `anp_precos_distribuicao` |
| `etl_anp_cdp_diaria.yml` | 3×/dia — `0 10,15,20 * * *` UTC (7h/12h/17h BRT) | `scripts/extractors/anp_cdp_powerbi.py --level all --upload` (via `_powerbi_common.py`) | `anp_cdp_diaria` (~16.5k rows; upsert `(data, campo, bacia)`), `anp_cdp_diaria_instalacao` (~16.3k rows; upsert `(data, campo, instalacao)`), `anp_cdp_diaria_poco` (~180.7k rows; upsert `(data, campo, bacia, poco)`). Timeout workflow: 25min. **Semântica de upload — append-only** (desde commit `397a108c`, 2026-05-08): usa `ignore_duplicates=True` (PostgREST `Prefer: resolution=ignore-duplicates` → SQL `ON CONFLICT DO NOTHING`). (data, dim) inédito: INSERT. (data, dim) já existe: SKIP — valor original preservado. Aplica-se às 3 tabelas (campo / instalacao / poco) — todas passam pela mesma `upload_to_supabase()`. Base point: `--start` default = `2025-11-09` (primeira data com dados Power BI). Trade-off: revisões retroativas do Power BI ANP não são refletidas (snapshot histórico tem prioridade sobre fidelidade a revisões — decisão explícita do usuário). **Pegadinha 1 — property names**: property names Power BI são case-sensitive e diferem do display name — ex: nível Poço usa `Campo (Poço)` (property) e não `NOME CAMPO` (display name); retorna 0 linhas se property errada. **Pegadinha 2 — atribuição 1:1 vs N:N**: entity `v_poco_instalacao_sigep_ultimo` (páginas 5/6, níveis Installation e Well) faz atribuição "última" — cada poço linka a apenas 1 campo. Entity `v_campos_detalhe` (página 4, nível Field) faz N:N. Resultado: filtro Campo mostra 94 campos em Field mas apenas 76 em Installation/Well (19 campos Field-only com poços 100% compartilhados com outro campo "principal"). Não é bug do ETL. Documentado em [`docs/app/anp-cdp-diaria.md`](../app/anp-cdp-diaria.md). |

> Workflows confirmados ativos em 2026-05-05. Row counts atualizados após backfill histórico de 2026-05-06. README está desatualizado (não os menciona). Quando atualizar README, incluir.

### Scripts de backfill histórico (one-shot, rodar localmente)

Scripts criados em 2026-05-06 para preencher gaps históricos entre `DADOS/` e Supabase.
São idempotentes (ON CONFLICT DO UPDATE) — seguros de re-rodar.

```
scripts/pipelines/
  mdic_comex_backfill.py              DADOS/mdic_comex/comex_consolidado.parquet → mdic_comex
                                      Flags: --parquet PATH, --desde ANO, --ate ANO
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

Os scripts em `alertas/bases/<base>.py` fazem download das mesmas fontes ANP/SINDICOM/MDIC
que os pipelines em `scripts/pipelines/`. Há duplicação de lógica de download, mas os
objetivos são distintos:
- **ETL pipelines**: populam Supabase (incrementais, via GHA).
- **alertas/**: consolidam parquet local em `DADOS/` para detecção de alertas (leitura local).

**Status**: redundância documentada, refactor não planejado. Unificação futura implicaria
fazer alertas/ consumir diretamente do Supabase em vez dos parquets — avaliação de escopo
necessária antes de iniciar.

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
  anp_ppi/
  anp_precos_produtores/
  anp_sintese_semanal/
  mdic_comex/
  sindicom/
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

`IBBAOG/news-hunter-scanner` — News Hunter scanner. Roda via cron-job.org cada ~5min. Usa `SUPABASE_SERVICE_KEY` (bypass RLS). Keywords sourced da UNION de `news_hunter_keywords` (todos os usuários). Frontend (APP) faz polling em `news_articles` cada 60s incremental por `found_at`.

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
2. Mudou HTML/API da fonte? (ANP, SINDICOM, MDIC mudam UI sem aviso.)
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
