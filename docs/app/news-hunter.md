# Sub-PRD — `/news-hunter`

Dashboard de News Hunter (radar de notícias). Owner: [`worker_dash-news-hunter`](../../.claude/agents/worker_dash-news-hunter.md).

> Único dashboard que **coordena com um repo externo** ([`IBBAOG/news-hunter-scanner`](https://github.com/IBBAOG/news-hunter-scanner)).

## Escopo de código

```
src/app/(dashboard)/news-hunter/
  page.tsx
  page.module.css                   Estilos scoped (não polui globals.css)
```

RPC wrapper: seção "news_hunter" em [`src/lib/rpc.ts`](../../src/lib/rpc.ts).

## Produto

Lista de **notícias** publicadas que matchearam keywords salvas pelo user. Atualização em tempo (quase) real via polling. Funcionalidades:
- Visualização cronológica (`found_at` / `published_at`).
- Filtros por keyword, domínio, fonte.
- Gestão de keywords (adicionar / remover).
- Snapshot/excerpt de cada artigo + link pra fonte.

## Arquitetura cross-repo

```
+----------------------------+   service_key   +-----------------+   anon+RLS    +--------------+
| GitHub Actions             |  --- push --->  | Supabase        | <--- read --- | Vercel       |
| IBBAOG/news-hunter-        |                 | news_articles   |               | /news-hunter |
|   scanner                  |                 | news_hunter_    |               | poll 60s     |
| cron-job.org → ~5min       |                 |   keywords      |               | filter local |
| workflow_dispatch          |                 | RLS on          |               |              |
+----------------------------+                 +-----------------+               +--------------+
```

Doc detalhado: [`docs/etl-pipelines/news-hunter-architecture.md`](../etl-pipelines/news-hunter-architecture.md).

### Componentes do sistema

1. **Scanner** (repo separado, não acessível a partir daqui):
   - Roda via cron-job.org cada ~5min.
   - `python news_hunter_service.py --once`.
   - Lê keywords da UNION dedupada de `news_hunter_keywords`.
   - Fallback: `DEFAULT_KEYWORDS` local quando tabela vazia ou Supabase off.
   - Escreve em `news_articles`.

2. **Frontend** (este dashboard):
   - Polling cada 60s no `news_articles`.
   - Filtro incremental por `found_at > <last_seen>` (watermark).
   - Filtros adicionais (keyword, domínio) rodam no cliente.
   - Gestão de keywords via UI.

## RPCs

| RPC | Função |
|---|---|
| `seed_my_news_hunter_keywords` | Popula keywords default pro user logado (chamada no first-login pelo `worker_dash-admin`) |

## Tabelas

### `news_articles`
- PK: `url`
- Colunas: `domain, source_name, title, snippet, published_at, found_at, matched_keywords text[]`
- **Populada apenas pelo scanner externo** (service key).
- **RLS:** read-only para authenticated.

### `news_hunter_keywords`
- PK: `(user_id, keyword)`
- Colunas: `created_at`
- **RLS:** cada user gerencia só as próprias.
- Scanner lê **UNION dedupada de TODOS os users** (cross-user implícito por design — keywords não são private).

## Polling padrão

```ts
// Cada 60s
const last = state.maxFoundAt;
const novas = await getNewsArticles({ found_at_gt: last });
state.merge(novas);
```

Nunca baixe a tabela inteira. Sempre incremental.

## Dependências cross-dept

| Origem | Como depende |
|---|---|
| News Hunter scanner (repo separado) | Popula `news_articles` |
| ETL (responsabilidade indireta) | Documenta o scanner em `docs/etl-pipelines/news-hunter-architecture.md` |
| Subgerente APP | Schema de `news_articles` e `news_hunter_keywords` |
| dash-admin | Chama `seed_my_news_hunter_keywords` no first-login |
| Designer | UI de keyword management, listagem |

## Estilos

`page.module.css` (CSS Module) — único módulo do app que usa esse padrão. **Não polua `globals.css`**.

## Mudanças que cruzam fronteira (cuidado especial)

### Schema de `news_articles`
- Mudança quebra o scanner (que escreve com schema antigo).
- **Sequência obrigatória**: (1) coordenar com `worker_etl-pipelines` quem mantém doc do scanner, (2) atualizar repo `news-hunter-scanner` PRIMEIRO, (3) deploy do scanner, (4) só então criar migration aqui.

### Schema de `news_hunter_keywords`
- Mesma lógica.

### Mudança visual
- Consulte `worker_designer`.

## Anti-padrões

- Polling sem watermark (vai matar o Supabase).
- Disparar o scanner do frontend (você só lê).
- Mexer no repo `news-hunter-scanner` daqui.
- Misturar estilos no `globals.css` em vez do `page.module.css`.
- Mostrar keywords cross-user (quebra o conceito de RLS).
