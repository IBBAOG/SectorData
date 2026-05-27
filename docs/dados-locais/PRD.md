# PRD — Departamento Dados Locais

Dados que o CEO mantém **manualmente** em arquivos Excel/CSV no disco, e os scripts que sobem esses dados para o Supabase. Workflow é **humano-no-loop** (não automatizado por scrape).

## Escopo

```
data/
  d_g_margins.xlsx              Margens diesel/gasolina (atualização semanal)
  d_g_margins_backup.xlsx       Backup anterior do d_g_margins
  price_bands.xlsx              Bandas de preço (paridade import/export, Petrobras)
  field_stakes_brasil.xlsx      Stakes (working interest) por campo × empresa — ANP Anuário 2025 (seed inicial)
  Liquidos_Vendas_Atual.csv     Vendas líquidos (snapshot)

scripts/manual/dg_margins_upload.py     Upload de d_g_margins → Supabase
scripts/manual/price_bands_upload.py    Upload de price_bands → Supabase
scripts/manual/field_stakes_upload.py   Upload (seed) de field_stakes → Supabase
```

## Tabelas-alvo no Supabase

Schema é dono do APP. Aqui só listamos o contrato esperado.

| Arquivo | Tabela | Chave de upsert |
|---|---|---|
| `data/d_g_margins.xlsx` | `d_g_margins` | `(fuel_type, week)` |
| `data/price_bands.xlsx` | `price_bands` | `(date, product)` |
| `data/field_stakes_brasil.xlsx` | `field_stakes` | `(campo, empresa)` (one-shot seed; edits via Admin Panel) |
| `data/Liquidos_Vendas_Atual.csv` | (verificar uso atual) | — |

## Fluxo padrão

```
1. CEO abre Excel em data/
2. CEO edita/adiciona linhas
3. CEO salva
4. Upload roda (manual local OU GitHub Action manual_dg_margins.yml semanal)
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
4. **Backup antes de upload destrutivo.** Para `d_g_margins`, manter `d_g_margins_backup.xlsx`.
5. **Dry run quando schema mudou.** Antes de upload de produção pós-mudança de coluna, ler Excel e validar (tipos, NULLs, duplicatas na chave).

## Workflow GitHub Action

| Workflow | Schedule | Script |
|---|---|---|
| `.github/workflows/manual_dg_margins.yml` | Semanal (segunda) | `scripts/manual/dg_margins_upload.py` |

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
- **ETL** não toca em `data/` nem nos scripts de upload manual. (Por design.)
- **Alertas** podem monitorar `d_g_margins` ou `price_bands`. Verifique antes de remover/renomear coluna.
