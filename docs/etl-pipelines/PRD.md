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
    cdp/                            chain (workflow anp_cdp_extract.yml)
      01_extract.py                 Selenium + ddddocr CAPTCHA → output/anp/
      02_upload.py                  CSVs → Supabase
    fase3/                          chain (workflow anp_fase3_sync.yml)
      01_daie_sync.py               Dados Abertos IE
      02_desembaracos_sync.py       Desembaraços
      03_painel_imp_sync.py         Painel Combustíveis
    precos/                         chain (workflow anp_precos_sync.yml — junto com glp_sync)
      01_ppi_sync.py                PPI
      02_precos_produtores_sync.py  Preços Produtores
    glp_sync.py                     GLP (rodado em anp_precos_sync.yml)
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
| `ais_candidates_discover.yml` | Cada 4h | `pipelines/ais/candidates_discover.py` | `import_candidates` |
| `ais_positions_sync.yml` | Cada 6h+15min | `pipelines/ais/positions_sync.py` | `vessel_registry`, `vessel_positions`, `port_arrivals` |
| `anp_vendas_watch.yml` | Trigger externo (cron-job.org via `workflow_dispatch`) | `pipelines/anp/vendas_watch.py --force` | (vendas combustíveis ANP) |
| `anp_fase3_sync.yml` | Mensal — 1º dia, 13:00 UTC | `pipelines/anp/fase3/01_daie_sync.py` → `02_desembaracos_sync.py` → `03_painel_imp_sync.py` | `anp_daie` (6.912 rows), `anp_desembaracos` (6.204), `anp_painel_imp_dist` (1.444) |
| `anp_lpc_sync.yml` | Semanal — quarta, 14:30 UTC (`30 14 * * 3`) | `pipelines/anp/lpc_sync.py` | `anp_lpc` (29.736 rows) |
| `anp_precos_sync.yml` | Semanal — segunda, 12:00 UTC (`0 12 * * 1`) | `pipelines/anp/glp_sync.py` + `precos/01_ppi_sync.py` → `02_precos_produtores_sync.py` | `anp_glp` (3.106), `anp_ppi` (18.131), `anp_precos_produtores` (38.392) |
| `anp_cdp_extract.yml` | Mensal (5º), 08:00 UTC (`0 8 5 * *`) | `pipelines/anp/cdp/01_extract.py` → `02_upload.py` | `output/anp/` + `anp_cdp_producao` (1.813.851 rows) |
| `mdic_comex_sync.yml` | Diário, 14:00 UTC (`0 14 * * *`) | `pipelines/mdic_comex_sync.py` | `mdic_comex` (1.238 rows) |
| `navios_lineup_scrape.yml` | Cada 6h | `pipelines/navios/01_lineup_scrape.py` → `02_diesel_import.mjs` | `navios_diesel` |
| `sindicom_sync.yml` | Mensal — dia 5, 15:00 UTC (`0 15 5 * *`) | `pipelines/sindicom_sync.py` | `sindicom` — BLOQUEADO por Cloudflare em IP residencial; só roda via GitHub Actions runner. Aguardando dispatch manual. |
| `dg_margins_upload.yml` | Semanal | `manual/dg_margins_upload.py` | `d_g_margins` (este é Dados Locais, não ETL) |
| `navios_imo_lookup.yml` | Após `navios_lineup_scrape` | `pipelines/navios/03_imo_lookup.py` → `04_cabotage_cleanup.py` | `navios_diesel.imo/mmsi` |
| `navios_positions_sync.yml` | Após `navios_imo_lookup` | `pipelines/navios/05_positions_sync.py` | `vessel_positions`, `port_arrivals` |

> Workflows confirmados ativos em 2026-05-05. Row counts refletem estado de produção em 2026-05-05. README está desatualizado (não os menciona). Quando atualizar README, incluir.

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
