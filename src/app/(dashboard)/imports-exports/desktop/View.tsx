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
import { useMemo, useState } from "react";
import MonthRangePicker from "../../../../components/dashboard/MonthRangePicker";

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
import ExportPanel from "../../../../components/dashboard/ExportPanel";
import SegmentedToggle from "../../../../components/dashboard/SegmentedToggle";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";

import { useImportsExportsData, formatMonth, cmpMonth } from "../useImportsExportsData";
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
// its YoY table only. Importer panel (Panel B), Panel C (Import Price), and
// Exports tab use their own coloring strategies.
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
 * Inject zero-valued points so every pinned country has a series in every
 * month present in `rows`. Ensures the legend always carries the full 7
 * entries (Russia → Saudi Arabia + Others) even when a country has no
 * volume in the selected window — matches the reference image where UAE
 * and Netherlands always show in the legend even at near-zero values.
 *
 * Input/output rows carry English `name`.
 */
function ensureAllPinsPresent(
  rows: { ano: number; mes: number; name: string; value: number }[],
): { ano: number; mes: number; name: string; value: number }[] {
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
        out.push({ ano: a, mes: m, name: pin.label, value: 0 });
      }
    }
    // Ensure Others bucket exists too (even at zero) so legend stays stable.
    const othersKey = `${a}|${m}|${OTHERS_LABEL}`;
    if (!present.has(othersKey)) {
      out.push({ ano: a, mes: m, name: OTHERS_LABEL, value: 0 });
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

type StackedRow = { ano: number; mes: number; name: string; value: number };

// Minimum value to show a trace in the unified hover tooltip.
// Points below this threshold are hidden from hover (shown as blank) to avoid
// polluting the tooltip with near-zero entries.
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

  const lookup = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const key = `${r.ano}-${String(r.mes).padStart(2, "0")}-01`;
    if (!lookup.has(r.name)) lookup.set(r.name, new Map());
    lookup.get(r.name)!.set(key, r.value);
  }

  return entities.map((entity) => {
    const color = colourForEntity(entities, entity);
    const ys = xs.map((x) => lookup.get(entity)?.get(x) ?? 0);
    // Per-point hovertemplate array: hide points below threshold from unified
    // hover by emitting an empty template (Plotly skips blank entries).
    const hovertemplates = ys.map((v) =>
      v >= HOVER_THRESHOLD
        ? `${entity}: %{y:,.1f} ${unit}<extra></extra>`
        : `<extra></extra>`,
    );
    return {
      type: "scatter" as const,
      mode: "lines" as const,
      stackgroup: "one",
      name: entity,
      x: xs,
      y: ys,
      line: { width: 0.5, color },
      fillcolor: color,
      hovertemplate: hovertemplates,
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
): PlotData[] {
  if (!rows.length) return [];
  // Aggregate by entity (rows should already be single-month, but defensively
  // sum just in case the RPC ever returns multiple rows for the same entity).
  const byEntity = new Map<string, number>();
  for (const r of rows) {
    byEntity.set(r.name, (byEntity.get(r.name) ?? 0) + r.value);
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
      tickfont: { family: "Arial", size: 10 },
    },
    yaxis: {
      ...AXIS_LINE,
      tickfont: { family: "Arial", size: 11 },
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

function YoYTable({
  rows,
  loading,
  volumeLabel,
  title,
  anchorAno,
  anchorMes,
  orderOverride,
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
  /** Optional fixed render order for the rows. When provided, rows are
   *  sorted to match (entities not present in rows are omitted; entities
   *  present but not in the override fall through to the end). Used by
   *  Imports Panel A YoY table to mirror the chart's pinned legend. */
  orderOverride?: string[];
}) {
  if (loading) {
    return (
      <div style={{ color: "#aaa", fontSize: 12, padding: "8px 0" }}>
        Loading...
      </div>
    );
  }
  if (!rows.length) return null;

  const currentLbl = formatMonth(anchorAno, anchorMes);
  const priorLbl = formatMonth(anchorAno - 1, anchorMes);

  // Build the entity set in the same shape `buildStackedTraces` uses so the
  // table's color dots match the chart's trace colors for each entity.
  const entitySet = new Set(rows.map((r) => r.entity));
  const tableEntities = orderOverride
    ? orderOverride.filter((e) => entitySet.has(e))
    : [
        ...Array.from(entitySet).filter((e) => e !== OTHERS_LABEL).sort(),
        ...(entitySet.has(OTHERS_LABEL) ? [OTHERS_LABEL] : []),
      ];

  // Reorder rows to match `tableEntities` so the table reads top-to-bottom
  // in the same sequence as the chart's stack reads top-to-bottom.
  const rowByEntity = new Map(rows.map((r) => [r.entity, r]));
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
        {title} — {currentLbl} vs {priorLbl}
      </div>
      <div
        style={{
          maxHeight: 400,
          overflowY: "auto",
          overflowX: "auto",
          border: "1px solid #ececec",
          borderRadius: 4,
        }}
      >
        <table
          className="table table-sm table-striped mb-0"
          style={{ fontFamily: "Arial", fontSize: 12 }}
        >
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
                }}
              >
                Entity
              </th>
              <th
                style={{
                  textAlign: "right",
                  whiteSpace: "nowrap",
                  borderBottom: "2px solid #888",
                }}
              >
                {currentLbl} ({volumeLabel})
              </th>
              <th
                style={{
                  textAlign: "right",
                  whiteSpace: "nowrap",
                  borderBottom: "2px solid #888",
                }}
              >
                {priorLbl} ({volumeLabel})
              </th>
              <th
                style={{
                  textAlign: "right",
                  whiteSpace: "nowrap",
                  borderBottom: "2px solid #888",
                }}
              >
                YoY %
              </th>
            </tr>
          </thead>
          <tbody>
            {orderedRows.map((row) => {
              const yoy = fmtDelta(row.yoy_pct);
              const dotColor = colourForEntity(tableEntities, row.entity);
              return (
                <tr key={row.entity}>
                  <td
                    style={{
                      whiteSpace: "nowrap",
                      maxWidth: 220,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
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

// ─── Panel C — Import price helpers ────────────────────────────────────────────

// Product colours: Diesel = brand orange, Gasoline = amber, Crude Oil = near-black
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
    // Single-month → big marker only (line is degenerate with 1 point).
    const markerSize = isSingleMonth ? 14 : 4;
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

// ─── Imports unit price metric type ───────────────────────────────────────────

type ImportsUPMetric = "usd_per_ton" | "cents_per_gal";

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

const PRODUCTS: UnifiedProduct[] = ["Diesel", "Gasoline", "Crude Oil"];

// Product pill toggle — content-sized pills with brand-orange active state.
// Uses simple buttons (not SegmentedToggle) so each pill sizes to its label.
function ProductPillToggle({
  value,
  onChange,
}: {
  value: UnifiedProduct;
  onChange: (v: UnifiedProduct) => void;
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
      {PRODUCTS.map((p) => {
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
    margin: { t: 12, b: 60, l: 60, r: 12 },
    xaxis: {
      ...AXIS_LINE,
      type: "date" as const,
      tickformat: "%b %Y",
      dtick: pickDtick(rangeMonths),
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

  const [excelBusy, setExcelBusy] = useState(false);
  const [csvBusy, setCsvBusy] = useState(false);

  // Panel D — imports unit price metric toggle (local state, not global filter)
  const [importsUPMetric, setImportsUPMetric] = useState<ImportsUPMetric>("usd_per_ton");

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
  // force-inject zero rows so every pinned country shows in the legend, and
  // render in the canonical Russia → Saudi Arabia → Others order.
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

  // Panel B — mil m³ (already from RPC)
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

  // Panel C — price metric helpers
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
      height: 320,
      margin: { t: 12, b: 60, l: 72, r: 12 },
      xaxis: {
        ...AXIS_LINE,
        type: "date" as const,
        tickformat: "%b %Y",
        dtick: pickDtick(rangeMonths),
        tickangle: -45,
        tickfont: { family: "Arial", size: 10 },
      },
      yaxis: {
        ...AXIS_LINE,
        title: { text: priceUnit, font: { family: "Arial", size: 11 } },
        tickformat: ",.2f",
      },
      legend: {
        orientation: "h" as const,
        x: 0,
        y: -0.22,
        font: { family: "Arial", size: 10 },
      },
    }),
    [priceUnit, rangeMonths],
  );

  // Imports — unit price by country (Panel D): pinned-country mode.
  // Filter rows to the 6 pinned origins only (Others bucket would conflate
  // disparate per-country prices and be misleading), relabel to English,
  // and force the fixed legend order.
  const importsUnitPriceDataPinned: UnitPriceRow[] = useMemo(() => {
    const out: UnitPriceRow[] = [];
    for (const r of importsUnitPriceData) {
      const label = ORIGIN_LABEL_BY_DB[r.pais];
      if (!label) continue;
      out.push({ ano: r.ano, mes: r.mes, pais: label, usd_per_m3: r.usd_per_m3 });
    }
    return out;
  }, [importsUnitPriceData]);

  const importsUPEntities = useMemo(
    () => ORIGIN_COUNTRY_PINS.map((p) => p.label),
    [],
  );

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
            importsUnitPriceDataPinned,
            importsUPEntities,
            importsUPUnitLabel,
            importsUPConvertFn,
            ORIGIN_COLOR_BY_LABEL,
          )
        : buildUnitPriceTraces(
            importsUnitPriceDataPinned,
            importsUPEntities,
            importsUPUnitLabel,
            importsUPConvertFn,
            ORIGIN_COLOR_BY_LABEL,
          ),
    [importsUnitPriceDataPinned, importsUPEntities, importsUPUnitLabel, importsUPConvertFn, isSingleMonth],
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
        tickfont: { family: "Arial", size: 10 },
      },
      yaxis: {
        ...AXIS_LINE,
        title: { text: importsUPUnitLabel, font: { family: "Arial", size: 11 } },
        tickformat: ",.1f",
      },
      legend: {
        orientation: "h" as const,
        x: 0,
        y: -0.22,
        font: { family: "Arial", size: 10 },
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
        tickfont: { family: "Arial", size: 10 },
      },
      yaxis: {
        ...AXIS_LINE,
        title: { text: "USD / bbl", font: { family: "Arial", size: 11 } },
        tickformat: ",.2f",
      },
      legend: {
        orientation: "h" as const,
        x: 0,
        y: -0.22,
        font: { family: "Arial", size: 10 },
      },
    }),
    [rangeMonths],
  );

  const exportsPaisesLayout: Partial<Layout> = useMemo(
    () => areaLayout(exportsUnit, rangeMonths, 420),
    [exportsUnit, rangeMonths],
  );

  // Guard — after all hooks
  if (visibilityLoading) return <BarrelLoading />;
  if (!visible) return <></>;

  // ── Export handler (Tier 1 — direct download) ───────────────────────────────
  async function handleExcelExport() {
    setExcelBusy(true);
    try {
      const { default: ExcelJS } = await import("exceljs");

      const wb = new ExcelJS.Workbook();

      const wsA = wb.addWorksheet("Imports by Country (kt)");
      wsA.addRow(["Year", "Month", "Country", "Volume (kt)"]);
      for (const r of paisesData) {
        wsA.addRow([r.ano, r.mes, r.pais_origem, +(r.total_kg / 1e6).toFixed(3)]);
      }

      const wsB = wb.addWorksheet("Imports by Importer (mil m3)");
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
      setExcelBusy(false);
    }
  }

  async function handleCsvExport() {
    setCsvBusy(true);
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
      setCsvBusy(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

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
                rightSlot={
                  <ExportPanel
                    actions={[
                      {
                        kind: "excel",
                        label: "Excel",
                        onClick: handleExcelExport,
                        busy: excelBusy,
                        disabled: excelBusy || csvBusy,
                        loadingLabel: "Building workbook…",
                      },
                      {
                        kind: "csv",
                        label: "CSV (zip)",
                        onClick: handleCsvExport,
                        busy: csvBusy,
                        disabled: excelBusy || csvBusy,
                      },
                    ]}
                  />
                }
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
                      rows={yoyImportersData}
                      loading={yoyImportersLoading}
                      volumeLabel="mil m³"
                      title="By Importer"
                      anchorAno={filters.period.end.ano}
                      anchorMes={filters.period.end.mes}
                    />
                  )}

                  <div style={{ height: 24 }} />

                  {/* Panel C — Import Price (MDIC-sourced) */}
                  <ChartSection
                    title={`Import Price (${priceUnit})`}
                    loading={priceLoading}
                    height={320}
                  >
                    {/* Metric toggle */}
                    <div style={{ marginBottom: 10, maxWidth: 360 }}>
                      <SegmentedToggle
                        options={[
                          { value: "fob_per_bbl" as const, label: "USD / bbl" },
                          { value: "fob_per_m3" as const, label: "USD / m³" },
                          { value: "fob_per_ton" as const, label: "USD / ton" },
                        ]}
                        value={filters.priceMetric}
                        onChange={(v) =>
                          setFilters({ priceMetric: v as PriceMetric })
                        }
                        variant="compact"
                      />
                    </div>

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
                        layout={{ ...emptyPlot().layout, height: 320 }}
                        config={{ responsive: true, displayModeBar: false }}
                        style={{ width: "100%" }}
                      />
                    ) : null}
                  </ChartSection>

                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 11,
                      color: "#aaa",
                      fontStyle: "italic",
                    }}
                  >
                    Source: MDIC Comex — FOB unit price derived from total import value ÷ volume. Diesel = 832 kg/m³, Gasoline = 745 kg/m³, Crude Oil = 870 kg/m³.
                  </div>

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
                        onChange={(v) => setImportsUPMetric(v as ImportsUPMetric)}
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
