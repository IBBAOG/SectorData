# PRD — Departamento Dados Locais

Dados que o CEO mantém **manualmente** em arquivos Excel/CSV no disco, e os scripts que sobem esses dados para o Supabase. Workflow é **humano-no-loop** (não automatizado por scrape).

## Escopo

```
data/
  d_g_margins.xlsx              Margens diesel/gasolina (atualização semanal)
  d_g_margins_backup.xlsx       Backup anterior do d_g_margins
  price_bands.xlsx              Bandas de preço (paridade import/export, Petrobras)
  Liquidos_Vendas_Atual.csv     Vendas líquidos (snapshot)

scripts/manual/dg_margins_upload.py    Upload de d_g_margins → Supabase
scripts/manual/price_bands_upload.py   Upload de price_bands → Supabase
```

## Tabelas-alvo no Supabase

Schema é dono do APP. Aqui só listamos o contrato esperado.

| Arquivo | Tabela | Chave de upsert |
|---|---|---|
| `data/d_g_margins.xlsx` | `d_g_margins` | `(fuel_type, week)` |
| `data/price_bands.xlsx` | `price_bands` | `(date, product)` |
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
