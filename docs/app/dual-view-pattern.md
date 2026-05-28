# Dual-view dashboard pattern (Fase 1 — 2026-05)

Every dashboard ships **two Views** — desktop (PC, ≥769px) and mobile (phone, ≤768px) — driven by a **single shared hook** that owns all data, filters, and derivations.

> Mobile is **"same analysis, adapted clothing"** — never a different brain. If a View needs a value the other doesn't have yet, you add it to the hook first; both Views pick it up automatically.

This document is the canonical copy-paste reference for `worker_dash-*` agents refactoring an existing dashboard or creating a new one.

---

## 1. File layout

```
src/app/(dashboard)/<slug>/
├── page.tsx                 ← viewport router (useIsMobile → desktop or mobile)
├── use<Slug>Data.ts         ← THE BRAIN — RPCs, filters, derivations, types
├── desktop/
│   └── View.tsx             ← desktop UX (existing layout migrates here)
└── mobile/
    └── View.tsx             ← mobile UX (mobile-first, redesigned from scratch)
```

All four files are owned by the dashboard's `worker_dash-<slug>`. Shared mobile components live under `src/components/dashboard/mobile/` (owned by `worker_designer`); shared desktop components live under `src/components/dashboard/`.

---

## 2. `page.tsx` — viewport router

This file does one thing: pick the View based on `useIsMobile()`.

```tsx
"use client";

import { useIsMobile } from "@/hooks/useIsMobile";
import DesktopView from "./desktop/View";
import MobileView from "./mobile/View";

export default function Page(): React.ReactElement {
  const isMobile = useIsMobile();
  return isMobile ? <MobileView /> : <DesktopView />;
}
```

`useIsMobile()` is SSR-safe — returns `false` during SSR + first paint, then flips to the real value after mount.

---

## 3. `use<Slug>Data.ts` — the brain

Contract every dashboard hook follows:

```ts
export interface Use<Slug>Data {
  data: <RowShape>[];
  loading: boolean;
  error: Error | null;
  filters: <Filters>;
  setFilters: (next: Partial<<Filters>>) => void;
}
```

Rules:
- All Supabase RPC calls live here. Views NEVER call `supabase.rpc(...)` directly, nor import `rpc.ts` wrappers themselves.
- All filter state, debounce logic, fetch-id race-protection, and unit conversions live here.
- All derived values (e.g. KPI totals, sorted slices, top-N rollups) are exposed by the hook.
- TypeScript propagates the return shape into both Views; structural drift between desktop and mobile is impossible by construction.

Skeleton with stale-fetch protection:

```ts
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { rpcGetMyDashboardSerie } from "@/lib/rpc";

export interface MyDashboardFilters {
  dataInicio: string | null;
  dataFim: string | null;
}

export interface MyDashboardRow {
  date: string;
  value: number;
}

export interface UseMyDashboardData {
  data: MyDashboardRow[];
  loading: boolean;
  error: Error | null;
  filters: MyDashboardFilters;
  setFilters: (next: Partial<MyDashboardFilters>) => void;
}

const DEFAULT_FILTERS: MyDashboardFilters = { dataInicio: null, dataFim: null };

export function useMyDashboardData(): UseMyDashboardData {
  const supabase = getSupabaseClient();
  const [filters, setFiltersState] = useState<MyDashboardFilters>(DEFAULT_FILTERS);
  const [data, setData] = useState<MyDashboardRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const fetchIdRef = useRef(0);

  const setFilters = useCallback((next: Partial<MyDashboardFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...next }));
  }, []);

  const applied = useMemo(
    () => ({ dataInicio: filters.dataInicio, dataFim: filters.dataFim }),
    [filters.dataInicio, filters.dataFim],
  );

  useEffect(() => {
    if (!supabase) return;
    const id = ++fetchIdRef.current;
    setLoading(true);
    setError(null);
    rpcGetMyDashboardSerie(supabase, applied)
      .then((rows) => {
        if (id !== fetchIdRef.current) return;
        setData(rows);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (id !== fetchIdRef.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
  }, [supabase, applied]);

  return { data, loading, error, filters, setFilters };
}
```

---

## 4. `desktop/View.tsx`

Hosts the existing desktop layout (sidebar, multi-column grid, etc.). When migrating an existing dashboard:
- Move the body of the old `page.tsx` here, unchanged.
- Replace inline `useState`/`useEffect`/RPC plumbing with reads from the hook.
- Continue using shared desktop components from `src/components/dashboard/` (`DashboardHeader`, `MultiSelectFilter`, `ChartSection`, `ExportPanel`, etc.).

```tsx
"use client";

import { useMyDashboardData } from "../useMyDashboardData";

export default function DesktopView(): React.ReactElement {
  const { data, loading, error, filters, setFilters } = useMyDashboardData();
  // ... existing desktop layout, but reading from the hook
}
```

---

## 5. `mobile/View.tsx`

Mobile-first redesign — NOT a copy of the desktop. The `mobile/View.tsx` is rendered **inside `MobileShell`**, which provides the global chrome (top bar with kebab menu, floating Home pill, toast host). Dashboards do NOT render their own top bar, footer or PWA prompt — those come from `(dashboard)/layout.tsx`.

Compose shared mobile components from `src/components/dashboard/mobile/` (owned by `worker_designer`).

Layout primitives (composed inside the View body):
- `BottomSheet` — slide-up panels for filters or detail drilldowns
- `FilterDrawer` — full-height filter pane
- `MobileChart` — viewport-aware Plotly wrapper
- `MobileDataCard` — touch-friendly KPI card
- `StickyBreadcrumb` — sticky context bar
- `MobileHomeIconTile` — bento launcher tile used by `/home` mobile (variants `default` / `compact`); tinted squircle icon badge + title, paired with `getTileMeta(slug)` from `mobileHomeTiles.tsx` for the palette + glyph mapping

Global chrome (mounted ONCE by `MobileShell`, NOT by individual Views):
- `MobileTopBar` (centered SectorData wordmark on `leftSlot`, `MobileKebabMenu` on `rightSlot`)
- `MobileHomePill` (single floating capsule, auto-hidden on `/home`)
- `MobileToastHost` (listens for `app-toast` `CustomEvent`)

Legacy components (kept for reference but NOT mounted in any post-reform dashboard):
- `MobileNavBar`, `MobileTabBar`, `ExportFAB` — superseded by the single Home pill + kebab + desktop-only export policy from the 2026-05-27 reform.

Constraints from `docs/design/best-practices.md`:
- Touch targets ≥44×44px.
- No horizontal scroll (charts and tables must adapt or paginate).
- Filters always reachable from the visible viewport (no buried "scroll to find").
- Mobile is **light-only** — never assume `prefers-color-scheme: dark` (the `--mobile-*` tokens have no dark variants).
- **Export is desktop-only** — never mount `ExportFAB`; never wire a download button in `mobile/View.tsx`.

```tsx
"use client";

import { useMyDashboardData } from "../useMyDashboardData";

export default function MobileView(): React.ReactElement {
  const { data, loading, error, filters, setFilters } = useMyDashboardData();
  // ... mobile-first layout, composing mobile shared components.
  // Do NOT render <MobileNavBar />, <MobileTabBar />, <ExportFAB />,
  // <Footer />, or <PWAInstallPrompt /> — chrome lives in MobileShell.
}
```

### 5.1. Excluded routes (mobile redirect pattern)

Some dashboards are explicitly **off-limits on mobile** (e.g. `/stocks`, `/admin-panel`, `/admin-analytics`, `/news-hunter`, `/alerts`, `/profile`, `/anp-cdp`, `/anp-prices`, `/anp-glp` — list maintained in `docs/app/PRD.md` § Mobile reform). For these, do NOT keep a `mobile/View.tsx`. Instead, the `page.tsx` mounts `MobileExcludedRedirect` next to `DesktopView`:

```tsx
"use client";

import MobileExcludedRedirect from "@/components/dashboard/mobile/MobileExcludedRedirect";
import DesktopView from "./desktop/View";

export default function Page(): React.ReactElement {
  return (
    <>
      <MobileExcludedRedirect slug="<slug>" displayName="<Display Name>" />
      <DesktopView />
    </>
  );
}
```

On mobile, the redirect component fires `router.replace("/home?excluded=<slug>")` + dispatches a `CustomEvent("app-toast", { detail: { message: "<Display> is available only on desktop", tone: "info" } })`. `MobileToastHost` (mounted by `MobileShell`) survives the route change and renders the toast on `/home`. On desktop, `MobileExcludedRedirect` renders `null` and `DesktopView` mounts normally.

### 5.2. Cross-component communication via `app-toast`

Any client component can fire a transient pill message:

```ts
if (typeof window !== "undefined") {
  window.dispatchEvent(
    new CustomEvent("app-toast", {
      detail: { message: "Saved", tone: "info", source: "my-component" },
    }),
  );
}
```

`MobileToastHost` listens once at the layout level and renders the most recent message (single-slot — new events replace the previous toast). Tones: `info` (default, white-on-glass), `warning` (amber), `error` (red). Default auto-dismiss 3000ms.

### 5.3. Last-visited tracking

`useTrackLastVisited` (mounted ONCE at `DashboardShell`, NOT per page) writes a FIFO of the last 4 visited dashboard slugs to `localStorage["sd_last_visited"]`. The mobile `/home v2` View consumes it via `readLastVisited()` from `@/hooks/useTrackLastVisited` to render the horizontal "Last visited" pill row.

Excluded prefixes (never written): `/login`, `/profile`, `/admin-panel`, `/admin-analytics`, `/terms`, `/privacy`, `/home`, `/mobile-preview`. Storage namespace `sd_*` (never `sb-*` — reserved by Supabase Auth).

---

## 6. Binding sync rule (enforcement)

Every meaningful change to one View must land in the OTHER View **in the same commit**, OR the commit message must declare `[desktop-only]` / `[mobile-only]` with an explicit reason.

| Change | Rule |
|---|---|
| New filter | Both Views, same commit |
| New chart / KPI | Both Views, same commit |
| New export option | Both Views, same commit |
| Copy change (labels, titles, empty states) | Both Views, same commit |
| RPC / schema change | `worker_supabase` (DB) + `worker_dash-<slug>` (hook + both Views), same commit |
| Pure visual tweak that doesn't change content | View-specific allowed, no tag needed |

Enforcement layers:
1. **TypeScript** — hook propagates types into both Views; structural drift is a compile error.
2. **`worker_revisor-qa`** — pre-commit audit of View edits.
3. **`worker_documentador`** — periodic audit of `docs/app/<slug>.md` vs. both Views.

---

## 7. Shared infrastructure

### 7.1. Built in Fase 1 (foundation, 2026-05-20)

| File | Purpose |
|---|---|
| [`src/hooks/useIsMobile.ts`](../../src/hooks/useIsMobile.ts) | Viewport detector (SSR-safe, 768px threshold) — single source of breakpoint truth |
| [`public/manifest.json`](../../public/manifest.json) | PWA manifest — app name SectorData, theme `#ff5000`, standalone display |
| [`public/sw.js`](../../public/sw.js) | Minimal service worker — Add-to-Home-Screen support only, no business-data caching |
| [`src/components/PWAInstallPrompt.tsx`](../../src/components/PWAInstallPrompt.tsx) | Dismissable install banner (desktop chrome — rendered only by `DesktopShell`) |
| [`src/components/ServiceWorkerRegister.tsx`](../../src/components/ServiceWorkerRegister.tsx) | Registers `/sw.js` once after mount (production only) |
| [`src/app/(dashboard)/template-module/`](../../src/app/(dashboard)/template-module/) | Canonical dual-view starter template |

### 7.2. Built in the mobile reform (2026-05-27)

| File | Purpose |
|---|---|
| [`src/app/(dashboard)/layout.tsx`](../../src/app/(dashboard)/layout.tsx) | `DashboardShell` switcher — picks `DesktopShell` or `MobileShell` based on `useIsMobile()`. Mounts `useTrackLastVisited` once at the shell level. |
| [`src/components/dashboard/mobile/MobileHomePill.tsx`](../../src/components/dashboard/mobile/MobileHomePill.tsx) | Single floating capsule (bottom-center). Routes to `/home`. Auto-hides when already on `/home`. Replaced the legacy 4-icon tab bar. |
| [`src/components/dashboard/mobile/MobileKebabMenu.tsx`](../../src/components/dashboard/mobile/MobileKebabMenu.tsx) | 3-dot button in top bar `rightSlot`. Opens a `BottomSheet` with Sign out. Auto-hides for Anon. |
| [`src/components/dashboard/mobile/MobileExcludedRedirect.tsx`](../../src/components/dashboard/mobile/MobileExcludedRedirect.tsx) | Side-effect component mounted by excluded-route `page.tsx`. Fires `router.replace` + `app-toast` on mobile; `null` on desktop. |
| [`src/components/dashboard/mobile/MobileToastHost.tsx`](../../src/components/dashboard/mobile/MobileToastHost.tsx) | Global listener for `window` `app-toast` `CustomEvent`. Renders a single Liquid Glass pill (`info`/`warning`/`error`). Mounted by `MobileShell`. |
| [`src/components/dashboard/mobile/MobileHomeIconTile.tsx`](../../src/components/dashboard/mobile/MobileHomeIconTile.tsx) | Bento launcher tile used exclusively by `/home` mobile (Onda 5 visual refresh, 2026-05-28). Tinted squircle icon badge (44×44) + dashboard title; variants `default` (88px) / `compact` (56px). Liquid Glass v2 layering. Pair with `getTileMeta(slug)` from [`mobileHomeTiles.tsx`](../../src/components/dashboard/mobile/mobileHomeTiles.tsx) — single source of truth for the 13-slug palette + icon mapping. |
| [`src/hooks/useTrackLastVisited.ts`](../../src/hooks/useTrackLastVisited.ts) | Mounts a fire-and-forget effect that pushes the current pathname slug onto a FIFO of 4 entries in `localStorage["sd_last_visited"]`. Exports `readLastVisited()` for consumers. |

Mobile design tokens (`--mobile-bg`, `--mobile-text`, `--mobile-text-muted`, `--mobile-accent`, `--mobile-accent-glow`, `--mobile-glass-bg`, `--mobile-glass-border`, `--mobile-glass-blur`, `--mobile-glass-shadow`, `--mobile-row-press`, `--mobile-safe-top`, `--mobile-safe-bottom`, `--mobile-topbar-h`, `--mobile-tabbar-h`, `--mobile-up`, `--mobile-down`) live in `src/app/globals.css` "Mobile design system" block — light-only, no dark variants.

---

## 8. Migration recipe (existing dashboard → dual-view)

For a `worker_dash-<slug>` refactoring an existing dashboard:

1. Create `desktop/` and `mobile/` folders inside the dashboard route.
2. Create `use<Slug>Data.ts` next to `page.tsx`.
3. Move every `useState`, `useEffect`, RPC call, derivation, and unit conversion from `page.tsx` into the hook. Expose them via the canonical interface.
4. Cut the rendered JSX from `page.tsx` and paste it into `desktop/View.tsx`. Replace local state/effects with hook reads.
5. Rewrite `page.tsx` to be the 5-line viewport router.
6. Build `mobile/View.tsx` from scratch, composing mobile shared components, mobile-first. Do NOT render the global chrome (top bar / Home pill / footer) — `MobileShell` already does.
7. Update `docs/app/<slug>.md` to declare the dashboard is dual-view and list both Views' analyses.
8. Smoke-test desktop and mobile in dev server (`preview_start` + `preview_screenshot` at viewport widths 1280 and 375).

### 8.1. Exclusion variant (dashboard not viable on mobile)

If the dashboard is in the **mobile-excluded list** (see `docs/app/PRD.md` § Mobile reform):

1. Skip step 6 above (no `mobile/View.tsx`).
2. Delete any pre-existing `mobile/` folder for the route.
3. Rewrite `page.tsx` as the 5-line excluded-route pattern from § 5.1.
4. Update `docs/app/<slug>.md` declaring the dashboard is **desktop-only** with the redirect rationale.
