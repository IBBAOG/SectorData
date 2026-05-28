# Identidade Visual — dashboard_projeto

Tokens, componentes e padrões. Fonte da verdade derivada do código real (`src/app/globals.css`).

## Paleta

### Cor primária

| Token | Hex | Uso |
|---|---|---|
| **Laranja primário** | `#ff5000` | Botões primários, foco, accent, links ativos, sidebar accent, slider, badges Admin |
| Laranja hover (escuro) | `#d4561a` | `.btn-apply:hover`, `.rc-slider-handle:hover` |
| Laranja hover (alt) | `#cc3d00` | `.btn-login:hover`, `nav-module-item:hover` color, `profile-name-edit-btn:hover` |
| Laranja background suave | `rgba(255, 80, 0, 0.07)` | hover de items de dropdown |
| Laranja background sutil | `rgba(255, 80, 0, 0.05)` | hover de view-mode-btn |
| Laranja foco shadow | `rgba(255, 80, 0, 0.12)`–`0.15` | `box-shadow` de inputs em foco |

### Neutros

| Token | Hex | Uso |
|---|---|---|
| Branco | `#ffffff` | Background base do app |
| Texto primário | `#1a1a1a` | Headers, body principal |
| Texto secundário | `#555555` | Labels secundárias, sidebar filter labels |
| Texto terciário | `#888888` | Section dividers, metric labels, timestamps |
| Texto desabilitado | `#aaaaaa` | Inputs disabled, ícones inativos |
| Border padrão | `#e0e0e0` | Borda de cards, accordion |
| Border médio | `#d0d0d0` | Inputs, dropdowns |
| Border claro | `#f0f0f0` | Separadores internos |
| Background frio | `#f5f5f5` | Stocks-light bg, sidebar accordion background |

### NavBar (alto contraste)

| Token | Hex | Uso |
|---|---|---|
| Background NavBar | `#000512` | Background principal da `#main-navbar` |
| Border accent NavBar | `#ff5000` | Borda inferior 3px da NavBar |
| Texto NavBar | `rgba(255, 255, 255, 0.85)` | Itens default |
| Texto NavBar hover | `#ffffff` | Item ativo / hover |

### Estados (alerts)

| Token | Hex | Uso |
|---|---|---|
| Sucesso | `#0f7a4d` (texto), `rgba(25, 135, 84, 0.12)` (bg) | `.alert-success` |
| Erro | `#a8232f` (texto), `rgba(220, 53, 69, 0.12)` (bg) | `.alert-danger` |
| Erro inline | `#c0392b` | `.profile-edit-error`, `.profile-name-edit-error` |
| Tick salvo | `#22aa55` | `.settings-saved-tick` |

### Paleta multi-série (Plotly)

Paleta canônica para gráficos com múltiplas séries (stacked area, multi-line, bar charts, dots em tabelas). Fonte da verdade: `PALETTE` em [`src/lib/plotlyDefaults.ts`](../../src/lib/plotlyDefaults.ts).

Spec definido pelo CTO em 2026-05-27, atualizado em 2026-05-28 (audit "sem branco em gráficos"): **14 cores em 2 tiers** — 3 *highlight* consumidos primeiro, 11 *fallback* quando o tier de destaque se esgota. Os consumers indexam posicionalmente via `PALETTE[i % PALETTE.length]`.

#### Highlight tier (posições 1-3)

Cores de destaque — atribuídas primeiro às séries que devem chamar atenção. A **posição 1 é o laranja de marca**: é entregue à primeira série (leader) de cada gráfico que rotaciona pela paleta. Em práticas onde a "primeira série" não é semanticamente o destaque (ex: stacked area por país com ordem fixa), use os canonical maps abaixo em vez da rotação ordinal.

| Pos | Hex | Papel típico |
|---|---|---|
| 1 | `#FF5000` | Primary highlight — laranja de marca (`BRAND_ORANGE`) — leader/topo |
| 2 | `#FFAE66` | Secondary highlight (peach) |
| 3 | `#000512` | Tertiary highlight (near-black com nuance navy) |

#### Fallback tier (posições 4-14)

Usadas apenas quando o highlight tier se esgota (≥4 séries simultâneas). Todas as posições problemáticas (branco, near-yellow, near-white grey) foram removidas no audit de 2026-05-28.

| Pos | Hex | Cor |
|---|---|---|
| 4 | `#0EA5E9` | Sky blue *(substituiu `#FFFFFF` branco)* |
| 5 | `#000000` | Preto |
| 6 | `#1D4080` | Navy |
| 7 | `#73C6A1` | Mint |
| 8 | `#8258A0` | Purple |
| 9 | `#0F766E` | Teal *(substituiu `#D2FF00` lime — quase-amarelo ilegível)* |
| 10 | `#7030A0` | Deep purple |
| 11 | `#D97706` | Amber *(substituiu `#FFFF99` amarelo claro)* |
| 12 | `#52525B` | Slate *(substituiu `#F2F2F2` near-white)* |
| 13 | `#BE185D` | Magenta *(substituiu `#D8D8D8` light grey)* |
| 14 | `#7F7F7F` | Mid grey |

#### Regras

1. **Sempre importe de `PALETTE`** — nunca hard-code hex de gráfico em componente.
2. **Não reordene** — a ordem é semântica (pos 1-3 = highlight; pos 4-14 = fallback).
3. **`BRAND_ORANGE` (`#FF5000`)** é a cor primária canônica da identidade (botões, links, accents UI). Como cor de **série de gráfico**, só aparece via `PALETTE[0]` (leader rotacional — primeira série do chart) ou via padrão `leader = BRAND_ORANGE` (BSW, anp-cdp-diaria). **Nunca é usado para "fixar" uma entidade recorrente** (Diesel, Estados Unidos, Big-3, etc) — use os canonical maps abaixo.
4. **Não use branco** em traces, markers, fillcolor ou line.color. White paper/plot bg está OK (padrão Plotly); white text em barra escura também (legibilidade).
5. **Não invente cor nova** para gráfico — se precisar de mais de 14 séries, agrupe em "Outros" ou passe pelo CTO.

### Canonical chart colors — mapeamentos fixos por entidade

Tabelas pinadas em `src/lib/plotlyDefaults.ts`. **Use estas constantes em vez de `PALETTE` rotation quando a entidade existe em mais de um dashboard** — garante que a mesma entidade tem a mesma cor em todas as views.

#### `PRODUCT_COLORS`

| Produto | Hex | Aliases aceitos |
|---|---|---|
| Diesel | `#1D4080` (navy) | Diesel B, Diesel S10 |
| Gasoline | `#0F766E` (teal) | Gasoline C, Gasolina C |
| Crude Oil | `#1f2937` (dark slate) | — |
| Ethanol | `#73C6A1` (mint) | Etanol Hidratado, Hydrous Ethanol, An. Ethanol |
| Biodiesel | `#0EA5E9` (sky blue) | — |
| LPG | `#8258A0` (purple) | GLP |
| Otto-Cycle | `#A16207` (bronze) | — |

Brand orange é reservada para "highlight" — não aparece como cor de produto.

#### `COUNTRY_COLORS` (origens + destinos em `/imports-exports`)

| País | Hex | Note |
|---|---|---|
| Russia | `#000000` | preto |
| United States | `#1D4080` | navy (era `#FF5000` brand orange — flagged no audit 2026-05-28) |
| UAE | `#73C6A1` | mint (afinidade com verde emiradense) |
| Netherlands | `#FFAE66` | peach (próximo do laranja holandês, sem colidir com brand) |
| India | `#8258A0` | purple |
| Saudi Arabia | `#0F766E` | teal saturado (era `#D2FF00` near-yellow ilegível) |
| Norway | `#0EA5E9` | sky blue |
| Argentina | `#A16207` | bronze |
| Others | `#7F7F7F` | mid grey neutro |

#### `REGION_COLORS` (Brasil — N / NE / CO / SE / S)

| Região | Hex | Aliases |
|---|---|---|
| N (Norte) | `#0F766E` | NORTE |
| NE (Nordeste) | `#FFAE66` | NORDESTE |
| CO (Centro-Oeste) | `#A16207` | CENTRO-OESTE |
| SE (Sudeste) | `#1D4080` | SUDESTE |
| S (Sul) | `#8258A0` | SUL |

#### `SEGMENT_COLORS` (cadeia de suprimentos / segmento de venda)

| Segmento | Hex | Note |
|---|---|---|
| Producer | `#1D4080` | navy — wholesale (refinaria / importador) |
| Refinery | `#1D4080` | alias |
| Distribution | `#0F766E` | teal — B2B (canonical) |
| Retail | `#73C6A1` | mint — bomba |
| TRR | `#A16207` | bronze — Transporte Revendedor Retalhista |
| Importer | `#8258A0` | purple |
| Total | `#000512` | near-black — agregado |

> Dashboards que já tinham mapeamento próprio (ex: `/anp-prices` mantém Producer=navy / Distribution=bronze / Retail=teal para distinguir B2B de Retail num gráfico com os 3 simultaneamente; `/diesel-gasoline-margins` mantém o stack com 5 cores fixas) mantêm essas tabelas locais — mas devem se alinhar com a paleta canônica quando possível.

#### Quando NÃO usar o canonical map

- Dashboards com 1 produto fixo (filter implícito) onde a série representa **role** (Import Parity / Export Parity / Petrobras / Reference) — use cores semânticas locais (ver `price-bands.ts` e `subsidy-tracker.ts`).
- Tabela locais como `STACK_COLORS` em `/diesel-gasoline-margins` (componentes da composição do preço, não-aplicável a "produto" como entidade).
- Brand-coloring de empresas reais (ex: Vibra `#f26522`, Ipiranga `#73C6A1`) onde a marca define a cor — manter como está.

### Stocks (tema isolado — flat trading terminal)

> **Aviso**: tema propositalmente distinto. Não use fora do `/stocks`.

| Token | Hex | Uso |
|---|---|---|
| Background dark | `#030814` (`.stocks-dark`) | Body do Market Watch |
| Card dark | `#070d1c` | Cards |
| Border dark | `#131a2e` / `#161d33` | Borders |
| Hover row dark | `#0a1124` | Tabela hover |
| Verde (alta) | `#3fb950` | `.sd-green`, `stock-blink-up`, `price-flash-up` |
| Vermelho (baixa) | `#f85149` | `.sd-red`, `stock-blink-down`, `price-flash-down` |
| Muted dark | `#8b949e` | `.sd-muted` |
| Texto dark | `#e6edf3` | Body |
| (Light) Verde | `#16a34a` | `.stocks-light .sd-green` |
| (Light) Vermelho | `#dc2626` | `.stocks-light .sd-red` |

## Tipografia

**Família única:** `Arial, Helvetica, sans-serif`.

| Contexto | Tamanho | Peso |
|---|---|---|
| Section title | 18px | 600 |
| Page header (`.page-header-title`) | 1.5rem (~24px) | 600 |
| Page header sub | 0.85rem (~13.6px) | 400 |
| Body / form-control | 13–14px | 400 |
| Form label | 13px | 600 |
| Sidebar accordion | 13px | 600 |
| Sidebar section label | 15px | 700 |
| Sidebar filter label | 11px | 600 |
| Filter chip | 11px | 500 (active 600) |
| View-mode tab | 12px | 400 (active 700) |
| Filter btn link | 11px | 600 |
| Metric value | 22px | 700 |
| Metric label | 12px | 400 |
| Profile info label | 12px | 600 (uppercase, letter-spacing 0.06em) |
| Profile info value | 14px | 400 |
| First-login modal title | 1.35rem (~21.6px) | 700 |
| Role badge | 11px | 600 (uppercase, letter-spacing 0.04em) |
| **Stocks (Market Watch)** | **11px** | uniform via `!important` |

## Border radius (escala)

| Tamanho | Uso |
|---|---|
| 0 | Stocks (zerado via `!important`) |
| 3px | Slider tooltip |
| 4px | View-mode tab top |
| 6px | Botões padrão, accordion items, dropdown trigger, sidebar items |
| 7–8px | Inputs pequenos, edit buttons, dropdown panel |
| 10px | Inputs principais, navbar dropdown, alerts |
| 12px | Login form-control, alerts, role badge bg pill |
| 14px | Login button |
| 16px | Settings card |
| 20px | First-login modal, profile-info pill chips |
| 24px | Stocks modal glass |
| 28px | Login card, profile card |

## Sombras

### Sombra suave (cards)

```css
box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);    /* metric card, sd-card light */
box-shadow: 0 2px 12px rgba(0, 0, 0, 0.05);   /* settings card */
```

### Sombra dropdown

```css
box-shadow: 0 4px 12px rgba(0, 0, 0, 0.10);                              /* dropdown-panel */
box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);                              /* navbar dropdown */
box-shadow: 0 8px 32px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.07);     /* user dropdown */
```

### Liquid Glass (cards/modais frosted)

```css
/* Login card / Profile card */
backdrop-filter: blur(60px) saturate(180%) brightness(1.05);
-webkit-backdrop-filter: blur(60px) saturate(180%) brightness(1.05);
border: 2px solid rgba(255, 255, 255, 0.7);
box-shadow:
  0 0 0 1px rgba(255, 255, 255, 0.3),
  0 0 20px rgba(255, 255, 255, 0.15),
  0 16px 48px rgba(0, 0, 0, 0.20),
  0 4px 12px rgba(0, 0, 0, 0.08),
  inset 0 2px 0 rgba(255, 255, 255, 0.9),
  inset 0 -2px 0 rgba(255, 255, 255, 0.3),
  inset 2px 0 0 rgba(255, 255, 255, 0.4),
  inset -2px 0 0 rgba(255, 255, 255, 0.4),
  inset 0 0 30px rgba(255, 255, 255, 0.25);
background: linear-gradient(
  145deg,
  rgba(255, 255, 255, 0.92) 0%,
  rgba(248, 248, 252, 0.86) 40%,
  rgba(245, 245, 250, 0.90) 100%
);
```

Use `.profile-card`, `#login-card`, ou `.stocks-light .sd-modal-glass` como referência. **Não simplifique** sombras de liquid glass — a profundidade vem das múltiplas camadas.

## Componentes nomeados (já existem — reutilize)

### Cards e seções

| Classe | Função |
|---|---|
| `.metric-card` | Card de métrica (border-left laranja 4px) |
| `.metric-label`, `.metric-value` | Conteúdo do metric-card |
| `.chart-container` | Container de gráfico Plotly |
| `.section-title` | Título de seção (laranja 18px 600) |
| `.section-hr` | Separador (border-top cinza 2px) |
| `.page-header-title`, `.page-header-sub` | Cabeçalho de página |
| `.sidebar-section-label` | Label de seção na sidebar (border-bottom laranja) |
| `.sidebar-filter-section`, `.sidebar-filter-label` | Subdivisões da sidebar |

### Botões

| Classe | Função |
|---|---|
| `.btn-apply` | Primário (laranja, full width) |
| `.btn-clear` | Secundário (border cinza) |
| `#btn-login` | Login (rounded 14px, sombra laranja) |
| `.btn-hover-transition` | Helper de transition |
| `.profile-save-btn`, `.profile-name-edit-btn--save` | Save (laranja) |
| `.profile-name-edit-btn--cancel` | Cancel (cinza) |
| `.filter-btn-link--primary/--secondary` | Botões inline (laranja / cinza) |

### Filtros

| Classe | Função |
|---|---|
| `.filter-chip` | Chip pill (border cinza, hover laranja) |
| `.filter-chip--active` | Chip selecionado (bg laranja, texto branco) |
| `.filter-chip-group` | Container de chips (flex wrap) |
| `.filter-chip-actions` | Linha "All / Clear" |
| `.filter-checkbox` | Checkbox custom com accent laranja |
| `.view-mode-tabs`, `.view-mode-btn`, `.view-mode-btn--active` | Abas de modo (border-bottom laranja em ativo) |
| `.dropdown-trigger`, `.dropdown-panel`, `.dropdown-search` | Dropdown custom |

### Form controls

| Classe | Função |
|---|---|
| `.profile-edit-input`, `.profile-name-edit-input` | Input padrão (border 1.5px cinza → laranja em foco) |
| `#login-card .form-control` | Input glass (background semi-transparente) |
| `input[type="checkbox"], input[type="radio"]` | Accent laranja global |
| `.form-check-input:checked` | Toggle Bootstrap (override pra laranja) |

### Avatar e role

| Classe | Função |
|---|---|
| `.nav-avatar-circle` | Avatar 32px na NavBar (laranja, iniciais brancas) |
| `.profile-avatar-circle` | Avatar 72px na page de perfil |
| `.role-badge`, `.role-badge--admin`, `.role-badge--client` | Badge de role |

### NavBar

| Classe | Função |
|---|---|
| `#main-navbar` | NavBar principal (3-col grid: logo / nav / avatar) |
| `.nav-module`, `.nav-module-trigger`, `.nav-module-dropdown`, `.nav-module-item` | Dropdown de módulos |
| `.nav-user-dropdown`, `.nav-user-dropdown-item`, `.nav-user-dropdown-signout` | Dropdown do user |
| `.nav-hamburger-btn`, `.nav-hamburger-icon` | Mobile menu toggle |
| `.nav-username-label` | Nome do user na NavBar (escondido em <1100px) |
| `.navbar-autohide`, `.navbar-autohide--visible` | Modo auto-hide (Market Watch fullscreen) |

### Tooltip Plotly (já estilizado)

```css
.hoverlayer .hovertext {
  filter: drop-shadow(0 4px 16px rgba(0, 0, 0, 0.12))
          drop-shadow(0 1px 4px rgba(0, 0, 0, 0.06));
}
.hoverlayer .hovertext rect { rx: 8px; ry: 8px; }
```

### Crosshair customizado (Plotly)

```css
.js-plotly-plot .plotly .cursor-crosshair {
  cursor: url("data:image/svg+xml,...") 12 12, crosshair !important;
}
```

## Padrões de animação

| Animação | Onde | Duração |
|---|---|---|
| `navDropdownIn` | NavBar dropdowns | 0.18–0.20s ease-out |
| `dropdown-in` | Dropdown panel genérico | 0.12s ease-out |
| `fadeInTick` | Settings saved indicator | 0.2s ease-out |
| `stock-blink-up/down` | Linha da tabela Stocks | 0.4s × 3 |
| `price-flash-up/down` | Texto de preço Stocks | 1.2s ease-out |

## Responsividade

Breakpoints usados (alinhados com Bootstrap 5.3):

| Limite | Comportamento |
|---|---|
| `< 1919.98px` | Navios-diesel grid: 3-col → 2-col |
| `< 1400px` | NavBar padding reduz (40px → 24px) |
| `< 1199.98px` | Sidebar padding reduz, page-content padding reduz |
| `< 1100px` | NavBar gap reduz, esconde `nav-username-label` |
| `< 991.98px` | NavBar dropdown vira static (mobile-first item) |
| `< 900px` | NavBar nav-link 12.5px |
| `< 767.98px` | Sidebar não-sticky, NavBar 3-col com hamburger, navios-diesel 1-col |
| `< 1200px` (page) | page-content padding 12px 16px |

## Logo usage

A marca da plataforma é **Oil & Gas Data House** (gota preta sobre quadrado laranja, título em laranja sobre branco).

- **Assets (2 variantes do mesmo logo):**
  - [`public/logo.png`](../../public/logo.png) — versão laranja (gota preta + título laranja sobre fundo branco). PNG fornecido pelo cliente, 1243×392, ratio 3.17:1, ~32KB. Uso em **fundos claros**: cards de auth e topo da sidebar.
  - [`public/logo-navbar.png`](../../public/logo-navbar.png) — versão branca (laranja recolorido para branco puro, fundo branco original convertido para transparente; gota preta preservada). Uso na **NavBar com fundo navy `#000512`**, onde o laranja sumiria. Gerada por [`scripts/utils/generate_navbar_logo.py`](../../scripts/utils/generate_navbar_logo.py) — regenerar com `python scripts/utils/generate_navbar_logo.py` sempre que `logo.png` for substituído.
- **Componente único:** [`src/components/BrandLogo.tsx`](../../src/components/BrandLogo.tsx) — wrapper sobre `next/image` com 3 variantes (cada uma já mapeia para o asset correto):
  - `variant="navbar"` → `/logo-navbar.png` 114×36 (canto superior esquerdo da NavBar, `priority`)
  - `variant="auth"` → `/logo.png` 203×64 (cards de login / forgot-password / reset-password, `priority`)
  - `variant="sidebar"` → `/logo.png` 286×90 (topo das sidebars de todos os dashboards, lazy)
- **Como rebrandear no futuro:** (1) substituir `public/logo.png` pela nova arte, (2) rodar `python scripts/utils/generate_navbar_logo.py` para regenerar a variante branca, (3) se a proporção mudar, ajustar `VARIANTS` em `BrandLogo.tsx` (manter `height: h, width: "auto"` no inline style para que o `object-fit: contain` funcione em containers menores).
- **Nunca** copie o markup do `<BrandLogo>` em outro componente — sempre importe `BrandLogo` para que uma futura troca de marca seja **uma única edição**.
- O arquivo legado `public/logo.webp` ainda existe mas não é consumido por código atual.

## Pontos de drift conhecidos

- `Liquidos_Vendas_Atual.csv` no `data/` sem dashboard claro consumindo (verificar se está em uso).
- `barrel_loading.png` e `ship_orange.png` em `public/` são assets temáticos — verificar onde são exibidos antes de mudar.

## Como adicionar token novo

1. Adicione na seção apropriada acima.
2. Use a CSS var ou hex direto no `globals.css` (atualmente o projeto não usa CSS vars — todos os hex são inline; mantenha consistente, mas pode ser convertido para `:root { --primary: #ff5000; }` num refactor futuro).
3. **Não invente cor sem justificar** — passe pelo CTO se for nova variante.

## Mobile design system (v2 — 2026-05-27, light-only)

Sistema visual paralelo para a view mobile (`mobile/View.tsx` em cada dashboard). **Não substitui** a identidade desktop — adiciona uma camada de tokens `--mobile-*` ativada quando `[data-viewport="mobile"]` (set pelo PWA shell) ou via `@media (max-width: 768px)` (first paint).

> **Reforma mobile v2 (2026-05-27).** A Fase 1 (mockup-driven, 2026-05) foi superada pela reforma "Liquid Glass refined". As mudanças centrais:
> - **Light-only.** Os blocos `[data-theme="dark"]` do escopo mobile foram **removidos** de `globals.css`. Dark mode permanece no desktop (não-mobile). Plano: [`o-modo-mobile-da-tranquil-giraffe.md`](.claude/plans/o-modo-mobile-da-tranquil-giraffe.md) § 3.2.
> - **Liquid Glass refinado.** Blur 18px, border `rgba(255,255,255,0.55)` (shine edge), shadow multi-camada com inset highlight. Novo token `--mobile-glass-shine-gradient` para sheen opcional em pills/hero.
> - **Single Home pill flutuante** substitui o `MobileBottomTabBar` (4 ícones). Detalhes em `MobileHomePill.tsx`.
> - **Kebab menu (⋮)** no header right-slot expõe Logout. Detalhes em `MobileKebabMenu.tsx`.
> - **Rotas excluídas do mobile** redirecionam para `/home?excluded=<slug>` via `MobileExcludedRedirect.tsx`.

**Fonte da verdade visual:** os 6 mockups em [`mockups/`](../../mockups/) (`stocks-mobile.html`, `home-mobile.html`, `news-hunter-mobile.html`, `market-share-mobile.html`, `navios-diesel-mobile.html`, `anp-cdp-mobile.html`) aprovados em 2026-05-20 + reforma v2 aprovada em 2026-05-27.

### Mobile Liquid Glass — receita canônica

Aplique em qualquer superfície "glass" no mobile (top bar, bottom sheet, floating pill, kebab dropdown, FAB). **Não simplifique** — cada camada tem propósito (profundidade, shine, halo).

```tsx
// Inline JSX style — exemplo do MobileHomePill / superfície glass
background:
  "linear-gradient(180deg, rgba(255,255,255,0.42) 0%, rgba(255,255,255,0) 50%), var(--mobile-glass-bg)",
WebkitBackdropFilter: "var(--mobile-glass-blur)",
backdropFilter: "var(--mobile-glass-blur)",
border: "1px solid var(--mobile-glass-border)",
boxShadow: "var(--mobile-glass-shadow)",
```

Equivalente em CSS:

```css
.surface-glass-mobile {
  background:
    linear-gradient(180deg, rgba(255,255,255,0.42) 0%, rgba(255,255,255,0) 50%),
    var(--mobile-glass-bg);
  backdrop-filter: var(--mobile-glass-blur);
  -webkit-backdrop-filter: var(--mobile-glass-blur);
  border: 1px solid var(--mobile-glass-border);
  box-shadow: var(--mobile-glass-shadow);
}
```

**Componente de referência:** [`src/components/dashboard/mobile/MobileHomePill.tsx`](../../src/components/dashboard/mobile/MobileHomePill.tsx). Use-o como template ao introduzir nova superfície glass — mesma composição (gradient shine + glass-bg base + blur + border + shadow).

**Antipattern:**
- `box-shadow: 0 2px 4px rgba(0,0,0,0.1)` (drop-shadow simples) — não dá a profundidade glass. Use `--mobile-glass-shadow`.
- `border: 1px solid #e6e6ec` — perde o "shine edge". Use `var(--mobile-glass-border)`.
- Dark-mode override para mobile (`[data-theme="dark"]` dentro de `[data-viewport="mobile"]`) — **proibido** post-reform.

### Onde usar

| Componente | Token-set | Notas |
|---|---|---|
| `MobileHomePill` (NEW — Onda 1) | glass-bg + blur + border + shadow + shine-gradient | Fixed bottom-center, z-index 1000, sized 64×56 |
| `MobileKebabMenu` BottomSheet | glass-bg + blur (sheet body usa `--mobile-sheet-bg` opaco) | Sheet inherits BottomSheet padrão |
| `MobileTopBar` (existente) | glass-bg + blur + border + shadow | Sticky top, 56px |
| `MobileBottomTabBar` (legado) | glass-bg + blur + border | Sendo descomissionado — substituído pelo MobileHomePill |
| Card hero / FAB | glass-bg + blur + shadow | Use shine-gradient se houver área >100px de altura |

### Tokens (em `globals.css`)

Bloco demarcado por `/* ===== Mobile design system (v2 — 2026-05-27, light-only) ===== */`. **Light-only**. Para a lista completa abra `globals.css`.

| Categoria | Tokens (light-only) |
|---|---|
| Brand | `--mobile-accent` `#ff5000`, `--mobile-accent-hover` `#d4561a`, `--mobile-accent-soft` `rgba(255,80,0,0.10)`, `--mobile-accent-fill` `rgba(255,80,0,0.08)`, `--mobile-accent-glow` `rgba(255,80,0,0.30)` |
| Backgrounds | `--mobile-bg` `#f5f5f7`, `--mobile-surface` `#ffffff`, `--mobile-surface-elevated` `#fafafc` |
| Text | `--mobile-text` `#1a1a1a`, `--mobile-text-muted` `#6b6b73`, `--mobile-text-faint` `#9a9aa3` |
| Borders | `--mobile-border` `#e6e6ec`, `--mobile-divider` `#f0f0f5`, `--mobile-row-press` `rgba(0,0,0,0.04)` |
| Semantic | `--mobile-up` `#16a34a`, `--mobile-down` `#dc2626` (+ `-soft` variants) |
| Status (navios) | `--mobile-status-{unloading\|anchored\|enroute\|completed}` + `-bg` variants |
| **Liquid Glass v2** | `--mobile-glass-bg` `rgba(255,255,255,0.72)`, `--mobile-glass-border` `rgba(255,255,255,0.55)` *(color, compose com `1px solid`)*, `--mobile-glass-blur` `blur(18px) saturate(180%)`, `--mobile-glass-shadow` multi-camada com inset highlight, `--mobile-glass-shine-gradient` linear-gradient top-to-mid white→transparent |
| Safe area | `--mobile-safe-top` `env(safe-area-inset-top)`, `--mobile-safe-bottom`, `--mobile-safe-left`, `--mobile-safe-right` |
| Heights | `--mobile-topbar-h` `56px`, `--mobile-tabbar-h` `64px` |
| Radii | `--mobile-radius-sm` `8px`, `-md` `12px`, `-lg` `14px`, `-xl` `20px`, `-full` `999px` |
| Shadows | `--mobile-shadow-soft`, `--mobile-shadow-strong`, `--mobile-shadow-fab` |
| Sheet | `--mobile-sheet-bg` `#ffffff`, `--mobile-sheet-handle` `#d1d1d8`, `--mobile-scrim` `rgba(0,0,0,0.36)` |

### Componentes (em `src/components/dashboard/mobile/`)

Os 8 componentes compartilhados consumidos por todo `mobile/View.tsx`. Barrel em [`src/components/dashboard/mobile/index.ts`](../../src/components/dashboard/mobile/index.ts).

| Componente | Função | Mockup de referência |
|---|---|---|
| `MobileTopBar` (named export de `MobileNavBar`) | Chrome sticky superior (56px liquid glass). `rightSlot` recebe o `MobileKebabMenu` (v2). | `stocks-mobile.html` `.topbar` |
| `MobileBottomTabBar` (legado — em descomissionamento) | Chrome inferior antigo (64px, 4 tabs). **Substituído pelo `MobileHomePill`** na reforma v2. Permanece exportado apenas pra compat até cleanup workers removerem os call-sites. | `stocks-mobile.html` `.tabbar` |
| `MobileHomePill` (NEW — Onda 1) | Single floating Home button, Liquid Glass v2, fixed bottom-center (`bottom: 24px + env(safe-area-inset-bottom)`). Esconde em `/home`. Z-index 1000. | — (novo no plan v2) |
| `MobileKebabMenu` (NEW — Onda 1) | Botão ⋮ no `rightSlot` do `MobileTopBar` abre `BottomSheet` com ações de conta (Logout). Esconde para anon. | — (novo no plan v2) |
| `MobileExcludedRedirect` (NEW — Onda 1) | Side-effect client component. Mount no top de dashboards excluídos do mobile (`/stocks`, `/admin-*`, `/news-hunter`, `/alerts`, `/profile`, `/anp-cdp`, `/anp-prices`, `/anp-glp`). Detecta `useIsMobile()` → `router.replace('/home?excluded=<slug>')` + dispara `CustomEvent('app-toast')`. | — (novo no plan v2 § 5.5) |
| `BottomSheet` | Primitivo slide-up com scrim, handle tap-to-close, body scroll, footer sticky opcional. `height: auto \| 70vh \| 90vh`. | `market-share-mobile.html` `.sheet` |
| `FilterDrawer` | Sheet especializado p/ filtros: header com Reset · Title · Close ×, footer sticky com Reset/Apply. | `market-share-mobile.html` (open state) |
| `MobileChart` | Plotly wrapper mobile: sem modebar, `scrollZoom:false`, `fixedrange:true`, hover `closest`, margins enxutas. Mesmo padrão dynamic-import + tooltip rounded do `PlotlyChart.tsx` desktop. | `stocks-mobile.html` chart, `market-share-mobile.html` hero |
| `MobileDataCard` | Row atômica (~88-96px): leftIcon · title+subtitle · rightSlot + sparkline inline SVG + status pill opcional + variants `default \| compact \| expanded`. | `stocks-mobile.html` `.card`, `home-mobile.html` `.module-card`, `navios-diesel-mobile.html` `.vessel` |
| `StickyBreadcrumb` | Breadcrumb horizontal-scroll com pills, separador `›`, reset `✕` opcional. Sticky por default. | `anp-cdp-mobile.html` `.breadcrumb` |
| `ExportFAB` (em remoção) | Floating action button bottom-right. **Removido em mobile** pela reforma v2 (plan § 3.4 — Export 100% desktop). Permanece exportado até cleanup workers removerem call-sites. | `market-share-mobile.html` `.fab` |
| `MobileTabBar` | Segmented control no topo da página (não confundir com bottom nav). Variants `container` (pill cluster com bg laranja) e `underline` (mínimo, só underline). | `navios-diesel-mobile.html` `.seg`, `anp-cdp-mobile.html` `.product-tab` |
| `MobileHomeIconTile` (NEW — Onda 5, 2026-05-28) | Bento launcher tile: tinted squircle icon badge (44×44, radius 12) + dashboard title (Arial 15/600). 88px tall default / 56px compact (Last-visited row). Liquid Glass v2 layering. Press state: scale 0.97 + orange glow. `excluded` variant dims to opacity 0.82 + "Desktop only" caption. Substitui `MobileHomeCardPill` (deletado). | — (Onda 5 visual refresh) |

### Home icon tiles (Onda 5 — visual refresh, 2026-05-28)

A galeria `/home` mobile usa tiles bento ([`MobileHomeIconTile`](../../src/components/dashboard/mobile/MobileHomeIconTile.tsx)) com **ícone identitário + título**. Cada dashboard recebe seu glyph e cor tint via [`mobileHomeTiles.tsx`](../../src/components/dashboard/mobile/mobileHomeTiles.tsx) — fonte única da verdade pra paleta e mapping.

**Especificações do tile (default variant):**

- **Tamanho:** `min-height: 88px`, full-width do grid 2-col, padding `12px 14px`, gap interno `14px`
- **Icon badge:** 44×44 squircle (radius 12), centered icon child 24-26px, foreground `tintFg` (default `#fff`), bg `tintBg` (per palette), `box-shadow: inset 0 1px 0 rgba(255,255,255,0.18), 0 1px 2px rgba(0,0,0,0.08)`
- **Tile body:** `border-radius: 16`, Liquid Glass v2 (gradient shine + `--mobile-glass-bg` + blur + `--mobile-glass-border` + `--mobile-glass-shadow`)
- **Título:** Arial 15px 600 weight, `color: var(--mobile-text)`, 2-line clamp, `letter-spacing: -0.005em`
- **Press (`:active`):** `transform: scale(0.97)`, `border-color: var(--mobile-accent)`, `box-shadow: 0 0 0 4px var(--mobile-accent-glow), var(--mobile-glass-shadow)`, transition 150ms
- **Focus-visible:** `outline: 2px solid var(--mobile-accent)` + `outline-offset: 2px`
- **Excluded variant** (`excluded={true}`): opacity 0.82 + "Desktop only" sub-caption 11px / 500 weight / `var(--mobile-text-faint)`

**Compact variant** (Last-visited row): `min-height: 56px`, icon 36×36 (radius 10), title 13px single-line nowrap, `min-width: 168px` para densidade visual.

**Paleta `TILE_PALETTE`** (slug → tintBg):

| Dashboard | Tint background | Icon |
|---|---|---|
| `well-by-well` | `#0c4a6e` petroleum blue | `PumpJackIcon` |
| `anp-cdp` | `#475569` slate | `GranularDataIcon` |
| `anp-cdp-bsw` | `#0891b2` teal | `WaterDropIcon` |
| `anp-cdp-depletion` | `#7c3aed` purple | `HourglassIcon` |
| `anp-cdp-diaria` | `#4f46e5` indigo | `CalendarDayIcon` |
| `market-share` | `#059669` emerald | `PieChartIcon` |
| `price-bands` | `#0284c7` sky | `ChartBandsIcon` |
| `subsidy-tracker` | `#d97706` amber | `ReceiptIcon` |
| `diesel-gasoline-margins` | `#ff5000` brand orange | `GaugeIcon` |
| `anp-prices` | `#e11d48` rose | `PriceTagIcon` |
| `anp-glp` | `#0e7490` cyan | `GasCylinderIcon` |
| `imports-exports` | `#9333ea` violet | `GlobeArrowsIcon` |
| `navios-diesel` | `#1e3a8a` navy | `ShipIcon` |

> **Taxonomy:** Oil & Gas leans petroleum/earth tones (slate, teal, indigo, navy, purple) para evocar geologia/exploração. Fuel Distribution leans commercial (emerald, sky, amber, orange, rose, cyan, violet, navy) para evocar comércio/markets. Brand orange (`#ff5000`) é reservado pro `/diesel-gasoline-margins` — o dashboard de bomba de combustível que melhor evoca a metáfora da marca.

**13 ícones SVG** (em [`icons.tsx`](../../src/components/dashboard/mobile/icons.tsx), seção `/home tile glyphs`): `PumpJackIcon`, `GranularDataIcon`, `WaterDropIcon`, `HourglassIcon`, `CalendarDayIcon`, `PieChartIcon`, `ChartBandsIcon`, `ReceiptIcon`, `GaugeIcon`, `PriceTagIcon`, `GasCylinderIcon`, `GlobeArrowsIcon`, `ShipIcon`. Mesmas convenções do icon set canônico (viewBox 24×24, stroke-only `currentColor`, `strokeWidth: 1.75`, `linecap/linejoin: round`). Consumed via `getTileMeta(slug, "default" | "compact")`.

**Consumer único:** `/home/mobile/View.tsx`. Se outro lugar quiser renderizar um tile de dashboard, importe `getTileMeta` + `MobileHomeIconTile`. Não duplique o palette.

### Uso rápido

```tsx
import {
  MobileTopBar, MobileHomePill, MobileKebabMenu,
  BottomSheet, FilterDrawer,
  MobileChart, MobileDataCard,
  StickyBreadcrumb, MobileTabBar,
} from "@/components/dashboard/mobile";

export default function View({ data }: Props) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [tab, setTab] = useState("active");

  return (
    <>
      <MobileTopBar
        title="Diesel Vessels"
        rightSlot={<MobileKebabMenu />}
      />
      <MobileTabBar
        tabs={[
          { key: "active", label: "Active" },
          { key: "recent", label: "Recent" },
          { key: "expected", label: "Expected" },
        ]}
        activeKey={tab}
        onChange={setTab}
      />
      {data.map((row) => (
        <MobileDataCard
          key={row.id}
          title={row.name}
          subtitle={`${row.origin} → ${row.destination}`}
          status={{ label: row.status, tone: "unloading" }}
          onClick={() => openDetail(row.id)}
        />
      ))}
      {/* NO ExportFAB on mobile (v2 — plan § 3.4) */}
      <FilterDrawer
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        onReset={resetFilters}
        onApply={() => setFiltersOpen(false)}
      >
        {/* filter sections */}
      </FilterDrawer>
      {/* Global floating Home pill — usually mounted by MobileLayout once,
          not per-dashboard. Shown here for completeness. */}
      <MobileHomePill />
    </>
  );
}
```

Para dashboards explicitamente excluídos do mobile (`/stocks`, `/admin-panel`, `/admin-analytics`, `/news-hunter`, `/alerts`, `/profile`, `/anp-cdp`, `/anp-prices`, `/anp-glp`), monte `MobileExcludedRedirect` no topo do `page.tsx`:

```tsx
import MobileExcludedRedirect from "@/components/dashboard/mobile/MobileExcludedRedirect";

export default function Page() {
  return (
    <>
      <MobileExcludedRedirect slug="stocks" displayName="Market Watch" />
      {/* desktop page content — render unconditionally; the redirect only
          fires on mobile viewport. */}
      <DesktopView />
    </>
  );
}
```

### Preview / Storybook

Página developer-only em [`/mobile-preview`](../../src/app/(dashboard)/mobile-preview/page.tsx) (gated por `useRoleGuard("Admin")`, sem entry no NavBar). Renderiza cada um dos 8 componentes com dados de exemplo — `worker_dash-*` consultam essa rota antes de compor o `mobile/View.tsx` do dashboard deles.

### Princípios não-negociáveis

1. **Não invente token novo** sem entrar nesta tabela. Se faltar variante, abra PR no `worker_designer`.
2. **Não duplique CSS** — use as variáveis. Hex hard-coded `#ff5000` é OK apenas em locais que já existiam antes da Fase 1.
3. **Tipografia única**: Arial, Helvetica, sans-serif. Nunca mude.
4. **`safe-area-inset-*`** é obrigatório em qualquer surface fixed top/bottom — iOS notch / Android nav vão comer pixels sem isso.
5. **PlotlyChart desktop ↔ MobileChart**: mesmo dynamic-import pattern, mesma estratégia de tooltip rounded. Não use `react-plotly.js` direto em nenhum componente novo.
6. **428px** é o max-width do phone shell. Componentes que se expandem além disso (BottomSheet, BottomTabBar) já trazem `maxWidth: 428` no default — só override se houver razão clara.
7. **Stocks (`/stocks`) mantém tema próprio** (`stocks-dark` / `stocks-light`) — o mobile system **não** o substitui. Stocks é desktop-only pós-reforma v2 (mobile é redirecionado via `MobileExcludedRedirect`).
8. **Light-only no mobile (v2 — 2026-05-27).** Não re-introduza blocos `[data-theme="dark"]` no escopo `[data-viewport="mobile"]` em `globals.css`. Dark mode permanece no desktop. Se um worker quiser adicionar uma "variante escura" para um componente mobile, **pare e converse com o Designer** — provavelmente é o caso de simplificar a paleta, não criar variante.
9. **Liquid Glass v2** é a linguagem visual. Toda superfície "elevada" (top bar, sheet, pill, FAB removido) usa o stack `glass-bg + blur(18px) + border(shine) + shadow(multi-layer)`. Drop-shadow simples (`box-shadow: 0 2px 4px rgba(0,0,0,0.1)`) NÃO é aceitável para essas superfícies.
10. **Não use `MobileBottomTabBar` em código novo.** Substituído por `MobileHomePill` (single floating). O legado fica exportado durante o descomissionamento; cleanup workers vão removê-lo.
11. **Sem `ExportFAB` em mobile (v2).** Plan § 3.4: export 100% desktop. Não importe o componente em `mobile/View.tsx` novo.
