# Sub-PRD — `/navios-diesel`

Dashboard de Navios Diesel (importação por mar). Owner: [`dash-navios-diesel`](../../.claude/agents/dash-navios-diesel.md). Mais complexo do APP.

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
| `navios_diesel` | ETL (`navios_esperados.py` → `import_navios_diesel.mjs`) cada 6h | Cresce ~100/semana |
| `vessel_registry` | ETL (`ais_sync.py`) | Catálogo de navios via AIS |
| `vessel_positions` | ETL (`vessel_position_sync.py`, `ais_sync.py`) | Posições históricas |
| `port_arrivals` | ETL (`ais_sync.py`, `vessel_position_sync.py`) | Chegadas confirmadas |
| `import_candidates` | ETL (`ais_discovery.py`) | Radar de candidatos a import (score 0-100) |

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
| `navios_esperados.yml` | cada 6h | Lineup dos portos → `navios_diesel` |
| `vessel_lookup.yml` | após `navios_esperados` | Resolve IMO/MMSI das linhas novas |
| `vessel_position_sync.yml` | após `vessel_lookup` | Atualiza posições + chegadas |
| `ais_sync.yml` | cada 6h+15min | AIS tempo real |
| `ais_discovery.yml` | cada 4h | Descoberta de candidatos (radar) |

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
- Tentar chamar `ais_discovery` ou `vessel_lookup` do frontend — são pipelines do ETL.
- Visualizar lista grande sem paginação/virtualização.
