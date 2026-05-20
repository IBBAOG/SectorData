"use client";

import { useTemplateModuleData } from "../useTemplateModuleData";

/**
 * Desktop view of the template module.
 *
 * This is the layer dashboards on ≥769px get. Implementation guidance for
 * real dashboards (when refactoring desktop into this file):
 *   - Move the existing page.tsx body here, unchanged.
 *   - Replace inline RPC calls + useState/useEffect data plumbing with
 *     reads from the shared hook (`useTemplateModuleData`).
 *   - Keep all desktop-only UX (sidebar, filter panel, multi-column grid).
 *   - Compose desktop shared components from `src/components/dashboard/`
 *     (DashboardHeader, MultiSelectFilter, ChartSection, ExportPanel...).
 *
 * Binding sync rule: any meaningful change here (new filter, new chart, new
 * KPI) must land in mobile/View.tsx in the SAME commit, OR the commit
 * message must declare `[desktop-only]` with an explicit reason. See
 * CLAUDE.md § "Dual-view (web + mobile) policy".
 */
export default function DesktopView(): React.ReactElement {
  const { data, loading, error } = useTemplateModuleData();

  return (
    <div style={{ padding: 24, fontFamily: "Arial, sans-serif" }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, color: "#1a1a1a", marginBottom: 4 }}>
        Template Module (Desktop)
      </h1>
      <p style={{ fontSize: 13, color: "#6b6b73", marginBottom: 16 }}>
        Replace this placeholder with the real dashboard layout when copying the
        template. Both Views consume the same hook in
        <code> useTemplateModuleData.ts</code>.
      </p>

      {error ? (
        <div style={{ color: "#dc2626", fontSize: 13 }}>
          Error loading data: {error.message}
        </div>
      ) : loading ? (
        <div style={{ color: "#6b6b73", fontSize: 13 }}>Loading…</div>
      ) : (
        <div style={{ fontSize: 13, color: "#1a1a1a" }}>
          Rows loaded: <strong>{data.length}</strong>
        </div>
      )}
    </div>
  );
}
