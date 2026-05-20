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

Mobile-first redesign — NOT a copy of the desktop. Compose shared mobile components from `src/components/dashboard/mobile/` (owned by `worker_designer`):

- `MobileNavBar` — top bar
- `BottomSheet` — slide-up panels for filters or detail drilldowns
- `FilterDrawer` — full-height filter pane
- `MobileChart` — viewport-aware Plotly wrapper
- `MobileDataCard` — touch-friendly KPI card
- `StickyBreadcrumb` — sticky context bar
- `ExportFAB` — floating export action button
- `MobileTabBar` — bottom tab navigation

Constraints from `docs/design/best-practices.md`:
- Touch targets ≥44×44px.
- No horizontal scroll (charts and tables must adapt or paginate).
- Filters always reachable from the visible viewport (no buried "scroll to find").

```tsx
"use client";

import { useMyDashboardData } from "../useMyDashboardData";

export default function MobileView(): React.ReactElement {
  const { data, loading, error, filters, setFilters } = useMyDashboardData();
  // ... mobile-first layout, composing mobile shared components
}
```

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

## 7. Shared infrastructure (Fase 1 — already built)

| File | Purpose |
|---|---|
| [`src/hooks/useIsMobile.ts`](../../src/hooks/useIsMobile.ts) | Viewport detector (SSR-safe, 768px threshold) — single source of breakpoint truth |
| [`public/manifest.json`](../../public/manifest.json) | PWA manifest — app name SectorData, theme `#ff5000`, standalone display |
| [`public/sw.js`](../../public/sw.js) | Minimal service worker — Add-to-Home-Screen support only, no business-data caching |
| [`src/components/PWAInstallPrompt.tsx`](../../src/components/PWAInstallPrompt.tsx) | Dismissable install banner (mobile-only, localStorage dismissal) |
| [`src/components/ServiceWorkerRegister.tsx`](../../src/components/ServiceWorkerRegister.tsx) | Registers `/sw.js` once after mount (production only) |
| [`src/app/(dashboard)/template-module/`](../../src/app/(dashboard)/template-module/) | Canonical dual-view starter template |

Mobile design tokens and the 8 shared mobile components are being delivered in parallel by `worker_designer`. See `docs/design/identity.md` (when published) and the 6 approved mockups in `mockups/*-mobile.html`.

---

## 8. Migration recipe (existing dashboard → dual-view)

For a `worker_dash-<slug>` refactoring an existing dashboard in Phase 2:

1. Create `desktop/` and `mobile/` folders inside the dashboard route.
2. Create `use<Slug>Data.ts` next to `page.tsx`.
3. Move every `useState`, `useEffect`, RPC call, derivation, and unit conversion from `page.tsx` into the hook. Expose them via the canonical interface.
4. Cut the rendered JSX from `page.tsx` and paste it into `desktop/View.tsx`. Replace local state/effects with hook reads.
5. Rewrite `page.tsx` to be the 5-line viewport router.
6. Build `mobile/View.tsx` from scratch, composing mobile shared components, mobile-first.
7. Update `docs/app/<slug>.md` to declare the dashboard is dual-view and list both Views' analyses.
8. Smoke-test desktop and mobile in dev server (`preview_start` + `preview_screenshot` at viewport widths 1280 and 375).
