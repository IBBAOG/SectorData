"use client";

import { useTemplateModuleData } from "../useTemplateModuleData";

/**
 * Mobile view of the template module.
 *
 * This is the layer dashboards on ≤768px get. Implementation guidance:
 *   - Mobile-first layout. NO sidebar — use a top-of-page filter trigger
 *     opening a `BottomSheet` / `FilterDrawer` from the shared mobile
 *     components.
 *   - Touch targets ≥44×44px (per `docs/design/best-practices.md`).
 *   - Compose mobile shared components from
 *     `src/components/dashboard/mobile/` once they land from worker_designer:
 *     MobileNavBar, BottomSheet, FilterDrawer, MobileChart, MobileDataCard,
 *     StickyBreadcrumb, ExportFAB, MobileTabBar.
 *
 * Binding sync rule: any meaningful change here (new filter, new chart, new
 * KPI) must land in desktop/View.tsx in the SAME commit, OR the commit
 * message must declare `[mobile-only]` with an explicit reason. See
 * CLAUDE.md § "Dual-view (web + mobile) policy".
 *
 * TODO (Phase 2 — once worker_designer's branch lands): swap the plain
 * divs/buttons below for the real mobile components. The current markup is
 * deliberately minimal so the template compiles independently.
 */
export default function MobileView(): React.ReactElement {
  const { data, loading, error } = useTemplateModuleData();

  return (
    <div
      style={{
        padding: 16,
        fontFamily: "Arial, sans-serif",
        // TODO: replace with MobileNavBar layout when designer's branch lands.
      }}
    >
      <h1 style={{ fontSize: 18, fontWeight: 600, color: "#1a1a1a", marginBottom: 4 }}>
        Template Module
      </h1>
      <p style={{ fontSize: 12, color: "#6b6b73", marginBottom: 12 }}>
        Mobile placeholder. Same data, mobile-first presentation.
      </p>

      {error ? (
        <div style={{ color: "#dc2626", fontSize: 13 }}>
          Error loading data: {error.message}
        </div>
      ) : loading ? (
        <div style={{ color: "#6b6b73", fontSize: 13 }}>Loading…</div>
      ) : (
        <div
          style={{
            padding: 12,
            border: "1px solid #e6e6ec",
            borderRadius: 12,
            background: "#ffffff",
            fontSize: 13,
            color: "#1a1a1a",
          }}
        >
          {/* TODO: replace with MobileDataCard when designer's branch lands. */}
          Rows loaded: <strong>{data.length}</strong>
        </div>
      )}
    </div>
  );
}
