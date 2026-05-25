# Sistema de Alertas — Documentação

Sistema local de monitoramento de bases de dados do setor de combustíveis e petróleo.
Detecta atualizações em fontes públicas, baixa os novos dados, consolida em Parquet e envia notificação por e-mail.

---

## Estrutura de pastas

```
alertas/
├── monitor.py                  # Runner principal
├── notificador.py              # Envio de e-mail via Gmail API
├── bases/                      # Uma classe por fonte de dados
│   ├── base.py                 # Classe abstrata BaseMonitor
│   ├── anp_lpc_ultimas.py
│   ├── anp_sintese_semanal.py
│   ├── anp_ppi.py
│   ├── anp_precos_produtores.py
│   ├── anp_desembaracos.py
│   ├── anp_dados_abertos_ie.py
│   ├── anp_painel_combustiveis.py
│   ├── anp_glp.py
│   ├── anp_cdp_producao_poco.py
│   ├── mdic_comex.py
│   ├── sindicom.py
│   └── etl_workflow_stuck.py
├── scripts/                    # Consolidadores por base
│   ├── anp_lpc_ultimas/consolidar.py + visualizar.py
│   ├── anp_ppi/consolidar.py + visualizar.py
│   ├── anp_precos_produtores/consolidar.py + visualizar.py
│   ├── anp_desembaracos/consolidar.py + visualizar.py
│   ├── anp_dados_abertos_ie/consolidar.py + visualizar.py
│   ├── anp_painel_combustiveis/consolidar.py + visualizar.py
│   ├── anp_glp/consolidar.py + visualizar.py
│   ├── anp_cdp_producao_poco/consolidar.py + visualizar.py
│   ├── mdic_comex/consolidar.py + visualizar.py
│   └── sindicom/consolidar.py + visualizar.py
├── estado/                     # JSON de estado por base (último período visto)
│   ├── anp_ppi.json
│   ├── mdic_comex.json
│   └── ...
└── credentials.json / token.json  # Gmail OAuth

DADOS/                          # Dados consolidados (fora de alertas/)
├── anp_lpc_ultimas/
├── anp_ppi/
├── ...
└── historico_alertas.csv       # Log global de todas as atualizações
```

Cada base também grava seu próprio `DADOS/<slug>/historico.csv`.

---

## Como executar

```bash
# Verificar todas as bases uma vez
python alertas/monitor.py

# Verificar uma base específica
python alertas/monitor.py --base anp_ppi

# Loop contínuo (verifica a cada 30 min)
python alertas/monitor.py --loop --intervalo 30
```

Slugs disponíveis: `anp_lpc_ultimas`, `anp_sintese_semanal`, `anp_ppi`, `anp_precos_produtores`, `anp_desembaracos`, `anp_dados_abertos_ie`, `anp_painel_combustiveis`, `anp_glp`, `anp_cdp_producao_poco`, `mdic_comex`, `sindicom`, `precos_distribuicao`, `etl_workflow_stuck`.

---

## Bases heavy (puladas no run default)

Algumas bases requerem dependências pesadas que são incompatíveis com o monitor rodando
a cada 2 horas no GitHub Actions. Essas bases são declaradas na constante `_HEAVY_BASES`
em `monitor.py` e são **puladas automaticamente** quando o monitor é chamado sem `--base`.

### Bases atualmente heavy

| Slug | Motivo | Quem detecta novidade |
|------|--------|-----------------------|
| `sindicom` | Requer Playwright + Chromium. O site usa proteção anti-bot e o link de download exige JavaScript e cookies de sessão — requests simples retorna 403. | `etl_sindicom.yml` (cron mensal dia 5, 15h UTC) faz o download + upload completo. |

> **Nota (2026-05):** `anp_cdp_producao_poco` foi **removida** de `_HEAVY_BASES`. Ela agora
> roda a cada 2h como as demais bases leves. Veja detalhes na seção da base abaixo.

### Por que não rodar no monitor a cada 2h

- SINDICOM exige Playwright + Chromium (anti-bot), impossível sem browser real no runner leve.
- O workflow `etl_sindicom.yml` já é o proprietário correto desse dado — tem Playwright instalado,
  roda na data certa e faz upload ao Supabase.

### Como rodar manualmente se necessário

```bash
# Rodar a base heavy diretamente (local, com Playwright instalado):
python alertas/monitor.py --base sindicom

# Ou via GitHub Actions (forçar workflow ETL dedicado):
gh workflow run etl_sindicom.yml --ref main

# ANP CDP agora é leve — roda normalmente no monitor default:
python alertas/monitor.py --base anp_cdp_producao_poco
# Para forçar nova captura Selenium (mensal):
gh workflow run etl_anp_cdp.yml --ref main
```

### Como adicionar uma nova base heavy

1. Adicione o slug ao conjunto `_HEAVY_BASES` em `alertas/monitor.py`.
2. Documente aqui: qual dep pesada exige, qual workflow ETL cobre.

---

## Arquitetura do sistema

### Fluxo de execução por base

```
monitor.py → m.run()
               ├── verificar()  → (tem_novidade, novo_estado, mensagem)
               │     └── se False → imprime "Sem novidade", para
               ├── baixar(novo_estado)  → [lista de arquivos locais]
               ├── salvar_estado(novo_estado)  → estado/<slug>.json
               ├── registrar_historico(...)  → DADOS/<slug>/historico.csv
               │                               DADOS/historico_alertas.csv
               └── notificador.enviar_alerta(...)  → e-mail Gmail
```

### Estado persistente

Cada base grava em `alertas/estado/<slug>.json` o identificador do último dado visto (período, data, hash, nome de arquivo...). Na próxima execução, `verificar()` compara com o estado anterior para decidir se há novidade. Isso garante idempotência: rodar duas vezes sem atualização da fonte não gera duplicatas nem alertas repetidos.

### Consolidadores (`scripts/<slug>/consolidar.py`)

A maioria das bases delega o download e a transformação dos dados a um script `consolidar.py` independente. Esse script é chamado via `subprocess.run()` com `capture_output=True`. A separação existe para que o consolidador possa ser executado manualmente (com flags como `--mes`, `--desde`, `--replay`) sem precisar passar pelo fluxo de alertas.

O consolidador é responsável por:
- Baixar o(s) arquivo(s) da fonte
- Limpar e normalizar o schema
- Fazer append/dedup no Parquet existente (nunca recriar do zero)
- Remover arquivos intermediários (xlsx, csv, zip) após consolidação

**Regra crítica**: nunca deletar um Parquet existente para recriar do zero. Sempre atualizar in-place. A razão é que alguns dados (especialmente Selenium 2024+) dependem de arquivos intermediários que podem não existir mais após cleanups.

### Visualizadores (`scripts/<slug>/visualizar.py`)

Cada base tem um app Dash que roda localmente na porta 8050 e permite explorar os dados consolidados via DuckDB + Plotly. Para iniciar:

```bash
python alertas/scripts/<slug>/visualizar.py
# Acesse http://localhost:8050
```

Para encerrar um visualizador no Windows (`pkill` não funciona):
```powershell
Get-NetTCPConnection -LocalPort 8050 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

---

## Bases — especificidades

### 1. ANP LPC — Últimas Semanas Pesquisadas (`anp_lpc_ultimas`)

- **Fonte**: `gov.br/anp` — levantamento de preços de combustíveis, últimas semanas pesquisadas
- **Detecção**: scraping de links com padrão `revendas_lpc_<data_ini>_<data_fim>.xlsx`. Compara `data_fim` com o estado salvo; detecta múltiplas semanas novas de uma vez.
- **Download**: baixa os XLSXs de todas as semanas novas (resumo semanal + revendas). Faz append direto no Parquet `lpc_consolidado.parquet` com dedup por `data_coleta` (não baixa datas já presentes).
- **Schema Parquet**: `cnpj, municipio, estado, bandeira, produto, unidade, preco_venda, data_coleta, regiao`
- **Particularidade**: os XLSXs têm 9 linhas de cabeçalho ANP antes dos dados (`skiprows=9`). A coluna `estado` vem por extenso (ex: "SAO PAULO") e é mapeada para UF de 2 letras. Semanas novas detectadas em lote numa única rodada.

---

### 2. ANP Síntese Semanal de Preços (`anp_sintese_semanal`)

- **Fonte**: `gov.br/anp` — página de síntese semanal, publica PDFs semanais
- **Detecção**: busca padrão `Edição Nº <num>/<ano>` no texto da página. Compara com `ultima_edicao` salvo. Fallback: data de atualização da página caso não encontre edição numerada.
- **Download**: baixa os PDFs da edição (até 3 links identificados na página).
- **Sem Parquet**: esse monitor só baixa PDFs — não há consolidação em série histórica.

---

### 3. ANP PPI — Preços de Paridade de Importação (`anp_ppi`)

- **Fonte**: `gov.br/anp` — XLSX único com a série histórica completa de PPI
- **Detecção**: compara `data_atualizacao` (extraída do texto "Atualizado em DD/MM/AAAA") e `Last-Modified` do HTTP header do arquivo.
- **Download**: remove o XLSX antigo em disco, baixa o novo (`ppi_<data>.xlsx`), chama `consolidar.py` que gera/atualiza `ppi_consolidado.parquet`.
- **Schema Parquet**: série histórica de preços de paridade semanais por produto.

---

### 4. ANP Preços de Produtores e Importadores (`anp_precos_produtores`)

- **Fonte**: `gov.br/anp` — arquivo `precos-medios-ponderados-semanais-2013.xls` (série corrente)
- **Detecção**: compara `data_atualizacao` + `Last-Modified` do arquivo específico `ponderados-semanais-2013`.
- **Download**: chama `consolidar.py` que:
  - Reutiliza cache local da série 2002–2012 (série fechada, nunca rebaixada)
  - Baixa apenas o arquivo `2013+` (série corrente)
  - Gera `precos_produtores_consolidado.parquet` e remove o xlsx
- **Particularidade**: dois arquivos fonte com schemas diferentes (série antiga vs corrente), unificados em um único Parquet.

---

### 5. ANP Desembaraços de Importações (`anp_desembaracos`)

- **Fonte**: `gov.br/anp` — XLSXs anuais de desembaraços (petróleo, gás, derivados, biocombustíveis)
- **Detecção**: compara `data_atualizacao` + `Last-Modified` do XLSX do ano corrente.
- **Download**: chama `consolidar.py` que:
  - Reutiliza cache local de anos fechados
  - Rebaixa apenas o XLSX do ano corrente (`desembaraco-<ano>.xlsx`)
  - Gera `desembaracos_consolidado.parquet` e remove o xlsx do ano corrente
- **Timeout**: 600 s (arquivo grande).

---

### 6. ANP Dados Abertos — Importações/Exportações (`anp_dados_abertos_ie`)

- **Fonte**: `gov.br/anp` — dois CSVs: `importacoes-exportacoes-petroleo` e `importacoes-exportacoes-derivados`
- **Detecção**: verifica `filename` + `Last-Modified` de cada um dos 2 CSVs. Dispara se qualquer um mudar.
- **Download**: chama `consolidar.py` que baixa os 2 CSVs, gera `dados_abertos_ie_consolidado.parquet` e remove os CSVs.
- **Particularidade**: dois datasets (petróleo bruto vs derivados) consolidados em um único Parquet com coluna `tipo_produto`.

---

### 7. ANP Painel — Mercado Brasileiro de Combustíveis Líquidos (`anp_painel_combustiveis`)

- **Fonte dupla**:
  1. ZIP estático em `gov.br/anp` — `liquidos.zip` com 6 CSVs (vendas, entregas, importações...)
  2. API Power BI da ANP — consultada via extrator `scripts/extractors/anp_painel_powerbi.py` (versionado no projeto)
- **Detecção**: dispara se o ZIP mudou (data ou Last-Modified) **ou** se o Power BI avançou para um período mais novo. Qualquer um dos dois sinais é suficiente.
- **Download**: chama `consolidar.py` que:
  - Baixa o `liquidos.zip`
  - Extrai 6 CSVs em pasta temporária
  - Gera 3 Parquets: `vendas.parquet`, `entregas.parquet`, `importacoes_distribuidores.parquet`
  - Remove ZIP, pasta temp e CSVs
- **Timeout**: 900 s (arquivo grande).
- **Particularidade**: o sinal do Power BI chega antes do ZIP ser atualizado — o PBI avança 1–2 semanas na frente do arquivo estático.

---

### 8. ANP Dados de Mercado GLP (`anp_glp`)

- **Fonte**: `gov.br/anp` — XLSX `relatorio_vendas_por_recipiente_*.xlsx`
- **Detecção**: compara o nome do arquivo (muda a cada atualização). Fallback: data de atualização da página.
- **Download**: chama `consolidar.py` que:
  - Baixa o XLSX mais recente
  - Lê 2 sheets (formato antigo e novo, schemas distintos)
  - Gera `glp_consolidado.parquet` com 4 categorias de produto
  - Remove o XLSX
- **Particularidade**: o XLSX tem dois formatos históricos incompatíveis (pré e pós-reforma do layout) que exigem parsers separados.

---

### 9. ANP CDP — Produção por Poço (`anp_cdp_producao_poco`)

- **Fonte**: Oracle APEX (`cdp.anp.gov.br`) — sistema interativo com CAPTCHA, sem bulk download para 2024+
- **Lógica diferente das demais**: o método `run()` é sobrescrito diretamente (não segue `verificar()/baixar()`).

#### Fluxo atual (desde 2026-05) — base leve, checada a cada 2h

A base passou de "heavy" (Selenium + ddddocr) para "leve" (Supabase session + requests puro):

1. **Lê sessão do Supabase** (`alertas_session` — criada pelo `etl_anp_cdp.yml` mensal). Se a sessão estiver ausente ou expirada, dispara o workflow de captura via GitHub API (com debounce de 6h) e pula a rodada.
2. **Verifica o período**: a sessão capturada deve ser do mês esperado (`now − 2 meses`). Se for de mês anterior, pula até nova captura.
3. **Baixa 3 CSVs** (Mar, Pre-Sal, Terra) usando `scripts/pipelines/anp/cdp/_replay.py` (`replay_download()` via requests puro, sem Selenium).
4. **Compara campos por ambiente** com baseline em `estado["campos_m"]`, `estado["campos_s"]`, `estado["campos_t"]`.
5. **Alerta granular**: 1 email por campo novo (CEO quer granularidade). Cap de 10 — se houver mais, envia 1 digest único.
6. Salva estado e atualiza `last_used_at` em `alertas_session`.

#### Invariante `baseline_consolidada` (implementado 2026-05-25)

**Problema resolvido**: runs parciais (ex: M+S baixados, T falhou) geravam baseline com `campos_t=[]`. Na run seguinte, quando T aparecia, todos os ~216 campos Terra viravam "novos" — falso positivo massivo.

**Solução**: dois campos no estado do Supabase (`alertas_estado.estado`):

| Campo | Tipo | Significado |
|-------|------|-------------|
| `baseline_consolidada` | bool | `true` se o último run processou os 3 ambientes (M+S+T) com sucesso |
| `ultima_baseline_consolidada` | dict | Snapshot de `{campos_m, campos_s, campos_t}` do último run completo |

**Invariante**: a detecção de novos campos usa `ultima_baseline_consolidada` quando `baseline_consolidada=false`. Um run parcial atualiza `campos_*` para os ambientes que baixou, mas nunca sobrescreve `ultima_baseline_consolidada` — esta só é atualizada quando todos os 3 ambientes retornam CSVs com sucesso.

**Transição de período** (`ultimo_periodo` muda): ambos os campos são resetados (`baseline_consolidada=false`, `ultima_baseline_consolidada={}`), e a baseline de detecção é forçada para `{}` (vazia) via override local — ou seja, **todos os campos do novo mês que aparecerem no primeiro run geram alerta**, independentemente do que existia no mês anterior. O primeiro run completo (M+S+T com campos não-vazios) do novo período se torna a nova baseline consolidada para runs subsequentes do mesmo período.

**Tabela Supabase necessária**: `alertas_session(base TEXT PK, session JSONB, captured_at TIMESTAMPTZ, expires_at TIMESTAMPTZ, last_used_at TIMESTAMPTZ, metadata JSONB)` — criada pela Frente A (migration da `worker_supabase`).

**Módulo externo necessário**: `scripts/pipelines/anp/cdp/_replay.py` com função `replay_download(session_data, periodo, ambiente, output_dir) -> str | Literal["expired","error"]` — criado pela Frente B (`worker_etl-pipelines`).

**Secret novo necessário** (CEO deve configurar em `https://github.com/IBBAOG/SectorData/settings/secrets/actions`):

| Secret | Escopo do PAT | Uso |
|--------|--------------|-----|
| `WORKFLOW_DISPATCH_PAT` | `actions:write` (fine-grained) ou `workflow` (classic) no repo `IBBAOG/SectorData` | Disparar `etl_anp_cdp.yml` automaticamente quando a sessão expira |

O capture Selenium pesado (ddddocr + Chrome) continua exclusivo do `etl_anp_cdp.yml` que roda 1×/mês. O monitor de alertas apenas **consume** a sessão resultante via requests.

#### Limitações conhecidas

| # | Limitação | Impacto | Mitigação atual |
|---|-----------|---------|-----------------|
| 1 | **Race condition em upsert de estado sem CAS**: se dois processos do monitor rodarem simultaneamente (improvável dado espaçamento do cron-job.org), o segundo `salvar_estado()` pode sobrescrever o estado gravado pelo primeiro sem detectar o conflito. | Baixo — dois runs simultâneos são anômalos; o cron tem espaçamento de horas. | Documentado. Não implementado lock/CAS. Revisitar se o cron for alterado para intervalos menores que 30 min. |

- **Consolidação manual** (`consolidar.py`):
  - 2005–2020: ZIPs anuais disponíveis em `gov.br/anp`
  - 2021–2023: ZIPs mensais disponíveis em `gov.br/anp`
  - 2024+: CSVs extraídos via Selenium, nomeados `producao_poco_MM-YYYY_[M|S|T].csv`, armazenados em `output/anp/` ou `DADOS/anp_cdp_producao_poco/`
- **Dedup Pré-Sal**: poços do Pré-Sal (ambiente S) também aparecem no dataset Mar (ambiente M) — double-counting. O consolidador remove as linhas M onde o poço já existe em S para o mesmo (ano, mes). A coluna resultante `local` tem valores: `PreSal`, `PosSal`, `Terra`.
- **Encoding**: CSVs de 2023 foram publicados em Latin-1 sem BOM. O parser tenta UTF-8-sig estrito primeiro, com fallback automático para Latin-1.
- **Parquet**: `cdp_consolidado.parquet` — 2,482,144 linhas, 2005-01 → 2026-03, ~77 MB.
- **Backfill Selenium**: para baixar meses em lote, usar `scripts/anp_auto.py --replay --de MM/YYYY --ate MM/YYYY --output output/anp`. Depois rodar `consolidar.py` para incorporar os CSVs ao Parquet.
- **Atenção crítica**: nunca deletar o Parquet para recriar — os CSVs Selenium de 2024+ são apagados em cleanups e uma recriação forçaria novo backfill (30–60 min, sujeito a falhas de CAPTCHA).

#### Pipeline Supabase (dashboard `/anp-cdp`)

O Parquet é a fonte de verdade local; os dados também são enviados ao Supabase para o dashboard web.

**Script de upload**: `dashboard_projeto/scripts/anp_cdp_upload.py`

```bash
# Backfill completo (primeira carga ou re-upload de todas as colunas)
python scripts/anp_cdp_upload.py --from-parquet DADOS/anp_cdp_producao_poco/cdp_consolidado.parquet --no-incremental

# Incremental (só envia meses novos, baseado no max(ano,mes) no DB)
python scripts/anp_cdp_upload.py --from-parquet DADOS/anp_cdp_producao_poco/cdp_consolidado.parquet

# Retomar backfill a partir de um ano específico
python scripts/anp_cdp_upload.py --from-parquet ... --ano-inicio 2020

# Incremental a partir de CSVs do CI
python scripts/anp_cdp_upload.py --from-csv-dir output/anp/
```

**Tabela Supabase**: `anp_cdp_producao`
- PK: `(ano, mes, poco, campo, bacia, local)`
- Apenas poços ativos: `petroleo_bbl_dia > 0 OR gas_total_mm3_dia > 0` (~2M linhas)
- Duplicatas intra-batch são resolvidas com `groupby(PK).agg(sum/first)` antes do upsert

**Colunas completas** (22 colunas do Parquet → todas persistidas):

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `ano`, `mes` | integer | Período de produção |
| `poco` | text | Nome do poço (ANP) |
| `nome_poco_operador` | text | Nome interno do operador |
| `campo` | text | Campo de produção |
| `bacia` | text | Bacia sedimentar |
| `local` | text | `PreSal` / `PosSal` / `Terra` |
| `estado` | text | UF (96% preenchido) |
| `operador` | text | Empresa operadora |
| `num_contrato` | text | Número do contrato ANP |
| `petroleo_bbl_dia` | float4 | Produção total de petróleo |
| `oleo_bbl_dia` | float4 | Produção de óleo cru |
| `condensado_bbl_dia` | float4 | Produção de condensado |
| `gas_total_mm3_dia` | float4 | Gás natural total |
| `gas_natural_assoc_mm3_dia` | float4 | Gás associado |
| `gas_natural_n_assoc_mm3_dia` | float4 | Gás não-associado |
| `gas_royalties` | float4 | Gás para royalties |
| `agua_bbl_dia` | float4 | Água produzida |
| `instalacao_destino` | text | Nome da instalação destino (48% preenchido) |
| `tipo_instalacao` | text | Tipo da instalação (48% preenchido) |
| `tempo_prod_hs_mes` | float4 | Horas de produção no mês (83% preenchido) |

**Materialized view**: `mv_anp_cdp_pocos`
- Pré-agrega os ~24.000 poços distintos com `MAX(estado)`, `MAX(operador)`, `SUM(petroleo_bbl_dia)`
- Usada pela RPC `get_anp_cdp_pocos_json()` que retorna todos os poços como JSON em **uma única requisição** (~400 KB gzipado), contornando o limite de 1000 linhas do PostgREST
- Atualizada automaticamente ao final de cada upload via `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_anp_cdp_pocos` (não-bloqueante)
- Novos poços aparecem no dashboard após o próximo upload + refresh

**RPCs Supabase**:
| Função | Descrição |
|--------|-----------|
| `get_anp_cdp_poco_serie(p_pocos, p_campos, p_bacoes, p_locais, p_estados, p_operadores, p_instalacoes, p_tipos_instalacao, p_ano_inicio, p_ano_fim)` | Série temporal agregada (≤252 pontos) com todas as métricas |
| `get_anp_cdp_pocos_json()` | Todos os ~24K poços como JSON array (usa `mv_anp_cdp_pocos`) |
| `get_anp_cdp_filtros()` | Opções de filtro: bacoes, campos, locais, estados, operadores, instalacoes, tipos_instalacao, ano_min, ano_max |
| `refresh_anp_cdp_pocos()` | Dispara `REFRESH MATERIALIZED VIEW CONCURRENTLY` |

**CI** (`.github/workflows/extrair-anp.yml`): após a extração Selenium dos CSVs mensais, o workflow executa automaticamente o upload incremental para Supabase com `--from-csv-dir output/anp/`.

**Dashboard** (`/anp-cdp`): 9 métricas (Petróleo, Óleo, Condensado, Gás Total, Gás Assoc., Gás N-Assoc., Gás Royalties, Água, Tempo Produção) × 8 filtros de dimensão (Ambiente, Bacia, Estado, Operador, Instalação Destino, Tipo Instalação, Campo, Poço). Todos os poços disponíveis no picker, filtrados no cliente após carregamento inicial do JSON.

---

### 10. MDIC Comex Stat — Petróleo, Gasolina e Diesel (`mdic_comex`)

- **Fonte**: API REST `api-comexstat.mdic.gov.br/general` — filtrando 3 NCMs:
  - `27090010` — Óleos brutos de petróleo
  - `27101259` — Gasolinas (exceto aviação)
  - `27101921` — Gasóleo (Diesel)
- **Detecção**: consulta os últimos 4 meses via POST para import + export. Extrai o mês mais recente disponível e compara com `ultimo_periodo` salvo.
- **Download**: chama `consolidar.py --mes YYYY-MM` que baixa apenas o mês novo e faz append/dedup no Parquet.
- **API instável**: o consolidador faz até 4 retries com backoff exponencial (1 → 3 → 8 → 20 s). Se a janela anual falhar, tenta mês a mês como fallback.
- **Backfill manual**: `python alertas/scripts/mdic_comex/consolidar.py --desde 1997` reconstrói o histórico completo desde 1997.
- **Schema Parquet**: `ano, mes, flow (import/export), ncm_codigo, ncm_nome, pais, volume_kg, valor_fob_usd`
- **Particularidade**: o NCM `27090000` (categoria-mãe) não retorna dados — é obrigatório usar o código de 8 dígitos `27090010`.

---

### 11. SINDICOM — Dados do Setor de Combustíveis (`sindicom`)

- **Fonte**: `sindicom.com.br` — XLSX único com histórico completo desde 2017, atualizado mensalmente
- **Detecção**: usa **Playwright** (Chrome headless) para carregar a página de downloads. Extrai o texto indicando o período mais recente (padrão `até <Mês> <Ano>`). Compara com `ultimo_periodo` salvo.
- **Por que Playwright**: o site usa WordPress com proteção anti-bot e o link de download exige JavaScript e cookies de sessão — requests simples retorna 403.
- **Download**: Playwright navega para a URL de download e captura o arquivo com `expect_download()`. Salva como `tabela_SINDICOM_combustiveis_<YYYYMM>.xlsx`.
- **Consolidação**: `consolidar.py` lê a sheet `dados_combs` do XLSX, converte o mês de texto (JANEIRO → 1) para numérico, e gera `sindicom_consolidado.parquet`.
- **Schema Parquet**: `ano, mes, tipo, empresa, segmento, tipo_produto, nome_produto, tipo_produto_web, regiao, uf, volume (m³)`
- **Empresas associadas**: IPIRANGA, RAIZEN, VIBRA, AIRBP. A entrada `ANP` representa o mercado total (dados ANP incluídos para referência) — deve ser excluída de análises de market share.
- **Segmentos**: `REVENDEDOR` (postos), `CONSUMIDOR` (direto), `TRR` (transportador-revendedor-retalhista), `MERCADO TOTAL - ANP`.
- **Nota GNV**: volume de GNV está em Mil m³, não em m³ como os demais produtos (aviso no próprio XLSX).
- **Cobertura**: 2017-01 → mês mais recente (atualmente 2026-03), 92k linhas.
- **Dashboard** (`/sindicom`): série mensal por produto + market share top-15 empresas. Filtros: produto, segmento, período. RPCs: `get_sindicom_serie`, `get_sindicom_filtros`.

---

### 12. ANP Preços de Distribuição de Combustíveis (`precos_distribuicao`)

- **Fonte**: tabela Supabase `anp_precos_distribuicao` — populada pelo pipeline ETL (`etl_anp_precos_distribuicao.yml`).
- **Detecção**: consulta `MAX(data_referencia)` segregado por `periodicidade` (`semanal` e `mensal`). Compara com `ultima_data_semanal` e `ultima_data_mensal` salvos no estado. Dispara se qualquer periodicidade avançou.
- **Sem download**: os dados já estão no Supabase — a base não baixa arquivos locais. `baixar()` retorna `[]`.
- **Estado**: `alertas/estado/precos_distribuicao.json` com chaves `ultima_data_semanal`, `ultima_data_mensal`, `ultima_verificacao`, `produtos_atualizados`.
- **Email**: inclui data mais recente por periodicidade, produtos identificados na nova data, e link para a página ANP.
- **Base leve**: sem Playwright, sem scraping — apenas consulta Supabase. Roda no monitor default a cada 2h.
- **Requer**: `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` no ambiente. Sem eles, retorna False silenciosamente.
- **Script standalone**: `alertas/scripts/precos_distribuicao/consolidar.py` — pode ser invocado para teste manual sem passar pelo monitor completo.

---

### 13. ETL Workflows — Consecutive Failures Detector (`etl_workflow_stuck`)

- **Fonte**: GitHub Actions run history via `gh run list` (CLI) ou GitHub REST API (`/repos/.../actions/workflows/.../runs`).
- **Detecção**: para cada workflow na lista `CRITICAL_WORKFLOWS`, conta runs consecutivas com `conclusion in {failure, timed_out, startup_failure}` no topo do histórico. `cancelled` runs são ignorados (usuário pode cancelar manualmente sem isso indicar falha). Se N≥3 falhas consecutivas → workflow marcado como "stuck".
- **Debounce de transição**: alerta é enviado apenas na transição de estado:
  - `ok` → `stuck`: email de alerta com tabela de workflows travados.
  - `stuck` → `ok`: email de recuperação (fecha o loop mental).
  - `stuck` → `stuck`: sem re-alerta (só atualiza `consecutive_failures` no estado).
- **Estado**: `alertas/estado/etl_workflow_stuck.json` — uma chave por workflow:
  ```json
  {
    "etl_anp_cdp.yml": { "status": "stuck", "since": "2026-05-23", "consecutive_failures": 8 },
    "etl_mdic_comex.yml": { "status": "ok" }
  }
  ```
- **Sem download**: não baixa arquivos. `baixar()` retorna `[]`.
- **Frequência**: base leve — roda no monitor default (cada 2h ou conforme o cron configurado). Não precisa de cadência separada.
- **Autenticação GitHub**: tenta `gh` CLI primeiro. Se não disponível, usa `GITHUB_TOKEN` env var via REST API. Se nenhum dos dois estiver disponível, pula o workflow com aviso e continua (não derruba a base).
- **Workflows monitorados** (12 ao todo — `supabase_deploy.yml` excluído intencionalmente):
  `etl_anp_cdp`, `etl_anp_cdp_diaria`, `etl_anp_fase3`, `etl_anp_precos`, `etl_anp_lpc`, `etl_anp_vendas`, `etl_anp_voip`, `etl_anp_subsidy_diesel`, `etl_mdic_comex`, `etl_sindicom`, `etl_navios_lineup`, `etl_ais_positions`.
- **Secret novo recomendado**: `GITHUB_TOKEN` (disponível automaticamente em GitHub Actions via `${{ secrets.GITHUB_TOKEN }}`). Para runs locais, exportar `export GITHUB_TOKEN=ghp_xxx` no shell do monitor.
- **Caso que motivou a criação** (2026-05-25): `etl_anp_cdp.yml` ficou travado por 3 dias (57/60 runs falhando); usuário percebeu apenas pelo dashboard `/anp-cdp-bsw` sem dados novos.

---

## Notificações

O módulo `notificador.py` usa a Gmail API (OAuth2) para enviar e-mails.
Configuração em `credentials.json` + `token.json` (gerado na primeira execução via `auth_gmail.py`).

Cada alerta inclui: nome da base, mensagem com período detectado, URL da fonte e nome do arquivo baixado.

---

## Histórico global

`DADOS/historico_alertas.csv` — log de todas as atualizações detectadas em todas as bases:

| Coluna | Descrição |
|--------|-----------|
| timestamp | Data/hora da detecção |
| slug | Identificador da base |
| nome | Nome legível da base |
| periodo | Período detectado (ex: 2026-03) |
| mensagem | Texto do alerta |
| arquivos | Nomes dos arquivos baixados (separados por `\|`) |
| url | URL da fonte |

Cada base também mantém seu próprio `DADOS/<slug>/historico.csv` com o mesmo schema.

---

## Operacao em producao (GitHub Actions)

A partir de 2026-05, o monitor roda autonomamente na nuvem via GitHub Actions, disparado
por cron-job.org a cada 2 horas. O estado persistente migrou para a tabela Supabase
`alertas_estado` (migration `20260506000001_alertas_estado.sql`).

### Estado persistente — Supabase

A tabela `alertas_estado (base TEXT PK, estado JSONB, updated_at TIMESTAMPTZ)` armazena o
ultimo periodo visto por base. O codigo em `bases/base.py` usa Supabase quando as variaveis
`SUPABASE_URL` e `SUPABASE_SERVICE_KEY` estao presentes, e cai para filesystem quando nao.

Isso garante idempotencia cross-runs: o runner e efemero mas o estado sobrevive.

### Secrets do repositorio necessarios

Acesse `https://github.com/IBBAOG/SectorData/settings/secrets/actions` e crie:

| Secret | Valor |
|--------|-------|
| `GMAIL_CREDENTIALS_JSON` | Conteudo completo de `alertas/credentials.json` |
| `GMAIL_TOKEN_JSON` | Conteudo completo de `alertas/token.json` |
| `ALERTAS_DEST_EMAIL` | Email destino das notificacoes (ex: `eduardo.mendes@itaubba.com`) |
| `SUPABASE_URL` | Ja existe — compartilhado com outros workflows |
| `SUPABASE_SERVICE_KEY` | Ja existe — compartilhado com outros workflows |
| `WORKFLOW_DISPATCH_PAT` | PAT com escopo `actions:write` (fine-grained) ou `workflow` (classic) no repo `IBBAOG/SectorData`. Usado pela base `anp_cdp_producao_poco` para re-disparar `etl_anp_cdp.yml` quando a sessão expira (debounce: 6h). |

Passos para copiar credentials.json e token.json:

```powershell
# Copie o conteudo de credentials.json
Get-Content alertas\credentials.json | Set-Clipboard

# Cole em: Settings > Secrets > Actions > New secret > GMAIL_CREDENTIALS_JSON

# Repita para token.json
Get-Content alertas\token.json | Set-Clipboard
# cole em GMAIL_TOKEN_JSON
```

### Setup cron-job.org

Configure uma chamada a cada 2 horas em `https://cron-job.org`:

- **URL**: `https://api.github.com/repos/IBBAOG/SectorData/actions/workflows/alertas_monitor.yml/dispatches`
- **Method**: `POST`
- **Headers**:
  - `Authorization: Bearer <SEU_PAT>` (PAT com permissao `workflow` no repositorio)
  - `Accept: application/vnd.github+json`
  - `Content-Type: application/json`
- **Body**: `{"ref": "main"}`
- **Schedule**: Every 2 hours (ex: `0 */2 * * *`)

O PAT deve ter escopo `workflow` (Actions) no repositorio `IBBAOG/SectorData`.
Crie em `https://github.com/settings/tokens` (classic token) ou fine-grained token
com permissao de leitura/escrita em Actions.

### Verificar execucao

Acesse `https://github.com/IBBAOG/SectorData/actions/workflows/alertas_monitor.yml`
para ver o historico de runs, logs e status de cada base.

Para acionar manualmente (ex: forcar verificacao de base especifica):

```bash
gh workflow run alertas_monitor.yml --ref main -f base=anp_ppi
```

---

## Operacao local (desenvolvimento e debug)

O sistema continua funcionando localmente sem nenhuma alteracao de interface.
Quando `SUPABASE_URL` e `SUPABASE_SERVICE_KEY` nao estao no ambiente, o estado
e lido/gravado em `alertas/estado/<slug>.json` (comportamento anterior).

```bash
# Verificar todas as bases (usa estado em disco se sem env vars)
python alertas/monitor.py

# Verificar base especifica
python alertas/monitor.py --base anp_ppi

# Loop continuo local (verifica a cada 30 min)
python alertas/monitor.py --loop --intervalo 30
```

---

## Pegadinhas conhecidas

### ANP CDP — sessao APEX expirada sem redirect (detectado 2026-05-18)

**Sintoma**: `anp_cdp_producao_poco` fica travado por dias: `ultimo_periodo` nao avanca,
sessions `last_used_at = NULL` em `alertas_session`, mas outras bases funcionam.

**Causa**: A sessao APEX expira no servidor ANP, mas o servidor retorna HTTP 200 com
a pagina HTML completa (page-54, formulario de busca) em vez de um redirect para `/login`.
O codigo antigo de `_looks_like_expired` so detectava redirects e patterns como ORA-20876 --
nao detectava o pattern `wwvFlowForm` HTML.

**Fix aplicado (2026-05-18 commit e6fff55c)**:
- `_replay.py`: adicionado `_APEX_PAGE_PATTERNS` que detecta `wwvFlowForm` como sessao expirada.
  Com isso, `_looks_like_expired()` retorna `True` e `replay_download` retorna `status="expired"`.
- `anp_cdp_producao_poco.py`: separado `_SessionExpiredError` de `RuntimeError` generico.
  Quando `_SessionExpiredError` e capturado, o monitor tenta re-disparar `etl_anp_cdp.yml`
  (workflow Selenium) via `WORKFLOW_DISPATCH_PAT`.
- `anp_cdp_producao_poco.py`: estado (`ultimo_periodo` + baselines) e salvo sempre que os CSVs
  sao baixados com sucesso, mesmo sem novidades. Antes so salvava quando havia campo novo,
  causando trava no mes anterior.

**Canario**: `monitor.py` agora envia digest "bases em silencio >48h" ao final de todo run
completo, com debounce de 24h via `_meta_stale_check` em `alertas_estado`.

**Sequencia de recuperacao manual** (se GHA nao conseguir re-disparar automaticamente):
1. Confirmar que `WORKFLOW_DISPATCH_PAT` esta configurado nos secrets do repo.
2. Disparar manualmente: `gh workflow run etl_anp_cdp.yml --ref main -f periodo="04/2026"` 
   (requer permissao admin no repo).
3. Aguardar o workflow Selenium completar (~30min) e criar novas sessions em `alertas_session`.
4. Na proxima rodada do monitor (automatica a cada 2h), o replay usara as novas sessions.

**Observacao**: o debounce de `last_capture_attempt` em `alertas_estado` controla quantas vezes
o `etl_anp_cdp.yml` pode ser disparado (maximos 1 vez a cada 6h). Se o Supabase mostrar que
`last_capture_attempt` e recente (< 6h), aguardar ou apagar o campo para forcar re-disparo.

Para depurar estado no Supabase localmente, exporte as variaveis:

```bash
export SUPABASE_URL=https://xxx.supabase.co
export SUPABASE_SERVICE_KEY=eyJ...
python alertas/monitor.py --base anp_ppi
```

---

### Gmail token revogado deixava estado avancar sem email (incidente 2026-05-19)

**Sintoma**: usuário recebeu apenas 1 de 2 alertas esperados para `anp_painel_combustiveis`.
Na run 01:01 UTC o monitor detectou "Power BI avancou para 2026-04", salvou
`powerbi_periodo: "2026-04"` no Supabase, mas o `enviar_alerta` falhou com
`invalid_grant: Token has been expired or revoked` → `webbrowser.Error`. Runs
seguintes viram `pbi_mudou == False` e nunca alertaram.

**Causa**: ordem em `bases/base.py:run()` salvava estado ANTES de enviar email.
Qualquer falha de email (token revogado, network, etc.) "consumia" a novidade
silenciosamente. Refresh tokens OAuth do Gmail podem ser revogados pelo
Google sem aviso prévio (mudança de senha, TTL, etc.).

**Fix (2026-05-20)**:
- `bases/base.py`: reordenado — `enviar_alerta` agora roda PRIMEIRO. Estado só
  é gravado após email sair com sucesso. Falha de email retorna `False` sem
  atualizar `alertas_estado`, então a próxima run retenta (entrega at-least-once).
- `notificador.py`: em ambiente CI/headless, `_get_service()` levanta
  `RuntimeError` descritivo quando o refresh falha, em vez do confuso
  `webbrowser.Error`.

**Como regenerar GMAIL_TOKEN_JSON quando isso acontece de novo**:
1. `cd alertas && python auth_gmail.py` (abre browser local, autentica conta Gmail)
2. `Get-Content alertas\token.json | Set-Clipboard`
3. Colar em https://github.com/IBBAOG/SectorData/settings/secrets/actions → GMAIL_TOKEN_JSON
4. Disparar `gh workflow run alertas_monitor.yml --ref main` pra confirmar

**Invariante novo**: `alertas_estado` é a verdade do "já vi esse período". Nunca avance esse estado sem ter enviado o email correspondente. Trata-se de um exactly-once-ish: emails podem ser repetidos em circunstâncias raras (email envia, mas update Supabase falha), mas nunca perdidos.
