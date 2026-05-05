# PRD — Departamento ETL / Pipelines

Pipelines automáticas que coletam dados de fontes externas (ANP, SINDICOM, MDIC, navios, AIS, news) e populam o Supabase. Rodam via GitHub Actions em schedule, ou em repos separados.

## Escopo

### Scripts Python (raiz e `scripts/`)

```
# Raiz (legado/mover para scripts/ quando seguro)
ais_discovery.py                   AIS global scan → score 0-100 → import_candidates
ais_sync.py                        AISStream WebSocket → vessel_registry, vessel_positions, port_arrivals
anp_watcher.py                     ANP geral (vintage)
cabotage_cleanup.py                Limpeza de cabotagem em navios_diesel
navios_esperados.py                Scrape portos → CSV → import_navios_diesel.mjs → navios_diesel
vessel_lookup.py                   VesselFinder + MarineTraffic → resolver IMO/MMSI em navios_diesel
vessel_position_sync.py            VF port-call API → vessel_positions, port_arrivals

# scripts/
scripts/anp_auto.py                Selenium + ddddocr CAPTCHA → output/anp/
scripts/anp_cdp_upload.py          Upload CDP poços → Supabase
scripts/anp_daie_sync.py           Dados Abertos IE
scripts/anp_desembaracos_sync.py   Desembaraços
scripts/anp_glp_sync.py            GLP
scripts/anp_lpc_sync.py            Levantamento Preços ao Consumidor
scripts/anp_painel_imp_sync.py     Painel Combustíveis
scripts/anp_ppi_sync.py            PPI
scripts/anp_precos_produtores_sync.py  Preços Produtores
scripts/import_navios_diesel.mjs   CSV → navios_diesel
scripts/mdic_comex_sync.py         MDIC Comex
scripts/sindicom_sync.py           SINDICOM
scripts/export_lineup_apr2026.py   Export específico de lineup (ad-hoc)

# scripts/ — utilitários (não-ETL, mas convivem)
scripts/capture-previews.mjs
scripts/deploy_migration.mjs
scripts/deploy_profiles_visibility.mjs
```

### Workflows GitHub Actions

| Workflow | Schedule | Script(s) | Tabela alvo |
|---|---|---|---|
| `ais_discovery.yml` | Cada 4h | `ais_discovery.py` | `import_candidates` |
| `ais_sync.yml` | Cada 6h+15min | `ais_sync.py` | `vessel_registry`, `vessel_positions`, `port_arrivals` |
| `anp-watcher.yml` | [verificar uso] | `anp_watcher.py` | — |
| `anp_fase3_sync.yml` | [verificar uso] | — | — |
| `anp_lpc_sync.yml` | [verificar] | `scripts/anp_lpc_sync.py` | (ANP LPC) |
| `anp_precos_sync.yml` | [verificar] | `scripts/anp_precos_produtores_sync.py` | (ANP preços) |
| `extrair-anp.yml` | Mensal (5º) | `scripts/anp_auto.py` | `output/anp/` (extração bruta) |
| `mdic_comex.yml` | [verificar] | `scripts/mdic_comex_sync.py` | (MDIC) |
| `navios_esperados.yml` | Cada 6h | `navios_esperados.py` + `scripts/import_navios_diesel.mjs` | `navios_diesel` |
| `sindicom_sync.yml` | [verificar] | `scripts/sindicom_sync.py` | (SINDICOM) |
| `upload-dg-margins.yml` | Semanal | `upload_dg_margins.py` | `d_g_margins` (este é Dados Locais, não ETL) |
| `vessel_lookup.yml` | Após `navios_esperados` | `vessel_lookup.py` | `navios_diesel.imo/mmsi` |
| `vessel_position_sync.yml` | Após `vessel_lookup` | `vessel_position_sync.py` | `vessel_positions`, `port_arrivals` |

> **Pendência:** confirmar com o CEO se `anp-watcher.yml` e `anp_fase3_sync.yml` ainda estão em uso. Não estão listados no README.

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
  navios_diesel.csv                 Output do navios_esperados.py
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

1. Criar script em `scripts/<fonte>_sync.py`.
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
- **Dados Locais** é separado por design. Não toque em `data/*.xlsx` nem em `upload_dg_margins.py`/`upload_price_bands.py` (estes são deles).
- **Alertas** lê do Supabase ou de `DADOS/historico_alertas.csv`. Mudanças de schema/coluna que Alertas usa precisam aviso via Gerente.
- **`supabase-deploy.yml`** é do APP, não deste dept (deploya migrations, não dados).
