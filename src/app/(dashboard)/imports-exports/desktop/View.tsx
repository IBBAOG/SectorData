"use client";

// Desktop view for /imports-exports (≥769px).
//
// Outer shell follows the project canonical pattern:
//   NavBar → container-fluid g-0 → row g-0
//     col-xxl-2 col-md-3 (#sidebar with BrandLogo + sidebar-* CSS classes)
//     col-xxl-10 col-md-9 (#page-content)
//
// Data logic lives entirely in useImportsExportsData — this file is
// presentation only.
//
// Binding sync rule (CLAUDE.md § Dual-view policy): any meaningful change
// here (new filter, chart, KPI, copy) must land in mobile/View.tsx in the
// SAME commit, or the commit message must declare [desktop-only].
//
// Units — CRITICAL: never drift label from divisor.
//   Panel A: total_kg / 1e6 = kt. Label "kt".
//   Panel B: total_mil_m3 already from RPC. Label "mil m³".
//   Exports (metric=volume): server returns mil m³ — DO NOT divide. Label "mil m³".
//   Exports (metric=usd): server returns raw USD. Label "USD".

import dynamic from "next/dynamic";
import type { Layout, PlotData } from "plotly.js";
import { useMemo } from "react";
import MonthRangePicker from "../../../../components/dashboard/MonthRangePicker";
import { ExportButton } from "@/lib/export";
import { importsExportsExport } from "@/lib/export/dashboards/importsExports";

// ─── Unit conversion constants ─────────────────────────────────────────────────

// Density by unified product (kg/m³). Used for client-side unit conversion of
// the imports unit price chart (Panel D). RPC returns USD/m³; we convert here.
// Values: ANP standard (same source as ncm_densidade_kg_m3 table).
const PRODUCT_DENSITY_KG_M3: Record<string, number> = {
  Diesel: 832,
  Gasoline: 745,
  "Crude Oil": 870,
};

// Crude Oil exports: 1 m³ = 6.2898 bbl (international standard for petroleum).
const M3_PER_BBL = 6.2898;

// Gallons per m³ (US liquid gallon).
const GAL_PER_M3 = 264.172;

import NavBar from "../../../../components/NavBar";
import BrandLogo from "../../../../components/BrandLogo";
import DashboardHeader from "../../../../components/dashboard/DashboardHeader";
import ChartSection from "../../../../components/dashboard/ChartSection";
import SegmentedToggle from "../../../../components/dashboard/SegmentedToggle";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";

import { useImportsExportsData, formatMonth, cmpMonth } from "../useImportsExportsData";
import type {
  UnifiedProduct,
  YoyTableRow,
  UnitPriceRow,
  MonthCursor,
  PriceSummaryRow,
  ImportsUnitPriceMetric,
} from "../useImportsExportsData";

import { COMMON_LAYOUT, AXIS_LINE, PALETTE, emptyPlot } from "../../../../lib/plotlyDefaults";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

// ─── Colour helpers ────────────────────────────────────────────────────────────

const OTHERS_COLOR = "#7F7F7F"; // neutral grey for "Others" bucket (pinned palette spec)
const OTHERS_LABEL = "Others";

// ─── Pinned origin-country palette (Imports tab — countries panels) ───────────
//
// Reference: CTO spec 2026-05-27 — exact replication of the legacy "Diesel
// Imports by Origin (Thousand m³)" chart. Only these 6 countries appear as
// their own series; every other origin country (Bahamas, China, Coréia do Sul,
// Quirguistão, Omã, etc.) is collapsed into a single client-side "Others"
// bucket regardless of what the server's top-N + Others bucket contains.
//
// `dbName`: literal Portuguese value stored in `anp_desembaracos.pais_origem`
//           (verified 2026-05-27 by querying get_imports_exports_paises_stacked
//           with p_top_n=30 across 2022–2026). The Netherlands entry differs
//           from the CTO's initial spec ("Países Baixos") — DB carries
//           "Países Baixos (Holanda)" instead.
// `label`:  English display label (legend, tooltip, table).
// `color`:  hex from the reference image; never derived from PALETTE for
//           these 6 entities.
//
// **Order matters** — this is the legend order (top to bottom of the stack
// and left to right in the legend): Russia → US → UAE → Netherlands → India
// → Saudi Arabia → Others (last, neutral grey).
//
// Scope: applies to Imports tab Panel A (By Origin Country stacked area) and
// its YoY table — the volume-side view of the same data. Panel D (Imports
// Unit Price by Origin Country) and the Imports Price Summary table are NOT
// pinned anymore (since 2026-05-28): they render exactly 3 series — top-2
// origin countries by SUM(vol_m3) in the window + Others (volume-weighted
// average) — so the chart and the table beneath it agree 1:1. When a top-2
// country happens to be in this pin set, its trace inherits the pinned color;
// otherwise the trace falls back to PALETTE rotation. Importer panel (Panel B)
// and the Exports tab use their own coloring strategies.
const ORIGIN_COUNTRY_PINS: ReadonlyArray<{
  dbName: string;
  label: string;
  color: string;
}> = [
  { dbName: "Rússia", label: "Russia", color: "#000000" },
  { dbName: "Estados Unidos", label: "United States", color: "#FF5000" },
  { dbName: "Emirados Árabes Unidos", label: "UAE", color: "#73C6A1" },
  { dbName: "Países Baixos (Holanda)", label: "Netherlands", color: "#FFAE66" },
  { dbName: "Índia", label: "India", color: "#8258A0" },
  { dbName: "Arábia Saudita", label: "Saudi Arabia", color: "#D2FF00" },
];

// Lookup: DB Portuguese → English label
const ORIGIN_LABEL_BY_DB: Record<string, string> = ORIGIN_COUNTRY_PINS.reduce(
  (acc, p) => ({ ...acc, [p.dbName]: p.label }),
  {} as Record<string, string>,
);

// Lookup: English label → color
const ORIGIN_COLOR_BY_LABEL: Record<string, string> = ORIGIN_COUNTRY_PINS.reduce(
  (acc, p) => ({ ...acc, [p.label]: p.color }),
  { [OTHERS_LABEL]: OTHERS_COLOR } as Record<string, string>,
);

// Fixed render order (English labels) — Russia first, Others last.
const ORIGIN_ORDER: string[] = [
  ...ORIGIN_COUNTRY_PINS.map((p) => p.label),
  OTHERS_LABEL,
];

/**
 * Re-bucket raw country rows against the 6-country pin set:
 * any country not in ORIGIN_COUNTRY_PINS (including the server's own
 * "Others" bucket) collapses into a single client-side "Others" entry
 * per (ano, mes). Pinned countries are relabeled to English.
 *
 * Output rows use `name = English label`.
 */
function bucketPaisesByPins(
  rows: { ano: number; mes: number; pais_origem: string; total_kg: number }[],
): { ano: number; mes: number; name: string; total_kg: number }[] {
  const byKey = new Map<string, number>();
  for (const r of rows) {
    const englishLabel = ORIGIN_LABEL_BY_DB[r.pais_origem] ?? OTHERS_LABEL;
    const k = `${r.ano}|${r.mes}|${englishLabel}`;
    byKey.set(k, (byKey.get(k) ?? 0) + r.total_kg);
  }
  const out: { ano: number; mes: number; name: string; total_kg: number }[] = [];
  for (const [k, total_kg] of byKey.entries()) {
    const [a, m, name] = k.split("|");
    out.push({ ano: Number(a), mes: Number(m), name, total_kg });
  }
  return out;
}

/**
 * Inject null-valued points so every pinned country has a series in every
 * month present in `rows`. Ensures the legend always carries the full 7
 * entries (Russia → Saudi Arabia + Others) even when a country has no
 * volume in the selected window — matches the reference image where UAE
 * and Netherlands always show in the legend even at near-zero values.
 *
 * Null (not 0) is used so Plotly's unified hover tooltip omits these entries
 * entirely for the affected month — no "UAE: 0 kt" pollution. In a
 * stackgroup, null is treated as "no contribution" so the visual stack
 * baseline of the OTHER traces is preserved (Plotly handles this natively).
 *
 * Input/output rows carry English `name`; value type widens to allow null.
 */
function ensureAllPinsPresent(
  rows: { ano: number; mes: number; name: string; value: number | null }[],
): { ano: number; mes: number; name: string; value: number | null }[] {
  if (!rows.length) return rows;
  const monthKeys = new Set<string>();
  for (const r of rows) monthKeys.add(`${r.ano}|${r.mes}`);
  const present = new Set<string>();
  for (const r of rows) present.add(`${r.ano}|${r.mes}|${r.name}`);
  const out = [...rows];
  for (const mk of monthKeys) {
    const [a, m] = mk.split("|").map(Number);
    for (const pin of ORIGIN_COUNTRY_PINS) {
      const key = `${a}|${m}|${pin.label}`;
      if (!present.has(key)) {
        out.push({ ano: a, mes: m, name: pin.label, value: null });
      }
    }
    // Ensure Others bucket exists too (even as null) so legend stays stable.
    const othersKey = `${a}|${m}|${OTHERS_LABEL}`;
    if (!present.has(othersKey)) {
      out.push({ ano: a, mes: m, name: OTHERS_LABEL, value: null });
    }
  }
  return out;
}

function colourForEntity(entities: string[], entity: string): string {
  if (entity === OTHERS_LABEL) return OTHERS_COLOR;
  // Pinned-origin lookup (Imports countries panels): authoritative.
  const pinned = ORIGIN_COLOR_BY_LABEL[entity];
  if (pinned) return pinned;
  // Fallback for non-pinned entities (importer panel, exports countries):
  // rotate through PALETTE, excluding "Others".
  const idx = entities.filter((e) => e !== OTHERS_LABEL).indexOf(entity);
  return PALETTE[idx % PALETTE.length] ?? OTHERS_COLOR;
}

// ─── Stacked area builder ──────────────────────────────────────────────────────

type StackedRow = { ano: number; mes: number; name: string; value: number | null };

// Minimum value to show a trace in the unified hover tooltip.
// Points below this threshold are converted to null in the y array so Plotly's
// unified hover skips them entirely (no swatch, no "0 kt" pollution). In a
// stackgroup, null is treated as "no contribution" so the visual baseline of
// other traces is preserved.
// Volume threshold: 0.05 mil m³ (50 m³). For the Exports USD metric this
// effectively suppresses true zeros only (any real export is orders of
// magnitude larger). A single constant works for all panels because the RPC
// already returns the correct unit — server-side conversion means the numeric
// magnitude is comparable across panels.
const HOVER_THRESHOLD = 0.05;

function buildStackedTraces(
  rows: StackedRow[],
  unit: string,
  orderOverride?: string[],
  colorMap?: Record<string, string>,
): PlotData[] {
  if (!rows.length) return [];

  // xs are ISO date strings "YYYY-MM-01" so that Plotly's xaxis.type='date'
  // parses them natively. Monthly granularity migration (20260526800000).
  const xSet = new Set<string>();
  const entitySet = new Set<string>();
  for (const r of rows) {
    xSet.add(`${r.ano}-${String(r.mes).padStart(2, "0")}-01`);
    entitySet.add(r.name);
  }
  const xs = Array.from(xSet).sort();
  // `orderOverride` (used by Imports Panel A — pinned-country mode) imposes a
  // fixed entity order so the stack always reads Russia → US → UAE → ...
  // → Others regardless of which countries actually have non-zero data.
  // When absent, fall back to alphabetical + Others last (legacy behavior).
  const entities = orderOverride
    ? orderOverride.filter((e) => entitySet.has(e))
    : [
        ...Array.from(entitySet).filter((e) => e !== OTHERS_LABEL).sort(),
        ...(entitySet.has(OTHERS_LABEL) ? [OTHERS_LABEL] : []),
      ];

  const lookup = new Map<string, Map<string, number | null>>();
  for (const r of rows) {
    const key = `${r.ano}-${String(r.mes).padStart(2, "0")}-01`;
    if (!lookup.has(r.name)) lookup.set(r.name, new Map());
    lookup.get(r.name)!.set(key, r.value);
  }

  return entities.map((entity) => {
    // `colorMap` (Panel B importer rank palette) wins over `colourForEntity`
    // when a mapping is provided — Panel A pinned palette path falls through
    // because `ORIGIN_COLOR_BY_LABEL` still drives `colourForEntity`.
    const color = colorMap?.[entity] ?? colourForEntity(entities, entity);
    // Sub-threshold values → null so Plotly's unified hover omits them. In a
    // stackgroup, null is "no contribution" — the other traces stack correctly.
    const ys = xs.map((x) => {
      const v = lookup.get(entity)?.get(x);
      if (v == null) return null;
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

// ─── Horizontal ranked bar — used when the period collapses to a single month ──
//
// Stacked area charts degenerate to a vertical stripe when start === end. In
// that case we switch to a horizontal bar chart, one bar per entity ranked by
// value desc — the most informative visual for "who imported X in May 2026".
// "Others" is rendered last (bottom) in neutral grey.

function buildHorizontalBarTraces(
  rows: StackedRow[],
  unit: string,
  orderOverride?: string[],
  colorMap?: Record<string, string>,
): PlotData[] {
  if (!rows.length) return [];
  // Aggregate by entity (rows should already be single-month, but defensively
  // sum just in case the RPC ever returns multiple rows for the same entity).
  // Null values (from `ensureAllPinsPresent`) are treated as 0 contribution.
  const byEntity = new Map<string, number>();
  for (const r of rows) {
    byEntity.set(r.name, (byEntity.get(r.name) ?? 0) + (r.value ?? 0));
  }
  let entries: [string, number][];
  if (orderOverride) {
    // Pinned-country mode: preserve fixed order so the bar chart's legend
    // reads identically to the multi-month stacked area (Russia first,
    // Others last). Entities absent from byEntity get omitted by filter.
    entries = orderOverride
      .filter((n) => byEntity.has(n))
      .map((n) => [n, byEntity.get(n) as number]);
  } else {
    entries = Array.from(byEntity.entries());
    // Sort descending; "Others" sinks to the bottom regardless of value.
    entries.sort(([aName, aVal], [bName, bVal]) => {
      if (aName === OTHERS_LABEL) return 1;
      if (bName === OTHERS_LABEL) return -1;
      return bVal - aVal;
    });
  }
  // For horizontal bars, Plotly puts the FIRST y-array entry at the bottom.
  // We want the biggest value at the top → reverse the entries.
  const reversed = entries.slice().reverse();
  const allEntities = entries.map(([n]) => n);
  const ys = reversed.map(([n]) => n);
  const xs = reversed.map(([, v]) => v);
  // `colorMap` (Panel B importer rank palette) wins over `colourForEntity`.
  const colors = reversed.map(([n]) =>
    colorMap?.[n] ?? colourForEntity(allEntities, n),
  );
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

function horizontalBarLayout(
  xLabel: string,
  monthLabel: string,
  height = 340,
): Partial<Layout> {
  return {
    ...COMMON_LAYOUT,
    hovermode: "closest" as const,
    height,
    margin: { t: 32, b: 50, l: 160, r: 24 },
    title: {
      text: monthLabel,
      font: { family: "Arial", size: 12, color: "#555" },
      x: 0,
      xanchor: "left" as const,
      y: 0.98,
    },
    xaxis: {
      ...AXIS_LINE,
      title: { text: xLabel, font: { family: "Arial", size: 11 } },
      tickformat: ",.1f",
      tickfont: { family: "Arial", size: 12 },
    },
    yaxis: {
      ...AXIS_LINE,
      tickfont: { family: "Arial", size: 12 },
      automargin: true,
    },
    showlegend: false,
  };
}

// ─── Multi-line → single-month horizontal bar (unit price panels) ──────────────
//
// Like buildHorizontalBarTraces but reads from UnitPriceRow[] and applies the
// caller-supplied `convertFn` (USD/m³ → USD/ton, ¢/gal, USD/bbl) per value.
// Lines with no data for the anchor month are silently dropped.

function buildHorizontalBarTracesFromUnitPrice(
  rows: UnitPriceRow[],
  entities: string[],
  unitLabel: string,
  convertFn: (v: number) => number = (v) => v,
  colorMap?: Record<string, string>,
): PlotData[] {
  if (!rows.length) return [];
  // Each row is (ano, mes, pais, usd_per_m3) but the period is single-month, so
  // there is at most one row per pais. Build a quick lookup, then iterate
  // entities in their already-ranked order.
  const byPais = new Map<string, number | null>();
  for (const r of rows) byPais.set(r.pais, r.usd_per_m3);
  // Filter entities that actually have a value; convert and rank desc.
  const converted = entities
    .map((e) => {
      const raw = byPais.get(e);
      return raw != null ? ({ name: e, value: convertFn(raw) } as const) : null;
    })
    .filter((x): x is { name: string; value: number } => x != null);
  if (!converted.length) return [];
  converted.sort((a, b) => b.value - a.value);
  // Reverse for horizontal bar (biggest on top).
  const reversed = converted.slice().reverse();
  const allEntities = converted.map((c) => c.name);
  const ys = reversed.map((c) => c.name);
  const xs = reversed.map((c) => c.value);
  const colors = reversed.map((c) => {
    // colorMap (Panel D pinned-country mode) wins over PALETTE rotation.
    if (colorMap?.[c.name]) return colorMap[c.name];
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

// ─── YoY table ─────────────────────────────────────────────────────────────────
//
// Canonical pattern mirrored from /anp-cdp-bsw and /anp-cdp-depletion:
//   - Scrollable container (maxHeight 400 + overflow auto + border + radius)
//   - Bootstrap `table-sm table-striped`
//   - Sticky <thead> with darker 2px bottom border
//   - First column: color dot (matches chart palette via colourForEntity)
//     + ellipsis-truncated entity (maxWidth 220, title tooltip)
//   - Numeric cells: fontVariantNumeric "tabular-nums"
//   - Delta cells: green (>0) / red (<0) / muted grey (null/0), weight 600
//   - Prior-period cell: muted color (#777)

function fmtDelta(v: number | null): { text: string; color: string } {
  if (v == null || !isFinite(v)) return { text: "—", color: "#666" };
  const text = (v > 0 ? "+" : "") + v.toFixed(1) + "%";
  const color = v > 0 ? "#28a745" : v < 0 ? "#dc3545" : "#666";
  return { text, color };
}

/**
 * Compute MoM % from current and previous-month values. Mirrors the YoY %
 * server-side math but lives client-side because prev_month is derived from
 * the stacked-area dataset, not returned by the YoY RPC.
 *
 * Semantics:
 *   prev == null  → null  ("—" — no comparable baseline)
 *   prev == 0     → null  ("—" — division-by-zero guard; matches existing
 *                          yoy_pct convention in server RPC for zero priors)
 *   else          → (current - prev) / prev * 100
 */
function computeMoMPct(current: number, prev: number | null | undefined): number | null {
  if (prev == null || prev === 0) return null;
  return ((current - prev) / prev) * 100;
}

function YoYTable({
  rows,
  loading,
  volumeLabel,
  title,
  anchorAno,
  anchorMes,
  orderOverride,
  prevMonthByEntity,
  colorMap,
}: {
  rows: YoyTableRow[];
  loading: boolean;
  volumeLabel: string;
  title: string;
  /** Anchor month for the YoY comparison. Always period.end (single-month
   * semantics since migration 20260527000000). `last_12m` / `prev_12m` column
   * keys are legacy names — semantically they hold the values of (anchorAno,
   * anchorMes) and (anchorAno-1, anchorMes) respectively. */
  anchorAno: number;
  anchorMes: number;
  /** Optional fixed render order for the rows. When provided, the non-Others
   *  entries inside this order are sorted by current-month value descending,
   *  and the Others bucket is anchored at the bottom (regardless of magnitude).
   *  Used by Imports Panel A YoY table to mirror the chart's pinned legend. */
  orderOverride?: string[];
  /** Map of entity → previous-month value (anchor - 1 month). Derived
   *  client-side from the stacked-area chart data. null means the entity
   *  had no data in the prior month (e.g. first month of the series). */
  prevMonthByEntity: Map<string, number | null>;
  /** Optional color map (entity → hex). When provided, dot colors come from
   *  this map; falls back to `colourForEntity` lookup (Panel A pinned palette
   *  / Exports PALETTE rotation). Used by Panel B to inject the rank-bound
   *  importer palette. */
  colorMap?: Record<string, string>;
}) {
  if (loading) {
    return (
      <div style={{ color: "#aaa", fontSize: 12, padding: "8px 0" }}>
        Loading...
      </div>
    );
  }
  if (!rows.length) return null;

  // Column headers — three month labels driven by anchor.
  const currentLbl = formatMonth(anchorAno, anchorMes);
  const prevMonthCursor =
    anchorMes === 1
      ? { ano: anchorAno - 1, mes: 12 }
      : { ano: anchorAno, mes: anchorMes - 1 };
  const prevMonthLbl = formatMonth(prevMonthCursor.ano, prevMonthCursor.mes);
  const priorYearLbl = formatMonth(anchorAno - 1, anchorMes);

  // Build the entity set in the same shape `buildStackedTraces` uses so the
  // table's color dots match the chart's trace colors for each entity.
  const entitySet = new Set(rows.map((r) => r.entity));

  // Sort by current-month value (last_12m) descending. Magnitude ordering is
  // the canonical reading order for "who imported the most".
  //
  // Pinned-countries case (orderOverride present): pinned entities sort by
  // current desc; Others is anchored at the bottom regardless of value
  // (convention — Others is an aggregate bucket, not a peer entity).
  const rowByEntity = new Map(rows.map((r) => [r.entity, r]));
  let tableEntities: string[];
  if (orderOverride) {
    const present = orderOverride.filter((e) => entitySet.has(e));
    const nonOthers = present
      .filter((e) => e !== OTHERS_LABEL)
      .sort((a, b) => (rowByEntity.get(b)?.last_12m ?? 0) - (rowByEntity.get(a)?.last_12m ?? 0));
    const hasOthers = present.includes(OTHERS_LABEL);
    tableEntities = hasOthers ? [...nonOthers, OTHERS_LABEL] : nonOthers;
  } else {
    tableEntities = Array.from(entitySet).sort(
      (a, b) => (rowByEntity.get(b)?.last_12m ?? 0) - (rowByEntity.get(a)?.last_12m ?? 0),
    );
  }

  const orderedRows: YoyTableRow[] = tableEntities
    .map((e) => rowByEntity.get(e))
    .filter((r): r is YoyTableRow => r != null);

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
        {title} — {currentLbl} vs {priorYearLbl}
      </div>
      <div
        style={{
          maxHeight: 400,
          overflowY: "auto",
          overflowX: "hidden",
          border: "1px solid #ececec",
          borderRadius: 4,
        }}
      >
        <table
          className="table table-sm table-striped mb-0"
          style={{
            fontFamily: "Arial",
            fontSize: 12,
            tableLayout: "fixed",
            width: "100%",
            margin: 0,
          }}
        >
          <colgroup>
            {/* Entity: 28% — widest column; value cols share 72% equally (14.4% each). */}
            <col style={{ width: "28%" }} />
            <col style={{ width: "14.4%" }} />
            <col style={{ width: "14.4%" }} />
            <col style={{ width: "14.4%" }} />
            <col style={{ width: "14.4%" }} />
            <col style={{ width: "14.4%" }} />
          </colgroup>
          <thead
            style={{
              position: "sticky",
              top: 0,
              background: "#fff",
              zIndex: 1,
            }}
          >
            <tr>
              <th
                style={{
                  textAlign: "left",
                  whiteSpace: "nowrap",
                  borderBottom: "2px solid #888",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                Entity
              </th>
              <th
                style={{
                  textAlign: "right",
                  whiteSpace: "nowrap",
                  borderBottom: "2px solid #888",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {currentLbl} ({volumeLabel})
              </th>
              <th
                style={{
                  textAlign: "right",
                  whiteSpace: "nowrap",
                  borderBottom: "2px solid #888",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {prevMonthLbl} ({volumeLabel})
              </th>
              <th
                style={{
                  textAlign: "right",
                  whiteSpace: "nowrap",
                  borderBottom: "2px solid #888",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                MoM %
              </th>
              <th
                style={{
                  textAlign: "right",
                  whiteSpace: "nowrap",
                  borderBottom: "2px solid #888",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {priorYearLbl} ({volumeLabel})
              </th>
              <th
                style={{
                  textAlign: "right",
                  whiteSpace: "nowrap",
                  borderBottom: "2px solid #888",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                YoY %
              </th>
            </tr>
          </thead>
          <tbody>
            {orderedRows.map((row) => {
              const yoy = fmtDelta(row.yoy_pct);
              const prevMonthValue = prevMonthByEntity.get(row.entity) ?? null;
              const mom = fmtDelta(computeMoMPct(row.last_12m, prevMonthValue));
              const dotColor =
                colorMap?.[row.entity] ?? colourForEntity(tableEntities, row.entity);
              return (
                <tr key={row.entity}>
                  <td
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={row.entity}
                  >
                    <span
                      aria-hidden
                      style={{
                        display: "inline-block",
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        backgroundColor: dotColor,
                        marginRight: 6,
                        verticalAlign: "middle",
                      }}
                    />
                    {row.entity}
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      whiteSpace: "nowrap",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {row.last_12m.toLocaleString("en-US", { maximumFractionDigits: 1 })}
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      whiteSpace: "nowrap",
                      fontVariantNumeric: "tabular-nums",
                      color: "#777",
                    }}
                  >
                    {prevMonthValue != null
                      ? prevMonthValue.toLocaleString("en-US", { maximumFractionDigits: 1 })
                      : "—"}
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      whiteSpace: "nowrap",
                      fontVariantNumeric: "tabular-nums",
                      color: mom.color,
                      fontWeight: 600,
                    }}
                  >
                    {mom.text}
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      whiteSpace: "nowrap",
                      fontVariantNumeric: "tabular-nums",
                      color: "#777",
                    }}
                  >
                    {row.prev_12m.toLocaleString("en-US", { maximumFractionDigits: 1 })}
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      whiteSpace: "nowrap",
                      fontVariantNumeric: "tabular-nums",
                      color: yoy.color,
                      fontWeight: 600,
                    }}
                  >
                    {yoy.text}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Price summary table (Current, M-1, MoM%, Y-1, YoY%) ─────────────────────
//
// Compact summary rendered directly below the unit-price chart it summarises.
// Mirrors the YoYTable visual conventions (Bootstrap table-sm table-striped,
// Arial 12, tabular-nums, MoM/YoY color coding) with a 6-column layout:
//   Country · <current month> · <prior month> · MoM% · <same month prev year> · YoY%
//
// Column headers are dynamic (e.g. "Apr 2026", "Mar 2026", "Apr 2025") and carry
// the unit in parentheses (USD/ton, ¢/gal, USD/bbl).
//
// Used for both Imports (3 rows: top-2 + Others) and Exports (top-N).
// `anchorAno` / `anchorMes` drive the three month labels (period.end from the hook).
// `unitLabel` is appended to each value column header.
// `rows` already carries the converted values, so this component is
// presentation-only — all math happens in the hook.

function PriceSummaryTable({
  title,
  rows,
  loading,
  unitLabel,
  anchorAno,
  anchorMes,
  fallbackColorFor,
}: {
  title: string;
  rows: PriceSummaryRow[];
  loading: boolean;
  unitLabel: string;
  /** Anchor month (period.end) — drives the three dynamic column headers. */
  anchorAno: number;
  anchorMes: number;
  /** For destinations without a pinned palette color, derive a swatch color
   *  from the chart's entity list (PALETTE rotation). Receives the row's
   *  country label, returns a hex string. */
  fallbackColorFor?: (country: string) => string;
}) {
  if (loading) {
    return (
      <div style={{ color: "#aaa", fontSize: 12, padding: "8px 0" }}>
        Loading...
      </div>
    );
  }
  if (!rows.length) return null;

  // Dynamic column headers — mirrors YoYTable convention.
  const currentLbl = formatMonth(anchorAno, anchorMes);
  const prevMonthCursor =
    anchorMes === 1
      ? { ano: anchorAno - 1, mes: 12 }
      : { ano: anchorAno, mes: anchorMes - 1 };
  const prevMonthLbl = formatMonth(prevMonthCursor.ano, prevMonthCursor.mes);
  const priorYearLbl = formatMonth(anchorAno - 1, anchorMes);

  const thStyle: React.CSSProperties = {
    textAlign: "right",
    whiteSpace: "nowrap",
    borderBottom: "2px solid #888",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };

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
        {title}
      </div>
      <div
        style={{
          overflowY: "auto",
          overflowX: "auto",
          border: "1px solid #ececec",
          borderRadius: 4,
        }}
      >
        <table
          className="table table-sm table-striped mb-0"
          style={{
            fontFamily: "Arial",
            fontSize: 12,
            tableLayout: "fixed",
            width: "100%",
            minWidth: 540,
            margin: 0,
          }}
        >
          <colgroup>
            {/* Country: 28% — matches YoYTable entity column width.
                Five value cols share 72% equally (14.4% each). */}
            <col style={{ width: "28%" }} />
            <col style={{ width: "14.4%" }} />
            <col style={{ width: "14.4%" }} />
            <col style={{ width: "14.4%" }} />
            <col style={{ width: "14.4%" }} />
            <col style={{ width: "14.4%" }} />
          </colgroup>
          <thead
            style={{
              position: "sticky",
              top: 0,
              background: "#fff",
              zIndex: 1,
            }}
          >
            <tr>
              <th style={{ textAlign: "left", whiteSpace: "nowrap", borderBottom: "2px solid #888", overflow: "hidden", textOverflow: "ellipsis" }}>
                Country
              </th>
              <th style={thStyle}>
                {currentLbl} ({unitLabel})
              </th>
              <th style={thStyle}>
                {prevMonthLbl} ({unitLabel})
              </th>
              <th style={thStyle}>
                MoM %
              </th>
              <th style={thStyle}>
                {priorYearLbl} ({unitLabel})
              </th>
              <th style={thStyle}>
                YoY %
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const mom = fmtDelta(row.momPct);
              const yoy = fmtDelta(row.yoyPct);
              const dotColor =
                row.color ?? (fallbackColorFor ? fallbackColorFor(row.country) : "#bbb");
              return (
                <tr key={row.country}>
                  <td
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={row.country}
                  >
                    <span
                      aria-hidden
                      style={{
                        display: "inline-block",
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        backgroundColor: dotColor,
                        marginRight: 6,
                        verticalAlign: "middle",
                      }}
                    />
                    {row.country}
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      whiteSpace: "nowrap",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {row.latest.toLocaleString("en-US", { maximumFractionDigits: 1 })}
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      whiteSpace: "nowrap",
                      fontVariantNumeric: "tabular-nums",
                      color: "#777",
                    }}
                  >
                    {row.prevMonth != null
                      ? row.prevMonth.toLocaleString("en-US", { maximumFractionDigits: 1 })
                      : "—"}
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      whiteSpace: "nowrap",
                      fontVariantNumeric: "tabular-nums",
                      color: mom.color,
                      fontWeight: 600,
                    }}
                  >
                    {mom.text}
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      whiteSpace: "nowrap",
                      fontVariantNumeric: "tabular-nums",
                      color: "#777",
                    }}
                  >
                    {row.prevYear != null
                      ? row.prevYear.toLocaleString("en-US", { maximumFractionDigits: 1 })
                      : "—"}
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      whiteSpace: "nowrap",
                      fontVariantNumeric: "tabular-nums",
                      color: yoy.color,
                      fontWeight: 600,
                    }}
                  >
                    {yoy.text}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Unit price by country (multi-line, NOT stacked) ──────────────────────────
//
// Each country gets its own line. y=null for months with no data so Plotly
// skips those months in the unified hover (connectgaps keeps the line intact).
// Countries are coloured from PALETTE (same rotation as stacked panels).
// "Gulf of Mexico ≈ Estados Unidos (proxy)" — see sub-PRD.
//
// `convertFn`: applied to each usd_per_m3 value before plotting.
//   null value → stays null (gap). non-null → converted.
// `unitLabel`: string used in hovertemplate (e.g. "USD/ton", "¢/gal", "USD/bbl").

function buildUnitPriceTraces(
  rows: UnitPriceRow[],
  entities: string[],
  unitLabel: string,
  convertFn: (v: number) => number = (v) => v,
  colorMap?: Record<string, string>,
): PlotData[] {
  if (!rows.length) return [];

  // Build per-entity time series. xs are ISO date strings (YYYY-MM-01) so
  // Plotly's xaxis.type='date' parses them natively.
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
    // colorMap (Panel D pinned-country mode) takes precedence over PALETTE
    // rotation so the unit-price chart's legend stays color-aligned with
    // Panel A. Fallback: PALETTE rotation (legacy behavior for other panels).
    const color =
      colorMap?.[entity] ?? PALETTE[idx % PALETTE.length] ?? OTHERS_COLOR;
    const ys = xs.map((x) => {
      const raw = byEntity.get(entity)?.get(x) ?? null;
      return raw != null ? convertFn(raw) : null;
    });
    return {
      type: "scatter" as const,
      mode: "lines+markers" as const,
      name: entity,
      x: xs,
      y: ys,
      connectgaps: true,
      line: { color, width: 2 },
      marker: { size: 3, color },
      hovertemplate: `${entity}: %{y:,.1f} ${unitLabel}<extra></extra>`,
    } as unknown as PlotData;
  });
}

// Imports unit price metric type — lives in the hook so both views and the
// price-summary derivation stay in lockstep.

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

// ─── Products ──────────────────────────────────────────────────────────────────

// Product pill toggle — content-sized pills with brand-orange active state.
// Uses simple buttons (not SegmentedToggle) so each pill sizes to its label.
// `products` is the tab-restricted list provided by the hook
// (`useImportsExportsData().allowedProducts`) — Imports tab shows only Diesel,
// Exports tab shows only Crude Oil. When the list collapses to a single
// product the toggle still renders (as a visual lock indicator) but offers no
// alternative to switch to.
function ProductPillToggle({
  value,
  onChange,
  products,
}: {
  value: UnifiedProduct;
  onChange: (v: UnifiedProduct) => void;
  products: readonly UnifiedProduct[];
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        gap: 6,
        background: "#f0f0f0",
        borderRadius: 999,
        padding: "3px 4px",
      }}
    >
      {products.map((p) => {
        const active = p === value;
        return (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "4px 14px",
              borderRadius: 999,
              border: "none",
              background: active ? "#ff5000" : "transparent",
              color: active ? "#fff" : "#555",
              fontFamily: "Arial",
              fontSize: 12,
              fontWeight: active ? 700 : 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "background 0.18s, color 0.18s",
              userSelect: "none",
            }}
          >
            {p}
          </button>
        );
      })}
    </div>
  );
}

// ─── Shared chart layout ───────────────────────────────────────────────────────

/**
 * Choose a sensible monthly tick step based on how many months the chart spans.
 * 1-12 months → M1; 13-36 → M3; 37-96 → M6; >96 → M12.
 */
function pickDtick(rangeMonths: number): string {
  if (rangeMonths <= 12) return "M1";
  if (rangeMonths <= 36) return "M3";
  if (rangeMonths <= 96) return "M6";
  return "M12";
}

function areaLayout(yLabel: string, rangeMonths = 12, height = 340): Partial<Layout> {
  return {
    ...COMMON_LAYOUT,
    hovermode: "x unified" as const,
    height,
    // Bottom margin generous so vertical (-90°) month labels fit without clipping.
    margin: { t: 12, b: 80, l: 60, r: 12 },
    xaxis: {
      ...AXIS_LINE,
      type: "date" as const,
      tickformat: "%b %Y",
      dtick: pickDtick(rangeMonths),
      tickangle: -90,
      tickfont: { family: "Arial", size: 12 },
    },
    yaxis: {
      ...AXIS_LINE,
      title: { text: yLabel, font: { family: "Arial", size: 11 } },
      tickformat: ",.1f",
      tickfont: { family: "Arial", size: 12 },
    },
    legend: {
      orientation: "h" as const,
      // Plotly defaults stacked-area legends to traceorder="reversed" (top of
      // stack first). Force "normal" so the legend reads bottom-of-stack first:
      // Russia → US → UAE → Netherlands → India → Saudi Arabia → Others.
      traceorder: "normal" as const,
      x: 0,
      y: -0.32,
      font: { family: "Arial", size: 12 },
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
    importersLatestMonth,
    importersMonthPending,
    importersTop6Data,
    importersTop6Entities,
    importersTop6ColorMap,
    yoyPaisesData,
    yoyPaisesLoading,
    yoyImportersData,
    yoyImportersLoading,
    yoyImportersTop6Data,
    exportsPaisesData,
    exportsPaisesLoading,
    yoyExportsData,
    yoyExportsLoading,
    importsUnitPriceLoading,
    importsUnitPriceChartData,
    importsUnitPriceChartEntities,
    importsUnitPriceChartColorMap,
    exportsUnitPriceData,
    exportsUnitPriceLoading,
    importsUPMetric,
    setImportsUPMetric,
    allowedProducts,
    importsPriceSummary,
    exportsPriceSummary,
    periodBadge,
    visible,
    visibilityLoading,
  } = useImportsExportsData();

  // ── Period bounds (for MonthRangePicker) ────────────────────────────────────
  // Picker enforces clamping + ordering against (anoMin/mesMin..anoMax/mesMax).

  const pickerMin: MonthCursor = {
    ano: filtros?.ano_min ?? new Date().getFullYear() - 10,
    mes: filtros?.mes_min ?? 1,
  };
  const pickerMax: MonthCursor = {
    ano: filtros?.ano_max ?? new Date().getFullYear(),
    mes: filtros?.mes_max ?? 12,
  };

  // Range in months — used to pick xaxis.dtick (M1 / M3 / M6 / M12).
  const rangeMonths = useMemo(() => {
    const s = filters.period.start;
    const e = filters.period.end;
    return (e.ano - s.ano) * 12 + (e.mes - s.mes) + 1;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- destructured cursors
  }, [filters.period.start.ano, filters.period.start.mes, filters.period.end.ano, filters.period.end.mes]);

  // Single-month flag — when start === end, stacked area degenerates to a
  // vertical stripe. The view switches to horizontal ranked bars instead.
  const isSingleMonth = useMemo(
    () => cmpMonth(filters.period.start, filters.period.end) === 0,
  // eslint-disable-next-line react-hooks/exhaustive-deps -- destructured cursors
  [filters.period.start.ano, filters.period.start.mes, filters.period.end.ano, filters.period.end.mes]);

  const singleMonthLabel = useMemo(
    () => formatMonth(filters.period.end.ano, filters.period.end.mes),
  [filters.period.end.ano, filters.period.end.mes]);

  // ── Derived: stacked traces ─────────────────────────────────────────────────
  // All useMemo calls MUST be before any conditional early returns (Rules of Hooks).

  // YoY rows — Panel A (countries): re-bucket against pins + ensure every
  // pinned country has a row (zero/zero/null when absent from server result)
  // so the legend dots stay aligned with the chart's pinned 7 entries.
  const yoyPaisesPinned: YoyTableRow[] = useMemo(() => {
    if (!yoyPaisesData.length) return [];
    const acc = new Map<string, { last_12m: number; prev_12m: number }>();
    for (const r of yoyPaisesData) {
      const englishLabel = ORIGIN_LABEL_BY_DB[r.entity] ?? OTHERS_LABEL;
      const cur = acc.get(englishLabel) ?? { last_12m: 0, prev_12m: 0 };
      cur.last_12m += r.last_12m;
      cur.prev_12m += r.prev_12m;
      acc.set(englishLabel, cur);
    }
    // Inject zero entries for any pinned country not present, so the legend
    // always shows all 7 rows in fixed order.
    for (const pin of ORIGIN_COUNTRY_PINS) {
      if (!acc.has(pin.label)) acc.set(pin.label, { last_12m: 0, prev_12m: 0 });
    }
    if (!acc.has(OTHERS_LABEL)) acc.set(OTHERS_LABEL, { last_12m: 0, prev_12m: 0 });
    // Recompute yoy_pct per aggregated row so it reflects the bucketed totals
    // (server's yoy_pct was calculated per Portuguese entity before bucketing).
    const rows: YoyTableRow[] = [];
    for (const [entity, vals] of acc.entries()) {
      const yoy_pct =
        vals.prev_12m === 0
          ? null
          : ((vals.last_12m - vals.prev_12m) / vals.prev_12m) * 100;
      rows.push({ entity, last_12m: vals.last_12m, prev_12m: vals.prev_12m, yoy_pct });
    }
    return rows;
  }, [yoyPaisesData]);

  // Panel A — kt (divide total_kg by 1e6).
  // Pinned-country mode: re-bucket against the 6 fixed origins + Others, then
  // force-inject null rows for any pinned country absent in a given month so
  // the legend stays stable (Russia → Saudi Arabia → Others) and the unified
  // hover tooltip omits absent countries (null = "no contribution" in stack).
  const paisesTraces = useMemo(() => {
    const bucketed = bucketPaisesByPins(paisesData);
    const rawRows = bucketed.map((r) => ({
      ano: r.ano,
      mes: r.mes,
      name: r.name,
      value: r.total_kg / 1e6,
    }));
    const rows = ensureAllPinsPresent(rawRows);
    return isSingleMonth
      ? buildHorizontalBarTraces(rows, "kt", ORIGIN_ORDER)
      : buildStackedTraces(rows, "kt", ORIGIN_ORDER);
  }, [paisesData, isSingleMonth]);

  // Panel B — mil m³ (already from RPC). Reduced to top-6 + Others to match
  // Panel A's "6 named + Others" contract; color palette mirrors Panel A's
  // rank order (black/orange/mint/amber/purple/lime + grey for Others) so
  // the two panels look like siblings of the same family.
  const importersTraces = useMemo(() => {
    const rows = importersTop6Data.map((r) => ({
      ano: r.ano,
      mes: r.mes,
      name: r.unified_importer,
      value: r.total_mil_m3,
    }));
    return isSingleMonth
      ? buildHorizontalBarTraces(rows, "mil m³", importersTop6Entities, importersTop6ColorMap)
      : buildStackedTraces(rows, "mil m³", importersTop6Entities, importersTop6ColorMap);
  }, [importersTop6Data, importersTop6Entities, importersTop6ColorMap, isSingleMonth]);

  // Exports — stacked area by destination country (value already in correct unit from RPC)
  const exportsUnit = filters.exportsYAxis === "volume" ? "mil m³" : "USD";

  // Stable alphabetical entity order — mirrors the order buildStackedTraces
  // uses internally when no orderOverride is provided (non-Others sorted
  // alphabetically, Others last). We derive it once here so the chart and
  // the YoY table below it share the SAME PALETTE index per country, fixing
  // the legend-color ↔ table-dot-color mismatch.
  const exportsEntityOrder: string[] = useMemo(() => {
    const entitySet = new Set<string>();
    for (const r of exportsPaisesData) entitySet.add(r.pais);
    return [
      ...Array.from(entitySet).filter((e) => e !== OTHERS_LABEL).sort(),
      ...(entitySet.has(OTHERS_LABEL) ? [OTHERS_LABEL] : []),
    ];
  }, [exportsPaisesData]);

  // Color map for exports entities — PALETTE rotation in alphabetical order,
  // Others pinned to neutral grey. Passed to both the stacked chart and the
  // YoY table so dot colors are guaranteed identical.
  const exportsColorMap: Record<string, string> = useMemo(() => {
    const nonOthers = exportsEntityOrder.filter((e) => e !== OTHERS_LABEL);
    const map: Record<string, string> = {};
    for (const e of exportsEntityOrder) {
      if (e === OTHERS_LABEL) {
        map[e] = OTHERS_COLOR;
      } else {
        const idx = nonOthers.indexOf(e);
        map[e] = PALETTE[idx % PALETTE.length] ?? OTHERS_COLOR;
      }
    }
    return map;
  }, [exportsEntityOrder]);

  const exportsPaisesTraces = useMemo(() => {
    const rows = exportsPaisesData.map((r) => ({
      ano: r.ano,
      mes: r.mes,
      name: r.pais,
      value: r.value, // server already in mil m³ or USD — never divide client-side
    }));
    return isSingleMonth
      ? buildHorizontalBarTraces(rows, exportsUnit, exportsEntityOrder, exportsColorMap)
      : buildStackedTraces(rows, exportsUnit, exportsEntityOrder, exportsColorMap);
  }, [exportsPaisesData, exportsUnit, exportsEntityOrder, exportsColorMap, isSingleMonth]);

  // Imports — unit price by country (Panel D): 3-series mode (top-2 + Others).
  // Both the rows and entity/color metadata come from the shared hook so the
  // chart legend matches the Imports Price Summary table beneath it 1:1.
  // The hook already collapsed non-top-2 countries into a volume-weighted
  // "Others" series — the View just plots what arrives. The previous
  // pinned-6-country mode was retired per CTO directive to align chart ↔ table.
  const importsUPEntities = importsUnitPriceChartEntities;

  // Imports unit price — conversion based on local metric toggle
  const importsUPConvertFn = useMemo(() => {
    const density = PRODUCT_DENSITY_KG_M3[filters.unifiedProduct] ?? 840;
    if (importsUPMetric === "usd_per_ton") {
      // USD/m³ → USD/ton: divide by (density kg/m³ / 1000 ton/m³)
      return (v: number) => v / (density / 1000);
    }
    // cents_per_gal: USD/m³ → ¢/gal: divide by gal_per_m3, multiply by 100
    return (v: number) => (v / GAL_PER_M3) * 100;
  }, [filters.unifiedProduct, importsUPMetric]);

  const importsUPUnitLabel = importsUPMetric === "usd_per_ton" ? "USD/ton" : "¢/gal";

  const importsUPTraces = useMemo(
    () =>
      isSingleMonth
        ? buildHorizontalBarTracesFromUnitPrice(
            importsUnitPriceChartData,
            importsUPEntities,
            importsUPUnitLabel,
            importsUPConvertFn,
            importsUnitPriceChartColorMap,
          )
        : buildUnitPriceTraces(
            importsUnitPriceChartData,
            importsUPEntities,
            importsUPUnitLabel,
            importsUPConvertFn,
            importsUnitPriceChartColorMap,
          ),
    [importsUnitPriceChartData, importsUnitPriceChartColorMap, importsUPEntities, importsUPUnitLabel, importsUPConvertFn, isSingleMonth],
  );

  const importsUPLayout: Partial<Layout> = useMemo(
    () => ({
      ...COMMON_LAYOUT,
      hovermode: "x unified" as const,
      height: 320,
      margin: { t: 12, b: 60, l: 72, r: 12 },
      xaxis: {
        ...AXIS_LINE,
        type: "date" as const,
        tickformat: "%b %Y",
        dtick: pickDtick(rangeMonths),
        tickangle: -45,
        tickfont: { family: "Arial", size: 12 },
      },
      yaxis: {
        ...AXIS_LINE,
        title: { text: importsUPUnitLabel, font: { family: "Arial", size: 11 } },
        tickformat: ",.1f",
        tickfont: { family: "Arial", size: 12 },
      },
      legend: {
        orientation: "h" as const,
        x: 0,
        y: -0.22,
        font: { family: "Arial", size: 12 },
      },
    }),
    [importsUPUnitLabel, rangeMonths],
  );

  // Exports — unit price by destination country
  const exportsUPEntities = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of exportsUnitPriceData) {
      if (r.usd_per_m3 != null) totals.set(r.pais, (totals.get(r.pais) ?? 0) + 1);
    }
    return Array.from(totals.keys()).sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
  }, [exportsUnitPriceData]);

  // Exports unit price — Crude Oil only, USD/bbl (USD/m³ ÷ 6.2898)
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

  const exportsUPLayout: Partial<Layout> = useMemo(
    () => ({
      ...COMMON_LAYOUT,
      hovermode: "x unified" as const,
      height: 320,
      margin: { t: 12, b: 60, l: 72, r: 12 },
      xaxis: {
        ...AXIS_LINE,
        type: "date" as const,
        tickformat: "%b %Y",
        dtick: pickDtick(rangeMonths),
        tickangle: -45,
        tickfont: { family: "Arial", size: 12 },
      },
      yaxis: {
        ...AXIS_LINE,
        title: { text: "USD / bbl", font: { family: "Arial", size: 11 } },
        tickformat: ",.2f",
        tickfont: { family: "Arial", size: 12 },
      },
      legend: {
        orientation: "h" as const,
        x: 0,
        y: -0.22,
        font: { family: "Arial", size: 12 },
      },
    }),
    [rangeMonths],
  );

  const exportsPaisesLayout: Partial<Layout> = useMemo(
    () => areaLayout(exportsUnit, rangeMonths, 420),
    [exportsUnit, rangeMonths],
  );

  // ── Derived: previous-month value per entity (for new MoM% column) ──────────
  // The YoY RPC only returns (current, prior_year, yoy_pct). To populate the
  // "Previous month" + "MoM %" columns we derive prev_month entirely on the
  // client from the same stacked-series data the chart already loads. Anchor
  // is period.end; prev = anchor - 1 month (with year rollover at January).
  //
  // Edge case: when the selected period has only one month (start === end),
  // no prev-month data is in scope — the chart loads exactly that month — so
  // every entity gets null and the MoM/PrevMonth cells render "—".
  const prevMonthCursor = useMemo(() => {
    const a = filters.period.end.ano;
    const m = filters.period.end.mes;
    return m === 1 ? { ano: a - 1, mes: 12 } : { ano: a, mes: m - 1 };
  }, [filters.period.end.ano, filters.period.end.mes]);

  // Panel A (countries) — re-bucket against pins so the lookup keys match
  // the YoY table's English labels. Sum into Russia/US/UAE/.../Others.
  const prevMonthByCountry: Map<string, number | null> = useMemo(() => {
    const target = `${prevMonthCursor.ano}|${prevMonthCursor.mes}`;
    const acc = new Map<string, number>();
    for (const r of paisesData) {
      const key = `${r.ano}|${r.mes}`;
      if (key !== target) continue;
      const englishLabel = ORIGIN_LABEL_BY_DB[r.pais_origem] ?? OTHERS_LABEL;
      // Convert kg → kt to match the table's units (last_12m is in kt for
      // the countries panel — server returns it that way; the chart divides
      // by 1e6 too).
      const valueKt = r.total_kg / 1e6;
      acc.set(englishLabel, (acc.get(englishLabel) ?? 0) + valueKt);
    }
    const out = new Map<string, number | null>();
    for (const pin of ORIGIN_COUNTRY_PINS) {
      out.set(pin.label, acc.has(pin.label) ? acc.get(pin.label)! : null);
    }
    out.set(OTHERS_LABEL, acc.has(OTHERS_LABEL) ? acc.get(OTHERS_LABEL)! : null);
    return out;
  }, [paisesData, prevMonthCursor]);

  // Panel B (importers) anchor — the latest month ANP Desembaraços has
  // actually published (from the hook), clamped to never exceed period.end.
  // The "By Importer" YoY table, its MoM prev-month lookup, and the section
  // notice all key on THIS month rather than period.end so a month ANP has not
  // yet published is never rendered as a zero / −100%.
  const importerAnchor: MonthCursor = useMemo(
    () =>
      importersMonthPending && importersLatestMonth
        ? importersLatestMonth
        : { ano: filters.period.end.ano, mes: filters.period.end.mes },
    [importersMonthPending, importersLatestMonth, filters.period.end.ano, filters.period.end.mes],
  );

  const importerPrevMonthCursor = useMemo(
    () =>
      importerAnchor.mes === 1
        ? { ano: importerAnchor.ano - 1, mes: 12 }
        : { ano: importerAnchor.ano, mes: importerAnchor.mes - 1 },
    [importerAnchor],
  );

  // Panel B (importers) — per-importer lookup at prev_month, aggregated into
  // the same top-6 + Others buckets the YoY table uses. Top-6 keys come from
  // `importersTop6Entities`; everything else collapses into "Others".
  const prevMonthByImporter: Map<string, number | null> = useMemo(() => {
    const target = `${importerPrevMonthCursor.ano}|${importerPrevMonthCursor.mes}`;
    const topSet = new Set(importersTop6Entities.filter((e) => e !== OTHERS_LABEL));
    const acc = new Map<string, number>();
    let othersAcc = 0;
    let othersAccSeen = false;
    for (const r of importersData) {
      const key = `${r.ano}|${r.mes}`;
      if (key !== target) continue;
      if (topSet.has(r.unified_importer)) {
        acc.set(r.unified_importer, (acc.get(r.unified_importer) ?? 0) + r.total_mil_m3);
      } else {
        othersAcc += r.total_mil_m3;
        othersAccSeen = true;
      }
    }
    const out = new Map<string, number | null>();
    for (const e of importersTop6Entities) {
      if (e === OTHERS_LABEL) {
        out.set(OTHERS_LABEL, othersAccSeen ? othersAcc : null);
      } else {
        out.set(e, acc.has(e) ? acc.get(e)! : null);
      }
    }
    return out;
  }, [importersData, importersTop6Entities, importerPrevMonthCursor]);

  // Exports tab — straight per-destination lookup at prev_month.
  const prevMonthByExportsCountry: Map<string, number | null> = useMemo(() => {
    const target = `${prevMonthCursor.ano}|${prevMonthCursor.mes}`;
    const acc = new Map<string, number>();
    for (const r of exportsPaisesData) {
      const key = `${r.ano}|${r.mes}`;
      if (key !== target) continue;
      acc.set(r.pais, (acc.get(r.pais) ?? 0) + r.value);
    }
    const out = new Map<string, number | null>();
    for (const r of yoyExportsData) {
      out.set(r.entity, acc.has(r.entity) ? acc.get(r.entity)! : null);
    }
    return out;
  }, [exportsPaisesData, yoyExportsData, prevMonthCursor]);

  // Guard — after all hooks
  if (visibilityLoading) return <BarrelLoading />;
  if (!visible) return <></>;

  // ── Render ──────────────────────────────────────────────────────────────────
  // Export migrated to the unified library (Tier 2 modal-editable).
  // Spec: src/lib/export/dashboards/importsExports.ts.
  // RPCs (worker_supabase): get_imports_exports_raw_imports / ...raw_exports / ...export_count.

  return (
    <div>
      <NavBar />
      <div className="container-fluid g-0">
        <div className="row g-0">

          {/* ── Sidebar ── */}
          <div className="col-xxl-2 col-md-3 p-0">
            <div id="sidebar">
              <div style={{ textAlign: "center" }}>
                <BrandLogo variant="sidebar" />
              </div>
              <hr style={{ borderTop: "1px solid #f0f0f0", marginBottom: 14 }} />
              <div className="sidebar-section-label">Filters</div>

              {/* Period — monthly granularity (migration 20260526800000).
                  Replaced PeriodSlider with MonthRangePicker (4 selects + quick
                  ranges) — sliders become unreadable at 28 years × 12 = 336
                  months, and a range needs both start + end thumbs which were
                  visually overlapping their floating month labels. The picker
                  also makes the single-month case (start === end) trivial. */}
              <div className="sidebar-filter-section" data-testid="period-filter">
                <div className="sidebar-filter-label">Period</div>
                {filtrosLoading && !filtros ? (
                  <div style={{ fontSize: 11, color: "#aaa", fontFamily: "Arial" }}>
                    Loading…
                  </div>
                ) : (
                  <MonthRangePicker
                    min={pickerMin}
                    max={pickerMax}
                    value={filters.period}
                    onChange={(next) => setFilters({ period: next })}
                    layout="sidebar"
                    showQuickRanges
                  />
                )}
              </div>
            </div>
          </div>

          {/* ── Main content ── */}
          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <DashboardHeader
                title="Imports & Exports"
                sub="Brazilian fuel trade flows — by origin country and importer group"
                /* Monthly badge via extraBadge — collapses to a single label when
                   start === end (e.g. "May 2026") and renders as "Jan 2025 – May
                   2026" otherwise. periodBadge is computed by the hook. */
                extraBadge={
                  <span style={{ marginLeft: 12, fontSize: 11, color: "#888" }}>
                    Period: {periodBadge}
                  </span>
                }
                lang="en"
                rightSlot={<ExportButton spec={importsExportsExport} />}
              />

              {/* Control row: Product pill toggle + Imports/Exports tab selector */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  marginBottom: 16,
                  flexWrap: "wrap",
                }}
              >
                <ProductPillToggle
                  value={filters.unifiedProduct}
                  onChange={(v) => setFilters({ unifiedProduct: v })}
                  products={allowedProducts}
                />
                <div style={{ maxWidth: 200 }}>
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
              </div>

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
                        layout={
                          isSingleMonth
                            ? horizontalBarLayout("kt", singleMonthLabel, 340)
                            : areaLayout("kt", rangeMonths)
                        }
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
                    rows={yoyPaisesPinned}
                    loading={yoyPaisesLoading}
                    volumeLabel="kt"
                    title="By Origin Country"
                    anchorAno={filters.period.end.ano}
                    anchorMes={filters.period.end.mes}
                    orderOverride={ORIGIN_ORDER}
                    prevMonthByEntity={prevMonthByCountry}
                  />

                  <div style={{ height: 24 }} />

                  {/* Panel B — top-6 importers + Others. Rank-bound palette
                       mirrors Panel A in order (black/orange/mint/amber/
                       purple/lime + grey). Other importers collapse into the
                       Others bucket (sum, not weighted average, since the
                       Y-axis is volume). */}
                  <ChartSection
                    title="By Importer (Brazil)"
                    loading={importersLoading}
                    height={340}
                  >
                    {/* Publication-lag notice. ANP Desembaraços (the only
                        importer-level source, since it carries CNPJ) publishes
                        later than ComexStat, which drives the period selector.
                        When the selected trailing month is not yet in ANP we
                        say so explicitly — we never plot the missing month as a
                        zero. */}
                    {importersMonthPending && importersLatestMonth && (
                      <div
                        style={{
                          marginBottom: 10,
                          padding: "6px 12px",
                          background: "#fff7ed",
                          border: "1px solid #ffd9b3",
                          borderRadius: 6,
                          fontSize: 11,
                          color: "#9a4d00",
                          fontFamily: "Arial",
                        }}
                      >
                        Importers data through {formatMonth(importersLatestMonth.ano, importersLatestMonth.mes)} —{" "}
                        {formatMonth(filters.period.end.ano, filters.period.end.mes)} not yet published by ANP Desembaraços.
                      </div>
                    )}
                    {importersData.length > 0 ? (
                      <Plot
                        data={importersTraces}
                        layout={
                          isSingleMonth
                            ? horizontalBarLayout("mil m³", singleMonthLabel, 340)
                            : areaLayout("mil m³", rangeMonths)
                        }
                        config={{ responsive: true, displayModeBar: false }}
                        style={{ width: "100%" }}
                      />
                    ) : !importersLoading ? (
                      <ImporterEmptyState />
                    ) : null}
                  </ChartSection>

                  {importersData.length > 0 && (
                    <YoYTable
                      rows={yoyImportersTop6Data}
                      loading={yoyImportersLoading}
                      volumeLabel="mil m³"
                      title="By Importer"
                      anchorAno={importerAnchor.ano}
                      anchorMes={importerAnchor.mes}
                      orderOverride={importersTop6Entities}
                      colorMap={importersTop6ColorMap}
                      prevMonthByEntity={prevMonthByImporter}
                    />
                  )}

                  <div style={{ height: 24 }} />

                  {/* Panel D — Unit Price by Origin Country */}
                  <ChartSection
                    title={`Import Unit Price by Origin Country (${importsUPUnitLabel})`}
                    loading={importsUnitPriceLoading}
                    height={320}
                  >
                    {/* Metric toggle: USD/ton | ¢/gal */}
                    <div style={{ marginBottom: 10, maxWidth: 260 }}>
                      <SegmentedToggle
                        options={[
                          { value: "usd_per_ton" as const, label: "USD / ton" },
                          { value: "cents_per_gal" as const, label: "¢ / gal" },
                        ]}
                        value={importsUPMetric}
                        onChange={(v) => setImportsUPMetric(v as ImportsUnitPriceMetric)}
                        variant="compact"
                      />
                    </div>
                    {importsUPTraces.length > 0 ? (
                      <Plot
                        data={importsUPTraces}
                        layout={
                          isSingleMonth
                            ? horizontalBarLayout(importsUPUnitLabel, singleMonthLabel, 320)
                            : importsUPLayout
                        }
                        config={{ responsive: true, displayModeBar: false }}
                        style={{ width: "100%" }}
                      />
                    ) : !importsUnitPriceLoading ? (
                      <Plot
                        data={emptyPlot().data}
                        layout={{ ...emptyPlot().layout, height: 320 }}
                        config={{ responsive: true, displayModeBar: false }}
                        style={{ width: "100%" }}
                      />
                    ) : null}
                  </ChartSection>

                  <PriceSummaryTable
                    title={`Import Price Summary — ${formatMonth(filters.period.end.ano, filters.period.end.mes)} vs Prior Periods (${importsUPUnitLabel})`}
                    rows={importsPriceSummary}
                    loading={importsUnitPriceLoading}
                    unitLabel={importsUPUnitLabel}
                    anchorAno={filters.period.end.ano}
                    anchorMes={filters.period.end.mes}
                  />

                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 11,
                      color: "#aaa",
                      fontStyle: "italic",
                    }}
                  >
                    Source: MDIC Comex — FOB USD ÷ volume per origin country per month. Top 8 countries by import volume in the selected period. "Gulf of Mexico" ≈ Estados Unidos (proxy: ANP registers US Gulf Coast cargoes as origin = United States).
                  </div>
                </div>
              )}

              {/* ── EXPORTS TAB ── */}
              {filters.tab === "exports" && (
                <div>
                  {/* Volume / USD toggle */}
                  <div style={{ marginBottom: 12, maxWidth: 220 }}>
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

                  <ChartSection
                    title="Exports — By Destination Country"
                    loading={exportsPaisesLoading}
                    height={420}
                  >
                    {exportsPaisesTraces.length > 0 ? (
                      <Plot
                        data={exportsPaisesTraces}
                        layout={
                          isSingleMonth
                            ? horizontalBarLayout(exportsUnit, singleMonthLabel, 420)
                            : exportsPaisesLayout
                        }
                        config={{ responsive: true, displayModeBar: false }}
                        style={{ width: "100%" }}
                      />
                    ) : !exportsPaisesLoading ? (
                      <div style={{ padding: 24, color: "#aaa", fontSize: 13 }}>
                        No export data for the selected period.
                      </div>
                    ) : null}
                  </ChartSection>

                  <YoYTable
                    rows={yoyExportsData}
                    loading={yoyExportsLoading}
                    volumeLabel={exportsUnit}
                    title="By Destination Country"
                    anchorAno={filters.period.end.ano}
                    anchorMes={filters.period.end.mes}
                    prevMonthByEntity={prevMonthByExportsCountry}
                    colorMap={exportsColorMap}
                  />

                  <div
                    style={{
                      marginTop: 12,
                      fontSize: 11,
                      color: "#aaa",
                      fontStyle: "italic",
                    }}
                  >
                    Source: MDIC Comex — monthly customs-declared exports by destination country
                    (NCM 27090010 / 27101259 / 27101921; kg→m³ via ANP standard densities).
                  </div>

                  {/* Export unit price by destination country — Crude Oil only */}
                  {filters.unifiedProduct === "Crude Oil" && (
                    <>
                      <div style={{ height: 24 }} />
                      <ChartSection
                        title="Export Unit Price by Destination Country (USD/bbl)"
                        loading={exportsUnitPriceLoading}
                        height={320}
                      >
                        {exportsUPTraces.length > 0 ? (
                          <Plot
                            data={exportsUPTraces}
                            layout={
                              isSingleMonth
                                ? horizontalBarLayout("USD / bbl", singleMonthLabel, 320)
                                : exportsUPLayout
                            }
                            config={{ responsive: true, displayModeBar: false }}
                            style={{ width: "100%" }}
                          />
                        ) : !exportsUnitPriceLoading ? (
                          <Plot
                            data={emptyPlot().data}
                            layout={{ ...emptyPlot().layout, height: 320 }}
                            config={{ responsive: true, displayModeBar: false }}
                            style={{ width: "100%" }}
                          />
                        ) : null}
                      </ChartSection>

                      <PriceSummaryTable
                        title={`Export Price Summary — ${formatMonth(filters.period.end.ano, filters.period.end.mes)} vs Prior Periods (USD/bbl)`}
                        rows={exportsPriceSummary}
                        loading={exportsUnitPriceLoading}
                        unitLabel="USD/bbl"
                        anchorAno={filters.period.end.ano}
                        anchorMes={filters.period.end.mes}
                        fallbackColorFor={(country) =>
                          colourForEntity(exportsUPEntities, country)
                        }
                      />

                      <div
                        style={{
                          marginTop: 8,
                          fontSize: 11,
                          color: "#aaa",
                          fontStyle: "italic",
                        }}
                      >
                        Source: MDIC Comex — FOB USD/bbl per destination country per month (1 m³ = 6.2898 bbl). Top 8 countries by export volume in the selected period. Crude Oil only.
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
