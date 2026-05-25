"use client";

// Desktop view for /imports-exports (≥769px).
//
// Layout:
//   DashboardHeader  (title + period badge + ExportPanel in rightSlot)
//   SegmentedToggle  [Imports] [Exports]
//   ┌─ sidebar (left 220px) ─────────────────────────────────────────┐
//   │  Product radio: Diesel / Gasoline / Crude Oil                  │
//   │  PeriodSlider                                                  │
//   └────────────────────────────────────────────────────────────────┘
//   Imports tab:
//     Panel A — By Origin Country (stacked bar, kt)
//     Panel B — By Importer (stacked bar, mil m³)
//     YoY table for each panel
//   Exports tab:
//     Product multi-select pills + Volume/USD toggle
//     Multi-line chart
//
// Units — CRITICAL: never drift label from divisor.
//   Panel A: total_kg / 1e6 = kt. Label "kt".
//   Panel B: total_mil_m3 already from RPC. Label "mil m³".
//   Exports volume: volume_m3 / 1e3. Label "mil m³".
//   Exports USD: valor_usd raw. Label "USD".

import dynamic from "next/dynamic";
import type { Layout, PlotData } from "plotly.js";
import { useCallback, useMemo, useState } from "react";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import ChartSection from "@/components/dashboard/ChartSection";
import ExportPanel from "@/components/dashboard/ExportPanel";
import SegmentedToggle from "@/components/dashboard/SegmentedToggle";
import BarrelLoading from "@/components/dashboard/BarrelLoading";

import { useImportsExportsData } from "../useImportsExportsData";
import type {
  UnifiedProduct,
  PaisesStackedRow,
  ImportersStackedRow,
  ExportsSerieRow,
  YoyTableRow,
} from "../useImportsExportsData";

import { COMMON_LAYOUT, AXIS_LINE, PALETTE } from "@/lib/plotlyDefaults";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

// ─── Colour helpers ────────────────────────────────────────────────────────────

const OTHERS_COLOR = "#bdbdbd"; // neutral grey for "Others" bucket

function colourForEntity(entities: string[], entity: string): string {
  if (entity === "Others") return OTHERS_COLOR;
  const idx = entities.filter((e) => e !== "Others").indexOf(entity);
  return PALETTE[idx % PALETTE.length] ?? OTHERS_COLOR;
}

// ─── Stacked bar builder ───────────────────────────────────────────────────────

type StackedRow = { ano: number; mes: number; name: string; value: number };

function buildStackedTraces(
  rows: StackedRow[],
  unit: string,
): PlotData[] {
  if (!rows.length) return [];

  // Collect unique x-axis labels (YYYY-MM) and unique entity names
  const xSet = new Set<string>();
  const entitySet = new Set<string>();
  for (const r of rows) {
    xSet.add(`${r.ano}-${String(r.mes).padStart(2, "0")}`);
    entitySet.add(r.name);
  }
  const xs = Array.from(xSet).sort();
  // Put "Others" last
  const entities = [
    ...Array.from(entitySet).filter((e) => e !== "Others").sort(),
    ...(entitySet.has("Others") ? ["Others"] : []),
  ];

  // Build a lookup: entity → month → value
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

// ─── YoY table ─────────────────────────────────────────────────────────────────

function YoYCell({ value }: { value: number | null }) {
  if (value == null) return <span style={{ color: "#aaa" }}>n/a</span>;
  const color = value > 0 ? "#16a34a" : value < 0 ? "#dc2626" : "#555";
  return (
    <span style={{ color, fontWeight: 600 }}>
      {value > 0 ? "+" : ""}{value.toFixed(1)}%
    </span>
  );
}

function YoYTable({
  rows,
  loading,
  volumeLabel,
  title,
}: {
  rows: YoyTableRow[];
  loading: boolean;
  volumeLabel: string;
  title: string;
}) {
  if (loading) {
    return (
      <div style={{ color: "#aaa", fontSize: 12, padding: "8px 0" }}>
        Loading...
      </div>
    );
  }
  if (!rows.length) return null;

  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "#555",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          marginBottom: 6,
        }}
      >
        {title} — Last 12 Months
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            {["Entity", `Last 12m (${volumeLabel})`, `Prior 12m (${volumeLabel})`, "YoY %"].map(
              (h) => (
                <th
                  key={h}
                  style={{
                    textAlign: h === "Entity" ? "left" : "right",
                    padding: "4px 8px",
                    borderBottom: "1px solid #e0e0e0",
                    fontFamily: "Arial",
                    fontWeight: 700,
                    color: "#333",
                  }}
                >
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.entity}
              style={{ borderBottom: "1px solid #f0f0f0" }}
            >
              <td style={{ padding: "4px 8px", fontFamily: "Arial" }}>
                {row.entity}
              </td>
              <td
                style={{
                  padding: "4px 8px",
                  textAlign: "right",
                  fontFamily: "Arial",
                }}
              >
                {row.last_12m.toLocaleString("en-US", { maximumFractionDigits: 1 })}
              </td>
              <td
                style={{
                  padding: "4px 8px",
                  textAlign: "right",
                  fontFamily: "Arial",
                  color: "#777",
                }}
              >
                {row.prev_12m.toLocaleString("en-US", { maximumFractionDigits: 1 })}
              </td>
              <td
                style={{
                  padding: "4px 8px",
                  textAlign: "right",
                  fontFamily: "Arial",
                }}
              >
                <YoYCell value={row.yoy_pct} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Importer Panel empty state ────────────────────────────────────────────────

function ImporterEmptyState() {
  return (
    <div
      style={{
        padding: "32px 24px",
        textAlign: "center",
        background: "#fafafa",
        border: "1px dashed #ddd",
        borderRadius: 8,
        fontFamily: "Arial",
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600, color: "#555", marginBottom: 8 }}>
        Importer-level data is being processed.
      </div>
      <div style={{ fontSize: 12, color: "#888", maxWidth: 400, margin: "0 auto" }}>
        The first backfill of <code>anp_desembaracos</code> will populate this panel —
        expected after the next <code>etl_anp_fase3.yml</code> run.
      </div>
    </div>
  );
}

// ─── Product radio ─────────────────────────────────────────────────────────────

const PRODUCTS: UnifiedProduct[] = ["Diesel", "Gasoline", "Crude Oil"];

function ProductRadio({
  value,
  onChange,
}: {
  value: UnifiedProduct;
  onChange: (v: UnifiedProduct) => void;
}) {
  return (
    <div style={{ fontFamily: "Arial" }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "#555",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          marginBottom: 8,
        }}
      >
        Product
      </div>
      {PRODUCTS.map((p) => (
        <label
          key={p}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 6,
            cursor: "pointer",
            fontSize: 13,
            color: value === p ? "#ff5000" : "#333",
            fontWeight: value === p ? 700 : 400,
          }}
        >
          <input
            type="radio"
            name="ie-product"
            value={p}
            checked={value === p}
            onChange={() => onChange(p)}
            style={{ accentColor: "#ff5000" }}
          />
          {p}
        </label>
      ))}
    </div>
  );
}

// ─── Period slider ─────────────────────────────────────────────────────────────

function PeriodSliderSimple({
  min,
  max,
  value,
  onChange,
}: {
  min: number;
  max: number;
  value: [number, number];
  onChange: (v: [number, number]) => void;
}) {
  // Simple range — using two range inputs stacked. The shared PeriodSlider
  // component (rc-slider) is also available but this inline version keeps
  // the sidebar self-contained without prop-drilling the full years array.
  return (
    <div style={{ fontFamily: "Arial" }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "#555",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          marginBottom: 8,
        }}
      >
        Period
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <select
          value={value[0]}
          onChange={(e) => onChange([Number(e.target.value), Math.max(Number(e.target.value), value[1])])}
          style={{ fontSize: 12, padding: "2px 4px", borderRadius: 4, border: "1px solid #ccc" }}
        >
          {Array.from({ length: max - min + 1 }, (_, i) => min + i).map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: "#888" }}>–</span>
        <select
          value={value[1]}
          onChange={(e) => onChange([Math.min(value[0], Number(e.target.value)), Number(e.target.value)])}
          style={{ fontSize: 12, padding: "2px 4px", borderRadius: 4, border: "1px solid #ccc" }}
        >
          {Array.from({ length: max - min + 1 }, (_, i) => min + i).map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ─── Shared chart layout ───────────────────────────────────────────────────────

function barLayout(yLabel: string, height = 340): Partial<Layout> {
  return {
    ...COMMON_LAYOUT,
    barmode: "stack" as const,
    height,
    margin: { t: 12, b: 60, l: 60, r: 12 },
    xaxis: {
      ...AXIS_LINE,
      tickangle: -45,
      tickfont: { family: "Arial", size: 10 },
    },
    yaxis: {
      ...AXIS_LINE,
      title: { text: yLabel, font: { family: "Arial", size: 11 } },
      tickformat: ",.1f",
    },
    legend: {
      orientation: "h" as const,
      x: 0,
      y: -0.22,
      font: { family: "Arial", size: 10 },
    },
  };
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function DesktopView(): React.ReactElement {
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

  const [exportBusy, setExportBusy] = useState(false);

  // ── Derived: stacked traces ─────────────────────────────────────────────────
  // All useMemo calls MUST be before any conditional early returns (Rules of Hooks).

  // Panel A — kt (divide total_kg by 1e6)
  const paisesTraces = useMemo(() => {
    const rows = paisesData.map((r) => ({
      ano: r.ano,
      mes: r.mes,
      name: r.pais_origem,
      value: r.total_kg / 1e6,
    }));
    return buildStackedTraces(rows, "kt");
  }, [paisesData]);

  // Panel B — mil m³ (already from RPC)
  const importersTraces = useMemo(() => {
    const rows = importersData.map((r) => ({
      ano: r.ano,
      mes: r.mes,
      name: r.unified_importer,
      value: r.total_mil_m3,
    }));
    return buildStackedTraces(rows, "mil m³");
  }, [importersData]);

  // Exports — multi-line
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

  const exportsYLabel =
    filters.exportsYAxis === "volume" ? "Volume (mil m³)" : "Value (USD)";

  const exportsLayout: Partial<Layout> = {
    ...COMMON_LAYOUT,
    height: 360,
    margin: { t: 12, b: 60, l: 72, r: 12 },
    xaxis: {
      ...AXIS_LINE,
      tickangle: -45,
      tickfont: { family: "Arial", size: 10 },
    },
    yaxis: {
      ...AXIS_LINE,
      title: { text: exportsYLabel, font: { family: "Arial", size: 11 } },
      tickformat: ",.1f",
    },
    legend: {
      orientation: "h" as const,
      x: 0,
      y: -0.22,
      font: { family: "Arial", size: 10 },
    },
  };

  // Guard — after all hooks
  if (visibilityLoading) return <BarrelLoading />;
  if (!visible) return <></>;

  // ── Export handler (Tier 1 — direct download) ───────────────────────────────
  async function handleExcelExport() {
    setExportBusy(true);
    try {
      const { default: ExcelJS } = await import("exceljs");

      const wb = new ExcelJS.Workbook();

      // Sheet 1: Panel A — countries (kt)
      const wsA = wb.addWorksheet("Imports by Country (kt)");
      wsA.addRow(["Year", "Month", "Country", "Volume (kt)"]);
      for (const r of paisesData) {
        wsA.addRow([r.ano, r.mes, r.pais_origem, +(r.total_kg / 1e6).toFixed(3)]);
      }

      // Sheet 2: Panel B — importers (mil m³)
      const wsB = wb.addWorksheet("Imports by Importer (mil m3)");
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

  async function handleCsvExport() {
    setExportBusy(true);
    try {
      const JSZip = (await import("jszip")).default;

      function toCsv(header: string[], rows: (string | number)[][]): string {
        const esc = (v: string | number) => `"${String(v).replaceAll('"', '""')}"`;
        return [header.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
      }

      const zip = new JSZip();

      const csvA = toCsv(
        ["year", "month", "country", "volume_kt"],
        paisesData.map((r) => [r.ano, r.mes, r.pais_origem, +(r.total_kg / 1e6).toFixed(3)]),
      );
      const csvB = toCsv(
        ["year", "month", "importer", "volume_mil_m3"],
        importersData.map((r) => [r.ano, r.mes, r.unified_importer, +r.total_mil_m3.toFixed(3)]),
      );

      zip.file("imports_by_country.csv", csvA);
      zip.file("imports_by_importer.csv", csvB);

      const today = new Date();
      const dd = String(today.getDate()).padStart(2, "0");
      const mm = String(today.getMonth() + 1).padStart(2, "0");
      const yy = String(today.getFullYear()).slice(-2);

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Imports-Exports_${dd}-${mm}-${yy}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExportBusy(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const anoMin = filtros?.ano_min ?? 2010;
  const anoMax = filtros?.ano_max ?? new Date().getFullYear();

  return (
    <div style={{ fontFamily: "Arial, sans-serif", padding: "16px 24px" }}>
      <DashboardHeader
        title="Imports & Exports"
        sub="Brazilian fuel trade flows — by origin country and importer group"
        period={[filters.period[0], filters.period[1]]}
        lang="en"
        rightSlot={
          <ExportPanel
            actions={[
              {
                kind: "excel",
                label: "Excel",
                onClick: handleExcelExport,
                busy: exportBusy,
                loadingLabel: "Building workbook…",
              },
              {
                kind: "csv",
                label: "CSV (zip)",
                onClick: handleCsvExport,
                busy: exportBusy && !exportBusy,
                disabled: exportBusy,
              },
            ]}
          />
        }
      />

      {/* Tab selector */}
      <div style={{ marginBottom: 16, maxWidth: 300 }}>
        <SegmentedToggle
          options={[
            { value: "imports" as const, label: "Imports" },
            { value: "exports" as const, label: "Exports" },
          ]}
          value={filters.tab}
          onChange={(v) => setFilters({ tab: v })}
          variant="compact"
        />
      </div>

      {/* Body: sidebar + content */}
      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        {/* Sidebar */}
        <div
          style={{
            minWidth: 200,
            maxWidth: 220,
            flexShrink: 0,
            padding: "16px",
            border: "1px solid #e6e6ec",
            borderRadius: 12,
            background: "#fafafa",
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          {/* Product radio — hidden in exports tab (all 3 products visible) */}
          {filters.tab === "imports" && (
            <ProductRadio
              value={filters.unifiedProduct}
              onChange={(p) => setFilters({ unifiedProduct: p })}
            />
          )}

          {/* Period */}
          {filtrosLoading ? (
            <div style={{ fontSize: 12, color: "#aaa" }}>Loading period…</div>
          ) : (
            <PeriodSliderSimple
              min={anoMin}
              max={anoMax}
              value={filters.period}
              onChange={(v) => setFilters({ period: v })}
            />
          )}
        </div>

        {/* Main content area */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* ── IMPORTS TAB ── */}
          {filters.tab === "imports" && (
            <div>
              {/* Panel A */}
              <ChartSection
                title="By Origin Country"
                loading={paisesLoading}
                height={340}
              >
                {paisesTraces.length > 0 ? (
                  <Plot
                    data={paisesTraces}
                    layout={barLayout("kt")}
                    config={{ responsive: true, displayModeBar: false }}
                    style={{ width: "100%" }}
                  />
                ) : !paisesLoading ? (
                  <div style={{ padding: 24, color: "#aaa", fontSize: 13 }}>
                    No data for the selected period and product.
                  </div>
                ) : null}
              </ChartSection>

              <YoYTable
                rows={yoyPaisesData}
                loading={yoyPaisesLoading}
                volumeLabel="kt"
                title="By Origin Country"
              />

              <div style={{ height: 24 }} />

              {/* Panel B */}
              <ChartSection
                title="By Importer (Brazil)"
                loading={importersLoading}
                height={340}
              >
                {importersData.length > 0 ? (
                  <Plot
                    data={importersTraces}
                    layout={barLayout("mil m³")}
                    config={{ responsive: true, displayModeBar: false }}
                    style={{ width: "100%" }}
                  />
                ) : !importersLoading ? (
                  <ImporterEmptyState />
                ) : null}
              </ChartSection>

              {importersData.length > 0 && (
                <YoYTable
                  rows={yoyImportersData}
                  loading={yoyImportersLoading}
                  volumeLabel="mil m³"
                  title="By Importer"
                />
              )}
            </div>
          )}

          {/* ── EXPORTS TAB ── */}
          {filters.tab === "exports" && (
            <div>
              {/* Controls row */}
              <div
                style={{
                  display: "flex",
                  gap: 16,
                  alignItems: "center",
                  marginBottom: 12,
                  flexWrap: "wrap",
                }}
              >
                {/* Product visibility pills */}
                <div style={{ display: "flex", gap: 8 }}>
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
                          padding: "4px 14px",
                          borderRadius: 999,
                          border: `2px solid ${PALETTE[i % PALETTE.length]}`,
                          background: active ? PALETTE[i % PALETTE.length] : "transparent",
                          color: active ? "#fff" : PALETTE[i % PALETTE.length],
                          fontFamily: "Arial",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>

                {/* Volume / USD toggle */}
                <div style={{ maxWidth: 200 }}>
                  <SegmentedToggle
                    options={[
                      { value: "volume" as const, label: "Volume (mil m³)" },
                      { value: "usd" as const, label: "Value (USD)" },
                    ]}
                    value={filters.exportsYAxis}
                    onChange={(v) => setFilters({ exportsYAxis: v })}
                    variant="compact"
                  />
                </div>
              </div>

              <ChartSection
                title="Exports — Fuel Trade"
                loading={exportsLoading}
                height={360}
              >
                {exportsTraces.length > 0 ? (
                  <Plot
                    data={exportsTraces}
                    layout={exportsLayout}
                    config={{ responsive: true, displayModeBar: false }}
                    style={{ width: "100%" }}
                  />
                ) : !exportsLoading ? (
                  <div style={{ padding: 24, color: "#aaa", fontSize: 13 }}>
                    No export data for the selected period.
                  </div>
                ) : null}
              </ChartSection>

              <div
                style={{
                  marginTop: 12,
                  fontSize: 11,
                  color: "#aaa",
                  fontStyle: "italic",
                }}
              >
                Source: ANP DAIE — Exports tab has no country or importer breakdown.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
