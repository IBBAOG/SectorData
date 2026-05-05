# Boas Práticas de Design e UX — dashboard_projeto

Princípios e patterns. Para tokens (cores, fontes, sizes), ver [`identity.md`](identity.md).

## Princípios gerais

1. **Reutilize antes de criar.** Antes de inventar componente novo, busque em `src/components/` e em `globals.css`. Mais provável que já exista.
2. **Bootstrap é a base.** Override seletivamente no `globals.css`. Não substitua a stack inteira.
3. **Tema único** (laranja/branco/preto) em todos os módulos exceto Stocks. Stocks tem tema próprio (Bloomberg-like) — propositalmente isolado.
4. **Idioma da UI:** português. Inglês só em código fonte (variáveis, funções).
5. **Sem dark mode global.** Light é padrão. Stocks tem `dark/light` interno.

## Padrões de componente

### Filtros (sidebar)

- **Cascata Região → UF**: usar `RegionStateFilter` (já existe).
- **Multi-select com busca**: `SearchableMultiSelect`.
- **Multi-select simples com Select All / Clear**: `CheckList`.
- **Range de datas**: `PeriodSlider` (rc-slider customizado, accent `#ff5000`).
- **Chips pill** quando lista de opções é curta (≤5–6): `.filter-chip`.

Layout padrão da sidebar:
- Header: `.sidebar-section-label` (15px, 700, border-bottom laranja)
- Sub-seções: `.sidebar-filter-section` (padding vertical, border-bottom claro entre)
- Cada label: `.sidebar-filter-label` (11px, 600, cinza)

### Botões

- **Ação principal** ("Aplicar"): `.btn-apply` (laranja, full width).
- **Ação secundária** ("Limpar"): `.btn-clear`.
- **Inline links** ("Selecionar tudo", "Limpar"): `.filter-btn-link--primary/--secondary`.
- **Ícone-only**: padrão profile (`.profile-name-edit-icon-btn`) — sem fundo, hover laranja com bg sutil.

### Cards

- **Métrica simples**: `.metric-card` (border-left laranja 4px, valor 22px 700).
- **Card de configuração**: `.settings-card` (16px radius, sombra suave).
- **Modal frosted**: padrão liquid glass (ver `identity.md`).

### Gráficos (Plotly)

- **Sempre** via wrapper `PlotlyChart` (não importe `react-plotly.js` direto).
- Tooltip já estilizado globalmente (drop-shadow + rounded). Não override.
- Crosshair preto (svg url). Não troque.
- Cores de série: laranja primário + variações neutras + verde/vermelho só pra Stocks (alta/baixa).

### Tabelas

- **Header**: `.sd-table th` style (12px 600 uppercase letter-spacing 0.5px) — copiar fora de Stocks só se fizer sentido visual; a maioria das tabelas usa Bootstrap padrão.
- **Hover**: bg muito sutil (#f9f9f9 light, ou 5% laranja).
- **Selected row**: border-left laranja 2px (padrão Stocks).

## Responsividade

### Regras gerais

1. **Mobile-first nunca foi feito** aqui — projeto começou desktop. Mas há media queries pra <768px e <1100px.
2. **Sidebar**: sticky em desktop, stacks acima do conteúdo em <768px.
3. **NavBar**: 3-col grid em desktop, 3-col com hamburger em mobile.
4. **Tabelas**: scroll horizontal em mobile (`#page-content overflow-x: auto`).
5. **Plotly**: `useResizeObserver`/auto-resize já configurado no wrapper.

### Breakpoints decoreba

| px | Comportamento principal |
|---|---|
| 1920 | Navios passa de 3-col → 2-col |
| 1400 | NavBar começa a contrair |
| 1200 | Page-content e sidebar contraem padding |
| 1100 | NavBar esconde label do user |
| 992 | NavBar dropdown vira accordion mobile |
| 768 | Sidebar destaca-se, NavBar vira mobile, navios 1-col |

### O que evitar

- Hard-codar `width: 800px` em componente. Use `max-width` + `width: 100%`.
- `position: fixed` sem fallback para mobile.
- Texto pequeno demais (<11px) — perde acessibilidade.

## Acessibilidade (mínimo viável)

1. **Contraste**: laranja `#ff5000` contra branco passa AA pra texto grande, falha pra texto pequeno (4.5:1 não atinge). Use `#1a1a1a` como cor de texto principal, laranja como **accent**.
2. **Focus visível**: inputs já têm `box-shadow: 0 0 0 3px rgba(255, 80, 0, 0.10)`. Não remova.
3. **Labels**: forms sempre com `<label>` linkado (não placeholder-only).
4. **Roles**: botões `<button>`, links `<a>`. Não usar `<div onClick>`.
5. **Teclado**: dropdowns custom devem responder a Esc para fechar.

## Performance visual

1. **Plotly** é pesado. Use `mv_ms_serie_fast` (materialized view) em vez de queries grandes em `vendas`. Lazy-load gráficos secundários.
2. **`backdrop-filter`** custa. Use só em login, profile, modal — não em mil cards.
3. **`box-shadow` empilhada** (liquid glass) — máximo em hero elements (login, modal). Em cards normais use sombra simples.
4. **Animações**: 0.12–0.22s. Nunca >0.5s pra interação. Stocks tem 1.2s pra price-flash (intencional).
5. **Re-renders Plotly**: caro. `React.memo` no chart wrapper, props estáveis.

## Texto da UI

- **Títulos**: substantivo curto. "Filtros", "Agentes", "Período".
- **Botões**: verbo imperativo. "Aplicar", "Limpar", "Salvar".
- **Erros**: específico e acionável. "Email inválido" > "Erro".
- **Datas**: padrão `DD/MM/YYYY` (Brasil).
- **Números**: separador de milhar `.`, decimal `,`. Use `Intl.NumberFormat('pt-BR')`.
- **Moeda**: `R$ X.XXX,XX`.
- **Percentual**: `XX,X%` (1 casa decimal por padrão).

## Padrões de interação

### Dropdowns

- Animação de entrada (`navDropdownIn` ou `dropdown-in`).
- Fecha ao: clicar fora, pressionar Esc, selecionar item.
- Em mobile, vira inline (sem dropdown flutuante).

### Modais

- Overlay escuro com `backdrop-filter: blur(6px)`. Ver `.first-login-overlay`.
- Modal centralizado, rounded 20–24px.
- Botão de fechar (`btn-close`) à direita do header.

### Toasts

- Posição: `bottom: 20px; right: 20px;` (`#toast-filters`).
- Auto-dismiss 3–5s. Permita override via close button.

### Loading states

- Spinner Bootstrap (`spinner-border`) — Stocks mantém circular mesmo com border-radius 0.
- Skeleton screens: ainda não usados; quando introduzir, padronize.

## Identidade Stocks (Market Watch) — exceções intencionais

1. Tudo `font-size: 11px !important; text-transform: uppercase !important; border-radius: 0 !important;`.
2. Background quase preto: `#030814`.
3. Animações Bloomberg-style (price flash, row blink).
4. Drag & drop via `react-grid-layout` com handle `.sd-drag-handle`.
5. Auto-hide navbar em modo full-screen.

**Não** misture esse tema em outros dashboards. Mantém scoped via `.stocks-dark` / `.stocks-light`.

## Ao adicionar dashboard novo

1. Use componentes/classes existentes — abrir `globals.css` antes de criar nada.
2. Plotly via `PlotlyChart`.
3. Filtros via `PeriodSlider`, `CheckList`, `SearchableMultiSelect`, `RegionStateFilter`.
4. Botões `.btn-apply` / `.btn-clear`.
5. Cabeçalho de página: `.page-header-title` + `.page-header-sub`.
6. Sidebar (se houver): padrão `sidebar-section-label` + sections.
7. **Não escreva CSS scoped sem necessidade** — primeiro tente classes globais. Se realmente precisar, use CSS Module (`page.module.css`) como `news-hunter` faz.
8. **Cores**: só use a paleta. Sem laranja diferente, sem novas cores.

## Quando consultar o Designer

- Componente visual novo (antes de codar).
- Mudança em `globals.css`.
- Mudança em `src/components/<compartilhado>` (PlotlyChart, NavBar, sidebar widgets).
- Adição de imagem/asset em `public/`.
- Mudança em fluxo de interação (modal, dropdown, animação).

## Quando NÃO precisa consultar

- Refatoração interna que não muda visual.
- Bug fix em lógica.
- Adicionar handler de evento, hook, RPC.
