# PRD — Departamento Dados Locais

Dados que o CEO mantém **manualmente** em arquivos Excel/CSV no disco, e os scripts que sobem esses dados para o Supabase. Workflow é **humano-no-loop** (não automatizado por scrape).

## Escopo

```
data/
  price_bands.xlsx              Bandas de preço (paridade import/export, Petrobras)
  field_stakes_brasil.xlsx      Stakes (working interest) por campo × empresa — ANP Anuário 2025 (seed inicial)
  stock_guide_brent_grid.xlsx   Malha multi-eixo (1–3) × multi-métrica (1 aba/métrica) de Brent → valor por papel (/stock-guide)
  Liquidos_Vendas_Atual.csv     Vendas líquidos (snapshot)

scripts/manual/price_bands_upload.py            Upload de price_bands → Supabase
scripts/manual/field_stakes_upload.py           Upload (seed) de field_stakes → Supabase
scripts/manual/make_brent_grid_template.py      [DEPRECADO] gerador single-métrica/offline (template canônico vem do Admin)
scripts/manual/stock_guide_brent_grid_upload.py Upload (snapshot multi-métrica) da malha Brent → stock_guide_scenario_grid
```

> **`d_g_margins` saiu deste departamento em 2026-06-05.** Deixou de ser Excel manual (`data/d_g_margins.xlsx` + `scripts/manual/dg_margins_upload.py` + `manual_dg_margins.yml`, todos retirados) e passou a ser **computado automaticamente** pelo `etl_dg_margins.yml` (dono `worker_etl-pipelines`). Ver [`docs/app/diesel-gasoline-margins.md`](../app/diesel-gasoline-margins.md) e [`docs/etl-pipelines/PRD.md`](../etl-pipelines/PRD.md).

## Tabelas-alvo no Supabase

Schema é dono do APP. Aqui só listamos o contrato esperado.

| Arquivo | Tabela | Chave de upsert |
|---|---|---|
| `data/price_bands.xlsx` | `price_bands` | `(date, product)` |
| `data/field_stakes_brasil.xlsx` | `field_stakes` | `(campo, empresa)` (one-shot seed; edits via Admin Panel) |
| `data/stock_guide_brent_grid.xlsx` | `stock_guide_scenario_grid` | `(sensitivity_id, ticker, metric, x_value, y_value, z_value)` (replace-total snapshot por `sensitivity_id`, todas as métricas) |
| `data/Liquidos_Vendas_Atual.csv` | (verificar uso atual) | — |

## Fluxo padrão

```
1. CEO abre Excel em data/
2. CEO edita/adiciona linhas
3. CEO salva
4. Upload roda manualmente (rodar localmente o script de upload da fonte)
5. Script lê Excel → valida schema → upsert in Supabase
```

Sua função: garantir que o passo 5 nunca quebre por mismatch entre Excel e schema da tabela.

## Schema do Excel price_bands.xlsx

Ambas as sheets têm agora **4 colunas de dados** (além de Date):

| Sheet | Colunas |
|---|---|
| `Gasoline` | Date, IBBA - Import Parity, IBBA - Export Parity, Petrobras Price |
| `Diesel` | Date, BBA - Import Parity, BBA - Export Parity, Petrobras Price |

As colunas `BBA - Import Parity w/ subsidy` e `Petrobras Price w/ subsidy` foram **removidas do fluxo de upload** a partir de 2026-05-27. Elas continuam existindo na tabela `price_bands` do Supabase, mas são agora **auto-preenchidas por triggers SQL** (migration `20260527200000_subsidy_reform.sql`) com base em:

- `anp_subsidy_diesel_reference` (preço de referência diário por região)
- `anp_subsidy_commercialization` (preço de comercialização por período × região × tipo_agente)
- `anp_subsidy_caps` (teto do reembolso por tipo_agente e data)

O script `price_bands_upload.py` ignora silenciosamente as 2 colunas obsoletas caso ainda estejam presentes no Excel (log de WARNING), sem quebrar. O user pode atualizar o template local removendo essas colunas da sheet Diesel, mas não é obrigatório.

## Princípios

1. **Excel é fonte da verdade enquanto não estiver no Supabase.** Não delete arquivos `data/*.xlsx` mesmo que pareçam obsoletos — pode haver linhas não upadas.
2. **Schema do Excel deve casar com schema da tabela.** Antes de mudar header de coluna no Excel, atualize o mapeamento no script de upload.
3. **Upsert por chave de negócio** — sempre `ON CONFLICT (chave) DO UPDATE`, nunca `INSERT` cego.
4. **Backup antes de upload destrutivo.** Manter um backup do Excel antes de sobrescrever (ex.: `price_bands_backup.xlsx`).
5. **Dry run quando schema mudou.** Antes de upload de produção pós-mudança de coluna, ler Excel e validar (tipos, NULLs, duplicatas na chave).

## Workflow GitHub Action

Nenhum workflow de upload manual ativo neste departamento. O `manual_dg_margins.yml` foi **retirado em 2026-06-05** (D&G Margins automation).

`price_bands` hoje é upload manual (rodar `python scripts/manual/price_bands_upload.py` localmente). Verificar se faz sentido criar workflow.

## Tarefas comuns

### Schema mismatch (script falha ao upar)

1. Abrir Excel e listar colunas (skill `xlsx` pode ajudar).
2. Comparar com schema da tabela — `Read supabase/migrations/<arquivo>.sql` e olhar `CREATE TABLE`.
3. Comparar com mapeamento no script Python.
4. Culpado típico: nova coluna no Excel não mapeada, ou coluna renomeada.
5. Fix: ajustar mapeamento no script (preferível) ou pedir migration ao APP.

### Adicionar nova fonte manual

1. Coloque arquivo em `data/<nome>.xlsx` ou `.csv`.
2. Solicite ao APP a criação da tabela no Supabase via migration.
3. Crie `scripts/manual/<nome>_upload.py` espelhado em `price_bands_upload.py` (segue R4 de nomenclatura: `<domain>_upload.py`).
4. Adicione workflow em `.github/workflows/upload-<nome>.yml` se for upload recorrente.
5. Atualize este PRD (linha nova na tabela de tabelas-alvo).
6. Se Alertas vai monitorar essa tabela, avise.

### Validar Excel antes de upload (dry run)

- Tipos das colunas (datas como datas, números como números — Excel pode corromper).
- Duplicatas na chave de negócio.
- NULLs em colunas NOT NULL.

## Anti-padrões

- Deletar arquivos `data/*.xlsx` "porque parecem obsoletos".
- Editar Excels via agente sem o CEO ter pedido (são arquivos manuais).
- Mudar header de coluna no Excel sem atualizar script de upload.
- Rodar upload de produção após mudança de schema sem dry run.
- Comitar Excel inflado/grande sem necessidade.
- Truncar tabela e re-popular do zero (memória do CEO: corrigir in-place).

## Field Stakes seed (manual upload)

### What it is

`data/field_stakes_brasil.xlsx` — manually curated working-interest table (campo × empresa × stake_pct) sourced from ANP Anuário Estatístico 2025, Quadro 2.3 ("Concessionários por campo de produção, dezembro de 2024"), with supplementary entries from PRIO/PetroReconcavo/Brava IR materials and PPSA publications for PSC (Production Sharing Contract) fields where Petrobras + PPSA + consortium partners share stakes.

The Excel has 4 sheets — only `field_stakes` is consumed by the upload script. The other 3 sheets are reference material:

| Sheet | Purpose | Consumed? |
|---|---|---|
| `field_stakes` | 378 rows × 10 cols — campo, empresa, stake_pct, bacia, ambiente, situacao, operador, fonte, data_fonte, obs | YES |
| `fontes` | 15 bibliographic refs (URLs to ANP, PPSA, IR releases) | no (documentation only) |
| `lacunas` | Campos present in `anp_cdp_producao` but absent from Anuário (PSA unitization areas, exploration licenses, ceased fields). Eduardo fills these via UI. | no |
| `resumo` | Metadata block | no |

### Target

| Table | Columns | PK | Writes by |
|---|---|---|---|
| `field_stakes` | `campo`, `empresa`, `stake_pct numeric(6,3) CHECK (stake_pct>0 AND stake_pct<=100)`, `updated_at`, `updated_by` | `(campo, empresa)` | Seed script (DIRECT upsert) + Admin Panel (via `admin_upsert_field_stakes` RPC) |

### Script

`scripts/manual/field_stakes_upload.py` — one-shot seed bootstrap. Reads the `field_stakes` sheet, normalizes empresa names, fuzzy-matches campo names to the canonical universe (`mv_anp_cdp_pocos.campo`), then `DELETE`s and `INSERT`s per campo. `updated_by` is left NULL (seed, not a user edit; column is nullable).

**Why direct table writes instead of `admin_upsert_field_stakes()` RPC?** The RPC guards on `is_admin()` which evaluates `auth.uid()` — null under Service Role Key. This script is the ONE documented place where field_stakes is written outside that RPC. All subsequent edits should go through the Admin Panel UI.

### Empresa normalization

`EMPRESA_NORMALIZATION` dictionary at the top of `scripts/manual/field_stakes_upload.py` — maps the 77 distinct raw legal names ("Petroleo Brasileiro S.A. - Petrobras", "PRIO Bravo Ltda.", "Brava Energia (3R Pescada S.A.)", etc.) to ~63 canonical short names ("Petrobras", "PRIO", "Brava Energia"). Maintenance rules:

- Strip legal suffixes (S.A., Ltda., Corp., Inc., Brasil) when the rest is unambiguous.
- Collapse SPE / subsidiary fragmentation into the parent group: all `PRIO *` → `PRIO`; all `Brava Energia (3R *)` → `Brava Energia`; all `PetroReconcavo` SPEs → `PetroReconcavo`; both Seacrest SPEs → `Seacrest`; both Equinor entities → `Equinor`; both Reconcavo E&P/Energia → `Reconcavo Energia`.
- Group ex-mergers under the surviving brand (Enauta → Brava Energia).
- Unmapped raw strings fall through with `.strip()` only — extend the dict when new partners appear in future Anuario revisions.

### Campo matching

The Excel `campo` column uses ANP Anuário CAPSLOCK + diacritic format ("ANAMBÉ", "AZULÃO", "ALBACORA LESTE"). The canonical universe is the union of `mv_anp_cdp_pocos.campo` (from monthly production) + already-registered `field_stakes.campo`, fetched at runtime via `get_field_stakes_overview()` RPC (~540 names). Matching uses:

1. ASCII-folded uppercase exact match (handles all diacritic variations).
2. Fallback to `difflib.get_close_matches(cutoff=0.85)` if no exact hit.
3. Anything still unmatched is skipped and reported — Eduardo decides via UI.

### Validation

The script only uploads campos whose post-normalization grouped sum is `100.0 ± 0.01`. (The Excel currently has all 306 campos summing exactly to 100, so this is just defense-in-depth.)

### Seed run (2026-05-26)

- 378 Excel rows / 306 distinct campos / 77 raw empresas → 64 canonical empresas
- 304 campos exact-matched and uploaded (373 stake rows inserted)
- 2 campos unmatched and skipped: `Mariqui`, `Xisto São Mateus do Sul` — neither exists in `mv_anp_cdp_pocos`; Eduardo will add via UI after table appears in `/admin-panel`.

### Refresh cadence

As needed, when:
- ANP publishes a new Anuário (annual, ~April), OR
- A partner deal closes that materially changes stakes on a marquee field (Tupi, Mero, Búzios, etc.).

For ad-hoc partner-deal updates, prefer editing through the Admin Panel (logged-in Admin → `admin_upsert_field_stakes` RPC) instead of re-running the seed script. The seed script is for bulk refreshes from a freshly curated Excel.

### How to re-run

```bash
# Default path (data/field_stakes_brasil.xlsx)
python scripts/manual/field_stakes_upload.py

# Alternative path
python scripts/manual/field_stakes_upload.py path/to/alternate.xlsx
# or env var
FIELD_STAKES_XLSX=path/to/alternate.xlsx python scripts/manual/field_stakes_upload.py
```

Important: re-running is idempotent at the campo level (DELETE + INSERT per campo). Any campos NOT in the Excel are left untouched in the DB — that is intentional, because Admin Panel edits for campos beyond the Anuário scope (PSA unitizations, exploration blocks) must not be wiped by a future re-seed.

---

## Stock Guide — Brent scenario grid multi-métrica × multi-eixo (manual upload)

### O que é

`data/stock_guide_brent_grid.xlsx` — malha Cartesiana **multi-eixo (1 a 3 eixos)** e **multi-métrica** que o analista gera no modelo dele. Cada **linha** de uma aba é um cenário (uma rodada do modelo): uma combinação de níveis dos eixos (ex. Avg Brent 2026 × 2027 × 2028+) → o valor de uma métrica de output (target_price, fcfe, dividends, net_income, …) de cada papel. O `/stock-guide` lê cada malha e **interpola multilinearmente ao vivo** (2^d cantos) contra os níveis correntes dos eixos. Substitui a camada linear de "compose" no lado do dashboard.

Cada malha pertence a uma "casca" (shell) que o analista cria no Admin Panel — uma linha em `stock_guide_sensitivities` marcada por `definition.grid` (metadados de eixo + lista de outputs; **sem valores**). Os valores por papel/métrica ficam na tabela relacional `stock_guide_scenario_grid`, não no jsonb.

Shape do `definition.grid` (migrations `20260618200000` multi-eixo + `20260619000000` multi-métrica):

```jsonc
{ "axes": [                                  // 1..3, ordem = storage (x, y, z)
    { "driver_key": "avg_brent_2026", "label": "Brent (avg 2026)", "unit": "USD/bbl" },
    { "driver_key": "avg_brent_2027", "label": "Brent (avg 2027)", "unit": "USD/bbl" } ],
  "outputs": ["target_price", "fcfe", "dividends"] }   // v2 — lista de métricas
  // legado: "output": "target_price"  (single) → mapeia p/ ['target_price']
```

> **v2 (2026-06-10):** o `output` (string única) virou `outputs` (lista). O uploader aceita ambos: `outputs` (lista) usado verbatim; `output` (string) → `[output]`; ausente → `['target_price']`.

### Template — gerado no Admin (browser)

**O template canônico é baixado pelo Admin Panel** ("Download template" na shell da malha, gerado no browser). É o contrato v2 abaixo. O Python virou **só o caminho de upload**. O gerador `make_brent_grid_template.py` está **DEPRECADO** (fallback single-métrica / offline — ver fim desta seção).

### Formato do Excel (v2 — multi-aba, posicional)

**Uma aba por métrica de output.** O **nome da aba = key da métrica** (`target_price`, `fcfe`, `dividends`, `net_income`) → vira a coluna `metric`. Aba cujo nome não casa nenhuma output configurada = **WARN + skip**; output configurada sem aba correspondente = **WARN** ("metric X — will be absent").

Por aba (formato LONG, 1 linha por cenário):
- As **primeiras `d` colunas são as coordenadas, lidas POSICIONALMENTE** na ordem de `definition.grid.axes` — **não por header** (eixos v2 podem usar `driver_id` opaco sem key limpa). O header da coluna de coordenada é só o label humano do eixo; mismatch gera **WARN de sanidade**, nunca erro.
- As demais colunas não-vazias e não-"Unnamed" são tickers; cada célula = valor daquela métrica para aquele ticker naquelas coordenadas.

Exemplo da aba `target_price` (2 eixos):

```
Brent avg 2026 | Brent avg 2027 | PETR4 | PRIO3
40             | 40             | 22.10 | 28.40
40             | 50             | 24.05 | 30.10
50             | 40             | 25.30 | 31.20
50             | 50             | 27.80 | 33.90
...
```

Records: `metric = <nome da aba>`, `x_value = coords[0]`, `y_value = coords[1]` (se d≥2, senão 0), `z_value = coords[2]` (se d≥3, senão 0). Eixo não usado = 0 permanente.

### Alvo

| Tabela | Colunas | PK | Escrita por |
|---|---|---|---|
| `stock_guide_scenario_grid` | `sensitivity_id`, `ticker`, `metric`, `x_value`, `y_value`, `z_value`, `primary_value` | `(sensitivity_id, ticker, metric, x_value, y_value, z_value)` | Este script (service role, bypassa RLS) |

Tabela criada pela migration `20260612000000_stock_guide_scenario_grid.sql`, estendida para multi-eixo por `20260618200000_stock_guide_scenario_grid_multi_axis.sql` (ALTER + PK 5-col) e para multi-métrica por `20260619000000_stock_guide_scenario_grid_multi_metric.sql` (`metric text NOT NULL DEFAULT 'target_price'` + PK 6-col + RPC recriada com a coluna `metric`). RLS habilitada, sem policies — leituras via RPC hide-aware `get_stock_guide_scenario_grid(p_sensitivity_id)`; escritas só via service role.

### Script de upload (v2)

`scripts/manual/stock_guide_brent_grid_upload.py` — loader **replace-total** (snapshot, não série temporal). Cada run apaga **TODAS** as linhas do `sensitivity_id` alvo (**todas as métricas de uma vez**) e reinsere o conteúdo do workbook. Idempotente (rodar 2× = mesmo estado). A regra "nunca deletar mês parcial" **não se aplica** aqui — replace-total é o correto.

Alvo selecionado por **exatamente um** de:
- `--sensitivity-id N` — id da linha em `stock_guide_sensitivities` (preferido, inequívoco).
- `--table-title "..."` — lookup do id por `title`; erro claro se 0 ou >1 match.

A shell é buscada via service role; `definition.grid.axes` dá `d` (nº de eixos) e `definition.grid.outputs` dá as métricas válidas (fallback `output` legado → `['target_price']`).

**Iteração das abas:** aba cujo nome casa uma output key (case-insensitive) → processada (metric = nome da aba); aba desconhecida → WARN + skip; output configurada sem aba → WARN.

**Validações duras (por aba, em ordem):**
- Coordenadas posicionais (1ªs `d` colunas). WARN de sanidade se o header da coord não bate o `driver_key`/`label` do eixo (não erro). WARN se um header de ticker for uma key do catálogo de drivers (coord mal-posicionada / arquivo errado).
- Linhas 100% vazias dropadas em silêncio.
- Coordenada não-numérica = **ERRO** (lista até 10 nº de linha do Excel; não warn-skip). Coords arredondadas a 6 decimais.
- Tupla de coordenadas duplicada = **ERRO** (até 5 exemplos).
- **Completude Cartesiana**: `len(linhas) == Π(níveis distintos por eixo)` — ERRO com nº de combos faltantes + até 5 tuplas exemplo.
- Por ticker: coluna 100% vazia = WARN+skip; parcialmente vazia = **ERRO** ("ticker X: N of M combos empty"); célula não-numérica = ERRO.
- `total=0` (nenhuma aba casou output, ou todas vazias) = **ERRO** (silent-empty é bug, pegadinha #12 do CLAUDE.md).
- Ticker fora de `stock_guide_companies` = WARN (não aborta).
- Print final: WARN se total > 60k (cada métrica multiplica o payload).

Upsert em lotes de 500, `on_conflict="sensitivity_id,ticker,metric,x_value,y_value,z_value"`.

### Como rodar

```bash
# Por id (preferido):
python scripts/manual/stock_guide_brent_grid_upload.py --sensitivity-id 7

# Por título (deve ser único):
python scripts/manual/stock_guide_brent_grid_upload.py --table-title "Brent scenario grid 3-D"

# Excel alternativo:
python scripts/manual/stock_guide_brent_grid_upload.py --sensitivity-id 7 --excel path/to/grid.xlsx
# ou via env var:
STOCK_GUIDE_BRENT_GRID_XLSX=path/to/grid.xlsx python scripts/manual/stock_guide_brent_grid_upload.py --sensitivity-id 7

# Dry run (parse + valida + reporta; NÃO deleta, NÃO faz upsert — produção intocada):
python scripts/manual/stock_guide_brent_grid_upload.py --sensitivity-id 7 --dry-run
```

`--dry-run` ainda precisa de `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (read-only basta) pra buscar eixos+outputs da shell; só pula o delete/upsert.

Caminho default do Excel: `$STOCK_GUIDE_BRENT_GRID_XLSX` → `C:\Users\eduar\dashboard_projeto\data\stock_guide_brent_grid.xlsx`. O Excel é gitignored (não commitar).

### Gerador de template — DEPRECADO

`scripts/manual/make_brent_grid_template.py` está **DEPRECADO** (2026-06-10). O template canônico agora vem do botão "Download template" do Admin (multi-aba v2). O gerador permanece só como **fallback single-métrica / offline**: emite **uma única aba nomeada `target_price`** (a output default legada) — consumível pelo uploader v2. Imprime aviso de deprecação no início e **recusa rodar** (exit 2) quando a shell resolvida tem **múltiplas outputs** (`outputs` com >1 item), apontando pro botão do Admin. Coordenadas posicionais; eixos resolvidos via `--axes` / `--sensitivity-id` / default 3 eixos de Brent; ranges via `--range KEY=MIN:MAX:STEP`.

### Guidance de payload

A malha inteira é baixada pelo browser e interpolada ao vivo, **por métrica**. Mantenha o payload sob controle:
- **3-D**: ≤15 níveis/eixo (≈ 3.375 cenários × N tickers × N métricas).
- **2-D**: ≤40×40 (1.600 cenários).
- **1-D**: livre.

O uploader avisa acima de 60k mesh points (somando todas as métricas).

### Refresh cadence

Ad-hoc, quando o analista regenera a malha no modelo (mudança de premissas, nova curva de Brent, novos eixos/papéis/métricas). Mudar eixos ou outputs da shell exige **re-download do template no Admin + re-upload** (a malha antiga vira órfã; o replace-total por `sensitivity_id` apaga todas as métricas antigas).

---

## Clipping cookies (News Hunter)

### O que é

`scripts/manual/upload_clipping_cookies.mjs` lê arquivos Netscape-format cookie (`.txt`) de uma pasta local e faz upsert de cada um na tabela `public.clipping_cookies` via service role key (bypassa RLS).

Cada arquivo deve ter o nome do domínio canônico: `valor.globo.com.txt`, `brasilenergia.com.br.txt`, etc.

### Quando rodar

A cada ~2 meses, ou quando o News Hunter (`/news-hunter`) reportar `fetch_failed` para valor.globo.com ou brasilenergia.com.br — sinal de cookie expirado.

### Pré-requisitos

1. Gerar os arquivos de cookie com o script `login.py` do clipinator (repo externo). Os arquivos ficam em `C:\Users\eduar\Documents\clipinator\cookies\`.
2. Ter as variáveis de ambiente disponíveis em `.env.local` (ou como env vars):
   - `SUPABASE_URL` (ou `NEXT_PUBLIC_SUPABASE_URL`)
   - `SUPABASE_SERVICE_ROLE_KEY` (ou `SUPABASE_SERVICE_KEY`)

### Como rodar

```bash
node scripts/manual/upload_clipping_cookies.mjs
# ou apontando para outra pasta:
node scripts/manual/upload_clipping_cookies.mjs C:\caminho\alternativo
# ou via env var:
CLIPPING_COOKIES_DIR=C:\caminho\alternativo node scripts/manual/upload_clipping_cookies.mjs
```

### Tabela-alvo

| Arquivo | Tabela | Chave de upsert |
|---|---|---|
| `*.txt` em `CLIPPING_COOKIES_DIR` | `clipping_cookies` | `domain` |

## Contratos com outros departamentos

- **APP** é dono do schema das tabelas-alvo. Mudança de schema vai via APP. Você só consome.
- **ETL** não toca em `data/` nem nos scripts de upload manual. (Por design.) Exceção: `d_g_margins` migrou para o ETL em 2026-06-05 e não é mais deste departamento.
- **Alertas** podem monitorar `price_bands`. Verifique antes de remover/renomear coluna.
