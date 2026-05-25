"use client";

// Mobile view for /imports-exports (≤768px).
//
// Same analysis as desktop/View.tsx — same hook, same data, adapted shell:
//   - MobileTabBar for Imports / Exports switching
//   - FilterDrawer triggered by a sticky filter button (product + period)
//   - Panels stack vertically
//   - Charts via MobileChart
//   - YoY rows via MobileDataCard
//   - ExportFAB for export trigger
//
// Binding sync rule: any meaningful change to data/filters here must land
// in desktop/View.tsx in the same commit (CLAUDE.md § Dual-view policy).

import dynamic from "next/dynamic";
import type { Layout, PlotData } from "plotly.js";
import { useMemo, useState } from "react";

import MobileTabBar from "@/components/dashboard/mobile/MobileTabBar";
import FilterDrawer from "@/components/dashboard/mobile/FilterDrawer";
import MobileDataCard from "@/components/dashboard/mobile/MobileDataCard";
import ExportFAB from "@/components/dashboard/mobile/ExportFAB";
import BarrelLoading from "@/components/dashboard/BarrelLoading";

import { useImportsExportsData } from "../useImportsExportsData";
import type {
  UnifiedProduct,
  ExportsSerieRow,
  YoyTableRow,
} from "../useImportsExportsData";

import { COMMON_LAYOUT, AXIS_LINE, PALETTE } from "@/lib/plotlyDefaults";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

// ─── Colour helpers ────────────────────────────────────────────────────────────

const OTHERS_COLOR = "#bdbdbd";

function colourForEntity(entities: string[], entity: string): string {
  if (entity === "Others") return OTHERS_COLOR;
  const idx = entities.filter((e) => e !== "Others").indexOf(entity);
  return PALETTE[idx % PALETTE.length] ?? OTHERS_COLOR;
}

// ─── Stacked bar builder (same logic as desktop) ───────────────────────────────

type StackedRow = { ano: number; mes: number; name: string; value: number };

function buildStackedTraces(rows: StackedRow[], unit: string): PlotData[] {
  if (!rows.length) return [];
  const xSet = new Set<string>();
  const entitySet = new Set<string>();
  for (const r of rows) {
    xSet.add(`${r.ano}-${String(r.mes).padStart(2, "0")}`);
    entitySet.add(r.name);
  }
  const xs = Array.from(xSet).sort();
  const entities = [
    ...Array.from(entitySet).filter((e) => e !== "Others").sort(),
    ...(entitySet.has("Others") ? ["Others"] : []),
  ];
  const lookup = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const key = `${r.ano}-${String(r.mes).padStart(2, "0")}`;
    if (!lookup.has(r.name)) lookup.set(r.name, new Map());
    lookup.get(r.name)!.set(key, r.value);
  }
  return entities.map((entity) => ({
    type: "bar" as const,
    name: entity,
    x: xs,
    y: xs.map((x) => lookup.get(entity)?.get(x) ?? 0),
    marker: { color: colourForEntity(entities, entity) },
    hovertemplate: `%{x}<br>${entity}: %{y:,.1f} ${unit}<extra></extra>`,
  })) as unknown as PlotData[];
}

function mobileBarLayout(yLabel: string): Partial<Layout> {
  return {
    ...COMMON_LAYOUT,
    barmode: "stack" as const,
    height: 280,
    margin: { t: 8, b: 52, l: 52, r: 8 },
    xaxis: {
      ...AXIS_LINE,
      tickangle: -60,
      tickfont: { family: "Arial", size: 8 },
    },
    yaxis: {
      ...AXIS_LINE,
      title: { text: yLabel, font: { family: "Arial", size: 10 } },
      tickformat: ",.1f",
    },
    legend: {
      orientation: "h" as const,
      x: 0,
      y: -0.28,
      font: { family: "Arial", size: 9 },
    },
  };
}

// ─── YoY row as MobileDataCard ─────────────────────────────────────────────────

function YoYCardList({
  rows,
  loading,
  volumeLabel,
}: {
  rows: YoyTableRow[];
  loading: boolean;
  volumeLabel: string;
}) {
  if (loading) {
    return (
      <div style={{ padding: "8px 16px", color: "#aaa", fontSize: 12 }}>
        Loading...
      </div>
    );
  }
  if (!rows.length) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {rows.map((row) => {
        const yoyColor =
          row.yoy_pct == null
            ? "#aaa"
            : row.yoy_pct > 0
            ? "#16a34a"
            : row.yoy_pct < 0
            ? "#dc2626"
            : "#555";

        const yoyText =
          row.yoy_pct == null
            ? "n/a"
            : `${row.yoy_pct > 0 ? "+" : ""}${row.yoy_pct.toFixed(1)}%`;

        const rightSlot = (
          <div style={{ textAlign: "right", fontFamily: "Arial" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1a1a" }}>
              {row.last_12m.toLocaleString("en-US", { maximumFractionDigits: 1 })}{" "}
              <span style={{ fontSize: 10, color: "#888" }}>{volumeLabel}</span>
            </div>
            <div style={{ fontSize: 12, color: yoyColor, fontWeight: 600, marginTop: 2 }}>
              {yoyText}
            </div>
          </div>
        );

        return (
          <MobileDataCard
            key={row.entity}
            title={row.entity}
            subtitle={`Prior 12m: ${row.prev_12m.toLocaleString("en-US", { maximumFractionDigits: 1 })} ${volumeLabel}`}
            rightSlot={rightSlot}
            variant="compact"
          />
        );
      })}
    </div>
  );
}

// ─── Importer empty state ──────────────────────────────────────────────────────

function ImporterEmptyStateMobile() {
  return (
    <div
      style={{
        margin: "0 16px",
        padding: "24px 16px",
        textAlign: "center",
        background: "#fafafa",
        border: "1px dashed #ddd",
        borderRadius: 12,
        fontFamily: "Arial",
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, color: "#555", marginBottom: 6 }}>
        Importer-level data is being processed.
      </div>
      <div style={{ fontSize: 11, color: "#888" }}>
        Expected after the next <code>etl_anp_fase3.yml</code> run.
      </div>
    </div>
  );
}

// ─── Section heading ───────────────────────────────────────────────────────────

function SectionHeading({
  title,
  loading,
}: {
  title: string;
  loading?: boolean;
}) {
  return (
    <div
      style={{
        padding: "12px 16px 6px",
        fontFamily: "Arial",
        fontSize: 13,
        fontWeight: 700,
        color: "#1a1a1a",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      {title}
      {loading && (
        <span style={{ fontSize: 11, color: "#aaa", fontWeight: 400 }}>
          updating…
        </span>
      )}
    </div>
  );
}

// ─── Products ──────────────────────────────────────────────────────────────────

const PRODUCTS: UnifiedProduct[] = ["Diesel", "Gasoline", "Crude Oil"];

// ─── Main component ────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement {
  const {
    filters,
    setFilters,
    filtros,
    filtrosLoading,
    paisesData,
    paisesLoading,
    importersData,
    importersLoading,
    yoyPaisesData,
    yoyPaisesLoading,
    yoyImportersData,
    yoyImportersLoading,
    exportsData,
    exportsLoading,
    periodBadge,
    visible,
    visibilityLoading,
  } = useImportsExportsData();

  const [filterOpen, setFilterOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);

  const anoMin = filtros?.ano_min ?? 2010;
  const anoMax = filtros?.ano_max ?? new Date().getFullYear();

  // ── Derived traces ─────────────────────────────────────────────────────────
  // All useMemo calls MUST be before any conditional early returns (Rules of Hooks).

  const paisesTraces = useMemo(() => {
    const rows = paisesData.map((r) => ({
      ano: r.ano,
      mes: r.mes,
      name: r.pais_origem,
      value: r.total_kg / 1e6,
    }));
    return buildStackedTraces(rows, "kt");
  }, [paisesData]);

  const importersTraces = useMemo(() => {
    const rows = importersData.map((r) => ({
      ano: r.ano,
      mes: r.mes,
      name: r.unified_importer,
      value: r.total_mil_m3,
    }));
    return buildStackedTraces(rows, "mil m³");
  }, [importersData]);

  const exportsTraces = useMemo(() => {
    const visibleProducts = new Set(filters.exportsProductsVisible);
    const byProduct = new Map<string, ExportsSerieRow[]>();
    for (const r of exportsData) {
      if (!visibleProducts.has(r.produto as UnifiedProduct)) continue;
      if (!byProduct.has(r.produto)) byProduct.set(r.produto, []);
      byProduct.get(r.produto)!.push(r);
    }
    const traces: PlotData[] = [];
    let idx = 0;
    for (const [product, rows] of byProduct.entries()) {
      const sorted = [...rows].sort((a, b) =>
        a.ano !== b.ano ? a.ano - b.ano : a.mes - b.mes,
      );
      const xs = sorted.map(
        (r) => `${r.ano}-${String(r.mes).padStart(2, "0")}`,
      );
      const ys =
        filters.exportsYAxis === "volume"
          ? sorted.map((r) => r.volume_m3 / 1e3)
          : sorted.map((r) => r.valor_usd);
      const unit = filters.exportsYAxis === "volume" ? "mil m³" : "USD";
      traces.push({
        type: "scatter" as const,
        mode: "lines" as const,
        name: product,
        x: xs,
        y: ys,
        line: { color: PALETTE[idx % PALETTE.length], width: 2 },
        hovertemplate: `%{x}<br>${product}: %{y:,.1f} ${unit}<extra></extra>`,
      } as unknown as PlotData);
      idx++;
    }
    return traces;
  }, [exportsData, filters.exportsProductsVisible, filters.exportsYAxis]);

  const exportsLayout: Partial<Layout> = {
    ...COMMON_LAYOUT,
    height: 280,
    margin: { t: 8, b: 52, l: 60, r: 8 },
    xaxis: {
      ...AXIS_LINE,
      tickangle: -60,
      tickfont: { family: "Arial", size: 8 },
    },
    yaxis: {
      ...AXIS_LINE,
      title: {
        text:
          filters.exportsYAxis === "volume" ? "mil m³" : "USD",
        font: { family: "Arial", size: 10 },
      },
      tickformat: ",.1f",
    },
    legend: {
      orientation: "h" as const,
      x: 0,
      y: -0.28,
      font: { family: "Arial", size: 9 },
    },
  };

  // Guard — after all hooks
  if (visibilityLoading) return <BarrelLoading bare />;
  if (!visible) return <></>;

  // ── Export handler ─────────────────────────────────────────────────────────
  async function handleExport() {
    setExportBusy(true);
    try {
      const { default: ExcelJS } = await import("exceljs");
      const wb = new ExcelJS.Workbook();

      const wsA = wb.addWorksheet("Countries (kt)");
      wsA.addRow(["Year", "Month", "Country", "Volume (kt)"]);
      for (const r of paisesData) {
        wsA.addRow([r.ano, r.mes, r.pais_origem, +(r.total_kg / 1e6).toFixed(3)]);
      }

      const wsB = wb.addWorksheet("Importers (mil m3)");
      wsB.addRow(["Year", "Month", "Importer", "Volume (mil m3)"]);
      for (const r of importersData) {
        wsB.addRow([r.ano, r.mes, r.unified_importer, +r.total_mil_m3.toFixed(3)]);
      }

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const today = new Date();
      const dd = String(today.getDate()).padStart(2, "0");
      const mm = String(today.getMonth() + 1).padStart(2, "0");
      const yy = String(today.getFullYear()).slice(-2);
      a.download = `Imports-Exports_${dd}-${mm}-${yy}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExportBusy(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        fontFamily: "Arial, Helvetica, sans-serif",
        background: "var(--mobile-bg, #f5f5f7)",
        minHeight: "100dvh",
        paddingBottom: 96,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 16px 12px",
          background: "#fff",
          borderBottom: "1px solid #e6e6ec",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, color: "#1a1a1a" }}>
          Imports & Exports
        </div>
        <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
          Period: {periodBadge}
          {filters.tab === "imports" && (
            <span style={{ marginLeft: 10 }}>
              · Product: {filters.unifiedProduct}
            </span>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ background: "#fff", paddingTop: 8, paddingBottom: 4 }}>
        <MobileTabBar
          tabs={[
            { key: "imports", label: "Imports" },
            { key: "exports", label: "Exports" },
          ]}
          activeKey={filters.tab}
          onChange={(key) => setFilters({ tab: key as "imports" | "exports" })}
          variant="container"
          ariaLabel="Dashboard tabs"
        />
      </div>

      {/* Filter button (sticky) */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: "rgba(245,245,247,0.95)",
          backdropFilter: "blur(8px)",
          padding: "8px 16px",
          borderBottom: "1px solid #e6e6ec",
          display: "flex",
          justifyContent: "flex-end",
        }}
      >
        <button
          type="button"
          onClick={() => setFilterOpen(true)}
          style={{
            padding: "6px 14px",
            borderRadius: 999,
            border: "1px solid #d0d0d0",
            background: "#fff",
            fontFamily: "Arial",
            fontSize: 12,
            fontWeight: 600,
            color: "#333",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="8" y1="12" x2="16" y2="12" />
            <line x1="12" y1="18" x2="12" y2="18" strokeLinecap="round" />
          </svg>
          Filters
        </button>
      </div>

      {/* ── IMPORTS TAB ── */}
      {filters.tab === "imports" && (
        <div style={{ paddingTop: 12 }}>
          {/* Panel A */}
          <SectionHeading title="By Origin Country" loading={paisesLoading} />
          <div style={{ padding: "0 16px 8px" }}>
            {paisesTraces.length > 0 ? (
              <Plot
                data={paisesTraces}
                layout={mobileBarLayout("kt")}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: "100%" }}
              />
            ) : !paisesLoading ? (
              <div style={{ color: "#aaa", fontSize: 12, padding: 16 }}>
                No data for the selected period and product.
              </div>
            ) : null}
          </div>

          {yoyPaisesData.length > 0 && (
            <>
              <div style={{ padding: "4px 16px 4px", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Last 12 months — Countries
              </div>
              <YoYCardList
                rows={yoyPaisesData}
                loading={yoyPaisesLoading}
                volumeLabel="kt"
              />
            </>
          )}

          <div style={{ height: 20 }} />

          {/* Panel B */}
          <SectionHeading title="By Importer (Brazil)" loading={importersLoading} />
          <div style={{ padding: "0 16px 8px" }}>
            {importersData.length > 0 ? (
              <Plot
                data={importersTraces}
                layout={mobileBarLayout("mil m³")}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: "100%" }}
              />
            ) : !importersLoading ? (
              <ImporterEmptyStateMobile />
            ) : null}
          </div>

          {importersData.length > 0 && yoyImportersData.length > 0 && (
            <>
              <div style={{ padding: "4px 16px 4px", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Last 12 months — Importers
              </div>
              <YoYCardList
                rows={yoyImportersData}
                loading={yoyImportersLoading}
                volumeLabel="mil m³"
              />
            </>
          )}
        </div>
      )}

      {/* ── EXPORTS TAB ── */}
      {filters.tab === "exports" && (
        <div style={{ paddingTop: 12 }}>
          {/* Product pills */}
          <div style={{ padding: "0 16px 8px", display: "flex", gap: 8, flexWrap: "wrap" }}>
            {PRODUCTS.map((p, i) => {
              const active = filters.exportsProductsVisible.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    const next = active
                      ? filters.exportsProductsVisible.filter((x) => x !== p)
                      : [...filters.exportsProductsVisible, p];
                    if (next.length > 0) setFilters({ exportsProductsVisible: next });
                  }}
                  style={{
                    padding: "4px 12px",
                    borderRadius: 999,
                    border: `2px solid ${PALETTE[i % PALETTE.length]}`,
                    background: active ? PALETTE[i % PALETTE.length] : "transparent",
                    color: active ? "#fff" : PALETTE[i % PALETTE.length],
                    fontFamily: "Arial",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    minHeight: 32,
                  }}
                >
                  {p}
                </button>
              );
            })}
          </div>

          {/* Volume / USD toggle */}
          <div style={{ padding: "0 16px 12px", display: "flex", gap: 8 }}>
            {(["volume", "usd"] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setFilters({ exportsYAxis: opt })}
                style={{
                  padding: "4px 14px",
                  borderRadius: 999,
                  border: "1px solid #d0d0d0",
                  background: filters.exportsYAxis === opt ? "#1a1a1a" : "#fff",
                  color: filters.exportsYAxis === opt ? "#fff" : "#333",
                  fontFamily: "Arial",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  minHeight: 32,
                }}
              >
                {opt === "volume" ? "Volume (mil m³)" : "Value (USD)"}
              </button>
            ))}
          </div>

          <SectionHeading title="Exports — Fuel Trade" loading={exportsLoading} />
          <div style={{ padding: "0 16px 8px" }}>
            {exportsTraces.length > 0 ? (
              <Plot
                data={exportsTraces}
                layout={exportsLayout}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: "100%" }}
              />
            ) : !exportsLoading ? (
              <div style={{ color: "#aaa", fontSize: 12, padding: 16 }}>
                No export data for the selected period.
              </div>
            ) : null}
          </div>

          <div style={{ padding: "0 16px", fontSize: 10, color: "#aaa", fontStyle: "italic" }}>
            Source: ANP DAIE — no country or importer breakdown available.
          </div>
        </div>
      )}

      {/* Filter drawer */}
      <FilterDrawer
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Filters"
        onReset={() => {
          setFilters({
            unifiedProduct: "Diesel",
            period: [anoMax - 9, anoMax],
          });
        }}
        onApply={() => setFilterOpen(false)}
        applyLabel="Apply"
        resetLabel="Reset"
      >
        {/* Product — only in imports tab */}
        {filters.tab === "imports" && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.4px" }}>
              Product
            </div>
            {PRODUCTS.map((p) => (
              <label
                key={p}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 0",
                  borderBottom: "1px solid #f0f0f0",
                  cursor: "pointer",
                  fontSize: 14,
                  fontFamily: "Arial",
                  color: filters.unifiedProduct === p ? "#ff5000" : "#1a1a1a",
                  fontWeight: filters.unifiedProduct === p ? 700 : 400,
                }}
              >
                <input
                  type="radio"
                  name="ie-product-mobile"
                  value={p}
                  checked={filters.unifiedProduct === p}
                  onChange={() => {
                    setFilters({ unifiedProduct: p });
                  }}
                  style={{ accentColor: "#ff5000", width: 18, height: 18 }}
                />
                {p}
              </label>
            ))}
          </div>
        )}

        {/* Period */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.4px" }}>
            Period
          </div>
          {filtrosLoading ? (
            <div style={{ fontSize: 12, color: "#aaa" }}>Loading…</div>
          ) : (
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <select
                value={filters.period[0]}
                onChange={(e) =>
                  setFilters({
                    period: [
                      Number(e.target.value),
                      Math.max(Number(e.target.value), filters.period[1]),
                    ],
                  })
                }
                style={{
                  flex: 1,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #ccc",
                  fontSize: 14,
                  fontFamily: "Arial",
                  minHeight: 44,
                }}
              >
                {Array.from({ length: anoMax - anoMin + 1 }, (_, i) => anoMin + i).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <span style={{ color: "#aaa" }}>–</span>
              <select
                value={filters.period[1]}
                onChange={(e) =>
                  setFilters({
                    period: [
                      Math.min(filters.period[0], Number(e.target.value)),
                      Number(e.target.value),
                    ],
                  })
                }
                style={{
                  flex: 1,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #ccc",
                  fontSize: 14,
                  fontFamily: "Arial",
                  minHeight: 44,
                }}
              >
                {Array.from({ length: anoMax - anoMin + 1 }, (_, i) => anoMin + i).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </FilterDrawer>

      {/* Export FAB */}
      <ExportFAB
        label="Export"
        onClick={() => void handleExport()}
        disabled={exportBusy}
        ariaLabel="Export data as Excel"
      />
    </div>
  );
}
