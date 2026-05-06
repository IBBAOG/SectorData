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

## Contratos com outros departamentos

- **APP** é dono do schema das tabelas-alvo. Mudança de schema vai via APP. Você só consome.
- **ETL** não toca em `data/` nem nos scripts de upload manual. (Por design.)
- **Alertas** podem monitorar `d_g_margins` ou `price_bands`. Verifique antes de remover/renomear coluna.
