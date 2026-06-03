"use client";

// Mobile view for /imports-exports (≤768px).
//
// Reform v2 (Onda 3 — Wave 3 of the mobile reform, 2026-05-27 / 2026-05-28).
// Big-bang rewrite per /.claude/plans/o-modo-mobile-da-tranquil-giraffe.md § 4.5.
//
// Drastic simplification vs the desktop View:
//   • NO product picker — Imports tab is hard-coded to **Diesel** and Exports
//     tab is hard-coded to **Crude Oil**. Mobile is monitoring-only for the
//     two highest-priority products.
//   • NO ExportFAB / Excel / CSV downloads on mobile (Plan § 3.4 policy).
//   • NO FilterDrawer — period is a 4-pill preset (1Y / 3Y / 5Y / All, default 1Y).
//   • NO MobileTopBar own — DashboardLayout's MobileShell renders the global
//     SectorData topbar + kebab + floating Home pill. Views render content only.
//   • NO MobileBottomTabBar — replaced by the global Home pill in the shell.
//   • NO useIsMobile() — we're already inside the mobile branch.
//
// Layout (top → bottom):
//   1. Top sticky tab bar  — Imports / Exports
//   2. Period preset pills — 1Y / 3Y / 5Y / All (default 3Y)
//   3. Volume / Value toggle (exports volume in mil t ↔ USD)
//   4a. Imports tab:
//        Hero stacked area by 6 origin countries (pinned palette, no Others
//          aggregation — the 6 are the legend, full stop)
//        Importers section: stacked area by top 6 importer groups
//        Import Price Summary table (top-2 + weighted Others)
//        YoY top-10 table — horizontal scroll, first column sticky
//   4b. Exports tab:
//        Hero stacked area by top 6 destination countries
//        Export Price Summary table (all top-N destinations, no Others)
//        YoY top-10 table — horizontal scroll
//
// Hook contract: this View flips `unifiedProduct` whenever the active tab
// changes (Imports → 'Diesel', Exports → 'Crude Oil'). The shared hook handles
// fetching for the active product; the tab + product change land together so
// only one refetch cycle is triggered per user gesture.

import dynamic from "next/dynamic";
import type { Layout, PlotData } from "plotly.js";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  MobileTabBar,
} from "../../../../components/dashboard/mobile";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";

import {
  useImportsExportsData,
  formatMonth,
  addMonths,
  cmpMonth,
} from "../useImportsExportsData";
import type {
  YoyTableRow,
  MonthCursor,
  PriceSummaryRow,
} from "../useImportsExportsData";

import { COMMON_LAYOUT, AXIS_LINE, PALETTE, emptyPlot } from "../../../../lib/plotlyDefaults";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

// Unit conversions (USD/m³ → USD/bbl / USD/ton / ¢/gal) are done inside the
// shared hook (`useImportsExportsData`) — both `importsPriceSummary` and
// `exportsPriceSummary` arrive pre-converted. No m³/bbl/ton math lives in
// this file; if conversion logic ever needs to live here, mirror the
// constants documented in docs/app/imports-exports.md § "Unit Price Panels".

// ─── Pinned origin-country palette ─────────────────────────────────────────────
//
// Same 6-country pin set as desktop — see desktop/View.tsx for the full
// rationale. Keep this list in sync with desktop/View.tsx, the hook, and the
// canonical palette in docs/app/imports-exports.md § "Pinned origin-country palette".
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

const OTHERS_COLOR = "#7F7F7F";
const OTHERS_LABEL = "Others";

const ORIGIN_LABEL_BY_DB: Record<string, string> = ORIGIN_COUNTRY_PINS.reduce(
  (acc, p) => ({ ...acc, [p.dbName]: p.label }),
  {} as Record<string, string>,
);

const ORIGIN_COLOR_BY_LABEL: Record<string, string> = ORIGIN_COUNTRY_PINS.reduce(
  (acc, p) => ({ ...acc, [p.label]: p.color }),
  { [OTHERS_LABEL]: OTHERS_COLOR } as Record<string, string>,
);

// Canonical order for the imports tab — top of stack first, Others last.
const ORIGIN_ORDER: string[] = [
  ...ORIGIN_COUNTRY_PINS.map((p) => p.label),
  OTHERS_LABEL,
];

/**
 * Re-bucket the raw country rows from RPC against our 6 pinned origins.
 * Any country outside the pin set (including the server's pre-existing
 * "Others" bucket) is collapsed into a single client-side "Others".
 */
function bucketPaisesByPins(
  rows: { ano: number; mes: number; pais_origem: string; total_m3: number }[],
): { ano: number; mes: number; name: string; total_m3: number }[] {
  const byKey = new Map<string, number>();
  for (const r of rows) {
    const englishLabel = ORIGIN_LABEL_BY_DB[r.pais_origem] ?? OTHERS_LABEL;
    const k = `${r.ano}|${r.mes}|${englishLabel}`;
    byKey.set(k, (byKey.get(k) ?? 0) + r.total_m3);
  }
  const out: { ano: number; mes: number; name: string; total_m3: number }[] = [];
  for (const [k, total_m3] of byKey.entries()) {
    const [a, m, name] = k.split("|");
    out.push({ ano: Number(a), mes: Number(m), name, total_m3 });
  }
  return out;
}

/**
 * Inject null-valued points so every pinned country has a series in every
 * month present in `rows`. Keeps the legend stable across periods.
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
    const othersKey = `${a}|${m}|${OTHERS_LABEL}`;
    if (!present.has(othersKey)) {
      out.push({ ano: a, mes: m, name: OTHERS_LABEL, value: null });
    }
  }
  return out;
}

function colourForEntity(entities: string[], entity: string): string {
  if (entity === OTHERS_LABEL) return OTHERS_COLOR;
  const pinned = ORIGIN_COLOR_BY_LABEL[entity];
  if (pinned) return pinned;
  const idx = entities.filter((e) => e !== OTHERS_LABEL).indexOf(entity);
  return PALETTE[idx % PALETTE.length] ?? OTHERS_COLOR;
}

// ─── Stacked area builder ─────────────────────────────────────────────────────
//
// Mirrors desktop's `buildStackedTraces`. Per-point hover threshold so the
// unified tooltip never shows "Country X: 0 kt" rows. Keep `HOVER_THRESHOLD`
// in sync with desktop/View.tsx + the hook (it lives in three files because
// each surface owns its own trace assembly).

const HOVER_THRESHOLD = 0.05;

type StackedRow = { ano: number; mes: number; name: string; value: number | null };

function buildStackedTraces(
  rows: StackedRow[],
  unit: string,
  orderOverride?: string[],
  colorMap?: Record<string, string>,
): PlotData[] {
  if (!rows.length) return [];
  const xSet = new Set<string>();
  const entitySet = new Set<string>();
  for (const r of rows) {
    xSet.add(`${r.ano}-${String(r.mes).padStart(2, "0")}-01`);
    entitySet.add(r.name);
  }
  const xs = Array.from(xSet).sort();
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
    const color = colorMap?.[entity] ?? colourForEntity(entities, entity);
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

/**
 * Mobile-tuned dtick selector for stacked-area x-axis (months).
 * Range pills clamp to 12 / 36 / 60 / All months — picking M3/M6/M12 keeps
 * tick density legible on phones.
 */
function pickDtick(rangeMonths: number): string {
  if (rangeMonths <= 12) return "M2";
  if (rangeMonths <= 36) return "M6";
  if (rangeMonths <= 72) return "M12";
  return "M24";
}

function mobileAreaLayout(yLabel: string, rangeMonths: number): Partial<Layout> {
  return {
    ...COMMON_LAYOUT,
    hovermode: "x unified" as const,
    height: 280,
    margin: { t: 8, b: 72, l: 52, r: 8 },
    xaxis: {
      ...AXIS_LINE,
      type: "date" as const,
      tickformat: "%b %Y",
      dtick: pickDtick(rangeMonths),
      tickangle: -90,
      tickfont: { family: "Arial", size: 11 },
    },
    yaxis: {
      ...AXIS_LINE,
      title: { text: yLabel, font: { family: "Arial", size: 10 } },
      tickformat: ",.1f",
      tickfont: { family: "Arial", size: 11 },
    },
    legend: {
      orientation: "h" as const,
      // Legend reads bottom-of-stack first (Russia → US → ... → Others).
      traceorder: "normal" as const,
      x: 0,
      y: -0.36,
      font: { family: "Arial", size: 11 },
    },
  };
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function fmtDelta(v: number | null): { text: string; color: string } {
  if (v == null || !isFinite(v)) return { text: "—", color: "#888" };
  const text = (v > 0 ? "+" : "") + v.toFixed(1) + "%";
  const color = v > 0 ? "#16a34a" : v < 0 ? "#dc2626" : "#555";
  return { text, color };
}

function fmtValue(v: number, digits = 1): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: digits });
}

// ─── Section heading ──────────────────────────────────────────────────────────

function SectionHeading({
  title,
  subtitle,
  loading,
}: {
  title: string;
  subtitle?: string;
  loading?: boolean;
}) {
  return (
    <div
      style={{
        padding: "16px 16px 8px",
        fontFamily: "Arial",
      }}
    >
      <div
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: "var(--mobile-text, #1a1a1a)",
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
      {subtitle && (
        <div
          style={{
            fontSize: 11,
            color: "var(--mobile-text-muted, #888)",
            marginTop: 2,
          }}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
}

// ─── Price Summary Table (horizontal scroll, sticky first col) ───────────────

function PriceSummaryTable({
  rows,
  unitLabel,
  loading,
}: {
  rows: PriceSummaryRow[];
  unitLabel: string;
  loading: boolean;
}) {
  if (loading && rows.length === 0) {
    return (
      <div style={{ padding: "12px 16px", color: "#aaa", fontSize: 12 }}>
        Loading…
      </div>
    );
  }
  if (!rows.length) return null;

  return (
    <div
      style={{
        margin: "0 16px 12px",
        background: "var(--mobile-surface, #fff)",
        border: "1px solid var(--mobile-divider, #e6e6ec)",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.6fr 1fr 0.9fr 0.9fr",
          padding: "8px 12px",
          fontSize: 10,
          fontWeight: 700,
          color: "#888",
          textTransform: "uppercase",
          letterSpacing: "0.4px",
          background: "#fafafa",
          borderBottom: "1px solid var(--mobile-divider, #e6e6ec)",
          fontFamily: "Arial",
        }}
      >
        <div>Country</div>
        <div style={{ textAlign: "right" }}>Latest</div>
        <div style={{ textAlign: "right" }}>MoM%</div>
        <div style={{ textAlign: "right" }}>YoY%</div>
      </div>
      {rows.map((r) => {
        const mom = fmtDelta(r.momPct);
        const yoy = fmtDelta(r.yoyPct);
        return (
          <div
            key={r.country}
            style={{
              display: "grid",
              gridTemplateColumns: "1.6fr 1fr 0.9fr 0.9fr",
              alignItems: "center",
              padding: "10px 12px",
              borderTop: "1px solid var(--mobile-divider, #f0f0f4)",
              fontFamily: "Arial",
              fontSize: 12,
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                minWidth: 0,
                fontWeight: 600,
                color: "var(--mobile-text, #1a1a1a)",
              }}
            >
              <span
                aria-hidden
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: r.color ?? "#bbb",
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {r.country}
              </span>
            </div>
            <div
              style={{
                textAlign: "right",
                fontVariantNumeric: "tabular-nums",
                fontWeight: 700,
              }}
            >
              {fmtValue(r.latest, 2)}
              <span style={{ fontSize: 9, color: "#999", fontWeight: 400, marginLeft: 4 }}>
                {unitLabel}
              </span>
            </div>
            <div
              style={{
                textAlign: "right",
                color: mom.color,
                fontVariantNumeric: "tabular-nums",
                fontWeight: 600,
              }}
            >
              {mom.text}
            </div>
            <div
              style={{
                textAlign: "right",
                color: yoy.color,
                fontVariantNumeric: "tabular-nums",
                fontWeight: 600,
              }}
            >
              {yoy.text}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── YoY table (horizontal scroll + sticky first col) ─────────────────────────
//
// Plan § 4.5: "YoY top-10 table — horizontal scroll, first col sticky."
// Mobile keeps tabular shape (vs the legacy MobileDataCard list) so the analyst
// can read across periods in one glance. First column is sticky via
// position:sticky + background, last 4 columns scroll under it.

function YoYTable({
  rows,
  loading,
  unitLabel,
  anchorAno,
  anchorMes,
  prevMonthByEntity,
  orderOverride,
  colorMap,
}: {
  rows: YoyTableRow[];
  loading: boolean;
  unitLabel: string;
  anchorAno: number;
  anchorMes: number;
  prevMonthByEntity: Map<string, number | null>;
  orderOverride?: string[];
  colorMap?: Record<string, string>;
}) {
  if (loading && rows.length === 0) {
    return (
      <div style={{ padding: "12px 16px", color: "#aaa", fontSize: 12 }}>
        Loading…
      </div>
    );
  }
  if (!rows.length) return null;

  const byEntity = new Map(rows.map((r) => [r.entity, r]));
  let orderedRows: YoyTableRow[];
  if (orderOverride) {
    const present = orderOverride.filter((e) => byEntity.has(e));
    const nonOthers = present
      .filter((e) => e !== OTHERS_LABEL)
      .sort((a, b) => (byEntity.get(b)?.last_12m ?? 0) - (byEntity.get(a)?.last_12m ?? 0));
    const hasOthers = present.includes(OTHERS_LABEL);
    const ordered = hasOthers ? [...nonOthers, OTHERS_LABEL] : nonOthers;
    orderedRows = ordered
      .map((e) => byEntity.get(e))
      .filter((r): r is YoyTableRow => r != null);
  } else {
    orderedRows = [...rows].slice(0, 10).sort((a, b) => b.last_12m - a.last_12m);
  }

  const currentLbl = formatMonth(anchorAno, anchorMes);
  const prevMonthCursor =
    anchorMes === 1
      ? { ano: anchorAno - 1, mes: 12 }
      : { ano: anchorAno, mes: anchorMes - 1 };
  const prevMonthLbl = formatMonth(prevMonthCursor.ano, prevMonthCursor.mes);
  const priorYearLbl = formatMonth(anchorAno - 1, anchorMes);

  // First column sticky background must be opaque so scrolled cells render
  // under it cleanly.
  const stickyBg = "var(--mobile-surface, #fff)";
  const headerBg = "#fafafa";

  const cellPadding = "10px 12px";
  const headerCellPadding = "10px 12px 8px";

  return (
    <div
      style={{
        margin: "0 16px 12px",
        background: "var(--mobile-surface, #fff)",
        border: "1px solid var(--mobile-divider, #e6e6ec)",
        borderRadius: 12,
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
      }}
    >
      <table
        style={{
          minWidth: 540,
          borderCollapse: "separate",
          borderSpacing: 0,
          width: "100%",
          fontFamily: "Arial",
          fontSize: 12,
        }}
      >
        <thead>
          <tr>
            <th
              style={{
                position: "sticky",
                left: 0,
                background: headerBg,
                borderBottom: "1px solid var(--mobile-divider, #e6e6ec)",
                borderRight: "1px solid var(--mobile-divider, #f0f0f4)",
                padding: headerCellPadding,
                fontSize: 10,
                fontWeight: 700,
                color: "#888",
                textTransform: "uppercase",
                letterSpacing: "0.4px",
                textAlign: "left",
                zIndex: 2,
                minWidth: 160,
              }}
            >
              Entity
            </th>
            {[
              { lbl: currentLbl, sub: unitLabel },
              { lbl: prevMonthLbl, sub: unitLabel },
              { lbl: "MoM %", sub: "" },
              { lbl: priorYearLbl, sub: unitLabel },
              { lbl: "YoY %", sub: "" },
            ].map((h) => (
              <th
                key={h.lbl + h.sub}
                style={{
                  background: headerBg,
                  borderBottom: "1px solid var(--mobile-divider, #e6e6ec)",
                  padding: headerCellPadding,
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#888",
                  textTransform: "uppercase",
                  letterSpacing: "0.4px",
                  textAlign: "right",
                  whiteSpace: "nowrap",
                }}
              >
                {h.lbl}
                {h.sub && (
                  <div style={{ fontSize: 9, fontWeight: 400, color: "#aaa", marginTop: 2 }}>
                    {h.sub}
                  </div>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orderedRows.map((row) => {
            const prevMonthValue = prevMonthByEntity.get(row.entity) ?? null;
            const momPct =
              prevMonthValue != null && prevMonthValue !== 0
                ? ((row.last_12m - prevMonthValue) / prevMonthValue) * 100
                : null;
            const mom = fmtDelta(momPct);
            const yoy = fmtDelta(row.yoy_pct);
            const dotColor = colorMap?.[row.entity];

            return (
              <tr key={row.entity}>
                <td
                  style={{
                    position: "sticky",
                    left: 0,
                    background: stickyBg,
                    borderBottom: "1px solid var(--mobile-divider, #f0f0f4)",
                    borderRight: "1px solid var(--mobile-divider, #f0f0f4)",
                    padding: cellPadding,
                    fontWeight: 600,
                    color: "var(--mobile-text, #1a1a1a)",
                    zIndex: 1,
                    minWidth: 160,
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    {dotColor && (
                      <span
                        aria-hidden
                        style={{
                          display: "inline-block",
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: dotColor,
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: 140,
                      }}
                      title={row.entity}
                    >
                      {row.entity}
                    </span>
                  </span>
                </td>
                <td
                  style={{
                    padding: cellPadding,
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: 700,
                    color: "var(--mobile-text, #1a1a1a)",
                    borderBottom: "1px solid var(--mobile-divider, #f0f0f4)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {fmtValue(row.last_12m, 1)}
                </td>
                <td
                  style={{
                    padding: cellPadding,
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                    color: "#777",
                    borderBottom: "1px solid var(--mobile-divider, #f0f0f4)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {prevMonthValue != null ? fmtValue(prevMonthValue, 1) : "—"}
                </td>
                <td
                  style={{
                    padding: cellPadding,
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                    color: mom.color,
                    fontWeight: 600,
                    borderBottom: "1px solid var(--mobile-divider, #f0f0f4)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {mom.text}
                </td>
                <td
                  style={{
                    padding: cellPadding,
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                    color: "#777",
                    borderBottom: "1px solid var(--mobile-divider, #f0f0f4)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {fmtValue(row.prev_12m, 1)}
                </td>
                <td
                  style={{
                    padding: cellPadding,
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                    color: yoy.color,
                    fontWeight: 600,
                    borderBottom: "1px solid var(--mobile-divider, #f0f0f4)",
                    whiteSpace: "nowrap",
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
  );
}

// ─── Period preset pills ──────────────────────────────────────────────────────
//
// Plan § 4.5: "Period preset pills. 1Y / 3Y / 5Y / All. Default 3Y."
//
// Each preset clamps to the filtros bounds and snaps to (filtros.ano_max,
// filtros.mes_max) as the anchor. "All" snaps start to (ano_min, mes_min).

type PeriodPreset = "1Y" | "3Y" | "5Y" | "All";

const PERIOD_PRESETS: ReadonlyArray<{ key: PeriodPreset; months: number | null }> = [
  { key: "1Y", months: 12 },
  { key: "3Y", months: 36 },
  { key: "5Y", months: 60 },
  { key: "All", months: null },
];

function computePresetPeriod(
  preset: PeriodPreset,
  bounds: { lower: MonthCursor; upper: MonthCursor },
): { start: MonthCursor; end: MonthCursor } {
  const end = bounds.upper;
  const def = PERIOD_PRESETS.find((p) => p.key === preset)!;
  if (def.months == null) return { start: bounds.lower, end };
  // Inclusive — last N months means end and (end - (N-1)) are both included.
  let start = addMonths(end, -(def.months - 1));
  if (cmpMonth(start, bounds.lower) < 0) start = bounds.lower;
  return { start, end };
}

/**
 * Best-effort detection of which preset matches the current period. Used to
 * highlight the active pill after the user manually edits the period (which
 * cannot happen on mobile but the hook may emit non-preset values on first
 * load if the data window is tiny).
 */
function detectPreset(
  period: { start: MonthCursor; end: MonthCursor },
  bounds: { lower: MonthCursor; upper: MonthCursor },
): PeriodPreset | null {
  for (const def of PERIOD_PRESETS) {
    const ref = computePresetPeriod(def.key, bounds);
    if (
      cmpMonth(ref.start, period.start) === 0 &&
      cmpMonth(ref.end, period.end) === 0
    ) {
      return def.key;
    }
  }
  return null;
}

// ─── Main component ───────────────────────────────────────────────────────────

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
    importersLatestMonth,
    importersMonthPending,
    importersTop6Data,
    importersTop6Entities,
    importersTop6ColorMap,
    yoyPaisesData,
    yoyPaisesLoading,
    yoyImportersLoading,
    yoyImportersTop6Data,
    exportsPaisesData,
    exportsPaisesLoading,
    yoyExportsData,
    yoyExportsLoading,
    importsUnitPriceLoading,
    exportsUnitPriceData,
    exportsUnitPriceLoading,
    importsPriceSummary,
    exportsPriceSummary,
    visible,
    visibilityLoading,
  } = useImportsExportsData();

  // ── Tab state — switching tabs also pins the product per the mobile spec ──
  //
  // Imports tab → Diesel; Exports tab → Crude Oil. The product picker is
  // intentionally absent from the mobile UI (plan § 4.5). The hook's
  // `setFilters` now self-corrects `unifiedProduct` whenever the (tab,
  // product) pair would be invalid (see ALLOWED_PRODUCTS_BY_TAB in
  // useImportsExportsData.ts, 2026-05-28), so the View just patches the tab
  // and trusts the hook to snap the product to the canonical one in the
  // same render. A defensive mount-time effect there also corrects any stale
  // state inherited from a previous session.
  const handleTabChange = useCallback(
    (key: string) => {
      setFilters({ tab: key as "imports" | "exports" });
    },
    [setFilters],
  );

  // ── Bounds + presets ────────────────────────────────────────────────────────

  const anoMin = filtros?.ano_min ?? 2010;
  const mesMin = filtros?.mes_min ?? 1;
  const anoMax = filtros?.ano_max ?? new Date().getFullYear();
  const mesMax = filtros?.mes_max ?? 12;
  const lowerBound: MonthCursor = useMemo(
    () => ({ ano: anoMin, mes: mesMin }),
    [anoMin, mesMin],
  );
  const upperBound: MonthCursor = useMemo(
    () => ({ ano: anoMax, mes: mesMax }),
    [anoMax, mesMax],
  );

  // Default preset = 1Y. When filtros first loads, snap to 1Y window.
  // Desktop defaults to 3Y (more data visible on a wide screen); mobile
  // defaults to 1Y to keep charts legible on a narrow phone viewport.
  const [preset, setPreset] = useState<PeriodPreset>("1Y");
  const filtrosReady = filtros != null;

  useEffect(() => {
    if (!filtrosReady) return;
    const { start, end } = computePresetPeriod(preset, {
      lower: lowerBound,
      upper: upperBound,
    });
    if (
      cmpMonth(filters.period.start, start) !== 0 ||
      cmpMonth(filters.period.end, end) !== 0
    ) {
      setFilters({ period: { start, end } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, filtrosReady, lowerBound.ano, lowerBound.mes, upperBound.ano, upperBound.mes]);

  // Sync preset if the hook's period somehow shifts away from our presets
  // (shouldn't happen on mobile since we don't expose a manual editor).
  const activePreset = useMemo(
    () =>
      detectPreset(filters.period, { lower: lowerBound, upper: upperBound }) ??
      preset,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      filters.period.start.ano,
      filters.period.start.mes,
      filters.period.end.ano,
      filters.period.end.mes,
      lowerBound.ano,
      lowerBound.mes,
      upperBound.ano,
      upperBound.mes,
      preset,
    ],
  );

  // Period in months — drives chart dtick.
  const rangeMonths = useMemo(() => {
    const s = filters.period.start;
    const e = filters.period.end;
    return Math.max(1, (e.ano - s.ano) * 12 + (e.mes - s.mes) + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filters.period.start.ano,
    filters.period.start.mes,
    filters.period.end.ano,
    filters.period.end.mes,
  ]);

  // ── Imports tab — Panel A traces (countries, thousand m³) ──────────────────
  //
  // The hook returns volume rows in m³ (server applies per-NCM density,
  // migration 20260608500000); we divide by 1000 for thousand m³. Panel A is
  // volume-only — `anp_desembaracos`/ComexStat volume has no $-revenue column
  // for this panel, so there is no Volume/USD toggle on the Imports tab; the
  // chart is always Volume (thousand m³).
  //
  // The Exports tab keeps the Volume/USD toggle because `mdic_comex` carries
  // both columns and the exports RPC honours `metric=volume|usd`.

  const importsPaisesStacked = useMemo(() => {
    const bucketed = bucketPaisesByPins(paisesData);
    const rawRows = bucketed.map((r) => ({
      ano: r.ano,
      mes: r.mes,
      name: r.name,
      value: r.total_m3 / 1000,
    }));
    return ensureAllPinsPresent(rawRows);
  }, [paisesData]);

  const importsPaisesTraces = useMemo(
    () => buildStackedTraces(importsPaisesStacked, "thousand m³", ORIGIN_ORDER),
    [importsPaisesStacked],
  );

  const importsPaisesLayout: Partial<Layout> = useMemo(
    () => mobileAreaLayout("thousand m³", rangeMonths),
    [rangeMonths],
  );

  // Importers — top-6 + Others, rank-bound palette.
  const importersTraces = useMemo(() => {
    const rows: StackedRow[] = importersTop6Data.map((r) => ({
      ano: r.ano,
      mes: r.mes,
      name: r.unified_importer,
      value: r.total_mil_m3,
    }));
    return buildStackedTraces(rows, "mil m³", importersTop6Entities, importersTop6ColorMap);
  }, [importersTop6Data, importersTop6Entities, importersTop6ColorMap]);

  const importersLayout: Partial<Layout> = useMemo(
    () => mobileAreaLayout("mil m³", rangeMonths),
    [rangeMonths],
  );

  // YoY Panel A — pinned-bucket re-aggregation so rows align with the chart
  // legend (Russia / US / UAE / NL / India / Saudi / Others).
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
    for (const pin of ORIGIN_COUNTRY_PINS) {
      if (!acc.has(pin.label)) acc.set(pin.label, { last_12m: 0, prev_12m: 0 });
    }
    if (!acc.has(OTHERS_LABEL)) acc.set(OTHERS_LABEL, { last_12m: 0, prev_12m: 0 });
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

  // ── Exports tab — traces + unit/label per toggle ──────────────────────────
  // Volume is reported in thousand tonnes ("mil t") — the RPC returns ComexStat
  // net weight directly (2026-06-03). USD label unchanged.
  const exportsUnit = filters.exportsYAxis === "volume" ? "mil t" : "USD";

  // Stable alphabetical entity order — mirrors the order buildStackedTraces
  // uses internally when no orderOverride is provided (non-Others sorted
  // alphabetically, Others last). Derived once so the chart and the YoY table
  // share the SAME PALETTE index per country, fixing the legend-color ↔
  // table-dot-color mismatch. Keep in sync with desktop/View.tsx.
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

  // Server-returned top-N destination countries — alphabetical order via
  // exportsEntityOrder so chart and table share the same PALETTE indices.
  const exportsPaisesTraces = useMemo(() => {
    const rows: StackedRow[] = exportsPaisesData.map((r) => ({
      ano: r.ano,
      mes: r.mes,
      name: r.pais,
      value: r.value, // already in mil t (volume) or USD from RPC
    }));
    return buildStackedTraces(rows, exportsUnit, exportsEntityOrder, exportsColorMap);
  }, [exportsPaisesData, exportsUnit, exportsEntityOrder, exportsColorMap]);

  const exportsPaisesLayout: Partial<Layout> = useMemo(
    () => mobileAreaLayout(exportsUnit, rangeMonths),
    [exportsUnit, rangeMonths],
  );

  // Export Price Summary — Crude Oil only on exports, but the hook always
  // emits exportsPriceSummary. We assign chart-palette colors so dots line
  // up with the chart legend.
  const exportsUPEntities = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of exportsUnitPriceData) {
      if (r.usd_per_m3 != null) {
        totals.set(r.pais, (totals.get(r.pais) ?? 0) + 1);
      }
    }
    return Array.from(totals.keys()).sort(
      (a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0),
    );
  }, [exportsUnitPriceData]);

  const exportsPriceSummaryColored: PriceSummaryRow[] = useMemo(
    () =>
      exportsPriceSummary.map((row) => {
        const idx = exportsUPEntities.indexOf(row.country);
        const color =
          idx >= 0 ? PALETTE[idx % PALETTE.length] ?? OTHERS_COLOR : OTHERS_COLOR;
        return { ...row, color };
      }),
    [exportsPriceSummary, exportsUPEntities],
  );

  // ── prev-month-per-entity lookups (drives MoM% column in YoY tables) ──────
  const prevMonthCursor = useMemo(() => {
    const a = filters.period.end.ano;
    const m = filters.period.end.mes;
    return m === 1 ? { ano: a - 1, mes: 12 } : { ano: a, mes: m - 1 };
  }, [filters.period.end.ano, filters.period.end.mes]);

  // Countries (Imports) — thousand m³ at prev_month, bucketed against pins.
  const prevMonthByCountry: Map<string, number | null> = useMemo(() => {
    const target = `${prevMonthCursor.ano}|${prevMonthCursor.mes}`;
    const acc = new Map<string, number>();
    for (const r of paisesData) {
      if (`${r.ano}|${r.mes}` !== target) continue;
      const englishLabel = ORIGIN_LABEL_BY_DB[r.pais_origem] ?? OTHERS_LABEL;
      const valueK = r.total_m3 / 1000;
      acc.set(englishLabel, (acc.get(englishLabel) ?? 0) + valueK);
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
  // ANP lags ComexStat (which drives the period selector), so period.end can
  // point at a month ANP has not yet published. Anchoring the importer YoY
  // table + its MoM lookup here keeps an unpublished month from rendering as a
  // zero / −100%. Mirrors desktop/View.tsx.
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

  // Importers (Imports) — per-importer lookup, collapsed to top-6 + Others.
  const prevMonthByImporter: Map<string, number | null> = useMemo(() => {
    const target = `${importerPrevMonthCursor.ano}|${importerPrevMonthCursor.mes}`;
    const topSet = new Set(importersTop6Entities.filter((e) => e !== OTHERS_LABEL));
    const acc = new Map<string, number>();
    let othersAcc = 0;
    let othersAccSeen = false;
    for (const r of importersData) {
      if (`${r.ano}|${r.mes}` !== target) continue;
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

  // Exports — per-destination lookup at prev_month.
  const prevMonthByExportsCountry: Map<string, number | null> = useMemo(() => {
    const target = `${prevMonthCursor.ano}|${prevMonthCursor.mes}`;
    const acc = new Map<string, number>();
    for (const r of exportsPaisesData) {
      if (`${r.ano}|${r.mes}` !== target) continue;
      acc.set(r.pais, (acc.get(r.pais) ?? 0) + r.value);
    }
    const out = new Map<string, number | null>();
    for (const r of yoyExportsData) {
      out.set(r.entity, acc.has(r.entity) ? acc.get(r.entity)! : null);
    }
    return out;
  }, [exportsPaisesData, yoyExportsData, prevMonthCursor]);

  // Visibility guard — render nothing until profile/visibility resolves.
  if (visibilityLoading) return <BarrelLoading bare />;
  if (!visible) return <></>;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "var(--mobile-bg, #f5f5f7)",
        paddingBottom: "calc(96px + var(--mobile-safe-bottom, 0px))",
        fontFamily: "Arial, Helvetica, sans-serif",
        color: "var(--mobile-text, #1a1a1a)",
      }}
    >
      {/* Page title + locked product */}
      <div
        style={{
          padding: "14px 16px 6px",
          fontFamily: "Arial",
        }}
      >
        <div
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: "var(--mobile-text, #1a1a1a)",
            lineHeight: 1.2,
          }}
        >
          Imports &amp; Exports
        </div>
        <div
          style={{
            fontSize: 11,
            color: "var(--mobile-text-muted, #888)",
            marginTop: 4,
          }}
        >
          {filters.tab === "imports"
            ? "Brazilian diesel imports — by origin and importer"
            : "Brazilian crude oil exports — by destination"}
        </div>
      </div>

      {/* ── Top sticky tab bar ────────────────────────────────────────────── */}
      <div
        style={{
          position: "sticky",
          top: "var(--mobile-topbar-h, 56px)",
          zIndex: 22,
          background: "var(--mobile-glass-bg, rgba(245,245,247,0.92))",
          WebkitBackdropFilter: "var(--mobile-glass-blur, blur(8px))",
          backdropFilter: "var(--mobile-glass-blur, blur(8px))",
          paddingTop: 10,
          paddingBottom: 8,
          borderBottom: "1px solid var(--mobile-glass-border, rgba(0,0,0,0.06))",
        }}
      >
        <MobileTabBar
          tabs={[
            { key: "imports", label: "Diesel Imports" },
            { key: "exports", label: "Crude Oil Exports" },
          ]}
          activeKey={filters.tab}
          onChange={handleTabChange}
          variant="container"
          ariaLabel="Diesel Imports / Crude Oil Exports tabs"
        />

        {/* Period preset pills */}
        <div
          style={{
            display: "flex",
            gap: 8,
            padding: "10px 16px 0",
            overflowX: "auto",
            scrollbarWidth: "none",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {PERIOD_PRESETS.map((p) => {
            const active = activePreset === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => setPreset(p.key)}
                disabled={filtrosLoading && !filtros}
                style={{
                  flexShrink: 0,
                  padding: "5px 14px",
                  borderRadius: 999,
                  border: "1px solid",
                  borderColor: active
                    ? "var(--mobile-accent, #ff5000)"
                    : "var(--mobile-divider, #d0d0d0)",
                  background: active
                    ? "var(--mobile-accent, #ff5000)"
                    : "var(--mobile-surface, #fff)",
                  color: active ? "#fff" : "var(--mobile-text-muted, #555)",
                  fontFamily: "Arial",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  minHeight: 32,
                  transition: "background 0.15s ease, color 0.15s ease",
                }}
              >
                {p.key}
              </button>
            );
          })}
        </div>

        {/* Volume / Value toggle — only shown on Exports tab.
            Imports has no $-revenue column server-side; Volume (thousand m³) is fixed. */}
        {filters.tab === "exports" && (
          <div style={{ display: "flex", gap: 8, padding: "10px 16px 0" }}>
            {(
              [
                { key: "volume", label: "Volume" },
                { key: "usd", label: "Value (USD)" },
              ] as const
            ).map((opt) => {
              const active = filters.exportsYAxis === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setFilters({ exportsYAxis: opt.key })}
                  style={{
                    flex: 1,
                    padding: "5px 14px",
                    borderRadius: 999,
                    border: "1px solid",
                    borderColor: active ? "#1a1a1a" : "var(--mobile-divider, #d0d0d0)",
                    background: active ? "#1a1a1a" : "var(--mobile-surface, #fff)",
                    color: active ? "#fff" : "var(--mobile-text-muted, #555)",
                    fontFamily: "Arial",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    minHeight: 32,
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── IMPORTS TAB ────────────────────────────────────────────────────── */}
      {filters.tab === "imports" && (
        <div style={{ paddingTop: 4 }}>
          <SectionHeading
            title="By Origin Country"
            subtitle="Diesel imports, thousand m³"
            loading={paisesLoading}
          />
          <div style={{ padding: "0 8px 8px" }}>
            {importsPaisesTraces.length > 0 ? (
              <Plot
                data={importsPaisesTraces}
                layout={importsPaisesLayout}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: "100%" }}
              />
            ) : !paisesLoading ? (
              <Plot
                data={emptyPlot().data}
                layout={{ ...emptyPlot().layout, height: 280 }}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: "100%" }}
              />
            ) : (
              <div style={{ height: 280 }} />
            )}
          </div>

          <SectionHeading
            title="By Origin — YoY"
            subtitle={`${formatMonth(filters.period.end.ano, filters.period.end.mes)} vs ${formatMonth(
              filters.period.end.ano - 1,
              filters.period.end.mes,
            )}`}
            loading={yoyPaisesLoading}
          />
          <YoYTable
            rows={yoyPaisesPinned}
            loading={yoyPaisesLoading}
            unitLabel="thousand m³"
            anchorAno={filters.period.end.ano}
            anchorMes={filters.period.end.mes}
            prevMonthByEntity={prevMonthByCountry}
            orderOverride={ORIGIN_ORDER}
            colorMap={ORIGIN_COLOR_BY_LABEL}
          />

          <div style={{ height: 8 }} />

          <SectionHeading
            title="By Importer (Brazil)"
            subtitle="Top 6 importer groups, mil m³"
            loading={importersLoading}
          />
          {/* Publication-lag notice — ANP Desembaraços (the only importer-level
              source, since it carries CNPJ) publishes later than ComexStat,
              which drives the period selector. When the trailing month is not
              yet in ANP we say so; we never plot the missing month as a zero. */}
          {importersMonthPending && importersLatestMonth && (
            <div
              style={{
                margin: "0 16px 8px",
                padding: "8px 12px",
                background: "#fff7ed",
                border: "1px solid #ffd9b3",
                borderRadius: 10,
                fontSize: 11,
                color: "#9a4d00",
                fontFamily: "Arial",
              }}
            >
              Importers data through {formatMonth(importersLatestMonth.ano, importersLatestMonth.mes)} —{" "}
              {formatMonth(filters.period.end.ano, filters.period.end.mes)} not yet published by ANP Desembaraços.
            </div>
          )}
          <div style={{ padding: "0 8px 8px" }}>
            {importersTraces.length > 0 ? (
              <Plot
                data={importersTraces}
                layout={importersLayout}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: "100%" }}
              />
            ) : !importersLoading ? (
              <div
                style={{
                  margin: "0 16px",
                  padding: "24px 16px",
                  textAlign: "center",
                  background: "#fafafa",
                  border: "1px dashed #ddd",
                  borderRadius: 12,
                  fontFamily: "Arial",
                  color: "#888",
                  fontSize: 12,
                }}
              >
                Importer-level data is processing — expected after the next ETL run.
              </div>
            ) : (
              <div style={{ height: 280 }} />
            )}
          </div>

          {importersData.length > 0 && yoyImportersTop6Data.length > 0 && (
            <>
              <SectionHeading
                title="By Importer — YoY"
                subtitle={`${formatMonth(importerAnchor.ano, importerAnchor.mes)} vs ${formatMonth(
                  importerAnchor.ano - 1,
                  importerAnchor.mes,
                )}`}
                loading={yoyImportersLoading}
              />
              <YoYTable
                rows={yoyImportersTop6Data}
                loading={yoyImportersLoading}
                unitLabel="mil m³"
                anchorAno={importerAnchor.ano}
                anchorMes={importerAnchor.mes}
                prevMonthByEntity={prevMonthByImporter}
                orderOverride={importersTop6Entities}
                colorMap={importersTop6ColorMap}
              />
            </>
          )}

          <SectionHeading
            title="Import Price Summary"
            subtitle="Top-2 origins by volume + weighted Others — USD/ton"
            loading={importsUnitPriceLoading}
          />
          <PriceSummaryTable
            rows={importsPriceSummary}
            unitLabel="USD/ton"
            loading={importsUnitPriceLoading}
          />

          <div
            style={{
              padding: "0 16px 16px",
              fontSize: 10,
              color: "#aaa",
              fontStyle: "italic",
              fontFamily: "Arial",
            }}
          >
            Source: ANP Desembaraços (volumes), MDIC Comex (prices). &ldquo;Gulf of Mexico&rdquo; ≈ Estados Unidos (proxy).
          </div>
        </div>
      )}

      {/* ── EXPORTS TAB ────────────────────────────────────────────────────── */}
      {filters.tab === "exports" && (
        <div style={{ paddingTop: 4 }}>
          <SectionHeading
            title="By Destination Country"
            subtitle={`Crude oil exports, ${exportsUnit}`}
            loading={exportsPaisesLoading}
          />
          <div style={{ padding: "0 8px 8px" }}>
            {exportsPaisesTraces.length > 0 ? (
              <Plot
                data={exportsPaisesTraces}
                layout={exportsPaisesLayout}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: "100%" }}
              />
            ) : !exportsPaisesLoading ? (
              <Plot
                data={emptyPlot().data}
                layout={{ ...emptyPlot().layout, height: 280 }}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: "100%" }}
              />
            ) : (
              <div style={{ height: 280 }} />
            )}
          </div>

          {yoyExportsData.length > 0 && (
            <>
              <SectionHeading
                title="By Destination — YoY"
                subtitle={`${formatMonth(filters.period.end.ano, filters.period.end.mes)} vs ${formatMonth(
                  filters.period.end.ano - 1,
                  filters.period.end.mes,
                )}`}
                loading={yoyExportsLoading}
              />
              <YoYTable
                rows={yoyExportsData}
                loading={yoyExportsLoading}
                unitLabel={exportsUnit}
                anchorAno={filters.period.end.ano}
                anchorMes={filters.period.end.mes}
                prevMonthByEntity={prevMonthByExportsCountry}
                colorMap={exportsColorMap}
              />
            </>
          )}

          <SectionHeading
            title="Export Price Summary"
            subtitle="Top destinations, USD/bbl"
            loading={exportsUnitPriceLoading}
          />
          <PriceSummaryTable
            rows={exportsPriceSummaryColored}
            unitLabel="USD/bbl"
            loading={exportsUnitPriceLoading}
          />

          <div
            style={{
              padding: "0 16px 16px",
              fontSize: 10,
              color: "#aaa",
              fontStyle: "italic",
              fontFamily: "Arial",
            }}
          >
            Source: MDIC Comex — monthly customs-declared exports by destination
            (NCM 27090010; by-country volume in thousand tonnes as declared to
            customs; unit price 1 m³ = 6.2898 bbl).
          </div>
        </div>
      )}
    </div>
  );
}
