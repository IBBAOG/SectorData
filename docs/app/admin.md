# Sub-PRD — Bundle Admin (`/home` + `/profile` + `/admin-panel`)

Bundle administrativo. Owner: [`worker_dash-admin`](../../.claude/agents/worker_dash-admin.md).

3 páginas pequenas/médias com natureza administrativa, agrupadas num agente único.

## Escopo de código

```
src/app/(dashboard)/
  home/
    page.tsx                        Server Component (renders HomeRouter)
    HomeRouter.tsx                  Client viewport router (useIsMobile → desktop or mobile)
    useHomeData.ts                  Shared hook — visibility filter, search, collapsed sections
    desktop/View.tsx                Desktop view (grid of image cards, hover reveal)
    mobile/View.tsx                 Mobile view (category sections, gradient thumbs, search)
  profile/
    page.tsx                        Client viewport router (useIsMobile → desktop or mobile)
    useProfileData.ts               Shared hook — profile, email, inline name-edit state, save
    desktop/View.tsx                Desktop view (profile card, info rows, inline edit)
    mobile/View.tsx                 Mobile view (hero avatar, info rows, sticky save footer)
  admin-panel/page.tsx              Gestão de roles + visibilidade de módulos
```

RPC wrappers: [`src/lib/profileRpc.ts`](../../src/lib/profileRpc.ts) (perfil) + seção em [`src/lib/rpc.ts`](../../src/lib/rpc.ts) (admin) + [`src/lib/alertsAdminRpc.ts`](../../src/lib/alertsAdminRpc.ts) (Alerts product admin — 7 wrappers + 2 PostgREST helpers).

## Recent changes

- **2026-05-28 (Mobile section headers simplified — Round 9)** `[mobile-only]`: CEO feedback on the `/home` mobile section headers ("retirar do header de cada seção o número de cards — esse '4' ao lado de 'Oil & Gas' — e a funcionalidade de mostrar/esconder"). The two category headers ("Oil & Gas", "Fuel Distribution") in `src/app/(dashboard)/home/mobile/View.tsx` were collapsed from interactive `<button>`s carrying the tile count + chevron toggle into static `<h2>` labels. Removed: the `useState`-driven `collapsedSections` map, the `toggleSection` handler, the `Chevron` SVG sub-component, the tile-count `<span>` next to the title, the `aria-expanded` button affordance, and the `useState` import. Sections now always render expanded (no interaction on the header). Colors: Oil & Gas stays brand orange `#FF5000` (per Round 8); Fuel Distribution moves to emerald green `#10A065` so the two category headers read distinctly without the chevron / counter affordance to disambiguate. Stale ASCII-art doc comment updated to drop the `▼` chevron + count and call out "Static section header (orange/green)". Net: ~40 lines removed, ~25 lines added. Tiles, `TeamCard`, and `RAPPI_META` palette untouched. Verified: `npx tsc --noEmit` clean, `npx eslint` clean on the touched file.

- **2026-05-28 (Oil & Gas text/icon recolored to brand orange `#FF5000` — Round 8)** (dual-view): CEO direction "A cor do escrito e do ícone pode ser o hex #FF5000". Foreground (text + icon + accent) of the Oil & Gas category flipped from the earthy `#9a3412` / `#c2410c` pair (Round 7) to brand orange pure `#FF5000`. Backgrounds untouched — desktop keeps the 10% soft tile, mobile keeps the peach `#ffe5d6`. Files touched: `src/components/home/ModuleGallery/index.tsx` (desktop `ACCENTS.oilgas` — accent / accentText / soft / tile / tileHover / tileBorder / glow all rebased on rgba `255,80,0`), `src/components/dashboard/mobile/mobileHomeTiles.tsx` (mobile `CATEGORY_TINTS.oilgas` — tile + accentText), `src/app/globals.css` (mobile `--mobile-home-tile-oilgas-fg` flipped to `#FF5000` in both `:root[data-viewport="mobile"]` and the `@media (max-width: 768px)` SSR fallback; bg unchanged). All 5 O&G per-slug aliases and 2 badge aliases inherit automatically. **WCAG trade-off (documented per user direction):** contrast `#FF5000` on `#ffe5d6` ≈ 3.0:1; on white ≈ 3.4:1 — fails AA 4.5:1 for body text but passes AA Large (3:1) for the 13px/700 tile labels (borderline). Applied at explicit user request despite the trade-off. Verified: `npx tsc --noEmit` clean, `npx eslint` clean on the touched files.

- **2026-05-28 (Oil & Gas category recolored to earthy brand-orange — Round 7)** (dual-view): CEO direction to move the O&G category off blue and into a light orange derived from the brand orange `#FF5000`. Markets keeps the vibrant brand orange (`accent #ff5000`, `accentText #cc3d00`); to avoid a clash O&G adopts an *earthy/dark* tint of the same hue — `accent #c2410c` (orange-700) + `accentText #9a3412` (orange-800, ~7:1 on white, AA pass for 13/700 body). Fuel Distribution (emerald) untouched. Files touched: `src/components/home/ModuleGallery/index.tsx` (desktop `ACCENTS.oilgas` — accent / accentText / soft / tile / tileHover / tileBorder / glow all rebased on rgba `194,65,12`), `src/components/dashboard/mobile/mobileHomeTiles.tsx` (mobile `CATEGORY_TINTS.oilgas` — tile + accentText), `src/app/globals.css` (mobile tokens in both `:root[data-viewport="mobile"]` and the `@media (max-width: 768px)` SSR fallback: `--mobile-home-tile-oilgas-bg` `#ffe5d6` peach, `--mobile-home-tile-oilgas-fg` `#9a3412` orange-800 — contrast ~7:1, AA pass). All 5 O&G per-slug aliases (`well-by-well`, `anp-cdp`, `anp-cdp-bsw`, `anp-cdp-depletion`, `anp-cdp-diaria`) and the 2 O&G badge aliases inherit automatically. No JS edits beyond the 2 token-map files. Brand orange `#FF5000` continues to be used only by NavBar accent / Markets category / buttons / focus — not touched here. Verified: `npx tsc --noEmit` clean, `npx eslint` clean on the touched files.

- **2026-05-28 (Mobile tile palette softened — Round 6)** `[mobile-only]`: CEO feedback on Round 5 ("ficou bom, mas eu deixaria as cores mais suaves na visão mobile — azul mais claro e verde mais claro"). Round 5 had bumped category bgs to ~35% saturation to fix the off-white look of Round 3, but at full-tile size the result read as too candy-toned. Round 6 splits the difference: ~20% saturation — visibly blue/green but airy. New values mirrored in both `:root[data-viewport="mobile"]` and the `@media (max-width: 768px)` SSR fallback: `--mobile-home-tile-oilgas-bg: #dce6ff` (was `#bfd4ff`) paired with unchanged `--mobile-home-tile-oilgas-fg: #1d4ed8` — contrast widens vs Round 5 (lighter bg + same dark fg), AA pass for 13px/700 body comfortably preserved. `--mobile-home-tile-fuel-bg: #cdf0db` (was `#a8e6c8`) paired with unchanged `--mobile-home-tile-fuel-fg: #047857` — same reasoning, AA pass preserved. `fg` tokens intentionally unchanged so per-slug aliases and badge tokens (10 alias pairs each in both blocks) inherit automatically with zero edits. Files touched: `src/app/globals.css` only (4 lines). Verified: `npx tsc --noEmit` clean.

- **2026-05-28 (Mobile tile palette saturation bump — Round 5)** `[mobile-only]`: CEO feedback on Round 3/4 ("use the same color for the cards as the color used in the desktop version" — Round 4 misinterpreted as per-slug; the unification-by-category was correct, but the ~8% saturation of Round 3 read as off-white at the 159×108px tile size). Round 5 keeps the Round 3 structure intact (two category base pairs + 10 per-slug aliases, mirrored in both `:root[data-viewport="mobile"]` and the `@media (max-width: 768px)` SSR fallback) and only bumps the two base `bg` values to ~35% saturation so the tiles read as visibly blue / visibly green at thumbnail size. New values: `--mobile-home-tile-oilgas-bg: #bfd4ff` (was `#e9efff`) paired with unchanged `--mobile-home-tile-oilgas-fg: #1d4ed8` — contrast 6.5:1, AA pass for 13px/700 body. `--mobile-home-tile-fuel-bg: #a8e6c8` (was `#e6f5ef`) paired with unchanged `--mobile-home-tile-fuel-fg: #047857` — contrast 4.8:1, AA pass. The two categories now render distinctly from each other (clear blue vs clear green) while every tile inside a category renders identically — mirrors what the desktop `ACCENTS` map does, just translated into a saturated-pastel Rappi tile language. Files touched: `src/app/globals.css` only (4 lines across the two blocks). Verified: `npx tsc --noEmit` clean.

- **2026-05-28 (Rappi tile palette aligned to desktop card colors — Round 3)** `[mobile-only]`: CEO feedback on Round 2 ("use the same color for the cards as the color used in the desktop version"). The mobile Rappi tiles previously carried a per-slug rainbow pastel palette (warm sandstone for `well-by-well`, mint for `market-share`, peach for `subsidy-tracker`, lavender for `imports-exports`, etc.) — that broke visual continuity with desktop, where `ModuleGallery` paints **every** O&G row blue (`#2563eb`) and **every** Fuel row emerald (`#059669`) via its `ACCENTS` map (source of truth: [`src/components/home/ModuleGallery/index.tsx`](../../src/components/home/ModuleGallery/index.tsx) lines 52–80). Round 3 collapses the mobile per-slug palette down to two category pairs that mirror the desktop accents: `--mobile-home-tile-oilgas-bg/fg` (`#e9efff` / `#1d4ed8` — pastel of blue-600 + desktop's `accentText` blue-700) and `--mobile-home-tile-fuel-bg/fg` (`#e6f5ef` / `#047857` — pastel of emerald-600 + desktop's `accentText` emerald-700). Every per-slug token (`--mobile-home-tile-well-by-well-bg`, `--mobile-home-tile-market-share-bg`, etc.) is now a CSS variable alias pointing to its category pair, so `home/mobile/View.tsx` and `MobileHomeRappiCard` work unchanged — no JS edits needed. Result: mobile `/home` now reads as the same "blue for O&G, green for Fuel" visual rhythm as desktop, in the Rappi tile chrome. Files touched: `src/app/globals.css` only (both the primary `:root[data-viewport="mobile"]` block and the `@media (max-width: 768px)` SSR fallback). Adding a new dashboard to `/home` mobile: pick the category in `useHomeData.SLUG_CATEGORY`, then add one alias pair in `globals.css` (`--mobile-home-tile-<slug>-bg: var(--mobile-home-tile-<oilgas|fuel>-bg);` + matching `-fg`) — no new colors needed. If a future category is introduced (e.g. Markets resurfaces on mobile), add a new `ACCENTS` entry on desktop first, then mirror it as `--mobile-home-tile-<category>-bg/fg` here. Verified: `npx tsc --noEmit` clean.

- **2026-05-28 (Rappi pastel × Oil & Gas / Fuel Distribution sections — Round 2)** `[mobile-only]`: iteration on the Rappi redesign per CEO feedback ("the Oil & Gas and Fuel Distribution groupings should be exactly the same as before; icons can be smaller so they all fit"). The first pass (commit `10a2c17f`) had replaced the canonical category taxonomy with a curated Featured/Daily picks/More tools curatorial split — this iteration restores the category-section layout that was in place before `10a2c17f` (commit `022f41bc`) while keeping the pastel Rappi visual language. Result: two collapsible sections ("Oil & Gas" — 4 tiles, "Fuel Distribution" — 6 tiles) stacked vertically with a 2-col uniform grid inside each. Source of truth for grouping is `useHomeData.cardsByCategory` (categories live in `useHomeData.SLUG_CATEGORY`). Tiles use a new `variant="uniform"` of `MobileHomeRappiCard` — same pastel `--mobile-home-tile-<slug>-bg/fg` palette as before, but icon shrunk from ~96/60px to a 44px top-left zone (~40% card height) and overall card minHeight dropped from 168/116 to 108. The hero/secondary/quick variants stay defined for backward compat but are no longer used by `/home`. Files touched: `src/app/(dashboard)/home/mobile/View.tsx` (rewritten — `HIDE_FROM_MOBILE_HOME` restored from `022f41bc`, curatorial `_SLUGS` arrays dropped, sections + collapse state restored), `src/components/dashboard/mobile/MobileHomeRappiCard.tsx` (new `uniform` variant — icon top-left, label bottom-left, no emoji backdrop; existing variants untouched), `src/app/globals.css` (added bg/fg tokens for `anp-cdp-bsw`, `anp-cdp-depletion`, `price-bands`, `diesel-gasoline-margins` — they previously only had `-badge-*` tokens for the quick variant; the new tokens alias the badge values so the palette stays cohesive; mirrored in both `:root[data-viewport="mobile"]` and the `@media` SSR fallback). The `news-hunter` slug stays hidden from the gallery (consistent with `022f41bc`) — the floating `MobileNewsHunterPill` is its launcher. Adding a new dashboard to `/home` mobile: insert the slug into `SLUG_CATEGORY` in `useHomeData.ts`, add `--mobile-home-tile-<slug>-bg/fg` tokens in `globals.css`, and register a `RAPPI_META` entry in `home/mobile/View.tsx` (optional mobile-friendly `label` override). The card renders automatically from there. Verified: `npx tsc --noEmit` clean, `npx eslint` clean on the touched files.

- **2026-05-28 (Rappi-style mobile /home redesign — Round 1, superseded by Round 2 same day)** `[mobile-only]`: full visual overhaul of the `/home` mobile gallery inspired by the Rappi delivery app. The flat 2-col bento grid of `MobileHomeIconTile` rows was replaced by a three-tier composition of pastel "launcher" tiles:
  - **Featured** — 2 large hero cards (`well-by-well` + `market-share`). Pastel background (`--mobile-home-tile-<slug>-bg`), oversized illustration in the upper-right with a saturated foreground tint, big bold label bottom-left, optional uppercase sublabel ("PRODUCTION" / "DISTRIBUTION"), 168px tall.
  - **Daily picks** — 2x2 grid of medium pastel cards (`anp-cdp-diaria` + `subsidy-tracker` + `imports-exports` + `navios-diesel`). Each gets its own pastel palette pair, smaller illustration top-right, bold label bottom, 116px tall.
  - **More tools** — horizontal scroll row of small neutral white cards with a per-slug accent badge (`anp-cdp-bsw` + `anp-cdp-depletion` + `price-bands` + `diesel-gasoline-margins` + `news-hunter`). 96x96 fixed, bleeds past viewport edges as a scroll cue.
  - Files touched: `src/app/(dashboard)/home/mobile/View.tsx` (rewritten), `src/components/dashboard/mobile/MobileHomeRappiCard.tsx` (new — 3 variants share one component), `src/components/dashboard/mobile/index.ts` (barrel export), `src/app/globals.css` (new `--mobile-home-tile-<slug>-*` palette tokens in both the `:root[data-viewport="mobile"]` block and the `@media (max-width: 768px)` SSR fallback; new `.mobile-home-rappi-tile` + `.mobile-home-quick-row` press/focus rules).
  - Section headers ("FEATURED" / "DAILY PICKS" / "MORE TOOLS") are tiny uppercase muted labels so the colour blocks do the talking.
  - The previous `MobileHomeIconTile` component is **kept** in the codebase for non-`/home` call sites (e.g. ad-hoc launcher tiles elsewhere) — only `/home` mobile switched to the Rappi composition. `getTileMeta` and `mobileHomeTiles.tsx` stay untouched.
  - Section-collapse state was dropped (the 3-section layout is short enough to take at a glance — collapsing was leftover from the longer 10-tile bento). The `useHomeData` hook still exposes `collapsed`/`toggleCollapsed` for backwards compat; the mobile View no longer uses them.
  - Curatorial slots (`HERO_SLUGS` / `SECONDARY_SLUGS` / `QUICK_SLUGS`) define a preferred order; `useHomeData.visibleCards` still drives visibility, and slugs absent from the visibility-filtered map are silently dropped from their row (Anon misses `well-by-well` per `is_visible_for_public=false`).
  - Verified at 360 / 390 / 430px via DOM inspection — no horizontal overflow, all tiles fit within the grid (heroes 158-193px wide x 168 tall, secondaries 159-194px x 116 tall, quicks fixed 96x96), no console errors, TypeScript + ESLint clean on the diff.
  - Adding a new dashboard to `/home` mobile: drop a row of tokens into `src/app/globals.css` under the "Rappi-style /home tile palette" block, then add the slug to the appropriate `_SLUGS` array in `home/mobile/View.tsx` (hero / secondary / quick). Illustration falls back to the shared `getModuleIcon(slug, size, stroke)`.

- **2026-05-28 (mobile tile: keep horizontal, abbreviate long labels)** `[mobile-only]`: an earlier attempt the same day (commit `c8850895`) flipped `MobileHomeIconTile`'s default variant to a vertical layout (icon-on-top + centered 3-line label, 116px tall) to fit "Brazil Production Summary" etc. — rejected by Eduardo: tiles too tall, icon-on-top looked odd, centered label awkward. **Reverted to horizontal** (icon-left 36×36 + label-right left-aligned, 2-line clamp, ~84px tall) and solved truncation by shortening the LONG titles on mobile only via a new `mobileLabel?: string` field returned by `getTileMeta` in `src/components/dashboard/mobile/mobileHomeTiles.tsx`. The consumer (`home/mobile/View.tsx`) uses `meta.mobileLabel ?? card.title`. Three overrides registered: `well-by-well` → "Brazil Production", `diesel-gasoline-margins` → "D&G Margins", `navios-diesel` → "Diesel Line-Up". All other titles (`Monthly Production`, `Daily Production`, `BSW by Well`, `Depletion`, `Market Share`, `Price Bands`, `Subsidy Tracker`, `Imports & Exports`) already fit two lines at 360px after dropping the icon badge from 40 → 36px and tightening padding/gap. Tile dimensions: padding `12px 12px`, gap 10, badge 36×36, label font 15/600. Verified at 360/390/426px viewports via DOM (`scrollHeight === clientHeight` on every label span). Compact variant unchanged. Desktop `/home` untouched — desktop labels remain the long versions.

- **2026-05-28 (MobileTopBar slim + hide-on-scroll)**: reduced `--mobile-topbar-h` from 56px to 44px in `src/app/globals.css` (both `:root` and `@media` blocks). Added hide-on-scroll-down / show-on-scroll-up behavior to `MobileTopBar` in `src/components/dashboard/mobile/MobileNavBar.tsx` — a `rAF`-gated `window.scroll` listener drives a `translateY(-100%)` / `translateY(0)` with `0.22s ease` transition. The bar always stays visible when `scrollY < 48px`. Change is global (shell-level component, affects all mobile routes). `[mobile-only]` — desktop unchanged.

- **2026-05-28 (mobile TeamCard)**: added `src/components/home/mobile/TeamCard/` — a new mobile-only component that renders the three team members (Monique Greco, Eric de Mello, Eduardo Mendes) with `mailto:` links above the "Oil & Gas" section in `home/mobile/View.tsx`. Uses `--mobile-*` token system (light-only). Desktop `/home` already has `TeamPanel` in the right column; this is the mobile equivalent. `[mobile-only]` — desktop unchanged.

- **2026-05-28 (Round 2 — `/production` registration)**: added `production` slug to the hardcoded `MODULE_LABELS` array in `useAdminPanelData.ts` (placed FIRST in the Oil & Gas group, matching NavBar order) and to `CARDS` + `SLUG_CATEGORY` in `home/useHomeData.ts` (also FIRST in Oil & Gas). The `module_visibility` row was already seeded by migration `20260528000000_production_rpcs.sql` with `is_visible_for_public=false`, `is_visible_for_clients=true`, `is_visible_on_home=true`. Companion rename: the legacy `anp-cdp` label flipped from "Production" to "Monthly Production" in both the Permissions tab and the Home gallery, so the two slugs co-exist without label collision. No `moduleIcons.tsx` entry added yet — the slot falls back to the generic grid icon until an SVG is contributed.

## Dual-view structure

This bundle is being migrated to the dual-view pattern (desktop + mobile) in waves.

### Wave 4 — `/home` (completed 2026-05-20)

`/home` is now a full dual-view module. File layout:

```
home/
├── page.tsx            Server Component — renders HomeRouter (no server-side data fetch)
├── HomeRouter.tsx      "use client" — useIsMobile → DesktopView | MobileView
├── useHomeData.ts      Brain hook — visibility filter, search, section-collapse state
├── desktop/View.tsx    Desktop: icon-list rows + DataSourcesTable panel (70/30 split)
└── mobile/View.tsx     Mobile: 4 collapsible category sections, icon rows, sticky search
```

**Desktop view** — redesigned 2026-05-26 (icon list). Vertical list of compact rows inside the left 70% column. One card per row: 40×40px rounded icon bubble + module name + optional badge + chevron. Icon glows orange on hover (`#ff5000`, glow shadow), row translates right 4px, left accent bar animates in. Categories (Markets / Oil & Gas / Fuel Distribution) are separated by a `SectionHeader` with a category-color bar + divider line. The former "Admin" category (Profile + Admin Panel) was removed 2026-05-26 — those tools are accessed via the NavBar.

**Mobile view — "Last visited" row removed (2026-05-28, `[mobile-only]`):** the horizontal scroll of recently-visited dashboard pills at the top of `/home` mobile was removed per CEO feedback. `useTrackLastVisited` continues to be mounted in `DashboardShell` (writes the FIFO of 4 slugs to `localStorage["sd_last_visited"]`) — only the UI surface in `home/mobile/View.tsx` is gone. Desktop is unaffected.

**Mobile view** — redesigned 2026-05-26 (icon list, same analysis as desktop). Components used:
- `MobileTopBar` (wordmark + avatar initials / Sign-in pill for anon)
- `MobileBottomTabBar` (Home / Discover / Saved / Profile; Profile tab navigates to `/profile`)
- Inline sticky section headers with category-color dot
- Per-slug SVG icons from `src/data/moduleIcons.tsx` (centralized registry, shared with desktop)
- `ModuleRow` component: 44×44 touch target, icon bubble (glow on press), module name, chevron. No more gradient thumbnails.

**Shared hook (`useHomeData`):**
- Reads `moduleVisibility` + `homeVisibility` + `profile` from `UserProfileContext`
- Applies two-axis visibility filter (same logic as original HomeClient)
- `search` state: live-filters title + description across all cards
- `collapsed` state: per-category expand/collapse (mobile only; desktop ignores it)
- `cardsByCategory`: `Record<HomeCategory, HomeCardDef[]>` for mobile category sections (Markets / Oil & Gas / Fuel Distribution — Admin section removed 2026-05-26)

**Divergence from mockup** — the mockup's `MDIC Comex` card is in the Oil & Gas section. This reflects the module's dual classification (`Estatísticas / Oil & Gas` and `Fuel Distribution`). In code, `mdic-comex` is assigned `oilgas` category (matching mockup) even though it also covers fuel distribution.

### Wave 5 — `/admin-panel` (completed 2026-05-20; consolidated 2026-05-26)

`/admin-panel` is now a full dual-view module. File layout:

```
admin-panel/
├── page.tsx               "use client" — useIsMobile → DesktopView | MobileView
├── useAdminPanelData.ts   Brain hook — RPCs, all state, all handlers,
│                           SECTIONS & MODULE_LABELS metadata
├── desktop/View.tsx       Desktop: sidebar (6 sections) + content panel
└── mobile/View.tsx        Mobile: sticky horizontal pill row for sections +
                            search bar + MobileDataCard rows per item
```

**Shared hook (`useAdminPanelData`):**
- Owns `useRoleGuard("Admin")` invocation (MFA-aware) — both Views early-return `null` if not allowed
- Owns ALL state: `activeSection`, `localVis`, `localHomeVis`, `localPublicVis`, `users`/`localRoles`, `recipients`, plus all `saving*`/`saved*`/`*Error` flags
- Owns ALL handlers: `handleToggle`, `handleHomeToggle`, `handlePublicToggle`, `handleRoleChange`, `handleAddRecipient`, `handleToggleRecipient`, `handleRemoveRecipient`
- Owns pure helpers `isValidEmail` and `formatDateBR`
- Exports `SECTIONS` (id, label, shortLabel, description) and `MODULE_LABELS` (slug, label, description) as static module-level constants so both Views render the same catalog

**Desktop view** — Dark left sidebar (220px wide, 6 buttons + Analytics link), white content panel with section header + module-specific cards.

**Mobile view** — list-based archetype:
- `MobileTopBar` with "Admin" pill + "Admin Panel" title + avatar (initials)
- Sticky horizontal scroll of section pills (Members / Access / Alert Emails / Alerts / News Defaults / Tables) — pill row needed because 6 tabs don't fit in `MobileTabBar` container variant
- Per-section search bar (placeholder adapts: "Search by name, email, or role" / "Search modules" / "Search recipients")
- **Members**: `MobileDataCard` per user with avatar, name+email, role pill. Tapping the row opens a `BottomSheet` with the Admin/Client picker.
- **Permissions**: one article per module with title+description, then three stacked toggle rows — Public / Clients / Home. All three visibility axes are in the same card (consolidated 2026-05-26).
- **Alert Emails**: Add form (input + button, 44px min-height for touch), then `MobileDataCard` per recipient with status pill + Enable/Disable button. Removing opens a `BottomSheet` with a confirm prompt (replaces the inline "Are you sure?" pattern from desktop, which doesn't fit on a 320px row).
- **Data Input**: shows a desktop-only notice because `EditableTableEditor` needs a wide layout.

**Divergence from desktop** (`[mobile-only]` deltas):
- The desktop's Analytics sidebar link is omitted on mobile — navigation to `/admin-analytics` happens through `/home`.
- Inline "Are you sure?" confirm for recipient removal becomes a `BottomSheet` with explicit Cancel/Remove buttons.
- Recipient row's primary action (tap whole row) is "remove" (opens confirm sheet); secondary action (button) is "Disable/Enable". On desktop both are inline buttons.
- `Data Input` section shows a placeholder explaining desktop-only; the embedded `EditableTableEditor` is not rendered on mobile.
- Per-section search filter is mobile-only (desktop has no search; the sidebar's narrow nav makes it unnecessary).
- The original Portuguese string `"Remover"` in the recipients list was corrected to `"Remove"` in BOTH views (English-only policy).

### Wave 5 — `/profile` (completed 2026-05-20)

`/profile` is now a full dual-view module. File layout:

```
profile/
├── page.tsx              Client viewport router — useIsMobile → DesktopView | MobileView
├── useProfileData.ts     Brain hook — profile mirror, email resolution, name-edit FSM, save handler
├── desktop/View.tsx      Desktop: profile card with inline name edit + Security section (verbatim move)
├── mobile/View.tsx       Mobile: hero avatar + Account/Security sections + sticky save footer
└── mfa/page.tsx          (Unchanged) MFA enrollment screen, owned by Supabase/security path
```

**Shared hook (`useProfileData`)** owns:
- `profile` (mirrored from `UserProfileContext`), `loading`, `isAdmin`
- `email` (resolved from `supabase.auth.getSession()` since context does not expose it)
- Inline name-edit FSM: `editing`, `editName`, `saving`, `saveError`, `canSave` plus `startEdit / cancelEdit / setEditName / saveName`
- Derived helpers used by both Views: `displayName`, `initials`, `memberSince`

Both Views call `saveName()` and `refreshProfile()` is invoked inside the hook on success — NavBar avatar updates without manual plumbing.

**Desktop view** is a verbatim move of the previous `page.tsx`. Same layout (`profile-card`, `role-badge--*`, `profile-info-row`, `profile-name-edit-*` classes), same Security panel, same inline pencil edit. Only difference: all `useState` / `useEffect` / RPC plumbing now lives in the hook.

**Mobile view** is a single-screen edit page (no `MobileBottomTabBar` — users return to home via the top-left back button or the system back gesture). Structure:
- `MobileTopBar` with custom `leftSlot` = back button + "Profile" title
- Hero card: 96 px avatar bubble, display name, role pill
- "Account" `SectionCard`: 4 rows (Email, Name with pencil/inline form, Role, Member since), each row uses a local `InfoRow` (44 px+ touch targets, matching mobile rhythm)
- "Security" `SectionCard`: single tap row navigating to `/profile/mfa` (chevron right + shield icon)
- Sticky save footer (`position: fixed` bottom): only rendered while `editing === true`. Cancel + Save buttons, glass background. Page body adds bottom padding equal to footer height so the last row is never hidden.

**Mobile design choices vs. desktop**:
- Inline edit uses a full-width input (`font-size: 16px` to prevent iOS focus auto-zoom) and a sticky two-button footer instead of an inline submit/cancel pair. Saves are easier to commit one-handed.
- Avatar moves from 72 px (desktop `.profile-avatar-circle`) to 96 px in the hero. Visual hierarchy: the avatar is the screen's centrepiece, not buried inside a card.
- Security section is presented as a tap row (mobile metaphor) instead of a button-anchor (desktop metaphor).
- The "My Account" badge from the desktop page header is dropped — the topbar title already labels the screen.

No `[mobile-only]` tag needed for this commit: the mobile view is a fresh redesign of the same data the desktop view exposes, and the hook is the single source of truth for both.

### Wave — Anonymous access (3-tier visibility) (added 2026-05-21)

The login-required gate is being relaxed in favour of a 3-tier visibility model. Per-module access is split into three independent flags in `module_visibility`:

| Flag | Tier | UI surface |
|---|---|---|
| `is_visible_for_public` | Anon (logged-out visitors) | Permissions tab — Public column |
| `is_visible_for_clients` | Client (logged-in non-Admin) | Permissions tab — Clients column |
| `is_visible_on_home` | All roles (controls Home gallery card) | Permissions tab — Home column (consolidated 2026-05-26; was a separate "Home Visibility" tab) |

**Invariant (Public ⇒ Clients):** a module visible to anonymous visitors must also be visible to Clients (otherwise a user would lose access on sign-in). The database enforces this in two places:
1. A `CHECK` constraint (`module_visibility_public_implies_clients_chk`) rejects pathological inserts.
2. A `BEFORE INSERT/UPDATE` trigger coerces `is_visible_for_clients = TRUE` whenever `is_visible_for_public = TRUE`, so the constraint never fires in normal flow.

**UI parity with the trigger.** `handlePublicToggle` in `useAdminPanelData.ts` mirrors the coercion: when Public is turned ON while Clients is OFF, it flips the local Clients state to ON optimistically, calls `set_module_public_visibility`, then explicitly calls `set_module_visibility(slug, true)` so the global `UserProfileContext.moduleVisibility` map (consumed by NavBar / `useModuleVisibilityGuard`) refreshes within the same session. Without that second call, the trigger would have updated the DB but the React tree would still see the old `is_visible_for_clients=false`. The Clients toggle is rendered visually locked ON (disabled, 0.5 opacity) while Public is ON.

**Permissions tab layout (both views).**
- Desktop: 3-column grid — *Module* | *Public* | *Clients*, with a header row showing column labels and an explanatory paragraph above ("Public = anonymous visitors. Clients = logged-in tier. Enabling Public also enables Clients.").
- Mobile: each module renders as a single card with a title + description block, then two stacked rows ("Public — Anonymous visitors" / "Clients — Logged-in Client tier"), each with its own switch. When Public is ON, the Clients row's sub-label changes to "Locked on (Public is enabled)" and the switch is disabled.

**New RPC wrappers** (in `src/lib/profileRpc.ts`):
- `rpcSetModulePublicVisibility(supabase, slug, isVisible)` — calls `set_module_public_visibility(p_slug, p_is_visible)` (Admin-only via `require_admin_mfa()` server-side).
- `rpcGetModuleVisibility` already returns the new `is_visible_for_public` column from the rebuilt `get_module_visibility()` RPC. `ModuleConfig.is_visible_for_public` is an optional field on the type so older envs without the migration still typecheck.

**Hook-side fetching.** `useAdminPanelData` calls `rpcGetModuleVisibility` directly on mount to populate `localPublicVis`, independently of `UserProfileContext`. This keeps the admin-panel change isolated from Phase B's wider context expansion; once Phase B's `publicVisibility` map lands in context, the local fetch can be replaced with a context read.

**Dual-view sync.** Both views in the same commit. No `[desktop-only]` / `[mobile-only]` tag — both views received the new Public toggle, the constraint visual ("locked on"), and the updated descriptive paragraph.

## Páginas — descrição rápida

### `/home`
Landing visual. Shows module cards (icon list, not image cards since 2026-05-26) filtered by role + visibility. **Each module needs an icon entry in `src/data/moduleIcons.tsx`.**

> **Memória persistente do CEO (updated 2026-05-26)**: TODO módulo novo precisa de ícone em `src/data/moduleIcons.tsx`. O upload de imagem foi removido — home agora usa ícones SVG inline, não imagens carregadas pelo admin.

> **Mobile/desktop icon parity (2026-05-28, `[mobile-only]`):** the mobile `/home` bento tiles (`MobileHomeIconTile`) now consume the SAME glyph registry (`@/data/moduleIcons` / `getModuleIcon`) as the desktop `ModuleGallery` and `NavBar`. `src/components/dashboard/mobile/mobileHomeTiles.tsx` keeps the tinted-squircle palette (`TILE_PALETTE: slug → tintBg`) but delegates the SVG itself to `getModuleIcon(slug, size, 1.75)`. Net effect: a given dashboard's icon is visually identical across views — only the colored frame is mobile-specific. **Adding a new dashboard still requires only one icon registration: in `src/data/moduleIcons.tsx`.** Mobile picks it up automatically; the tile background colour is added to `TILE_PALETTE` (mobile-only concern).

#### News Hunter center panel (2026-05-28, `[desktop-only]`)

Desktop layout is a **3-column grid** (cards · News Hunter · Team + Data Sources) — `1fr 2fr 1fr` (bumped from `1.4fr 1fr 1fr` on 2026-05-28 so the live news ticker becomes the visual focal point with twice the width of the side columns). The News Hunter panel sits visually centered horizontally, between the module list (left, compact icon rows) and the live Data Sources / Team stack (right). Mobile view is **unchanged** — still shows cards only.

**Component tree:**
```
src/components/home/NewsHunterPanel/
  index.tsx                   — Top-20 headlines list with pulse dot header
                                (no header CTA since 2026-05-27) and a single
                                "Open full feed →" footer link. Re-renders age
                                labels every 30s via local tick.
  NewsHunterPanel.module.css  — Glass card matching DataSourcesTable + TeamPanel.
                                Yellow accent reuses --ds-cat-news / --ds-cat-news-soft
                                tokens to tie this panel to the news_articles row
                                of the Data Sources table (same category color).
```

**Data source:** consumes the already-mounted `NewsHunterProvider` (in `src/app/(dashboard)/layout.tsx`) via `useNewsHunter()`. No new RPC, no new fetch — the provider already polls every 60s on the `found_at` watermark and persists to localStorage (`nh_articles_v1` / `nh_watermark_v1`). The home panel slices the top 20 articles sorted by `published_at desc nulls last`, then `found_at desc` (bumped from 6 on 2026-05-27 per CTO — gives a deeper feed snapshot directly on /home; the panel grows taller than the right-column stack and /home scrolls naturally).

**Visibility:** panel renders for all roles (anon / client / admin). `NewsHunterProvider` itself handles the anon / authed branching (anon gets the default-keywords seed list), so the panel doubles as a "what's live" showcase on the public surface.

**Rationale for placement:** the user (CEO) asked for "um painel de news hunter ao centro da página" (desktop-only). The 3-column layout puts the panel literally at the horizontal center of the page while preserving breathing room for both the module gallery (left) and the live data instruments (right).

#### Data Sources live table (2026-05-26, `[desktop-only]`)

Desktop layout is now a **3-column grid** (since 2026-05-28; was a 70/30 split before that): module cards (left, `1fr`) + News Hunter panel (center, `2fr`) + Team + Data Sources stack (right, `1fr`) — News Hunter doubled on 2026-05-28.
Mobile view is **unchanged** — still shows cards only. The table is explicitly desktop-only.

**Component tree:**
```
src/
  data/dataSources.ts                 — 17-entry TS catalog (DataSource interface + DATA_SOURCES array)
  components/home/DataSourcesTable/
    index.tsx                          — wrapper, groups by category, single-expand accordion
    DataSourcesTable.module.css        — glass + pulse styles; consumes only existing globals.css tokens. Grid tracks on `.colHeaders` + `.sourceRow` use `minmax(0, Nfr)` (not bare `Nfr`) so columns ignore intrinsic content width — without this, longer Source labels ("Proprietary", "News Hunter scanner") or longer Last-update text ("2 weeks ago") expand the track and shift the centered SOURCE badge off the vertical baseline (alignment bug fixed 2026-05-28).
    SectionHeader.tsx                  — translucent "── ANP PRODUCTION ──" divider
    SourceRow.tsx                      — collapsed row: Status · Name · Source · Last update · Actions
    ExpandedRow.tsx                    — expanded panel: description + schedule + next run + action buttons + download
    StatusDot.tsx                      — colored dot (fresh/stale/overdue); real-time sources get .ds-pulse class
    LastUpdateCell.tsx                 — "2h ago" / "3 days ago" via relative time helper
    DashboardPicker.tsx                — dropdown when source feeds ≥2 dashboards; direct Link when only 1
    useDataSourcesFreshness.ts         — hook: calls get_data_sources_freshness() every 60s, returns Map<key, {lastUpdate, rowCount}>
```

**RPC:** `get_data_sources_freshness()` — migration `20260526200000_data_sources_freshness.sql`. Returns `(source_key, last_update, row_count)` for all 22 ETL-fed tables. SECURITY DEFINER, accessible to `anon` + `authenticated`. Wrapper: `rpcGetDataSourcesFreshness` in `src/lib/rpc.ts`.

**Note on catalog vs. RPC key count:** The RPC returns source_keys for all ETL-fed tables. The catalog deduplicates some keys (e.g. the 3 CDP Diária sub-tables are represented by one entry, `anp_desembaracos` is covered by the `anp_daie` entry, `port_arrivals` + `import_candidates` by `vessel_positions`). The hook silently ignores keys with no catalog entry (returns undefined → no render).

**The 19 entries** (post-deduplication; as of 2026-05-27 after subsidy reform):
- ANP Production (3): `anp_cdp_diaria` (covers all 3 Power BI tables), `anp_cdp_producao`, `anp_voip`
- ANP Distribution (8): `vendas`, `anp_precos_produtores`, `anp_glp`, `anp_lpc`, `anp_precos_distribuicao`, `anp_subsidy_diesel_reference`, `anp_subsidy_caps`, `anp_subsidy_commercialization`
- Imports & Exports (2): `mdic_comex`, `anp_daie` (covers Desembaraços too)
- Vessels (2): `navios_diesel`, `vessel_positions` (covers arrivals + candidates)
- Proprietary Data (2): `d_g_margins`, `price_bands`
- News & Markets (2): `news_articles`, `yahoo_finance`

**Status derivation** (computed client-side from `DataSource.staleAfterHours` / `overdueAfterHours`):
- `fresh` (green) — `now - last_update < staleAfterHours × 3600 × 1000`
- `stale` (yellow) — between stale and overdue thresholds
- `overdue` (red) — `now - last_update ≥ overdueAfterHours × 3600 × 1000`
- `unknown` — `last_update` is null (yahoo_finance always shows "live" not a timestamp)

**Real-time pulse** (`.ds-pulse` CSS class, defined in globals.css): applied to `vessel_positions`, `port_arrivals`, `import_candidates`, `news_articles`, and `yahoo_finance`.

**Download:** uses `ExportModal` (Tier 2). Visible only to logged-in users. Anonymous users see a disabled "Sign in to download" button. Yahoo Finance has no `supabaseTable` → download button hidden entirely.

**Visibility:** table is visible to all roles (anon, client, admin) — it serves as a product transparency/robustness showcase.

### `/profile`
Perfil do usuário logado. Edição inline do nome (`profile-name-edit-icon-btn`). Mostra: avatar (iniciais), full_name, email, role badge.

### `/admin-panel`
Protegida por `useRoleGuard("Admin")`. Funcionalidades (6 seções na sidebar):
- **Members** — listar todos os users com role; promover/demover Admin ↔ Client.
- **Permissions** — three-column visibility per module (consolidated 2026-05-26; previously split across two separate tabs):
  - `is_visible_for_public` (**Public** column) — affects anonymous (logged-out) visitors.
  - `is_visible_for_clients` (**Clients** column) — affects logged-in Client tier users. Forced ON whenever Public is ON (DB invariant + UI lock).
  - `is_visible_on_home` (**Home** column) — controls whether the module card appears in the `/home` gallery for ALL users (including Admin). Default `true`. Independent from access flags: a module can be Home=false (card gone from Home for everyone) while Clients=true (direct URL still works).
  - Admin always has access regardless of these flags.
  - Desktop layout: 4-column grid — Module | Public | Clients | Home.
  - Mobile layout: one article per module with three stacked toggle rows (Public / Clients / Home).
- **Alert Emails** — gerenciar destinatários de alertas automáticos (legado local).
- **Alerts** — Alerts Product management (cloud, multi-recipient). 5 sub-sections:
  - **Subscriber Stats** — total/active/unconfirmed counts, bounce/complaint rates (7d), per-source active count.
  - **Subscribers** — full subscriber table with source filter and Force Unsubscribe action.
  - **Sources** — toggle `is_active` per source; Send Test Event button for QA.
  - **Email Log** — recent delivery events (sent/bounced/complained/failed) with status filter.
  - **Outbox Repair** — failed outbox rows with Requeue button (resets status → queued, attempts → 0).
- **Default News Keywords** — manage the `news_hunter_default_keywords` table. These keywords are used by anonymous visitors of the News Hunter dashboard and as the seed for new authenticated users (via `seed_my_news_hunter_keywords`). See section below.
- **Data Input** — editar linhas de tabelas de referência diretamente via PostgREST (ver seção abaixo).

## RPCs

| RPC | Tipo | Página |
|---|---|---|
| `get_my_profile` | leitura | profile |
| `upsert_my_profile` | escrita | profile (edição de nome) |
| `get_module_visibility` | leitura | admin-panel + UserProfileContext — retorna `(module_slug, is_visible_for_clients, is_visible_on_home, is_visible_for_public)` (Phase A) |
| `set_module_visibility` | escrita | admin-panel → aba Permissions (Clients toggle) |
| `set_module_home_visibility` | escrita | admin-panel → aba Permissions (Home column toggle) |
| `set_module_public_visibility` | escrita | admin-panel → aba Permissions (Public toggle); Admin-only, MFA-gated |
| `get_all_users_with_roles` | leitura | admin-panel |
| `set_user_role` | escrita | admin-panel |
| `seed_my_news_hunter_keywords` | escrita | first-login (chamada por dash-admin para popular keywords default no novo user) |
| `admin_list_default_news_keywords()` | leitura | admin-panel → Default News Keywords — `RETURNS TABLE(keyword text, match_type text, created_at timestamptz)` |
| `admin_add_default_news_keyword(p_keyword text, p_match_type text DEFAULT 'substring')` | escrita | admin-panel → Default News Keywords — idempotent; `RETURNS void` |
| `admin_set_default_news_keyword_match_type(p_keyword text, p_match_type text)` | escrita | admin-panel → Default News Keywords — `RETURNS void` |
| `admin_remove_default_news_keyword(p_keyword text)` | escrita | admin-panel → Default News Keywords — `RETURNS void` |
| `admin_list_subscribers(p_source_slug, p_limit)` | leitura | admin-panel → Alerts → Subscribers |
| `admin_force_unsubscribe(p_subscriber_id)` | escrita | admin-panel → Alerts → Subscribers (Force Unsubscribe) |
| `admin_requeue_outbox(p_outbox_id)` | escrita | admin-panel → Alerts → Outbox Repair (Requeue) |
| `admin_send_test_event(p_source_slug)` | escrita | admin-panel → Alerts → Sources (Send Test Event) |
| `admin_email_log_recent(p_limit)` | leitura | admin-panel → Alerts → Email Log |
| `admin_subscriber_stats()` | leitura | admin-panel → Alerts → Subscriber Stats |
| `admin_toggle_source_active(p_source_slug, p_is_active)` | escrita | admin-panel → Alerts → Sources (toggle is_active) |
| `get_data_sources_freshness()` | leitura | `/home` Data Sources live table — returns `(source_key, last_update, row_count)` for all ETL-fed tables; SECURITY DEFINER, anon + authenticated; migration `20260526200000` |

## Tabelas

### `profiles`
- PK: `id` (UUID, FK pra `auth.users.id`, ON DELETE CASCADE)
- Colunas: `role TEXT NOT NULL` ∈ {Admin, Client}, `full_name`, `avatar_url`, `created_at`
- RLS: cada user lê o próprio. Admin lê todos via RPC com `SECURITY DEFINER`.

### `module_visibility`
- PK: `module_slug`
- Colunas: `is_visible_for_clients BOOLEAN`, `is_visible_on_home BOOLEAN NOT NULL DEFAULT true`, `is_visible_for_public BOOLEAN NOT NULL DEFAULT true` (added 2026-05-21 via migration `20260522000001_anonymous_access.sql`)
- RLS: read for anon + authenticated (Phase A opened anon SELECT), write only via Admin RPC.
- `is_visible_for_public`: controls anonymous (logged-out) visitor access. Managed via Permissions tab "Public" column. RPC: `set_module_public_visibility` (Admin-only, MFA-gated).
- `is_visible_for_clients`: controls Client tier visibility only (Admin always sees). Managed via Permissions tab "Clients" column. RPC: `set_module_visibility`.
- `is_visible_on_home`: controls Home gallery visibility for ALL users including Admin. Managed via Permissions tab "Home" column (consolidated 2026-05-26 — previously a separate "Home Visibility" tab). Default `true` (backward-compatible). RPC: `set_module_home_visibility`.
- **Invariant (Public ⇒ Clients):** `is_visible_for_public = true` ⇒ `is_visible_for_clients = true`. Enforced by both a `CHECK` constraint (`module_visibility_public_implies_clients_chk`) and a `BEFORE INSERT/UPDATE` trigger that coerces clients=TRUE when public flips ON.

**Invariant (Home requires visibility):** `is_visible_on_home = true` ⇒ `(is_visible_for_public = true OR is_visible_for_clients = true)`. Enforced by migration `20260526900000_module_visibility_home_requires_visible.sql`. When both Public and Clients are false, the trigger coerces Home to false automatically. The UI mirrors this: the Home toggle is **disabled** (greyed out, cursor `not-allowed`, tooltip "Make the module visible to Public or Clients first") when both flags are false. Optimistic coercion in `handleToggle` and `handlePublicToggle` (inside `useAdminPanelData`) flips `localHomeVis[slug] = false` immediately so the UI updates before the round-trip completes; `refreshVisibility()` then reseeds from the DB-authoritative value.

> **Tech debt**: ambas criadas via [`sql/create_profiles_and_visibility.sql`](../../sql/create_profiles_and_visibility.sql) aplicado direto no Dashboard, **não em migration versionada**.

## Slugs gerenciados em `module_visibility`

Lista completa dos slugs atualmente registrados na tabela `module_visibility` (todos com `is_visible_for_clients = true` e `is_visible_on_home = true` por padrão):

> **Sales Volumes deprecation (2026-05-26)**: the `sales-volumes` row was removed from `module_visibility` by migration `20260526400000_drop_sv_rpcs.sql` when `/sales-volumes` was folded into `/market-share` (% Share ↔ thousand m³ via top-level unit toggle; `/sales-volumes` 301-redirects to `/market-share?unit=volume`). The legacy `sales` label still present in `MODULE_LABELS` (`useAdminPanelData.ts`) is a residual entry pending cleanup — it has no matching `module_visibility` row, so it renders as a dead toggle in the Permissions tab. Tracked for removal.

| Slug | Categoria | Label na UI |
|---|---|---|
| `market-share` | Fuel Distribution | Market Share (absorveu Sales Volumes em 2026-05-26) |
| `navios-diesel` | Fuel Distribution | Diesel Imports Line-Up |
| `diesel-gasoline-margins` | Fuel Distribution | Diesel and Gasoline Margins |
| `price-bands` | Fuel Distribution | Price Bands |
| `anp-precos-produtores` | Estatísticas / Fuel Distribution | ANP Preços Produtores |
| `anp-precos-distribuicao` | Estatísticas / Fuel Distribution | ANP Preços Distribuição |
| `anp-glp` | Estatísticas / Fuel Distribution | ANP GLP |
| `imports-exports` | Estatísticas / Fuel Distribution | Imports & Exports |
| `anp-lpc` | Estatísticas / Fuel Distribution | ANP LPC Preços |
| `well-by-well` | Estatísticas / Oil & Gas | Brazil Production Summary (Anon-hidden: `is_visible_for_public=false`) |
| `anp-cdp` | Estatísticas / Oil & Gas | Monthly Production |
| `anp-cdp-diaria` | Estatísticas / Oil & Gas | Daily Production |
| `anp-cdp-bsw` | Estatísticas / Oil & Gas | BSW by Well |
| `anp-cdp-depletion` | Estatísticas / Oil & Gas | Depletion |
| `stocks` | Other | Market Watch |
| `news-hunter` | Other | News Hunter |
| `alerts` | Tools | Alerts |

> Os toggles no `/admin-panel` (seção Permissions) e os slots de imagem (seção Card Images) são gerados automaticamente a partir de `MODULE_LABELS` em `admin-panel/page.tsx`. Os cards na `/home` são definidos em `HomeClient.tsx` (array `CARDS`).

## Sua RESPONSABILIDADE ESPECIAL — onboarding de dashboard novo

Workflow disparado pelo Subgerente APP quando ele cria um dashboard novo:

### Passos

1. **Inserir em `module_visibility`:**
   ```sql
   INSERT INTO module_visibility (module_slug, is_visible_for_clients, is_visible_on_home, is_visible_for_public)
   VALUES ('<slug>', true, true, true)
   ON CONFLICT (module_slug) DO NOTHING;
   ```
   *(default `is_visible_for_public = true` since 2026-05-21 — new modules are visible to anon by default; flip to `false` here if the module should be Client-or-Admin only at launch.)*

2. **Garantir toggle no `/admin-panel`** — a UI de admin-panel idealmente faz auto-discovery via query a `module_visibility`. Se não, adicionar explicitamente.

3. **Ícone na `/home`** — adicionar entrada em `src/data/moduleIcons.tsx` para o novo slug (SVG `getModuleIcon` registry). Home cards no longer use uploaded images — they use inline SVG icons since 2026-05-26. Without an icon entry the slot renders a generic fallback circle. The upload UI in `/admin-panel` was removed as orphan in 2026-05-26 (images are no longer rendered).

4. **Avisar Subgerente APP** que onboarding terminou.

## Alerts Product — section "alerts-product" (added 2026-05-25)

This section manages the cloud multi-recipient Alerts Product (`worker_alerts-product` domain). It is entirely separate from the legacy Alert Emails section (`alert_recipients` table) which manages local one-off notifications.

### Sub-sections

| ID | Panel | RPC / source |
|---|---|---|
| A | Subscriber Stats | `admin_subscriber_stats()` |
| B | Subscribers table | `admin_list_subscribers(p_source_slug?, p_limit)` + `admin_force_unsubscribe(id)` |
| C | Sources management | `alert_sources` (PostgREST) + `admin_toggle_source_active` + `admin_send_test_event` |
| D | Email Log | `admin_email_log_recent(p_limit)` |
| E | Outbox Repair | `alert_outbox` (PostgREST filtered by `status='failed'`) + `admin_requeue_outbox(id)` |

### RPC wrappers

All 7 RPCs + 2 PostgREST helpers are in `src/lib/alertsAdminRpc.ts`. This file is intentionally separate from `rpc.ts` (which `worker_dash-alerts` edits for user-facing wrappers) to avoid merge conflicts (Regra G).

### Module visibility

`alerts` was registered in `module_visibility` via migration `20260525230000_alerts_module_visibility.sql`:
- `is_visible_for_public = TRUE` — anonymous opt-in is the product's core value
- `is_visible_for_clients = TRUE`
- `is_visible_on_home = TRUE`

### Hook state

Loaded lazily when `activeSection === "alerts-product"`. All state lives in `useAdminPanelData`. No additional hooks needed.

### Dual-view sync

Both `desktop/View.tsx` and `mobile/View.tsx` received the Alerts section in the same commit. Mobile uses `MobileDataCard` rows for B/D/E. Desktop uses grid tables. Both use the same 5 sub-section structure.

## Default News Keywords — section "default-news"

Manages the `news_hunter_default_keywords` table, which is the single source of truth for:
1. Anonymous visitors of `/news-hunter` — served via the public RPC `get_default_news_keywords()`.
2. New authenticated users — `seed_my_news_hunter_keywords` inserts these as the user's personal starting set on first login.

### UI contract

- Header copy: "These keywords are used by anonymous visitors of the News Hunter dashboard. Logged-in users have their own personal keyword list."
- **Add form**: text input (placeholder `e.g. Petrobras, diesel, BNDES`) + "Exact match (whole word)" checkbox/toggle + "Add" button. Enter key triggers add. Button disabled while input is empty or a call is in flight. Success shows "✓ Added" for 2 seconds. After a successful add, the match type resets to `substring`.
- **Exact match (whole word) toggle**: available both in the add form (sets `match_type` for the new keyword) and on each existing keyword (toggles between `substring` and `exact` in-place via `admin_set_default_news_keyword_match_type`). Tooltip copy: "When enabled, only whole-word matches trigger an alert. Useful for short/generic terms like 'Vibra'." Disabled while a toggle is in-flight (`togglingMatchType` state).
- **"Exact" badge**: keywords with `match_type='exact'` show a small orange "EXACT" badge next to the keyword text. Desktop: displayed inside the chip, before the match-type toggle icon. Mobile: inline within the `MobileDataCard` title.
  - Desktop chip: toggle button uses `=` icon when substring (switch to exact), `≈` when exact (switch to substring), with dashed orange border when exact.
  - Mobile card: Bootstrap form-switch row below the keyword name; label reads "Exact match (whole word)" in orange when active, muted when inactive.
- **Duplicate validation**: client-side check (case-insensitive). If keyword already exists, shows a 4-second warning. RPC is idempotent so a race condition is safe.
- **Keyword list**: desktop uses chip tags with an × button (hover to reveal remove, click × to enter confirm-inline state). Mobile uses `MobileDataCard` per keyword with a "Remove" button that opens a `BottomSheet` confirm dialog.
- **Loading/empty states**: spinner while fetching, "No default keywords yet." when empty, search-aware "No keywords match your search." when search is active.
- **Error states**: banner above the list for load/remove errors; inline message below the input for add errors.

> **TODO — scanner repo** (`IBBAOG/news-hunter-scanner`): keywords with `match_type='exact'` should match only as whole-word (regex `\b<keyword>\b`, case-insensitive). Currently the scanner applies the same substring matching to all keywords — updating the scanner to respect `match_type` is **out of scope** for this task and must be done in the separate scanner repo.

### RPC wrappers (in `src/lib/rpc.ts`)

| Wrapper | RPC | Return type |
|---|---|---|
| `rpcAdminListDefaultNewsKeywords(supabase)` | `admin_list_default_news_keywords()` | `DefaultNewsKeyword[]` (keyword, match_type, created_at) — **throws on RPC error** (caller must catch) |
| `rpcAdminAddDefaultNewsKeyword(supabase, keyword, matchType?)` | `admin_add_default_news_keyword(p_keyword, p_match_type)` | `boolean` (success); `matchType` defaults to `'substring'` |
| `rpcAdminSetDefaultNewsKeywordMatchType(supabase, keyword, matchType)` | `admin_set_default_news_keyword_match_type(p_keyword, p_match_type)` | `boolean` (success) |
| `rpcAdminRemoveDefaultNewsKeyword(supabase, keyword)` | `admin_remove_default_news_keyword(p_keyword)` | `boolean` (success) |

All four RPCs are SECURITY DEFINER and call `require_admin_mfa()` server-side — Admin + verified MFA factor required.

### Hook state (in `useAdminPanelData.ts`)

Loaded on demand when `activeSection === "default-news"` (lazy, same pattern as Alert Emails).

| State | Type | Purpose |
|---|---|---|
| `defaultKeywords` | `DefaultNewsKeyword[]` | Current list from DB |
| `defaultKeywordsLoading` | `boolean` | Spinner |
| `defaultKeywordsError` | `string \| null` | Load/remove/toggle-type error banner |
| `newKeyword` | `string` | Controlled input |
| `newKeywordMatchType` | `'substring' \| 'exact'` | Match type for the next Add; resets to `'substring'` after success |
| `addingKeyword` | `boolean` | In-flight add |
| `addKeywordError` | `string \| null` | Inline add error |
| `addKeywordSuccess` | `boolean` | "✓ Added" flash |
| `removingKeyword` | `string \| null` | Currently being removed |
| `confirmRemoveKeyword` | `string \| null` | Desktop confirm-inline / mobile sheet trigger |
| `togglingMatchType` | `string \| null` | Keyword whose match_type is currently being toggled; disables all other toggle buttons while non-null |

### Dual-view sync

Both desktop and mobile were updated in the same commit. Desktop uses inline chip-tag UI with × button + confirm state. Mobile uses `MobileDataCard` rows + `BottomSheet` confirm dialog (same pattern as the existing Alert Emails section).

## Two-factor authentication (MFA TOTP) — F3.1

The platform supports TOTP-based MFA. Behaviour differs by role:

- **Admin** — MFA is **required** to perform admin actions. After enrolling and verifying a factor, the admin RPCs (`set_user_role`, `set_module_visibility`, `set_module_home_visibility`) refuse to run unless the caller has a verified factor in `auth.mfa_factors`. The DB-side guard is `public.require_admin_mfa()`. Admins reaching `/admin-panel` without a verified factor are redirected to `/profile/mfa` so they enroll before doing anything else.
- **Client** — MFA is **optional**. Clients can opt in from `/profile/mfa` for extra protection. There is no backend gate for Client RPCs.

### User-visible flow

| Step | UI |
|---|---|
| Enroll | `/profile/mfa` → "Enable MFA" → QR code + secret → enter 6-digit code → factor moves to `verified` |
| Sign-in (post-enroll) | `/login` after password challenge surfaces the `MfaChallenge` component until AAL2 is reached |
| Disable | `/profile/mfa` → "Disable". Blocked for Admins on their last verified factor |
| Admin guard | `useRoleGuard("Admin")` requires both verified factor and `currentLevel === 'aal2'`; otherwise redirects to `/profile/mfa` or `/login` |

### Pre-requisite

Supabase Dashboard → Authentication → Multi-Factor Auth → TOTP provider must be enabled. This is configured outside the codebase by the platform owner.

### Backend objects

| Object | Purpose |
|---|---|
| `public.has_verified_mfa(uuid)` | Boolean helper. SECURITY DEFINER (reads `auth.mfa_factors`). |
| `public.require_admin_mfa()` | Raises if caller has role Admin without a verified factor. Reused by admin RPCs. |
| `public.set_user_role` / `set_module_visibility` / `set_module_home_visibility` | All call `require_admin_mfa()` before mutation. |

Migration: `20260514120000_mfa_admin_required.sql`.

## Visibility flow (tempo de execução)

1. User loga.
2. `UserProfileContext` carrega `profiles` (próprio) + `module_visibility` (todos). Uma única chamada RPC `get_module_visibility` popula dois maps:
   - `moduleVisibility: Record<string, boolean>` — derivado de `is_visible_for_clients`
   - `homeVisibility: Record<string, boolean>` — derivado de `is_visible_on_home`
3. NavBar usa `moduleVisibility` pra filtrar `NAV_ENTRIES`:
   - Admin vê tudo.
   - Client vê só módulos onde `is_visible_for_clients = true`.
4. `/home` (HomeClient) aplica dois filtros combinados:
   - Primeiro: `homeVisibility[card.slug] ?? true` — para TODOS os usuários. Card com `false` some do Home inclusive pra Admin.
   - Segundo: `moduleVisibility` — só para Clients. Admin passa direto.
5. Cada módulo tem `useModuleVisibilityGuard("<slug>")` que bloqueia acesso direto via URL (não afetado pelo `homeVisibility` — é só visibilidade no Home).

## Componentes/CSS específicos

| Classe | Uso |
|---|---|
| `.role-badge--admin/--client` | Badge de role |
| `.nav-avatar-circle` | Avatar 32px na NavBar |
| `.profile-avatar-circle` | Avatar 72px no perfil |
| `.first-login-overlay`, `.first-login-modal` | Modal de "complete seu perfil" |
| `.profile-card`, `.settings-card` | Cards das páginas |
| `.profile-info-row/-label/-value` | Linhas de info |
| `.profile-name-edit-*` | Edição inline |

## Dependências cross-dept

| Origem | Como depende |
|---|---|
| Subgerente APP | Trigger do onboarding de dashboard novo |
| dash-news-hunter | first-login chama `seed_my_news_hunter_keywords` |
| Designer | Padrão liquid glass do profile card, cores de role badge |

## Data Input — seção de edição de tabelas de referência

Arquitetura extensível baseada em registry. Substitui o workflow de editar `data/*.xlsx` localmente e rodar `scripts/manual/*_upload.py`.

### Arquivos

| Arquivo | Função |
|---|---|
| `src/lib/dataInput/types.ts` | Tipos compartilhados (`EditableTableConfig`, `ColumnConfig`, `EditState`, `SaveResult`, etc.) |
| `src/lib/dataInput/registry.ts` | `EDITABLE_TABLES: EditableTableConfig[]` — lista de tabelas editáveis |
| `src/lib/dataInput/validation.ts` | Funções puras de validação (`validateCell`, `validateRow`, `validateAll`) |
| `src/lib/dataInput/persistence.ts` | `loadRows` + `saveChanges` (upsert + delete via PostgREST anon key); exports `coerceValue` helper reused by bulk upload |
| `src/lib/dataInput/bulkUpload.ts` | Bulk .xlsx parse + diff + upsert (`parseWorkbook`, `computeBulkDiff`, `bulkUpsert`). ExcelJS is dynamic-imported (browser-only, kept out of the initial bundle) |
| `src/components/dataInput/EditableTableEditor.tsx` | Editor de tabela inline (client component); mounts the bulk-upload button + modal when `config.bulkUpload` is set |
| `src/components/dataInput/BulkUploadModal.tsx` | Bulk .xlsx upload modal (choose file → preview insert/update diff + validation → confirm) |
| `src/components/dataInput/TableSelector.tsx` | Seletor de tabela (SegmentedToggle ≤4, select >4) |

### Tabelas atualmente registradas

| slug | tableName | conflictColumns | partitionBy |
|---|---|---|---|
| `price-bands` | `price_bands` | `['product', 'date']` | `product` (Diesel / Gasoline) |
| `d-g-margins` | `d_g_margins` | `['fuel_type', 'week']` | — |

### Como adicionar uma nova tabela

1. Appende uma entrada `EditableTableConfig` em `src/lib/dataInput/registry.ts`.
2. Crie uma migration com a policy RLS:
   ```sql
   CREATE POLICY "<table>_admin_write" ON public.<table>
     AS PERMISSIVE FOR ALL TO authenticated
     USING (public.is_admin()) WITH CHECK (public.is_admin());
   ```
3. Pronto — a UI pega automaticamente.

### RLS

As políticas de escrita para `price_bands` e `d_g_margins` são criadas pela migration
`supabase/migrations/20260512000000_data_input_admin_policies.sql` (worker_supabase, branch paralela).
Sem a migration, writes retornam 403 — a UI renderiza mas não persiste.

### Bulk .xlsx upload (upsert + preview) — 2026-06-03

The Data Input editor now lets an admin upload the **same multi-sheet `.xlsx`** they used to feed to `scripts/manual/price_bands_upload.py` / `scripts/manual/dg_margins_upload.py`, directly from the browser — no local Python run needed. Excel-only (no CSV, no paste). **Desktop-only** (the whole `/admin-panel` is desktop-only — no dual-view sync).

**Where:** a "Bulk upload (.xlsx)" button appears in the editor toolbar whenever the active table's registry config declares a `bulkUpload` spec. Currently both registered tables have one (`price-bands`, `d-g-margins`).

**Flow (modal):** choose file → parse → **preview** → confirm.
- **Preview** shows: sheets found (expected sheets highlighted), total rows parsed, **N to insert / M to update** (diff computed against the rows currently loaded in the editor, by the conflict-key tuple), plus a scrollable list of validation errors and warnings (each tagged with sheet + Excel row number). Hard errors disable the Confirm button.
- **Merge semantics:** upsert on `conflictColumns` (`product+date` for Price Bands, `fuel_type+week` for D&G Margins). Existing keys are updated, new keys inserted; **nothing is deleted**. Written in chunks of 500.

**Per-sheet header maps** (declared in `registry.ts` under `bulkUpload.sheets[].headerMap`, mirroring the Python scripts):

| Table | Sheet | partitionValue | Excel headers → DB columns |
|---|---|---|---|
| Price Bands | `Diesel` | `Diesel` | `Date`→`date`, `BBA - Import Parity`→`bba_import_parity`, `BBA - Export Parity`→`bba_export_parity`, `Petrobras Price`→`petrobras_price` |
| Price Bands | `Gasoline` | `Gasoline` | `Date`→`date`, `IBBA - Import Parity`→`bba_import_parity`, `IBBA - Export Parity`→`bba_export_parity`, `Petrobras Price`→`petrobras_price` |
| D&G Margins | `Diesel B` | `Diesel B` | `Week`→`week`, `Distribution and Resale Margin`→`distribution_and_resale_margin`, `State Tax`→`state_tax`, `Federal Tax`→`federal_tax`, `Total`→`total`, `Biodiesel`→`biofuel_component`, `Diesel A`→`base_fuel` |
| D&G Margins | `Gasoline C` | `Gasoline C` | `Week`→`week`, `Distribution and Resale Margin`→`distribution_and_resale_margin`, `State Tax`→`state_tax`, `Federal Tax`→`federal_tax`, `Total`→`total`, `Anhydrous Ethanol`→`biofuel_component`, `Gasoline A`→`base_fuel` |

Notes:
- The Excel header is `Distribution and Resale Margin` ("and"); the registry column label is `Distribution & Resale Margin` ("&"). The header map bridges this — the file must use "and".
- `Date` cells (ExcelJS `Date` objects) are converted to ISO `YYYY-MM-DD` (read in UTC to avoid an off-by-one day). Rows with no/invalid Date are skipped. D&G rows with empty/`nan` Week are skipped (same as the Python scripts).
- **`_w_subsidy` columns are never sent.** They aren't in the registry, and the upsert allowlist (registry columns + conflict columns; `id` excluded so Postgres auto-generates) strips everything else. Obsolete columns like `BBA - Import Parity w/ subsidy` in older templates are simply not mapped and ignored silently.
- **Validation is lenient for non-key columns:** NULL/empty is allowed (the Python upserts insert NULLs freely and that data already lives in the DB). Hard errors only for malformed type/format (e.g. a non-numeric value in a number column, a Week not matching `WW/YYYY`) or a missing conflict-key column. Missing/empty conflict-key rows are skipped, not errored.

**Implementation files:** `src/lib/dataInput/types.ts` (`BulkUploadConfig`, `BulkSheetMap`, `BulkParseResult`, `BulkRowError`), `src/lib/dataInput/registry.ts` (`bulkUpload` on both tables), `src/lib/dataInput/bulkUpload.ts` (`parseWorkbook` / `computeBulkDiff` / `bulkUpsert`), `src/lib/dataInput/persistence.ts` (exported `coerceValue`), `src/components/dataInput/EditableTableEditor.tsx` (button + modal wiring), `src/components/dataInput/BulkUploadModal.tsx` (modal UI).

**No DB / RLS / migration change** — reuses the existing Admin upsert RLS on both tables (the same policy the single-row editor uses) and the shared `src/lib/supabaseClient` instance.

## Changelog — Price Bands form simplification + `anp_subsidy_history` cleanup (2026-05-27)

The Data Input → Price Bands form previously exposed 6 columns for Diesel: `Date`, `BBA Import Parity`, `BBA Import Parity w/ Subsidy`, `BBA Export Parity`, `Petrobras Price`, `Petrobras Price w/ Subsidy`. The two `_w_subsidy` columns are now **populated automatically** by SQL triggers (migration `20260527200000_subsidy_reform.sql`) from ANP reference + commercialization data — admins no longer enter them by hand.

**Form is now 4 columns**: `Date`, `BBA Import Parity`, `BBA Export Parity`, `Petrobras Price` (same set for both Diesel and Gasoline partitions).

**Why the two `_w_subsidy` inputs were removed:**
- DB triggers (`populate_pb_w_subsidy_on_insert` on `price_bands`, plus recompute triggers on `anp_subsidy_diesel_reference`, `anp_subsidy_commercialization`, and `anp_subsidy_caps`) now keep both columns in sync automatically.
- Manual entry would be overwritten by the next trigger fire — so editing them by hand created a confusing "your input vs trigger value" race.

**Implementation:**

| File | Change |
|---|---|
| `src/lib/dataInput/registry.ts` | Dropped the two `_w_subsidy` `ColumnConfig` entries. Added an `infoNote` on the Price Bands table: "Subsidy-adjusted values … are computed automatically from ANP data". |
| `src/lib/dataInput/types.ts` | Added optional `infoNote?: string` field to `EditableTableConfig`. |
| `src/lib/dataInput/persistence.ts` | **Critical:** added an allowlist filter (registry columns + conflict columns + `id`) before pushing to PostgREST. Without this, the existing-row upsert path was round-tripping the DB-read `bba_import_parity_w_subsidy` / `petrobras_price_w_subsidy` values back into the table, overwriting the trigger-computed values. The filter applies to both edited-row and draft payloads. |
| `src/components/dataInput/EditableTableEditor.tsx` | Renders the new `infoNote` as a small orange banner above the partition toggle. |
| `docs/app/admin.md` | This Changelog entry + updated `anp_subsidy_history` references. |

**Subsidy caps UI — intentionally not added.** The brief allowed an optional new tab for editing `anp_subsidy_caps` (the new table replacing `anp_subsidy_history`, PK `(vigente_desde, tipo_agente)`). Caps are 4 seed rows with very low edit frequency — managed via SQL/migrations is enough. Building a CRUD form for them would also require a new SECURITY DEFINER RPC (`anp_subsidy_caps` write is service-role-only, so the registry's PostgREST upsert path can't reach it). The form is deferred until there's actual demand for runtime edits.

**No mobile change** — Data Input is desktop-only (mobile shows a "Desktop only" placeholder card). Sync rule satisfied: this is a desktop-only enhancement to a desktop-only feature; no `[desktop-only]` tag needed in the commit because mobile has nothing equivalent to update.

**Stale `anp_subsidy_history` reference fixed:** the only remaining src/ reference was a comment in `src/lib/rpc.ts` inside the Subsidy Tracker module section (owned by `worker_dash-subsidy-tracker`). Left untouched here per ownership rules — that worker rewrites the section as part of the same reform.

---

## Changelog — Permissions toggle UX fixes (2026-05-26 → 2026-05-27)

Two UX fixes applied to the Permissions tab toggles (both desktop and mobile views).

**Fix 1 — Remove checkmark from switch pill (second attempt, 2026-05-27).** The check visible after clicking a toggle was not from Bootstrap's CSS background-image at all — it was the `✓` / `<CheckIcon>` save-confirmation span (`settings-saved-tick`) rendered directly beside the toggle input in the same 90px flex container. After the RPC round-trip completed, the span animated in via `fadeInTick` (scale + opacity), appearing to sit "on" the toggle. The first attempt (commit `63849680`) incorrectly targeted Bootstrap's `background-image` via `globals.css`. The real fix (this commit) removes `justSavedPublic`, `justSavedClient`, and `justSavedHome` spans from the three toggle columns in both desktop (`desktop/View.tsx`) and mobile (`mobile/View.tsx`) views. The corresponding `savedSlug`, `savedPublicSlug`, `savedHomeSlug` destructures are also dropped from both views since they are no longer used. Auto-save toggles are self-confirming via state change; no post-save tick is needed. The `globals.css` `background-image` override from the first attempt is retained (belt-and-suspenders).

**Fix 2 — Home toggle disabled when both Public and Clients are false.** Mirrors the DB invariant from migration `20260526900000_module_visibility_home_requires_visible.sql`. Implementation:
- `useAdminPanelData` state declarations for all three visibility axes (`localVis`, `localHomeVis`, `localPublicVis`) are now grouped together before the handlers to avoid forward-reference issues.
- `handleToggle` (Clients): when toggling Clients to `false` and Public is already `false`, optimistically coerces `localHomeVis[slug] = false`.
- `handlePublicToggle`: when toggling Public to `false` and Clients was already `false`, optimistically coerces `localHomeVis[slug] = false`. After successful save, `refreshVisibility()` re-seeds from the DB-authoritative value (DB trigger has already zeroed home).
- Both views compute `homeDisabled = !isPublicVisible && !isClientVisible` per module. When `true`: toggle is `disabled`, opacity `0.4`, cursor `not-allowed`. Tooltip: "Make the module visible to Public or Clients first". The `checked` prop is also forced to `false` when `homeDisabled` to ensure consistent UI state.
- Mobile: the Home row sub-label changes to "Requires Public or Clients to be on" when disabled.

---

## Changelog — Consolidate Home toggle into Permissions tab (2026-05-26)

The separate "Home Visibility" tab (section ID `card-images`) was removed. The `is_visible_on_home` toggle is now a third column inside the **Permissions** tab alongside Public and Clients.

**Motivation:** the three visibility axes (`is_visible_for_public`, `is_visible_for_clients`, `is_visible_on_home`) are per-module settings that affect how a module is accessed and surfaced. Splitting one of them into a separate tab was an artificial separation that forced admins to switch tabs to configure a single module.

**Changes:**

| File | Change |
|---|---|
| `useAdminPanelData.ts` | `SectionId` union: removed `"card-images"`. `SECTIONS` array: removed the "Home Visibility" entry. Hook comments updated. |
| `desktop/View.tsx` | `SECTION_ICONS`: removed `"card-images"` entry. Permissions section: added "Home" column header (width 90px) and Home toggle per row, reusing `localHomeVis` / `handleHomeToggle` / `savingHome` / `savedHomeSlug` / `homeToggleError`. Descriptive list updated to three bullet points. Removed the entire `activeSection === "card-images"` block. |
| `mobile/View.tsx` | `searchPlaceholder` map: removed `"card-images"` key. Permissions section: added third toggle row "Home — Show card in /home gallery" inside each module article. Removed the entire `activeSection === "card-images"` block. File header comment updated. |
| `docs/app/admin.md` | This entry + all references to `card-images` tab / "Home Visibility" tab updated to reflect Permissions consolidation. |

**No DB/RPC changes** — `set_module_home_visibility` is still the RPC; only the UI surface moved.

---

## Changelog — Remove Admin section from home cards (2026-05-26)

The "Admin" category section (Profile + Admin Panel cards) was removed from `/home` — the home is now identical for all roles (Anon / Client / Admin).

Profile and Admin Panel remain accessible via the NavBar (avatar dropdown / admin link). They are tools, not dashboard modules, and do not belong in the module gallery.

**Changes:**

| File | Change |
|---|---|
| `useHomeData.ts` | `HomeCategory` type dropped `"admin"` variant; `HomeSectionState` dropped `admin` key; `ADMIN_CARDS` constant removed; `cardsByCategory` memo simplified — no longer appends static admin entries per-role |
| `desktop/View.tsx` | Removed `admin` from `CATEGORY_ORDER`, `CATEGORY_LABELS`, `CATEGORY_ACCENT` |
| `mobile/View.tsx` | Removed `admin` from `CATEGORY_ORDER`, `CATEGORY_LABELS`, `CATEGORY_ACCENT`, `CATEGORY_ACCENT_SOFT`; updated file-header comment (4× → 3× sections) |

The slugs `profile` and `admin-panel` remain registered in `src/data/moduleIcons.tsx` (used elsewhere, e.g. NavBar) and are **not** touched.

---

## Changelog — Drop orphan `card_previews` table + Storage bucket (2026-05-26)

Final cleanup of the `/home` icon redesign series. With all `src/` code paths to `card_previews` already deleted (commits `5eb97335`, `249a8270`, `d5f92cd9`), the matching database table and Supabase Storage bucket were also dropped.

**Database:** migration `supabase/migrations/20260526600000_drop_card_previews.sql` — `DROP TABLE IF EXISTS public.card_previews CASCADE`.

**Storage:** bucket `card-previews` deleted out-of-band (rows removed from `storage.objects` first, then row removed from `storage.buckets`). File count purged is reported in the commit body.

**Verification:** post-deploy, `SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='card_previews'` and `SELECT 1 FROM storage.buckets WHERE id='card-previews'` both return zero rows.

No frontend or backend code references either resource after this commit. Closes the `worker_supabase` follow-up noted in the previous changelog entry below.

## Changelog — Delete dead card_previews code paths (2026-05-26)

Deep cleanup following the icon redesign and admin-panel upload removal. All remaining dead code referencing the old uploaded-image system was deleted.

**Files deleted:**

| File | Reason |
|---|---|
| `src/app/(dashboard)/home/HomeClient.tsx` | Orphaned — superseded by `HomeRouter` + dual-view; not imported anywhere |
| `src/lib/cardPreviewRpc.ts` | Orphaned — `getCardPreviews` / `uploadCardPreview` helpers with no callers |
| `src/app/api/card-previews/route.ts` | API route consumed exclusively by the deleted RPC lib |
| `src/app/api/upload-card-preview/route.ts` | API route consumed exclusively by the deleted RPC lib |

**Files simplified:**

| File | Change |
|---|---|
| `src/app/(dashboard)/home/page.tsx` | Dropped `getCardPreviews()` server-side fetch + `force-dynamic`; now a thin `<HomeRouter />` wrapper |
| `src/app/(dashboard)/home/HomeRouter.tsx` | Dropped `initialPreviews` prop and `HomeRouterProps` interface |
| `src/app/(dashboard)/home/desktop/View.tsx` | Dropped `DesktopViewProps` interface and unused `initialPreviews` parameter |
| `src/app/(dashboard)/admin-panel/useAdminPanelData.ts` | Updated stale comment pointing to `HomeClient` → `src/data/moduleIcons.tsx` |

**Note:** `card_previews` DB table and `card-previews` Storage bucket remain intact (no data deleted). Cleanup of those is a separate `worker_supabase` task.

## Changelog — Remove orphan image upload from Card Images tab (2026-05-26)

Follow-up to the `/home` icon-list redesign. Since module cards no longer use uploaded preview images (replaced by inline SVG icons), the upload machinery in the admin panel served no purpose.

**Changes in this commit:**

| File | Change |
|---|---|
| `useAdminPanelData.ts` | Removed `localPreviews`, `uploadingSlug`, `savedPreviewSlug`, `uploadError`, `handlePreviewUpload` state and `getCardPreviews`/`uploadCardPreview` imports; removed fields from `UseAdminPanelData` interface; renamed section label from "Card Images" → "Home Visibility" |
| `desktop/View.tsx` | Removed upload UI (thumbnail + "Upload image" button + saved/error indicators); replaced heading/description; restructured to 2-column grid (Module / Show on Home); removed `Image` import |
| `mobile/View.tsx` | Removed thumbnail row and Upload button from Card Images articles; section now shows label+description + toggle only; removed `Image` import |
| `docs/app/admin.md` | Updated section description, axis table, Wave 5 notes, and onboarding step 3 |

**Orphan DB/Storage:** the `card_previews` table and `card-previews` Supabase Storage bucket are still intact — no data was deleted. The API routes `/api/card-previews` and `/api/upload-card-preview` are also still present. These are candidates for cleanup by `worker_supabase` if the bucket and table are confirmed unused.

## Changelog — Home cards redesign: icon list (2026-05-26)

**Both desktop and mobile** views were redesigned in the same commit (`feat(home): replace image cards with icon+name list`).

| Change | Desktop | Mobile |
|---|---|---|
| Layout | Vertical list, one card per row, inside the existing 70% left column | Same vertical list, replacing gradient-thumbnail cards |
| Icon source | `src/data/moduleIcons.tsx` (centralized, 18 slugs) | Same `moduleIcons.tsx` — previously each view had its own inline SVG definitions |
| Icon size | 20×20 in a 40×40 rounded bubble | 20×20 in a 40×40 rounded bubble |
| Hover/press state | Orange icon color + glow shadow + translateX(4px) + left accent bar slides in | Pressed: orange icon + accent-left bar via `inset box-shadow` + translateX(3px) on chevron |
| Category headers | `SectionHeader` with category-color bar + horizontal divider | Section header with category-color dot |
| Image cards | Removed (large 220px photo cards) | Removed (gradient thumbnail + description rows) |
| `initialPreviews` prop | Still in signature (backward-compat with `page.tsx` server fetch) but not rendered | N/A (mobile never used server-fetched previews) |

**New file:** `src/data/moduleIcons.tsx` — module-level SVG icon registry. Exports `getModuleIcon(slug, size, strokeWidth)` and individual `Icon*` named components. Covers all 18 slugs currently in `module_visibility` + profile/admin-panel static entries.

**Admin-panel Card Images tab** (upload images per module + Show on Home toggle) is **preserved** — the toggle still controls `is_visible_on_home`. The uploaded images are no longer rendered in `/home` but the upload machinery remains intact. Cleanup of the upload UI in admin-panel is tracked as a follow-up task.

## Changelog — Data Sources table QA fixes (2026-05-26)

### Ad-hoc sources: cronUtc corrected + Next-run line hidden

`anp_subsidy_history` was removed from `src/data/dataSources.ts` (table dropped by migration `20260527200000_subsidy_reform.sql`). Replaced by two new entries: `anp_subsidy_caps` (ad-hoc, admin-edited cap rates) and `anp_subsidy_commercialization` (daily scrape, same schedule as `anp_subsidy_diesel_reference`). `price_bands` remains `cronUtc: null` (ad-hoc).

`ExpandedRow.tsx` already gates the "Next run" row on `src.cronUtc !== null` — no change needed there; the upstream `dataSources.ts` fix was sufficient.

### Header LIVE dot: worst-row status aggregation

`src/components/home/DataSourcesTable/status.ts` — new shared helper module:
- `deriveStatus(src, lastUpdate: string | null): SourceStatus` — single function for status derivation.
- `aggregateStatus(statuses: SourceStatus[]): SourceStatus` — returns the worst status.
- `statusToTokenVar(status): string` — maps to `--ds-status-*` CSS tokens.

`StatusDot.tsx` now imports `deriveStatus` + `statusToTokenVar` from this shared module (inline logic removed).

`index.tsx` computes `headerColor` via `useMemo` over all `DATA_SOURCES`, deriving + aggregating status for every row — the header dot's `background` and `color` inline styles now reflect the worst row status instead of hardcoded green. Pulse animation class (`ds-pulse`) is unchanged and runs continuously.

## Changelog — post-reform cleanup (2026-05-25)

After the Imports & Exports reform (`24dd2aa1`), three stale references to the retired dashboards were removed from `/home`:

| File | Change |
|---|---|
| `mobile/View.tsx` | Removed dead slug icons `anp-daie`, `anp-desembaracos`, `anp-painel-importacoes`; added `imports-exports` icon (globe + bidirectional arrows) |
| `useHomeData.ts` | Removed stale `SLUG_CATEGORY` entries for the 3 retired slugs; added `imports-exports: "fuel"` |
| `useHomeData.ts` + `HomeClient.tsx` | Softened `imports-exports` card description — now reads "ANP fuel imports and exports — origins, customs clearances, and (after backfill) importers" |

### `/mdic-comex` deprecation cleanup (2026-05-25)

`/mdic-comex` was retired (route folder deletion and RPC cleanup handled by W2). Admin-bundle references removed:

| File | Change |
|---|---|
| `HomeClient.tsx` | Removed `mdic-comex` entry from `CARDS` array |
| `useHomeData.ts` | Removed `mdic-comex` entry from `CARDS` array and `"mdic-comex": "oilgas"` from `SLUG_CATEGORY` |
| `mobile/View.tsx` | Removed `mdic-comex` icon from `CategoryIcon` slug map |
| `useAdminPanelData.ts` | Removed `{ slug: "mdic-comex", … }` row from `MODULE_LABELS` |
| `docs/app/admin.md` | Removed `mdic-comex` from slug table |

## Known bugs fixed

### `null value in column "date"` on draft save (2026-05-12)

**Symptom**: user adds a new row, fills all fields including date via the calendar picker, clicks Save — Postgres returns `null value in column "date"`.

**Root cause**: stale-closure race in React 19 concurrent mode. `handleSave` checked `saveDisabled`, a derived variable captured in the render closure. A `blur` on the date input right before the click could commit a new state (`date: null`) after the render that set `saveDisabled=false`, letting the old closure skip the guard while `drafts` already reflected the invalid state.

**Fix (commit 69a8839e)**:
- `EditableTableEditor.tsx` — `handleSave` now re-validates all drafts and edited rows from current committed state before calling `saveChanges`.
- `persistence.ts` — `saveChanges` now (a) coerces number strings to JS numbers for PostgREST, and (b) short-circuits with a clear error if any required column in a draft is null/undefined, blocking the Postgres call entirely.

## Security — Email Enumeration (F2.3, 2026-05-14)

`handleAddRecipient` in `admin-panel/page.tsx` previously differentiated error `23505` (duplicate key) with the message "This email is already registered.", enabling an Admin-credential attacker to enumerate registered emails via the Alert Emails form.

**Fix:** both error paths now return the same generic message: "Could not add recipient. Please verify the email and try again."

`loadRecipients` also exposed raw Postgres error messages via `setRecipientsError(error.message)`. Replaced with "Could not load recipients. Please try again."

`forgot-password/page.tsx` and `login/page.tsx` were audited and confirmed clean: forgot-password always shows generic success (catch also calls `setSent(true)`), and login uses a single "Incorrect email or password." message regardless of error type.

## Changelog — Team contacts card above DataSources table (2026-05-26) `[desktop-only]`

A glass-styled **Team Panel** was added to the right column of `/home` desktop view, positioned above the DataSourcesTable.

**New files:**

| File | Purpose |
|---|---|
| `src/components/home/TeamPanel/index.tsx` | Client component — renders 3 contact entries; each row is an `<a href="mailto:...">` |
| `src/components/home/TeamPanel/TeamPanel.module.css` | Glass card styles matching DataSourcesTable (same tokens: `--ds-glass-bg`, `--ds-glass-border`, `--ds-glass-backdrop`, `--ds-glass-shadow`); hover lift (translateY -1px), envelope icon reveal (opacity 0 → 1), dark-mode aware text colors |

**Modified file:**

| File | Change |
|---|---|
| `src/app/(dashboard)/home/desktop/View.tsx` | Import `TeamPanel`; render `<TeamPanel />` + `<div style={{ marginBottom: 12 }} />` + `<DataSourcesTable />` inside the right-column `<section>` |

**Contacts (hardcoded in component):**

```
Monique Greco     monique.greco@itaubba.com
Eric de Mello     eric.mello@itaubba.com
Eduardo Mendes    eduardo.mendes@itaubba.com
```

**Design decisions:**
- "TEAM" header: same `.header` class style as `.tableHeader` in DataSourcesTable — 11px Courier New, 700, 0.1em letter-spacing, uppercase, black light / white dark.
- Container: reuses the same glass token set (`--ds-glass-*`) as `.tableRoot` — identical padding, border-radius 4px, backdrop blur.
- No avatars — column is 30% wide; initials or photos would be noisy.
- Click target is the full `<a>` row, not just the email text.
- Envelope icon (Bootstrap Icons `bi bi-envelope`) is always in the DOM but `opacity: 0` by default; `opacity: 1` on `.row:hover` via CSS sibling rule.
- Separator between entries: `border-bottom: 1px solid var(--ds-glass-border)` on `.entry`; last child omits it via `:last-child { border-bottom: none }`.
- `mobile/View.tsx` is **untouched** — mobile does not show the right column.

---

## Changelog — dataSources catalog: subsidy reform (2026-05-27)

`anp_subsidy_history` entry removed from `src/data/dataSources.ts` — the table was dropped by migration `20260527200000_subsidy_reform.sql`. Replaced by two new entries in the `anp-distribution` category:

| key | name | schedule | staleAfterHours |
|---|---|---|---|
| `anp_subsidy_caps` | ANP Subsidy Caps | Ad-hoc (admin-edited) | 720 (30 days) |
| `anp_subsidy_commercialization` | ANP Subsidy Commercialization Prices | Daily at 11:30 UTC | 36 |

`anp_subsidy_diesel_reference` is **unchanged** — it remains a valid, active entry.

Catalog count moves from 17 → 19 entries. The QA fixes changelog entry (Data Sources table QA) was also updated to reflect the removal.

---

## Field Stakes (Fase 1 — 2026-05-27)

New `Field Stakes` section in the `/admin-panel` sidebar — CRUD for per-oil-field working-interest data. Curated by Admins; consumed in Fase 2 by the future `/production` dashboard (separate PRD), which will join `anp_cdp_producao` × `field_stakes` to derive company-attributable production.

### Backing schema

Source-of-truth migration: [`supabase/migrations/20260527600000_field_stakes.sql`](../../supabase/migrations/20260527600000_field_stakes.sql) — owned by `worker_supabase` (Frente 1 of the parallel rollout).

Table shape (per migration):
```sql
field_stakes (
  campo       text   NOT NULL,
  empresa     text   NOT NULL,
  stake_pct   numeric NOT NULL CHECK (stake_pct >= 0 AND stake_pct <= 100),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campo, empresa)
)
```

Invariant: `SUM(stake_pct) = 100` per campo — enforced server-side by `admin_upsert_field_stakes`, not by a table CHECK (cross-row checks belong in the write RPC).

RLS pattern: all 5 RPCs are `SECURITY DEFINER` + `SET search_path = public, pg_temp`. Read RPCs (`get_*`) are admin-only via in-body `require_admin_mfa()` (or equivalent role check); write RPCs (`admin_*`) likewise.

### RPCs consumed by this section (5)

| RPC | Wrapper in `src/lib/rpc.ts` | Returns |
|---|---|---|
| `get_field_stakes_overview()` | `rpcGetFieldStakesOverview(supabase)` | `FieldStakeOverview[]` — one row per field with `n_empresas`, `soma_pct`, `is_complete`, `has_data_in_producao`, `last_updated` |
| `get_field_stakes(p_campo text)` | `rpcGetFieldStakes(supabase, campo)` | `FieldStake[]` — `(empresa, stake_pct, updated_at)` ordered by `stake_pct DESC` |
| `get_field_stakes_empresas()` | `rpcGetFieldStakesEmpresas(supabase)` | `FieldStakeEmpresa[]` — distinct companies + `n_campos`; drives autocomplete |
| `admin_upsert_field_stakes(p_campo text, p_stakes jsonb)` | `rpcAdminUpsertFieldStakes(supabase, campo, stakes)` | void — replace-all per campo; validates sum=100; raises `sum_must_equal_100` (or similar) on failure |
| `admin_delete_field_stakes(p_campo text)` | `rpcAdminDeleteFieldStakes(supabase, campo)` | void — wipes every row for `campo` |

Types live in [`src/types/fieldStakes.ts`](../../src/types/fieldStakes.ts).

### Save flow

1. User taps a field in the left list (desktop) or card (mobile) → `handleSelectCampo(campo)` calls `rpcGetFieldStakes(supabase, campo)`, populates `editorStakes` working copy, snapshots it for change-detection via `editorSavedSnapshotRef`.
2. User edits rows / adds new company / removes a row → local state mutations update `editorStakes`; `pendingChanges` (memo) flips true when the JSON shape differs from the snapshot.
3. `currentSum` (memo) recomputes on every edit; `isValidSum` is `|currentSum - 100| < 0.001` (float tolerance).
4. Save button is disabled unless `isValidSum && pendingChanges && !savingStakes`. Tooltip explains the reason when disabled.
5. On click: `rpcAdminUpsertFieldStakes` (atomic replace-all). On error → message banner displays the raw postgres message verbatim (acceptable here because the only errors are sum-mismatch / similar curated server messages); on success → `editorSavedSnapshotRef` re-snaps, overview list is refetched.

The payload is sent as JS array; supabase-js auto-serializes it to JSONB because the RPC declares `p_stakes jsonb`. **No manual `JSON.stringify` is needed** (Frente 1 contract).

### Delete flow

1. "Delete all stakes for this field" footer button (desktop link or mobile button) → `handleDeleteCampo(selectedCampo)` sets `deleteCampoConfirm` to the campo name.
2. Modal (desktop overlay) / BottomSheet (mobile) appears with explicit Cancel / Confirm buttons. Copy: *"Delete all stakes for «{campo}»? This cannot be undone."*
3. Confirm → `rpcAdminDeleteFieldStakes`; on success the overview refreshes and the selection is cleared (`selectedCampo = null`).

### Dual-view layout

**Desktop** (`desktop/View.tsx`, branch `activeSection === "field-stakes"`):

- Two panes inside `.settings-card`:
  - Left (340 px): scrollable list of all fields. Status pill colors — green `100%`, amber `{soma}%`, gray `—` for empty. 4-button status filter row (All / ✓ / ⚠ / ○) with count badges. Search input filters by campo (case-insensitive substring).
  - Right: editor table with `Company` (text + `<datalist>` autocomplete) | `Stake %` (number, step 0.001, range 0–100) | `×` (remove). Sum pill in header colored green/red against 100%. `+ Add company` row below the table; "Last updated" line in header; error banner under the table; footer with Save (primary) + Delete-all (text button).
- Empty state in the right pane when nothing is selected: *"Select a field on the left to edit its working-interest breakdown."*
- Delete confirm: full-screen overlay modal (`position: fixed; inset: 0; background: rgba(0,0,0,0.45)`).

**Mobile** (`mobile/View.tsx`, branch `activeSection === "field-stakes"`):

- Sticky horizontal status-chip row (All / ✓ Complete / ⚠ Incomplete / ○ Empty), each chip with a count badge. Search input below.
- Vertical list of campo cards (44+ px tap target). Tap → `await handleSelectCampo(row.campo); setFieldStakesSheetOpen(true)`.
- Editor `BottomSheet` (`height="90vh"`): header shows campo name (ellipsized) + sum pill on the right. Scrollable body contains one card per stake (full-width company input, full-width stake % with `%` suffix, top-right remove ×). `+ Add company` card at the bottom (dashed border). "Delete all stakes for this field" outline button just above the sticky footer. Sticky footer: error banner + Save button (full width, label flips to "Sum must equal 100%" / "No changes" / "Saving…" / "Save").
- Delete confirm: separate `BottomSheet` (`height="auto"`) with Cancel/Delete buttons (matches the recipient-remove pattern).

Mobile-only state: `fieldStakesSheetOpen` (local `useState`) controls the editor sheet visibility, decoupled from the shared `selectedCampo` so closing the sheet preserves the user's selection. The shared search input at the top of the mobile View is suppressed for this section (`searchPlaceholder["field-stakes"] === ""`); the section has its own dedicated search inside the sticky filter area.

### Hook (`useAdminPanelData`)

State added (alphabetized for grep-ability):
- `deleteCampoConfirm: string | null`
- `editorLoading: boolean`
- `editorStakes: FieldStakeInput[]`
- `expandedCanonicals: Set<string>` (Round 4 — see "Canonical grouping" below)
- `fieldStakesEmpresas: FieldStakeEmpresa[]`
- `fieldStakesLoading: boolean`
- `fieldStakesOverview: FieldStakeOverview[]`
- `newEmpresaInput: string` / `newEmpresaPctInput: string`
- `savingStakes: boolean`
- `selectedCampo: string | null` / `selectedCampoLastUpdated: string | null`
- `stakesError: string | null`
- `stakesSearchQuery: string` / `stakesStatusFilter: 'all' | 'complete' | 'incomplete' | 'empty'`

Plus the `editorSavedSnapshotRef: useRef<string>` (intentionally not state — change-detection only) and `seedSeenRef: useRef<Set<string>>` (Round 4 — tracks canonical groups already seen so admins can manually collapse a group without it being re-expanded on every overview refresh).

Handlers: `handleSelectCampo`, `handleAddEmpresaRow`, `handleRemoveEmpresaRow`, `handleChangeStake`, `handleSaveStakes`, `handleDeleteCampo`, `handleConfirmDeleteCampo`, `handleCancelDeleteCampo`, `handleToggleCanonical` (Round 4).

Derived (`useMemo`): `currentSum`, `isValidSum`, `pendingChanges`, `filteredOverview`, `groupedOverview` (Round 4).

Lazy-load: `loadFieldStakesOverview()` only fires when `activeSection === 'field-stakes'` for the first time (same pattern as `alerts-product` and `default-news`).

### Canonical grouping (Round 4 — 2026-05-28)

Several variants of the same physical field (e.g. concession `Búzios`, coparticipação `AnC_Búzios`, cessão onerosa excedente `Búzios_ECO`) share the same canonical (family) name but have legitimately different stake compositions per contract type. Admin input has to keep them separate at the DB level so each contract's stakes can be edited independently, but seeing a flat list of ~300 campos with every Búzios variant scattered alphabetically made navigation painful.

Round 4 (Frente C) introduces a **canonical grouping layer** in the left-pane list. The right-pane editor is unchanged — it still acts on ONE variant at a time.

**Backing data**: the `get_field_stakes_overview` RPC (modified by Frente A in migration `20260528300000_well_by_well_round4.sql`) gains a `canonical text` column. Server-side it is computed by `public.canonical_field_name(p_variant text)` — strips `AnC_` / `EX_` prefixes and `_ECO` / `_EX` suffixes, plus an optional override table `field_canonical_names`. Type `FieldStakeOverview.canonical: string` mirrors it (see `src/types/fieldStakes.ts`).

**`groupedOverview` derivation** (in `useAdminPanelData.ts`):
- Groups `filteredOverview` by `canonical` (falls back to `campo` when null — defensive against older RPC payloads).
- Within each group, the variant whose name equals the canonical (the "base" variant, if present) comes first; remaining variants sort alphabetically.
- Groups themselves are sorted alphabetically by canonical (case-insensitive).
- Returns `FieldStakeCanonicalGroup[]` with aggregate flags:
  - `all_complete` — every variant has `soma_pct = 100`
  - `any_incomplete` — at least one variant has stakes but `soma_pct ≠ 100`
  - `all_empty` — every variant has `n_empresas = 0`

**Aggregate group status pill** (rendered in the group header):
| State | Source | Color | Text |
|---|---|---|---|
| Complete | `all_complete` | green | `100%` |
| Mixed | some variants complete, others not | amber (lighter bg) | `Mixed` |
| Incomplete | `any_incomplete && !mixed` | amber | `{first variant's soma_pct}%` |
| Empty | `all_empty` | gray | `—` |

**Expansion behavior**:
- `expandedCanonicals: Set<string>` — controls which multi-variant groups are open.
- **Default**: multi-variant groups are auto-expanded the FIRST time they appear in the data (so admins immediately see all variants of Búzios etc.). A `seedSeenRef` tracks which canonicals have been auto-seeded so manually collapsing a group is preserved across overview refreshes (the seed effect only runs for newly observed canonicals).
- Single-variant groups have no chevron and never appear in this set — they render inline (clicking the row selects the variant directly).
- `handleToggleCanonical(canonical)` flips membership.

**Search integration** — `filteredOverview` now matches if EITHER the variant name OR the canonical contains the query (case-insensitive substring). Typing "buzios" surfaces all 3 Búzios variants at once. Status filter (`complete` / `incomplete` / `empty` / `all`) continues to operate on individual variants.

**Desktop UI** (`desktop/View.tsx`):
- Single-variant groups: the row is the variant selector. Same look as the pre-Round-4 flat row.
- Multi-variant groups: a header row with chevron + canonical name (bold) + `N variants` pill + aggregate status pill, on a faint orange background. When expanded, variants are listed indented 30px below the header, with a slightly smaller font and lighter divider.
- Selected variant continues to show the orange left-edge accent bar.

**Mobile UI** (`mobile/View.tsx`):
- Single-variant groups: same card as before (tap → open editor BottomSheet).
- Multi-variant groups: a card with a header row (chevron + canonical + `N variants` pill + aggregate status). Tap the header to expand inline; the variants appear stacked inside the same card body, separated by `--mobile-border` lines and indented 32px. Tap a variant → opens the editor BottomSheet on THAT variant.

**Right-pane / BottomSheet editor — UNCHANGED.** The editor still receives `selectedCampo` (a single variant name), still calls `rpcGetFieldStakes(supabase, selectedCampo)`, and still validates `SUM = 100` per variant. This is intentional: Búzios concession's stakes (Petrobras 88.99% + CNOOC 7.34% + CNPC 3.67%) differ from AnC_Búzios coparticipação and Búzios_ECO cessão onerosa excedente — they cannot be edited as a single block.

**Dashboard side (`/well-by-well`)** is the place where variants ARE aggregated: Top Fields chart, drill-down timeseries, and KPI cards sum production across all variants of a canonical (handled server-side by Frente A in the same migration via the updated `get_production_top_fields` and `get_production_field_timeseries` RPCs). The admin panel remains the only surface where individual variants are visible per-row.

### Sub-PRD links

- Migration owner: `supabase/migrations/20260527600000_field_stakes.sql` (worker_supabase)
- Future consumer: `/production` dashboard, Fase 2 (separate PRD)
- Types: `src/types/fieldStakes.ts`
- RPC wrappers: `src/lib/rpc.ts` § "MODULE: Admin — Field Stakes"

---

## Anti-padrões

- Páginas administrativas sem `useRoleGuard("Admin")`.
- Esquecer `module_visibility` ao onboardar módulo novo (Cliente não vê).
- Esquecer slot de imagem na home (CEO vai notar).
- Mexer no padrão de avatar / first-login modal sem consultar Designer.
- Adicionar role novo sem revisar CHECK constraint + RLS de outras tabelas.
- Expor mensagem raw de erro do Postgres no frontend — usar mensagem genérica sempre.
