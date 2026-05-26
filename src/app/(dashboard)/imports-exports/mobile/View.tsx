"use client";

// Mobile view for /imports-exports (≤768px).
//
// Same analysis as desktop/View.tsx — same hook, same data, adapted shell:
//   MobileTopBar (sticky liquid glass) — canonical project top bar
//   MobileTabBar for Imports / Exports switching
//   FilterDrawer triggered by a sticky filter button (product + period)
//   Panels stack vertically
//   Charts via Plot (react-plotly.js with mobile-tuned layout)
//   YoY rows via MobileDataCard
//   ExportFAB for export trigger
//
// Binding sync rule: any meaningful change to data/filters here must land
// in desktop/View.tsx in the same commit (CLAUDE.md § Dual-view policy).
//
// Units — CRITICAL: never drift label from divisor.
//   Panel A: total_kg / 1e6 = kt. Label "kt".
//   Panel B: total_mil_m3 already from RPC. Label "mil m³".
//   Exports (metric=volume): server returns mil m³ — DO NOT divide. Label "mil m³".
//   Exports (metric=usd): server returns raw USD. Label "USD".

import dynamic from "next/dynamic";
import type { Layout, PlotData } from "plotly.js";
import { useMemo, useState } from "react";

import {
  MobileTopBar,
  FilterDrawer,
  MobileDataCard,
  ExportFAB,
  BottomSheet,
  MobileTabBar,
  FilterIcon,
} from "../../../../components/dashboard/mobile";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";

import { useImportsExportsData } from "../useImportsExportsData";
import type {
  UnifiedProduct,
  YoyTableRow,
  PriceMetric,
  PricePoint,
  UnitPriceRow,
} from "../useImportsExportsData";

import { COMMON_LAYOUT, AXIS_LINE, PALETTE, emptyPlot } from "../../../../lib/plotlyDefaults";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

// ─── Colour helpers ────────────────────────────────────────────────────────────

const OTHERS_COLOR = "#bdbdbd";

function colourForEntity(entities: string[], entity: string): string {
  if (entity === "Others") return OTHERS_COLOR;
  const idx = entities.filter((e) => e !== "Others").indexOf(entity);
  return PALETTE[idx % PALETTE.length] ?? OTHERS_COLOR;
}

// ─── Stacked area builder (same logic as desktop) ─────────────────────────────

type StackedRow = { ano: number; mes: number; name: string; value: number };

// Minimum value to show a trace in the unified hover tooltip.
// Points with value < HOVER_THRESHOLD are set to null in the y array so that
// Plotly's unified hover completely skips them (no swatch, no header, no blank
// row). connectgaps:true + stackgaps:"infer zero" keeps the filled area intact
// visually — Plotly treats null as zero for stacking but omits it from hover.
// Mirrors desktop/View.tsx exactly — keep in sync.
const HOVER_THRESHOLD = 0.05;

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
  return entities.map((entity) => {
    const color = colourForEntity(entities, entity);
    // Set y=null for points below threshold so Plotly omits them from the
    // unified hover entirely (no swatch, no blank entry). connectgaps:true +
    // stackgaps:"infer zero" ensures the filled area has no visual gaps.
    const ys = xs.map((x) => {
      const v = lookup.get(entity)?.get(x) ?? 0;
      return v >= HOVER_THRESHOLD ? v : null;
    });
    return {
      type: "scatter" as const,
      mode: "lines" as const,
      stackgroup: "one",
      stackgaps: "infer zero" as const,
      connectgaps: true,
      name: entity,
      x: xs,
      y: ys,
      line: { width: 0.5, color },
      fillcolor: color,
      hovertemplate: `%{x}<br>${entity}: %{y:,.1f} ${unit}<extra></extra>`,
    };
  }) as unknown as PlotData[];
}

// ─── Panel C — import price helpers (mobile) ──────────────────────────────────

const PRICE_COLORS: Record<UnifiedProduct, string> = {
  Diesel: "#ff5000",
  Gasoline: "#FFB04F",
  "Crude Oil": "#1a1a1a",
};

function buildPriceTraces(data: PricePoint[], unit: string): PlotData[] {
  if (!data.length) return [];
  const byProduct = new Map<UnifiedProduct, PricePoint[]>();
  for (const p of data) {
    if (!byProduct.has(p.product)) byProduct.set(p.product, []);
    byProduct.get(p.product)!.push(p);
  }
  const traces: PlotData[] = [];
  for (const [product, points] of byProduct.entries()) {
    const sorted = [...points].sort((a, b) =>
      a.ano !== b.ano ? a.ano - b.ano : a.mes - b.mes,
    );
    const xs = sorted.map(
      (r) => `${r.ano}-${String(r.mes).padStart(2, "0")}`,
    );
    const ys = sorted.map((r) => r.value);
    traces.push({
      type: "scatter" as const,
      mode: "lines+markers" as const,
      name: product,
      x: xs,
      y: ys,
      line: { color: PRICE_COLORS[product], width: 2 },
      marker: { size: 3, color: PRICE_COLORS[product] },
      hovertemplate: `%{x}<br>${product}: %{y:,.2f} ${unit}<extra></extra>`,
    } as unknown as PlotData);
  }
  return traces;
}

// ─── Unit price by country (multi-line, NOT stacked) — mobile ─────────────────

function buildUnitPriceTraces(rows: UnitPriceRow[], entities: string[]): PlotData[] {
  if (!rows.length) return [];

  const byEntity = new Map<string, Map<string, number | null>>();
  const xSet = new Set<string>();

  for (const r of rows) {
    const xKey = `${r.ano}-${String(r.mes).padStart(2, "0")}`;
    xSet.add(xKey);
    if (!byEntity.has(r.pais)) byEntity.set(r.pais, new Map());
    byEntity.get(r.pais)!.set(xKey, r.usd_per_m3);
  }

  const xs = Array.from(xSet).sort();

  return entities.map((entity, idx) => {
    const color = PALETTE[idx % PALETTE.length] ?? OTHERS_COLOR;
    const ys = xs.map((x) => byEntity.get(entity)?.get(x) ?? null);
    return {
      type: "scatter" as const,
      mode: "lines" as const,
      name: entity,
      x: xs,
      y: ys,
      connectgaps: true,
      line: { color, width: 1.5 },
      hovertemplate: `%{x}<br>${entity}: %{y:,.1f} USD/m³<extra></extra>`,
    } as unknown as PlotData;
  });
}

function mobileAreaLayout(yLabel: string): Partial<Layout> {
  return {
    ...COMMON_LAYOUT,
    hovermode: "x unified" as const,
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

function SectionHeading({ title, loading }: { title: string; loading?: boolean }) {
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

// Month labels for YoY section heading (0-indexed)
const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

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
    exportsPaisesData,
    exportsPaisesLoading,
    yoyExportsData,
    yoyExportsLoading,
    yoyEndAno,
    yoyExportsEndMes,
    priceData,
    priceLoading,
    importsUnitPriceData,
    importsUnitPriceLoading,
    exportsUnitPriceData,
    exportsUnitPriceLoading,
    periodBadge,
    visible,
    visibilityLoading,
  } = useImportsExportsData();

  const [filterOpen, setFilterOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
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

  // Exports — stacked area by destination country (value already in correct unit from RPC)
  const exportsUnit = filters.exportsYAxis === "volume" ? "mil m³" : "USD";

  const exportsPaisesTraces = useMemo(() => {
    const rows = exportsPaisesData.map((r) => ({
      ano: r.ano,
      mes: r.mes,
      name: r.pais,
      value: r.value, // server already in mil m³ or USD — never divide client-side
    }));
    return buildStackedTraces(rows, exportsUnit);
  }, [exportsPaisesData, exportsUnit]);

  const exportsPaisesLayout: Partial<Layout> = useMemo(
    () => mobileAreaLayout(exportsUnit),
    [exportsUnit],
  );

  // Panel C — price metric
  const priceUnitLabel: Record<PriceMetric, string> = {
    fob_per_bbl: "USD / bbl",
    fob_per_m3: "USD / m³",
    fob_per_ton: "USD / ton",
  };
  const priceUnit = priceUnitLabel[filters.priceMetric];

  const priceTraces = useMemo(
    () => buildPriceTraces(priceData, priceUnit),
    [priceData, priceUnit],
  );

  const priceLayout: Partial<Layout> = useMemo(
    () => ({
      ...COMMON_LAYOUT,
      hovermode: "x unified" as const,
      height: 240,
      margin: { t: 8, b: 52, l: 56, r: 8 },
      xaxis: {
        ...AXIS_LINE,
        tickangle: -60,
        tickfont: { family: "Arial", size: 8 },
      },
      yaxis: {
        ...AXIS_LINE,
        title: { text: priceUnit, font: { family: "Arial", size: 10 } },
        tickformat: ",.2f",
      },
      legend: {
        orientation: "h" as const,
        x: 0,
        y: -0.3,
        font: { family: "Arial", size: 9 },
      },
    }),
    [priceUnit],
  );

  // ── Unit price traces (imports + exports) ─────────────────────────────────
  const importsUPEntities = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of importsUnitPriceData) {
      if (r.usd_per_m3 != null) totals.set(r.pais, (totals.get(r.pais) ?? 0) + 1);
    }
    return Array.from(totals.keys()).sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
  }, [importsUnitPriceData]);

  const importsUPTraces = useMemo(
    () => buildUnitPriceTraces(importsUnitPriceData, importsUPEntities),
    [importsUnitPriceData, importsUPEntities],
  );

  const unitPriceMobileLayout: Partial<Layout> = useMemo(
    () => ({
      ...COMMON_LAYOUT,
      hovermode: "x unified" as const,
      height: 240,
      margin: { t: 8, b: 52, l: 56, r: 8 },
      xaxis: {
        ...AXIS_LINE,
        tickangle: -60,
        tickfont: { family: "Arial", size: 8 },
      },
      yaxis: {
        ...AXIS_LINE,
        title: { text: "USD / m³", font: { family: "Arial", size: 10 } },
        tickformat: ",.1f",
      },
      legend: {
        orientation: "h" as const,
        x: 0,
        y: -0.3,
        font: { family: "Arial", size: 9 },
      },
    }),
    [],
  );

  const exportsUPEntities = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of exportsUnitPriceData) {
      if (r.usd_per_m3 != null) totals.set(r.pais, (totals.get(r.pais) ?? 0) + 1);
    }
    return Array.from(totals.keys()).sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
  }, [exportsUnitPriceData]);

  const exportsUPTraces = useMemo(
    () => buildUnitPriceTraces(exportsUnitPriceData, exportsUPEntities),
    [exportsUnitPriceData, exportsUPEntities],
  );

  // Guard — after all hooks
  if (visibilityLoading) return <BarrelLoading bare />;
  if (!visible) return <></>;

  // ── Export handlers ────────────────────────────────────────────────────────

  async function handleExportExcel() {
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

      // Exports — unit header depends on current toggle
      const exportsVolLabel =
        filters.exportsYAxis === "volume" ? "Volume (mil m3)" : "Value (USD)";

      const wsC = wb.addWorksheet("Exports by Country");
      wsC.addRow(["Year", "Month", "Country", exportsVolLabel]);
      for (const r of exportsPaisesData) {
        wsC.addRow([r.ano, r.mes, r.pais, +r.value.toFixed(3)]);
      }

      const wsD = wb.addWorksheet("Exports YoY");
      wsD.addRow([
        "Entity",
        `Last 12m (${exportsVolLabel})`,
        `Prior 12m (${exportsVolLabel})`,
        "YoY %",
      ]);
      for (const r of yoyExportsData) {
        wsD.addRow([
          r.entity,
          +r.last_12m.toFixed(3),
          +r.prev_12m.toFixed(3),
          r.yoy_pct != null ? +r.yoy_pct.toFixed(2) : "",
        ]);
      }

      // Apply bold header row + thin borders to all worksheets
      for (const ws of [wsA, wsB, wsC, wsD]) {
        const headerRow = ws.getRow(1);
        headerRow.font = { bold: true };
        headerRow.eachCell((cell) => {
          cell.border = {
            bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
          };
        });
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

  async function handleExportCsv() {
    setExportBusy(true);
    try {
      const JSZip = (await import("jszip")).default;

      function toCsv(header: string[], rows: (string | number)[][]): string {
        const esc = (v: string | number) =>
          `"${String(v).replaceAll('"', '""')}"`;
        return [
          header.map(esc).join(","),
          ...rows.map((r) => r.map(esc).join(",")),
        ].join("\n");
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

      // Exports CSVs — unit column header depends on current toggle
      const exportsColLabel =
        filters.exportsYAxis === "volume" ? "volume_mil_m3" : "value_usd";

      const csvC = toCsv(
        ["year", "month", "country", exportsColLabel],
        exportsPaisesData.map((r) => [r.ano, r.mes, r.pais, +r.value.toFixed(3)]),
      );
      const csvD = toCsv(
        ["entity", `last_12m_${exportsColLabel}`, `prior_12m_${exportsColLabel}`, "yoy_pct"],
        yoyExportsData.map((r) => [
          r.entity,
          +r.last_12m.toFixed(3),
          +r.prev_12m.toFixed(3),
          r.yoy_pct != null ? +r.yoy_pct.toFixed(2) : "",
        ]),
      );

      zip.file("exports_by_country.csv", csvC);
      zip.file("exports_yoy.csv", csvD);

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

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        maxWidth: 428,
        margin: "0 auto",
        minHeight: "100dvh",
        background: "var(--mobile-bg, #f5f5f7)",
        paddingBottom: "calc(88px + var(--mobile-safe-bottom, 0px))",
        position: "relative",
        fontFamily: "Arial, Helvetica, sans-serif",
        color: "var(--mobile-text, #1a1a1a)",
        overflowX: "hidden",
      }}
    >
      {/* Canonical project top bar — same pattern as all other mobile views */}
      <MobileTopBar
        title={
          <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: "0.04em" }}>
            SECTORDATA<span style={{ color: "var(--mobile-accent, #ff5000)" }}>.</span>
          </span>
        }
        showAvatar
        avatarInitials="SD"
        avatarLabel="SectorData"
      />

      {/* Page sub-header: title + period badge + product badge */}
      <div
        style={{
          padding: "14px 16px 10px",
          background: "var(--mobile-surface, #fff)",
          borderBottom: "1px solid var(--mobile-divider, #e6e6ec)",
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 700, color: "var(--mobile-text, #1a1a1a)", lineHeight: 1.2 }}>
          Imports & Exports
        </div>
        <div style={{ fontSize: 11, color: "var(--mobile-text-muted, #888)", marginTop: 4 }}>
          {periodBadge}
        </div>
      </div>

      {/* Tab bar — Imports / Exports */}
      <div style={{ background: "var(--mobile-surface, #fff)", paddingTop: 8, paddingBottom: 4 }}>
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

      {/* Product pill row — horizontal scroll, single-select, brand orange */}
      <div
        style={{
          padding: "8px 16px",
          background: "var(--mobile-surface, #fff)",
          borderBottom: "1px solid var(--mobile-divider, #e6e6ec)",
          display: "flex",
          gap: 8,
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {PRODUCTS.map((p) => {
          const active = p === filters.unifiedProduct;
          return (
            <button
              key={p}
              type="button"
              onClick={() => setFilters({ unifiedProduct: p })}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "5px 16px",
                borderRadius: 999,
                border: "none",
                background: active ? "#ff5000" : "#f0f0f0",
                color: active ? "#fff" : "#555",
                fontFamily: "Arial",
                fontSize: 13,
                fontWeight: active ? 700 : 500,
                cursor: "pointer",
                whiteSpace: "nowrap",
                flexShrink: 0,
                minHeight: 34,
              }}
            >
              {p}
            </button>
          );
        })}
      </div>

      {/* Sticky filter trigger row */}
      <div
        style={{
          position: "sticky",
          top: 56, // MobileTopBar height
          zIndex: 22,
          background: "var(--mobile-glass-bg, rgba(245,245,247,0.92))",
          WebkitBackdropFilter: "var(--mobile-glass-blur, blur(8px))",
          backdropFilter: "var(--mobile-glass-blur, blur(8px))",
          borderBottom: "1px solid var(--mobile-glass-border, rgba(0,0,0,0.06))",
          padding: "8px 16px",
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
            border: "1px solid var(--mobile-divider, #d0d0d0)",
            background: "var(--mobile-surface, #fff)",
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 12,
            fontWeight: 600,
            color: "var(--mobile-text, #333)",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <FilterIcon size={14} strokeWidth={2.2} />
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
                layout={mobileAreaLayout("kt")}
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
                layout={mobileAreaLayout("mil m³")}
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

          <div style={{ height: 16 }} />

          {/* Panel C — Import Price */}
          <SectionHeading
            title={`Import Price (${priceUnit})`}
            loading={priceLoading}
          />

          {/* Metric pills — horizontal scroll */}
          <div
            style={{
              padding: "0 16px 8px",
              display: "flex",
              gap: 8,
              overflowX: "auto",
              WebkitOverflowScrolling: "touch",
            }}
          >
            {(["fob_per_bbl", "fob_per_m3", "fob_per_ton"] as PriceMetric[]).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setFilters({ priceMetric: opt })}
                style={{
                  padding: "4px 14px",
                  borderRadius: 999,
                  border: "1px solid #d0d0d0",
                  background: filters.priceMetric === opt ? "#1a1a1a" : "#fff",
                  color: filters.priceMetric === opt ? "#fff" : "#333",
                  fontFamily: "Arial",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  minHeight: 32,
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                {priceUnitLabel[opt]}
              </button>
            ))}
          </div>

          <div style={{ padding: "0 16px 8px" }}>
            {priceTraces.length > 0 ? (
              <Plot
                data={priceTraces}
                layout={priceLayout}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: "100%" }}
              />
            ) : !priceLoading ? (
              <Plot
                data={emptyPlot().data}
                layout={{ ...emptyPlot().layout, height: 240 }}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: "100%" }}
              />
            ) : null}
          </div>

          <div style={{ padding: "0 16px 12px", fontSize: 10, color: "#aaa", fontStyle: "italic" }}>
            Source: MDIC Comex — FOB unit price from total import value ÷ volume.
          </div>

          <div style={{ height: 16 }} />

          {/* Panel D — Import Unit Price by Origin Country */}
          <SectionHeading
            title="Import Unit Price by Country (USD/m³)"
            loading={importsUnitPriceLoading}
          />
          <div style={{ padding: "0 16px 8px" }}>
            {importsUPTraces.length > 0 ? (
              <Plot
                data={importsUPTraces}
                layout={unitPriceMobileLayout}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: "100%" }}
              />
            ) : !importsUnitPriceLoading ? (
              <Plot
                data={emptyPlot().data}
                layout={{ ...emptyPlot().layout, height: 240 }}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: "100%" }}
              />
            ) : null}
          </div>
          <div style={{ padding: "0 16px 12px", fontSize: 10, color: "#aaa", fontStyle: "italic" }}>
            Source: MDIC Comex — top 8 import origins by volume. "Gulf of Mexico" ≈ Estados Unidos (proxy).
          </div>
        </div>
      )}

      {/* ── EXPORTS TAB ── */}
      {filters.tab === "exports" && (
        <div style={{ paddingTop: 12 }}>
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

          <SectionHeading title="Exports — By Destination Country" loading={exportsPaisesLoading} />
          <div style={{ padding: "0 16px 8px" }}>
            {exportsPaisesTraces.length > 0 ? (
              <Plot
                data={exportsPaisesTraces}
                layout={exportsPaisesLayout}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: "100%" }}
              />
            ) : !exportsPaisesLoading ? (
              <div style={{ color: "#aaa", fontSize: 12, padding: 16 }}>
                No export data for the selected period.
              </div>
            ) : null}
          </div>

          {yoyExportsData.length > 0 && (
            <>
              <div style={{ padding: "4px 16px 4px", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Last 12 months — By Country (ending {MONTH_LABELS[(yoyExportsEndMes ?? 12) - 1]} {yoyEndAno})
              </div>
              <YoYCardList
                rows={yoyExportsData}
                loading={yoyExportsLoading}
                volumeLabel={exportsUnit}
              />
            </>
          )}

          <div style={{ padding: "8px 16px 0", fontSize: 10, color: "#aaa", fontStyle: "italic" }}>
            Source: MDIC Comex — monthly customs-declared exports by destination country
            (NCM 27090010 / 27101259 / 27101921; kg→m³ via ANP standard densities).
          </div>

          <div style={{ height: 16 }} />

          {/* Export Unit Price by Destination Country */}
          <SectionHeading
            title="Export Unit Price by Country (USD/m³)"
            loading={exportsUnitPriceLoading}
          />
          <div style={{ padding: "0 16px 8px" }}>
            {exportsUPTraces.length > 0 ? (
              <Plot
                data={exportsUPTraces}
                layout={unitPriceMobileLayout}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: "100%" }}
              />
            ) : !exportsUnitPriceLoading ? (
              <Plot
                data={emptyPlot().data}
                layout={{ ...emptyPlot().layout, height: 240 }}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: "100%" }}
              />
            ) : null}
          </div>
          <div style={{ padding: "0 16px 12px", fontSize: 10, color: "#aaa", fontStyle: "italic" }}>
            Source: MDIC Comex — top 8 export destinations by volume.
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

      {/* Export FAB — opens format picker */}
      <ExportFAB
        label="Export"
        onClick={() => setExportMenuOpen(true)}
        disabled={exportBusy}
        ariaLabel="Export data"
      />

      {/* Export format picker */}
      <BottomSheet
        open={exportMenuOpen}
        onClose={() => setExportMenuOpen(false)}
        title="Export"
        ariaLabel="Choose export format"
        height="auto"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <button
            type="button"
            disabled={exportBusy}
            onClick={() => {
              setExportMenuOpen(false);
              void handleExportExcel();
            }}
            style={{
              width: "100%",
              padding: "14px 16px",
              borderRadius: 12,
              border: "1px solid #e0e0e0",
              background: "#fff",
              fontFamily: "Arial",
              fontSize: 15,
              fontWeight: 600,
              color: "#1a1a1a",
              cursor: exportBusy ? "not-allowed" : "pointer",
              textAlign: "left",
              display: "flex",
              alignItems: "center",
              gap: 12,
              opacity: exportBusy ? 0.5 : 1,
            }}
          >
            <span style={{ fontSize: 22 }}>📊</span>
            <span>
              Excel (.xlsx)
              <br />
              <span style={{ fontSize: 11, fontWeight: 400, color: "#888" }}>
                4 sheets — Imports &amp; Exports
              </span>
            </span>
          </button>

          <button
            type="button"
            disabled={exportBusy}
            onClick={() => {
              setExportMenuOpen(false);
              void handleExportCsv();
            }}
            style={{
              width: "100%",
              padding: "14px 16px",
              borderRadius: 12,
              border: "1px solid #e0e0e0",
              background: "#fff",
              fontFamily: "Arial",
              fontSize: 15,
              fontWeight: 600,
              color: "#1a1a1a",
              cursor: exportBusy ? "not-allowed" : "pointer",
              textAlign: "left",
              display: "flex",
              alignItems: "center",
              gap: 12,
              opacity: exportBusy ? 0.5 : 1,
            }}
          >
            <span style={{ fontSize: 22 }}>📄</span>
            <span>
              CSV (.zip)
              <span style={{ fontSize: 11, fontWeight: 400, color: "#888" }}>
                <br />
                4 files — imports + exports
              </span>
            </span>
          </button>
        </div>
      </BottomSheet>
    </div>
  );
}
