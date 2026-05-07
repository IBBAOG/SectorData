# Sub-PRD — `/navios-diesel`

Dashboard de Navios Diesel (importação por mar). Owner: [`worker_dash-navios-diesel`](../../.claude/agents/worker_dash-navios-diesel.md). Mais complexo do APP.

## Escopo de código

```
src/app/(dashboard)/navios-diesel/
  page.tsx
  (sub-páginas futuras pertencem a este mesmo agente)
```

RPC wrappers: seção "navios-diesel" em [`src/lib/rpc.ts`](../../src/lib/rpc.ts).

## Produto

Visualização do pipeline de **importação de diesel via navios**. Mostra:
- Navios esperados nos portos (status: Esperado, Atracado, Iniciada Descarga, Despachado, Descarregado)
- Resumo por porto (volumes, ETA, descarga)
- Tracking AIS (posições reais via vessel_positions)
- Identidade de navios (IMO, MMSI, bandeira)
- **Filtragem rigorosa de cabotagem** — `is_cabotagem` (coluna gerada) precisa estar `false` em toda RPC

## Princípio crítico — cabotagem

A coluna `navios_diesel.is_cabotagem` é **generated** por:
- `flag IN ('Brazil', 'BR')` OR
- padrão regex em `origem` (porto brasileiro)

**Toda RPC deve filtrar `WHERE NOT is_cabotagem`.** Cabotagem é tráfego interno; não conta como import. Esquecer este filtro = dados errados no dashboard.

## RPCs

| RPC | Função |
|---|---|
| `get_nd_ultima_coleta` | Timestamp da última coleta (para mostrar ao user) |
| `get_nd_coletas_distintas` | Lista de timestamps distintos de coleta (para filtro de "snapshot") |
| `get_nd_navios` | Lista de navios filtrados (porto, produto, status, período) |
| `get_nd_resumo_portos` | Agregado por porto (totais, contagens) |

## Tabelas

| Tabela | Populada por | Notas |
|---|---|---|
| `navios_diesel` | ETL (`pipelines/navios/01_lineup_scrape.py` → `pipelines/navios/02_diesel_import.mjs`) cada 6h | Cresce ~100/semana |
| `vessel_registry` | ETL (`pipelines/ais/positions_sync.py`) | Catálogo de navios via AIS |
| `vessel_positions` | ETL (`pipelines/navios/05_positions_sync.py`, `pipelines/ais/positions_sync.py`) | Posições históricas |
| `port_arrivals` | ETL (`pipelines/ais/positions_sync.py`, `pipelines/navios/05_positions_sync.py`) | Chegadas confirmadas |
| `import_candidates` | ETL (`pipelines/ais/candidates_discover.py`) | Radar de candidatos a import (score 0-100) |

Migrations relevantes:
- `20260328200000_navios_diesel.sql`
- `20260331000000_navios_diesel_brt.sql`
- `20260415000000_navios_diesel_volume_mensal.sql` (+ v2, v3, v4)
- `20260415000004_navios_descarregados.sql`
- `20260416000001_nd_resumo_mensal_portos.sql`
- `20260422000000_ais_tracking.sql`
- `20260423000001_cabotage_filter.sql`
- `20260424000000_import_candidates.sql`

## Dependências cross-dept

Este dashboard tem a **maior dependência de ETL** dentro do APP:

| Workflow | Schedule | O que produz |
|---|---|---|
| `etl_navios_lineup.yml` | cada 6h | Lineup dos portos → `navios_diesel` |
| `etl_navios_imo_lookup.yml` | após `etl_navios_lineup` | Resolve IMO/MMSI das linhas novas |
| `etl_navios_positions.yml` | após `etl_navios_imo_lookup` | Atualiza posições + chegadas |
| `etl_ais_positions.yml` | cada 6h+15min | AIS tempo real |
| `etl_ais_candidates.yml` | cada 4h | Descoberta de candidatos (radar) |

Mudanças no schema vêm geralmente de **necessidade do dashboard** (você pede ao Subgerente que pede ao ETL — ou vice-versa para colunas novas do scraper).

## Status do navio (decoreba)

Valores de `navios_diesel.status`:

| Status | Significado |
|---|---|
| `Esperado` | Anunciado pelo porto, ainda não chegou |
| `Atracado` | Atracado, antes de iniciar descarga |
| `Iniciada Descarga` | Descarregando |
| `Despachado` | Saiu do porto (após descarregar) |
| `Descarregado` | Sinônimo legado de Despachado em alguns contextos — verificar |

## Filtros tipicamente usados (UI)

- Porto (multi-select).
- Produto (Diesel, derivados).
- Status (multi-select).
- Período de ETA / coleta.
- Bandeira.
- Origem (porto de origem).

## Performance

- `navios_diesel` cresce; use índices nas colunas filtradas (verificar migrations para confirmar).
- Tabelas grandes (lista de todos os navios do mês) — considere virtualização.
- Para resumo por porto, use `get_nd_resumo_portos` (agregado server-side) em vez de calcular client-side.

## Anti-padrões

- RPC sem `NOT is_cabotagem`.
- Confiar em MMSI quando IMO está disponível (IMO é mais estável).
- Mexer em `vessel_*` ou `port_arrivals` direto — esses são populados pelo ETL.
- Tentar chamar `ais_candidates_discover` ou `navios_imo_lookup` do frontend — são pipelines do ETL.
- Visualizar lista grande sem paginação/virtualização.

## Export

Tier 1 — download direto via `<ExportPanel>` (ver [`docs/app/PRD.md`](PRD.md) → "Export padronizado").

- Excel: `downloadGenericExcel<T>` em [`src/lib/exportExcel.ts`](../../src/lib/exportExcel.ts) — workbook single-sheet com título brand orange, header preto, dados Arial 10.
- CSV: `downloadCsv<T>` em [`src/lib/exportCsv.ts`](../../src/lib/exportCsv.ts) (RFC4180, UTF-8).
- Filename pattern: `NaviosDiesel_DD-MM-YY.<xlsx|csv>`.
- Dados exportados: linhas correspondentes ao estado `naviosDisplay` da página (saída de `get_nd_navios` já filtrada por porto/produto/status/período + `WHERE NOT is_cabotagem`).
