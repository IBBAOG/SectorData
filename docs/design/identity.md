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

## Pontos de drift conhecidos

- `Liquidos_Vendas_Atual.csv` no `data/` sem dashboard claro consumindo (verificar se está em uso).
- `barrel_loading.png` e `ship_orange.png` em `public/` são assets temáticos — verificar onde são exibidos antes de mudar.

## Como adicionar token novo

1. Adicione na seção apropriada acima.
2. Use a CSS var ou hex direto no `globals.css` (atualmente o projeto não usa CSS vars — todos os hex são inline; mantenha consistente, mas pode ser convertido para `:root { --primary: #ff5000; }` num refactor futuro).
3. **Não invente cor sem justificar** — passe pelo CTO se for nova variante.
