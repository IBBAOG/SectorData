# PRD — Departamento Alertas

Subsistema local de monitoramento. Auto-contido em `alertas/` (gitignored). Detecta atualizações em fontes públicas e envia notificações via Gmail API.

> **Documentação detalhada:** [`alertas/PRD_ALERTAS.md`](../../alertas/PRD_ALERTAS.md) (local-only, não versionado). Este arquivo é apenas o ponteiro cross-dept.

## Escopo

```
alertas/                            # local-only (gitignored)
  monitor.py                        Runner principal
  notificador.py                    Envio de e-mail via Gmail API
  bases/                            Uma classe por fonte de dados
  scripts/                          Consolidadores + visualizadores por base
  estado/                           JSON de estado por base (último período visto)
```

`DADOS/<slug>/historico.csv` e `DADOS/historico_alertas.csv` são compartilhados com ETL (append-only pelo dept Alertas).

## Bases monitoradas

| # | Slug | Fonte | Detecção | Dados no Supabase? |
|---|------|-------|----------|-------------------|
| 1 | `anp_lpc_ultimas` | ANP LPC | MAX(data_referencia) | Sim (`anp_lpc`) |
| 2 | `anp_sintese_semanal` | ANP Síntese Semanal | MAX(data_referencia) | Não (parquet local) |
| 3 | `anp_ppi` | ANP PPI | MAX(data_fim) por produto | Sim (`anp_ppi`) |
| 4 | `anp_precos_produtores` | ANP Preços Produtores | MAX(data_inicio) por produto/região | Sim (`anp_precos_produtores`) |
| 5 | `anp_desembaracos` | ANP Desembaraços | MAX(ano, mes) | Sim (`anp_desembaracos`) |
| 6 | `anp_dados_abertos_ie` | ANP Dados Abertos IE | MAX(ano, mes) | Sim (`anp_daie`) |
| 7 | `anp_painel_combustiveis` | ANP Painel Combustíveis | MAX(data_referencia) por distribuidora | Sim (`anp_painel_imp_dist`) |
| 8 | `anp_glp` | ANP GLP | MAX(ano, mes) por distribuidora | Sim (`anp_glp`) |
| 9 | `anp_cdp_producao_poco` | ANP CDP Produção | MAX(data_producao) | Sim (`anp_cdp_producao`) |
| 10 | `mdic_comex` | MDIC Comex | MAX(ano, mes) por flow | Sim (`mdic_comex`) |
| 11 | `sindicom` | SINDICOM | MAX(ano, mes) | Sim (`sindicom`) — base heavy (Playwright) |
| 12 | `precos_distribuicao` | ANP PDC — Preços de Distribuição | MAX(data_referencia) por periodicidade | Sim (`anp_precos_distribuicao`) |

## Contratos com outros departamentos

- **ETL**: compartilha `DADOS/historico_alertas.csv` (append-only pelo dept Alertas).
- **Supabase**: lê tabelas via service key para detecção de novidade. Mudanças de schema nas tabelas monitoradas precisam aviso ao dept Alertas.
- **ETL (pipeline)**: quando uma base heavy não pode rodar no monitor, o workflow ETL correspondente é o owner de detecção e upload.
