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
import React, { useMemo, useState } from "react";

// ─── Unit conversion constants (mirrors desktop/View.tsx) ─────────────────────

const PRODUCT_DENSITY_KG_M3: Record<string, number> = {
  Diesel: 832,
  Gasoline: 745,
  "Crude Oil": 870,
};

const M3_PER_BBL = 6.2898;
const GAL_PER_M3 = 264.172;

type ImportsUPMetric = "usd_per_ton" | "cents_per_gal";

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
import MonthRangePicker from "../../../../components/dashboard/MonthRangePicker";

import { useImportsExportsData, formatMonth, addMonths, cmpMonth } from "../useImportsExportsData";
import type {
  UnifiedProduct,
  YoyTableRow,
  PriceMetric,
  PricePoint,
  UnitPriceRow,
  MonthCursor,
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
  // xs are ISO date strings "YYYY-MM-01" so Plotly's xaxis.type='date' parses
  // them natively. Monthly granularity migration (20260526800000).
  const xSet = new Set<string>();
  const entitySet = new Set<string>();
  for (const r of rows) {
    xSet.add(`${r.ano}-${String(r.mes).padStart(2, "0")}-01`);
    entitySet.add(r.name);
  }
  const xs = Array.from(xSet).sort();
  const entities = [
    ...Array.from(entitySet).filter((e) => e !== "Others").sort(),
    ...(entitySet.has("Others") ? ["Others"] : []),
  ];
  const lookup = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const key = `${r.ano}-${String(r.mes).padStart(2, "0")}-01`;
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
      hovertemplate: `${entity}: %{y:,.1f} ${unit}<extra></extra>`,
    };
  }) as unknown as PlotData[];
}

// ─── Horizontal ranked bar — single-month variant (mobile) ────────────────────
//
// Same intent as the desktop helper: stacked area collapses to a vertical
// stripe when start === end, so swap to a horizontal bar chart, one bar per
// entity ranked by value desc. "Others" sinks to the bottom in grey.

function buildHorizontalBarTraces(rows: StackedRow[], unit: string): PlotData[] {
  if (!rows.length) return [];
  const byEntity = new Map<string, number>();
  for (const r of rows) {
    byEntity.set(r.name, (byEntity.get(r.name) ?? 0) + r.value);
  }
  const entries = Array.from(byEntity.entries());
  entries.sort(([aName, aVal], [bName, bVal]) => {
    if (aName === "Others") return 1;
    if (bName === "Others") return -1;
    return bVal - aVal;
  });
  const reversed = entries.slice().reverse();
  const allEntities = entries.map(([n]) => n);
  const ys = reversed.map(([n]) => n);
  const xs = reversed.map(([, v]) => v);
  const colors = reversed.map(([n]) => colourForEntity(allEntities, n));
  return [{
    type: "bar" as const,
    orientation: "h" as const,
    x: xs,
    y: ys,
    marker: { color: colors },
    hovertemplate: `%{y}: %{x:,.1f} ${unit}<extra></extra>`,
    showlegend: false,
  } as unknown as PlotData];
}

function buildHorizontalBarTracesFromUnitPrice(
  rows: UnitPriceRow[],
  entities: string[],
  unitLabel: string,
  convertFn: (v: number) => number = (v) => v,
): PlotData[] {
  if (!rows.length) return [];
  const byPais = new Map<string, number | null>();
  for (const r of rows) byPais.set(r.pais, r.usd_per_m3);
  const converted = entities
    .map((e) => {
      const raw = byPais.get(e);
      return raw != null ? ({ name: e, value: convertFn(raw) } as const) : null;
    })
    .filter((x): x is { name: string; value: number } => x != null);
  if (!converted.length) return [];
  converted.sort((a, b) => b.value - a.value);
  const reversed = converted.slice().reverse();
  const allEntities = converted.map((c) => c.name);
  const ys = reversed.map((c) => c.name);
  const xs = reversed.map((c) => c.value);
  const colors = reversed.map((c) => {
    const idx = allEntities.indexOf(c.name);
    return PALETTE[idx % PALETTE.length] ?? OTHERS_COLOR;
  });
  return [{
    type: "bar" as const,
    orientation: "h" as const,
    x: xs,
    y: ys,
    marker: { color: colors },
    hovertemplate: `%{y}: %{x:,.1f} ${unitLabel}<extra></extra>`,
    showlegend: false,
  } as unknown as PlotData];
}

function mobileHorizontalBarLayout(
  xLabel: string,
  monthLabel: string,
  height = 280,
): Partial<Layout> {
  return {
    ...COMMON_LAYOUT,
    hovermode: "closest" as const,
    height,
    // Left margin generous so country names fit; right slim.
    margin: { t: 28, b: 44, l: 110, r: 12 },
    title: {
      text: monthLabel,
      font: { family: "Arial", size: 11, color: "#555" },
      x: 0,
      xanchor: "left" as const,
      y: 0.98,
    },
    xaxis: {
      ...AXIS_LINE,
      title: { text: xLabel, font: { family: "Arial", size: 10 } },
      tickformat: ",.1f",
      tickfont: { family: "Arial", size: 9 },
    },
    yaxis: {
      ...AXIS_LINE,
      tickfont: { family: "Arial", size: 10 },
      automargin: true,
    },
    showlegend: false,
  };
}

// ─── Panel C — import price helpers (mobile) ──────────────────────────────────

const PRICE_COLORS: Record<UnifiedProduct, string> = {
  Diesel: "#ff5000",
  Gasoline: "#FFB04F",
  "Crude Oil": "#1a1a1a",
};

function buildPriceTraces(
  data: PricePoint[],
  unit: string,
  isSingleMonth = false,
): PlotData[] {
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
      (r) => `${r.ano}-${String(r.mes).padStart(2, "0")}-01`,
    );
    const ys = sorted.map((r) => r.value);
    const markerSize = isSingleMonth ? 12 : 3;
    traces.push({
      type: "scatter" as const,
      mode: "lines+markers" as const,
      name: product,
      x: xs,
      y: ys,
      line: { color: PRICE_COLORS[product], width: 2 },
      marker: { size: markerSize, color: PRICE_COLORS[product] },
      hovertemplate: `${product}: %{y:,.2f} ${unit}<extra></extra>`,
    } as unknown as PlotData);
  }
  return traces;
}

// ─── Unit price by country (multi-line, NOT stacked) — mobile ─────────────────
//
// `convertFn`: applied to each usd_per_m3 value before plotting.
// `unitLabel`: shown in hovertemplate (e.g. "USD/ton", "¢/gal", "USD/bbl").

function buildUnitPriceTraces(
  rows: UnitPriceRow[],
  entities: string[],
  unitLabel: string,
  convertFn: (v: number) => number = (v) => v,
): PlotData[] {
  if (!rows.length) return [];

  // xs are ISO date strings (YYYY-MM-01) so Plotly's xaxis.type='date' parses
  // them natively. Monthly granularity migration (20260526800000).
  const byEntity = new Map<string, Map<string, number | null>>();
  const xSet = new Set<string>();

  for (const r of rows) {
    const xKey = `${r.ano}-${String(r.mes).padStart(2, "0")}-01`;
    xSet.add(xKey);
    if (!byEntity.has(r.pais)) byEntity.set(r.pais, new Map());
    byEntity.get(r.pais)!.set(xKey, r.usd_per_m3);
  }

  const xs = Array.from(xSet).sort();

  return entities.map((entity, idx) => {
    const color = PALETTE[idx % PALETTE.length] ?? OTHERS_COLOR;
    const ys = xs.map((x) => {
      const raw = byEntity.get(entity)?.get(x) ?? null;
      return raw != null ? convertFn(raw) : null;
    });
    return {
      type: "scatter" as const,
      mode: "lines" as const,
      name: entity,
      x: xs,
      y: ys,
      connectgaps: true,
      line: { color, width: 1.5 },
      hovertemplate: `${entity}: %{y:,.1f} ${unitLabel}<extra></extra>`,
    } as unknown as PlotData;
  });
}

/**
 * Mobile-tuned monthly tick step. Smaller screen ⇒ slightly looser than desktop:
 * 1-6 months → M1; 7-18 → M3; 19-48 → M6; >48 → M12.
 */
function pickDtickMobile(rangeMonths: number): string {
  if (rangeMonths <= 6) return "M1";
  if (rangeMonths <= 18) return "M3";
  if (rangeMonths <= 48) return "M6";
  return "M12";
}

function mobileAreaLayout(yLabel: string, rangeMonths = 12): Partial<Layout> {
  return {
    ...COMMON_LAYOUT,
    hovermode: "x unified" as const,
    height: 280,
    margin: { t: 8, b: 52, l: 52, r: 8 },
    xaxis: {
      ...AXIS_LINE,
      type: "date" as const,
      tickformat: "%b %Y",
      dtick: pickDtickMobile(rangeMonths),
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
  anchorAno,
  anchorMes,
}: {
  rows: YoyTableRow[];
  loading: boolean;
  volumeLabel: string;
  /** Anchor month for the YoY comparison. Always period.end (single-month
   * semantics since migration 20260527000000). The row fields `last_12m` /
   * `prev_12m` are legacy names: they actually hold the values at
   * (anchorAno, anchorMes) and (anchorAno-1, anchorMes). */
  anchorAno: number;
  anchorMes: number;
}) {
  if (loading) {
    return (
      <div style={{ padding: "8px 16px", color: "#aaa", fontSize: 12 }}>
        Loading...
      </div>
    );
  }
  if (!rows.length) return null;

  const priorLbl = formatMonth(anchorAno - 1, anchorMes);

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
            subtitle={`${priorLbl}: ${row.prev_12m.toLocaleString("en-US", { maximumFractionDigits: 1 })} ${volumeLabel}`}
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

  // Range in months — feeds chart dtick (M1/M3/M6/M12).
  const rangeMonths = useMemo(() => {
    const s = filters.period.start;
    const e = filters.period.end;
    return (e.ano - s.ano) * 12 + (e.mes - s.mes) + 1;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- destructured cursors
  }, [filters.period.start.ano, filters.period.start.mes, filters.period.end.ano, filters.period.end.mes]);

  // Single-month flag — when start === end, stacked area degenerates. Switch
  // to a horizontal ranked bar instead (mirrors desktop).
  const isSingleMonth = useMemo(
    () => cmpMonth(filters.period.start, filters.period.end) === 0,
  // eslint-disable-next-line react-hooks/exhaustive-deps -- destructured cursors
  [filters.period.start.ano, filters.period.start.mes, filters.period.end.ano, filters.period.end.mes]);

  const singleMonthLabel = useMemo(
    () => formatMonth(filters.period.end.ano, filters.period.end.mes),
  [filters.period.end.ano, filters.period.end.mes]);

  const [filterOpen, setFilterOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);

  // Panel D — imports unit price metric toggle (local state, not global filter)
  const [importsUPMetric, setImportsUPMetric] = useState<ImportsUPMetric>("usd_per_ton");

  // Bounds for the month pickers (drawer). Fallbacks let the drawer render
  // sensibly while filtros is still loading.
  const anoMin = filtros?.ano_min ?? 2010;
  const mesMin = filtros?.mes_min ?? 1;
  const anoMax = filtros?.ano_max ?? new Date().getFullYear();
  const mesMax = filtros?.mes_max ?? 12;
  const lowerBound: MonthCursor = { ano: anoMin, mes: mesMin };
  const upperBound: MonthCursor = { ano: anoMax, mes: mesMax };

  // ── Derived traces ─────────────────────────────────────────────────────────
  // All useMemo calls MUST be before any conditional early returns (Rules of Hooks).

  const paisesTraces = useMemo(() => {
    const rows = paisesData.map((r) => ({
      ano: r.ano,
      mes: r.mes,
      name: r.pais_origem,
      value: r.total_kg / 1e6,
    }));
    return isSingleMonth
      ? buildHorizontalBarTraces(rows, "kt")
      : buildStackedTraces(rows, "kt");
  }, [paisesData, isSingleMonth]);

  const paisesLayout: Partial<Layout> = useMemo(
    () =>
      isSingleMonth
        ? mobileHorizontalBarLayout("kt", singleMonthLabel, 280)
        : mobileAreaLayout("kt", rangeMonths),
    [rangeMonths, isSingleMonth, singleMonthLabel],
  );

  const importersTraces = useMemo(() => {
    const rows = importersData.map((r) => ({
      ano: r.ano,
      mes: r.mes,
      name: r.unified_importer,
      value: r.total_mil_m3,
    }));
    return isSingleMonth
      ? buildHorizontalBarTraces(rows, "mil m³")
      : buildStackedTraces(rows, "mil m³");
  }, [importersData, isSingleMonth]);

  const importersLayout: Partial<Layout> = useMemo(
    () =>
      isSingleMonth
        ? mobileHorizontalBarLayout("mil m³", singleMonthLabel, 280)
        : mobileAreaLayout("mil m³", rangeMonths),
    [rangeMonths, isSingleMonth, singleMonthLabel],
  );

  // Exports — stacked area by destination country (value already in correct unit from RPC)
  const exportsUnit = filters.exportsYAxis === "volume" ? "mil m³" : "USD";

  const exportsPaisesTraces = useMemo(() => {
    const rows = exportsPaisesData.map((r) => ({
      ano: r.ano,
      mes: r.mes,
      name: r.pais,
      value: r.value, // server already in mil m³ or USD — never divide client-side
    }));
    return isSingleMonth
      ? buildHorizontalBarTraces(rows, exportsUnit)
      : buildStackedTraces(rows, exportsUnit);
  }, [exportsPaisesData, exportsUnit, isSingleMonth]);

  const exportsPaisesLayout: Partial<Layout> = useMemo(
    () =>
      isSingleMonth
        ? mobileHorizontalBarLayout(exportsUnit, singleMonthLabel, 280)
        : mobileAreaLayout(exportsUnit, rangeMonths),
    [exportsUnit, rangeMonths, isSingleMonth, singleMonthLabel],
  );

  // Panel C — price metric
  const priceUnitLabel: Record<PriceMetric, string> = {
    fob_per_bbl: "USD / bbl",
    fob_per_m3: "USD / m³",
    fob_per_ton: "USD / ton",
  };
  const priceUnit = priceUnitLabel[filters.priceMetric];

  const priceTraces = useMemo(
    () => buildPriceTraces(priceData, priceUnit, isSingleMonth),
    [priceData, priceUnit, isSingleMonth],
  );

  const priceLayout: Partial<Layout> = useMemo(
    () => ({
      ...COMMON_LAYOUT,
      hovermode: "x unified" as const,
      height: 240,
      margin: { t: 8, b: 52, l: 56, r: 8 },
      xaxis: {
        ...AXIS_LINE,
        type: "date" as const,
        tickformat: "%b %Y",
        dtick: pickDtickMobile(rangeMonths),
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
    [priceUnit, rangeMonths],
  );

  // ── Unit price traces (imports + exports) ─────────────────────────────────
  const importsUPEntities = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of importsUnitPriceData) {
      if (r.usd_per_m3 != null) totals.set(r.pais, (totals.get(r.pais) ?? 0) + 1);
    }
    return Array.from(totals.keys()).sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
  }, [importsUnitPriceData]);

  // Imports unit price — conversion based on local metric toggle
  const importsUPConvertFn = useMemo(() => {
    const density = PRODUCT_DENSITY_KG_M3[filters.unifiedProduct] ?? 840;
    if (importsUPMetric === "usd_per_ton") {
      return (v: number) => v / (density / 1000);
    }
    return (v: number) => (v / GAL_PER_M3) * 100;
  }, [filters.unifiedProduct, importsUPMetric]);

  const importsUPUnitLabel = importsUPMetric === "usd_per_ton" ? "USD/ton" : "¢/gal";

  const importsUPTraces = useMemo(
    () =>
      isSingleMonth
        ? buildHorizontalBarTracesFromUnitPrice(
            importsUnitPriceData,
            importsUPEntities,
            importsUPUnitLabel,
            importsUPConvertFn,
          )
        : buildUnitPriceTraces(
            importsUnitPriceData,
            importsUPEntities,
            importsUPUnitLabel,
            importsUPConvertFn,
          ),
    [importsUnitPriceData, importsUPEntities, importsUPUnitLabel, importsUPConvertFn, isSingleMonth],
  );

  const importsUPMobileLayout: Partial<Layout> = useMemo(
    () =>
      isSingleMonth
        ? mobileHorizontalBarLayout(importsUPUnitLabel, singleMonthLabel, 240)
        : {
            ...COMMON_LAYOUT,
            hovermode: "x unified" as const,
            height: 240,
            margin: { t: 8, b: 52, l: 56, r: 8 },
            xaxis: {
              ...AXIS_LINE,
              type: "date" as const,
              tickformat: "%b %Y",
              dtick: pickDtickMobile(rangeMonths),
              tickangle: -60,
              tickfont: { family: "Arial", size: 8 },
            },
            yaxis: {
              ...AXIS_LINE,
              title: { text: importsUPUnitLabel, font: { family: "Arial", size: 10 } },
              tickformat: ",.1f",
            },
            legend: {
              orientation: "h" as const,
              x: 0,
              y: -0.3,
              font: { family: "Arial", size: 9 },
            },
          },
    [importsUPUnitLabel, rangeMonths, isSingleMonth, singleMonthLabel],
  );

  // Exports unit price — Crude Oil only, USD/bbl
  const exportsUPEntities = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of exportsUnitPriceData) {
      if (r.usd_per_m3 != null) totals.set(r.pais, (totals.get(r.pais) ?? 0) + 1);
    }
    return Array.from(totals.keys()).sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
  }, [exportsUnitPriceData]);

  const exportsUPTraces = useMemo(
    () => {
      if (filters.unifiedProduct !== "Crude Oil") return [];
      return isSingleMonth
        ? buildHorizontalBarTracesFromUnitPrice(
            exportsUnitPriceData,
            exportsUPEntities,
            "USD/bbl",
            (v) => v / M3_PER_BBL,
          )
        : buildUnitPriceTraces(
            exportsUnitPriceData,
            exportsUPEntities,
            "USD/bbl",
            (v) => v / M3_PER_BBL,
          );
    },
    [exportsUnitPriceData, exportsUPEntities, filters.unifiedProduct, isSingleMonth],
  );

  const exportsUPMobileLayout: Partial<Layout> = useMemo(
    () =>
      isSingleMonth
        ? mobileHorizontalBarLayout("USD / bbl", singleMonthLabel, 240)
        : {
            ...COMMON_LAYOUT,
            hovermode: "x unified" as const,
            height: 240,
            margin: { t: 8, b: 52, l: 56, r: 8 },
            xaxis: {
              ...AXIS_LINE,
              type: "date" as const,
              tickformat: "%b %Y",
              dtick: pickDtickMobile(rangeMonths),
              tickangle: -60,
              tickfont: { family: "Arial", size: 8 },
            },
            yaxis: {
              ...AXIS_LINE,
              title: { text: "USD / bbl", font: { family: "Arial", size: 10 } },
              tickformat: ",.2f",
            },
            legend: {
              orientation: "h" as const,
              x: 0,
              y: -0.3,
              font: { family: "Arial", size: 9 },
            },
          },
    [rangeMonths, isSingleMonth, singleMonthLabel],
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
      const slug = filters.unifiedProduct.toLowerCase().replace(/\s+/g, "-");
      const startMonth = `${filters.period.start.ano}-${String(filters.period.start.mes).padStart(2, "0")}`;
      const endMonth = `${filters.period.end.ano}-${String(filters.period.end.mes).padStart(2, "0")}`;
      a.download = `imports-exports_${slug}_${startMonth}_${endMonth}.xlsx`;
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

      const slug = filters.unifiedProduct.toLowerCase().replace(/\s+/g, "-");
      const startMonth = `${filters.period.start.ano}-${String(filters.period.start.mes).padStart(2, "0")}`;
      const endMonth = `${filters.period.end.ano}-${String(filters.period.end.mes).padStart(2, "0")}`;

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `imports-exports_${slug}_${startMonth}_${endMonth}.zip`;
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
                layout={paisesLayout}
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
                {formatMonth(filters.period.end.ano, filters.period.end.mes)} vs {formatMonth(filters.period.end.ano - 1, filters.period.end.mes)} — Countries
              </div>
              <YoYCardList
                rows={yoyPaisesData}
                loading={yoyPaisesLoading}
                volumeLabel="kt"
                anchorAno={filters.period.end.ano}
                anchorMes={filters.period.end.mes}
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
                layout={importersLayout}
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
                {formatMonth(filters.period.end.ano, filters.period.end.mes)} vs {formatMonth(filters.period.end.ano - 1, filters.period.end.mes)} — Importers
              </div>
              <YoYCardList
                rows={yoyImportersData}
                loading={yoyImportersLoading}
                volumeLabel="mil m³"
                anchorAno={filters.period.end.ano}
                anchorMes={filters.period.end.mes}
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
            title={`Import Unit Price by Country (${importsUPUnitLabel})`}
            loading={importsUnitPriceLoading}
          />
          {/* Metric toggle: USD/ton | ¢/gal */}
          <div
            style={{
              padding: "0 16px 8px",
              display: "flex",
              gap: 8,
            }}
          >
            {(["usd_per_ton", "cents_per_gal"] as ImportsUPMetric[]).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setImportsUPMetric(opt)}
                style={{
                  padding: "4px 14px",
                  borderRadius: 999,
                  border: "1px solid #d0d0d0",
                  background: importsUPMetric === opt ? "#1a1a1a" : "#fff",
                  color: importsUPMetric === opt ? "#fff" : "#333",
                  fontFamily: "Arial",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  minHeight: 32,
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                {opt === "usd_per_ton" ? "USD / ton" : "¢ / gal"}
              </button>
            ))}
          </div>
          <div style={{ padding: "0 16px 8px" }}>
            {importsUPTraces.length > 0 ? (
              <Plot
                data={importsUPTraces}
                layout={importsUPMobileLayout}
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
                {formatMonth(filters.period.end.ano, filters.period.end.mes)} vs {formatMonth(filters.period.end.ano - 1, filters.period.end.mes)} — By Country
              </div>
              <YoYCardList
                rows={yoyExportsData}
                loading={yoyExportsLoading}
                volumeLabel={exportsUnit}
                anchorAno={filters.period.end.ano}
                anchorMes={filters.period.end.mes}
              />
            </>
          )}

          <div style={{ padding: "8px 16px 0", fontSize: 10, color: "#aaa", fontStyle: "italic" }}>
            Source: MDIC Comex — monthly customs-declared exports by destination country
            (NCM 27090010 / 27101259 / 27101921; kg→m³ via ANP standard densities).
          </div>

          <div style={{ height: 16 }} />

          {/* Export Unit Price by Destination Country — Crude Oil only */}
          {filters.unifiedProduct === "Crude Oil" && (
            <>
              <div style={{ height: 16 }} />
              <SectionHeading
                title="Export Unit Price by Country (USD/bbl)"
                loading={exportsUnitPriceLoading}
              />
              <div style={{ padding: "0 16px 8px" }}>
                {exportsUPTraces.length > 0 ? (
                  <Plot
                    data={exportsUPTraces}
                    layout={exportsUPMobileLayout}
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
                Source: MDIC Comex — FOB USD/bbl per destination (1 m³ = 6.2898 bbl). Top 8 destinations by export volume. Crude Oil only.
              </div>
            </>
          )}
        </div>
      )}

      {/* Filter drawer — monthly granularity (migration 20260526800000).
          Four selects: start (year + month) and end (year + month). Cursors
          are clamped against filtros bounds; if start > end after a change
          we swap to keep the period valid. Single-month view supported by
          setting start === end. */}
      <FilterDrawer
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Filters"
        onReset={() => {
          const end: MonthCursor = upperBound;
          let start = addMonths(end, -11);
          if (cmpMonth(start, lowerBound) < 0) start = lowerBound;
          setFilters({
            unifiedProduct: "Diesel",
            period: { start, end },
          });
        }}
        onApply={() => setFilterOpen(false)}
        applyLabel="Apply"
        resetLabel="Reset"
      >
        {/* Period — shared MonthRangePicker (same component used by desktop sidebar).
            Quick-range chips (Last 12m, Last 24m, YTD, Last 5y, All) + 4 selects.
            Clamping + ordering enforced inside the picker. */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.4px" }}>
            Period
          </div>
          {filtrosLoading && !filtros ? (
            <div style={{ fontSize: 12, color: "#aaa" }}>Loading…</div>
          ) : (
            <MonthRangePicker
              min={lowerBound}
              max={upperBound}
              value={filters.period}
              onChange={(next) => setFilters({ period: next })}
              layout="sidebar"
              showQuickRanges
            />
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
