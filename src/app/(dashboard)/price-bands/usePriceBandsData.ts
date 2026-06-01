"use client";

// ─── usePriceBandsData — single brain for the /price-bands dual-view ─────────
//
// Both desktop/View.tsx and mobile/View.tsx consume this hook exclusively.
// Neither View calls Supabase directly or derives data independently.
//
// Contract (same shape as the canonical template):
//   { rows, loading, error, filters, setFilters, derived }
//
// `derived` carries pre-computed chart data and current-value snapshots so
// both Views get them from the same calculation.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Annotations, Layout, PlotData } from "plotly.js";

import { getSupabaseClient } from "@/lib/supabaseClient";
import { rpcGetPriceBandsData, type PriceBandsRow } from "@/lib/rpc";

// ─── Re-export the row type so Views can import from one place ────────────────

export type { PriceBandsRow };

// ─── Constants ────────────────────────────────────────────────────────────────

export const SUBSIDY_CUTOFF = "2026-03-12";
export const DEFAULT_START  = "2023-06-01";

// Fixed/locked Gasoline subsidy reference. Unlike the Diesel `*_w_subsidy`
// columns (which come from DB triggers and ANP daily reference prices), this
// is a manually-maintained constant — NOT auto-calculated from ANP. The
// Gasoline "Petrobras Price w/ subsidy" line is synthesized client-side at
// fetch time from these values. To change it, edit the constant here (this is
// the supported way to change it).
export const GAS_PETRO_SUBSIDY_PRICE = 3.05;          // BRL/L
export const GAS_PETRO_SUBSIDY_START = "2026-05-29";  // ISO date

// ─── YTD subsidy→base field mapping (YTD chart only) ──────────────────────────
//
// Maps each "w/ subsidy" series field to its non-subsidy base field. Used ONLY
// by buildYtdChart to blend the pre-subsidy base price into the w/ subsidy line
// until the subsidy takes effect (see effectiveYtdValue). The main Price Bands
// chart does NOT use this — there the w/ subsidy line still only appears from
// its subsidy effective date.
const YTD_SUBSIDY_BASE_FIELD: Partial<Record<keyof PriceBandsRow, keyof PriceBandsRow>> = {
  petrobras_price_w_subsidy:   "petrobras_price",
  bba_import_parity_w_subsidy: "bba_import_parity",
};

// Resolves the subsidy start date for a (field, product) pair. The same field
// `petrobras_price_w_subsidy` starts on a DIFFERENT date per product (Gasoline
// vs Diesel), so the row's product is needed to disambiguate. Returns null for
// non-subsidy fields (which are never base-blended anyway).
function subsidyStartDate(field: keyof PriceBandsRow, product: PriceBandsProduct): string | null {
  if (field === "petrobras_price_w_subsidy") return product === "Gasoline" ? GAS_PETRO_SUBSIDY_START : SUBSIDY_CUTOFF;
  if (field === "bba_import_parity_w_subsidy") return SUBSIDY_CUTOFF; // diesel only
  return null;
}

// YTD average blends the pre-subsidy base price into the w/ subsidy line until
// the subsidy takes effect, so the line starts on Jan 1 like the others.
// Returns r[field] when present; otherwise, for a subsidy field with a mapped
// base, falls back to the base field's value — but ONLY within the subsidy's
// effective year or later. For years entirely before the subsidy existed
// (2025, 2024), the fallback is suppressed (returns null) so the w/ subsidy
// series stays empty and renders no line / legend entry / year-end label.
function effectiveYtdValue(r: PriceBandsRow, field: keyof PriceBandsRow): number | null {
  const own = r[field] as number | null;
  if (own != null) return own;
  const baseField = YTD_SUBSIDY_BASE_FIELD[field];
  if (!baseField) return null;
  const start = subsidyStartDate(field, r.product as PriceBandsProduct);
  // No subsidy ever, or the row predates the subsidy's effective year → no blend.
  if (start == null || r.date < `${start.slice(0, 4)}-01-01`) return null;
  return (r[baseField] as number | null) ?? null;
}

// ─── Colors (single source of truth for both Views) ──────────────────────────

export const COLOR_IMPORT = "#E8611A";  // orange — Import Parity
export const COLOR_EXPORT = "#1a1a1a";  // black  — Export Parity
export const COLOR_PETRO  = "#4ECDC4";  // teal   — Petrobras Price
export const COLOR_SUB    = "#aaa";     // grey   — subsidy variant lines

// ─── Series definitions (shared between both Views) ──────────────────────────

export interface SeriesDef {
  label: string;
  field: keyof PriceBandsRow;
  color: string;
  dash: "solid" | "dash";
  shape: "linear" | "hv";
  width: number;
}

export const GAS_SERIES: SeriesDef[] = [
  { label: "Import Parity",  field: "bba_import_parity", color: COLOR_IMPORT, dash: "solid", shape: "linear", width: 1.5 },
  { label: "Export Parity",  field: "bba_export_parity", color: COLOR_EXPORT, dash: "solid", shape: "linear", width: 1.5 },
  { label: "Petrobras Price", field: "petrobras_price",   color: COLOR_PETRO,  dash: "solid", shape: "hv",     width: 2   },
  { label: "Petrobras Price w/ subsidy", field: "petrobras_price_w_subsidy", color: COLOR_PETRO, dash: "dash", shape: "hv", width: 2 },
];

export const DSL_SERIES: SeriesDef[] = [
  { label: "BBA - Import Parity",            field: "bba_import_parity",           color: COLOR_IMPORT, dash: "solid", shape: "linear", width: 1.5 },
  { label: "BBA - Import Parity w/ subsidy", field: "bba_import_parity_w_subsidy", color: COLOR_IMPORT, dash: "dash",  shape: "linear", width: 1.5 },
  { label: "BBA - Export Parity",            field: "bba_export_parity",           color: COLOR_EXPORT, dash: "solid", shape: "linear", width: 1.5 },
  { label: "Petrobras Price",                field: "petrobras_price",             color: COLOR_PETRO,  dash: "solid", shape: "hv",     width: 2   },
  { label: "Petrobras Price w/ subsidy",     field: "petrobras_price_w_subsidy",   color: COLOR_PETRO,  dash: "dash",  shape: "hv",     width: 2   },
];

// ─── Filters ─────────────────────────────────────────────────────────────────

export type PriceBandsProduct = "Gasoline" | "Diesel";

export interface PriceBandsFilters {
  /** Active product tab — used by mobile (desktop shows both side by side). */
  product: PriceBandsProduct;
  /** Slider range expressed as [startIndex, endIndex] into `datas` array. */
  sliderRange: [number, number];
}

// ─── Derived current-value snapshot (used by both Views for badges / cards) ──

export interface PriceBandsCurrentValues {
  petrobrasPrice: number | null;
  importParity: number | null;
  exportParity: number | null;
  importParitySubsidy: number | null;
  petrobrasSubsidy: number | null;
  pctVsIpp: number | null;
  pctVsEpp: number | null;
  pctVsIppSubsidy: number | null;
  pctPetroSubVsIppSub: number | null;
  lastDate: string | null;
}

// ─── Hook return type ─────────────────────────────────────────────────────────

export interface UsePriceBandsData {
  rows: PriceBandsRow[];
  loading: boolean;
  error: Error | null;
  filters: PriceBandsFilters;
  setFilters: (next: Partial<PriceBandsFilters>) => void;
  /** Unique sorted date strings across all rows. */
  datas: string[];
  /** Computed xMin/xMax from slider position. */
  xMin: string | null;
  xMax: string | null;
  /** Rows filtered to gasoline / diesel respectively. */
  gasolineRows: PriceBandsRow[];
  dieselRows: PriceBandsRow[];
  /** Pre-built chart data for the Price Bands section. */
  gasolineChart: { data: PlotData[]; layout: Partial<Layout> };
  dieselChart:   { data: PlotData[]; layout: Partial<Layout> };
  /** Pre-built chart data for the YTD Average section. */
  gasolineYtd: { data: PlotData[]; layout: Partial<Layout> };
  dieselYtd:   { data: PlotData[]; layout: Partial<Layout> };
  /** Available years for YTD toggle. */
  ytdYears: number[];
  ytdYear: number;
  setYtdYear: (y: number) => void;
  /** Latest-point badge values per product. */
  currentValues: {
    Gasoline: PriceBandsCurrentValues;
    Diesel:   PriceBandsCurrentValues;
  };
  resetFilters: () => void;
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

export function fmtPct(ptbr: number | null, ref: number | null): string {
  if (ptbr == null || ref == null || ref === 0) return "—";
  const pct = (ptbr / ref - 1) * 100;
  return (pct >= 0 ? "+" : "") + Math.round(pct) + "%";
}

export function fmtDateLabel(d: string): string {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const m = parseInt(d.slice(5, 7), 10);
  const day = parseInt(d.slice(8, 10), 10);
  return `${months[m - 1]} ${day}, ${d.slice(0, 4)}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function generateDailyDates(from: string, to: string): string[] {
  const dates: string[] = [];
  const d = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  while (d <= end) {
    dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

// ─── Anti-collision for end-of-line annotations ───────────────────────────────

function deconflictAnnotations(
  annotations: Partial<Annotations>[],
  allDataY: number[],
  chartHeight = 380,
  marginT = 20,
  marginB = 110,
  fontPx = 15,
): Partial<Annotations>[] {
  if (annotations.length <= 1) return annotations;

  const yMin = Math.min(...allDataY);
  const yMax = Math.max(...allDataY);
  const yRange = yMax - yMin;
  if (yRange === 0) return annotations;

  const pxPerUnit = (chartHeight - marginT - marginB) / (yRange * 1.10);
  const minGapUnits = fontPx / pxPerUnit;

  const items = annotations.map((a, i) => ({ i, y: a.y as number }));
  items.sort((a, b) => a.y - b.y);

  for (let iter = 0; iter < 50; iter++) {
    let changed = false;
    for (let j = 1; j < items.length; j++) {
      const gap = items[j].y - items[j - 1].y;
      if (gap < minGapUnits) {
        const shift = (minGapUnits - gap) / 2;
        items[j - 1].y -= shift;
        items[j].y += shift;
        changed = true;
      }
    }
    if (!changed) break;
  }

  const result = [...annotations];
  for (const { i, y } of items) {
    result[i] = { ...annotations[i], y };
  }
  return result;
}

// ─── Shared layout base ───────────────────────────────────────────────────────

const COMMON_LAYOUT_BASE: Partial<Layout> = {
  paper_bgcolor: "white",
  plot_bgcolor:  "white",
  font: { family: "Arial", size: 12, color: "#000000" },
  hovermode: "x unified",
  hoverlabel: {
    bgcolor: "rgba(255,255,255,0.95)",
    bordercolor: "rgba(180,180,180,0.5)",
    font: { family: "Arial", color: "#1a1a1a", size: 12 },
    namelength: -1,
  },
};

// ─── Chart builders (shared, called by both Views via the hook) ───────────────

export function buildPriceBandsChart(
  rows: PriceBandsRow[],
  product: PriceBandsProduct,
  xMin: string | null,
  xMax: string | null,
): { data: PlotData[]; layout: Partial<Layout> } {
  const seriesDefs = product === "Gasoline" ? GAS_SERIES : DSL_SERIES;

  const filtered = rows
    .filter((r) => r.product === product)
    .filter((r) => (!xMin || r.date >= xMin) && (!xMax || r.date <= xMax))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (filtered.length === 0) {
    return { data: [], layout: { ...COMMON_LAYOUT_BASE, height: 380, annotations: [{ text: "No data for the selected period.", xref: "paper", yref: "paper", showarrow: false, font: { size: 13, family: "Arial", color: "#888" } }] } };
  }

  const dates = filtered.map((r) => r.date);

  const pctCustomdata = filtered.map((r) => {
    const ptbr = r.petrobras_price as number | null;
    const ipp  = r.bba_import_parity as number | null;
    const epp  = r.bba_export_parity as number | null;
    const ippStr = fmtPct(ptbr, ipp);
    const eppStr = fmtPct(ptbr, epp);

    if (product === "Diesel") {
      const sub = r.bba_import_parity_w_subsidy as number | null;
      const subsidyLine =
        r.date >= SUBSIDY_CUTOFF && sub != null
          ? `, vs. IPP w/ sub: ${fmtPct(ptbr, sub)}`
          : "";
      return [ippStr, eppStr, subsidyLine];
    }
    return [ippStr, eppStr];
  });

  const petrobrasTemplate =
    product === "Diesel"
      ? `%{fullData.name}: %{y:.2f} · vs. IPP: %{customdata[0]}, vs. EPP: %{customdata[1]}%{customdata[2]}<extra></extra>`
      : `%{fullData.name}: %{y:.2f} · vs. IPP: %{customdata[0]}, vs. EPP: %{customdata[1]}<extra></extra>`;

  const pctCustomdataSub: string[] | null = product === "Diesel"
    ? filtered.map((r) => {
        const ptbrSub = r.petrobras_price_w_subsidy as number | null;
        const sub     = r.bba_import_parity_w_subsidy as number | null;
        if (r.date < SUBSIDY_CUTOFF || ptbrSub == null || sub == null) return "—";
        return fmtPct(ptbrSub, sub);
      })
    : null;

  const petrobrasSubTemplate = `%{fullData.name}: %{y:.2f} · vs. IPP w/ sub: %{customdata}<extra></extra>`;

  const traces: PlotData[] = seriesDefs.map((s) => {
    const isPetrobras = s.field === "petrobras_price";
    const isPetroSub  = s.field === "petrobras_price_w_subsidy";
    return {
      type: "scatter",
      mode: "lines",
      name: s.label,
      x: dates,
      y: filtered.map((r) => r[s.field] as number | null),
      line: { color: s.color, dash: s.dash, shape: s.shape, width: s.width },
      ...(isPetrobras
        ? { customdata: pctCustomdata, hovertemplate: petrobrasTemplate }
        : isPetroSub && pctCustomdataSub
        ? { customdata: pctCustomdataSub, hovertemplate: petrobrasSubTemplate }
        : { hovertemplate: `%{fullData.name}: %{y:.2f}<extra></extra>` }),
    } as unknown as PlotData;
  });

  const allDataY: number[] = seriesDefs.flatMap((s) =>
    filtered.map((r) => r[s.field] as number | null).filter((v): v is number => v != null)
  );

  const rawAnnotations: Partial<Annotations>[] = seriesDefs.flatMap((s) => {
    for (let i = filtered.length - 1; i >= 0; i--) {
      const val = filtered[i][s.field] as number | null;
      if (val != null) {
        return [{ x: filtered[i].date, y: val, xanchor: "left" as const, yanchor: "middle" as const, text: val.toFixed(2), showarrow: false, font: { size: 11, color: s.color, family: "Arial" }, xref: "x" as const, yref: "y" as const, xshift: 6 }];
      }
    }
    return [];
  });

  const annotations = deconflictAnnotations(rawAnnotations, allDataY);
  const xRangeEnd = addDays(filtered[filtered.length - 1].date, 45);

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT_BASE,
      xaxis: { type: "date", tickformat: "%b-%y", hoverformat: "%b %d, %Y", tickangle: -90, range: [filtered[0].date, xRangeEnd], showgrid: false, showline: true, linecolor: "#000000", linewidth: 1, showspikes: true, spikemode: "across", spikedash: "solid", spikecolor: "#555555", spikethickness: 1 },
      yaxis: { showgrid: false, showline: true, linecolor: "#000000", linewidth: 1, tickformat: ".2f", title: { text: "BRL/litro", font: { family: "Arial", size: 11, color: "#555" } }, automargin: true },
      legend: { orientation: "h", y: -0.3, x: 0.5, xanchor: "center" },
      height: 380,
      margin: { t: 20, b: 110, l: 65, r: 55 },
      annotations,
    },
  };
}

export function buildYtdChart(
  rows: PriceBandsRow[],
  product: PriceBandsProduct,
  year: number,
): { data: PlotData[]; layout: Partial<Layout> } {
  const seriesDefs = product === "Gasoline" ? GAS_SERIES : DSL_SERIES;

  const yearRows = rows
    .filter((r) => r.product === product && r.date.startsWith(`${year}-`))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (yearRows.length === 0) {
    return { data: [], layout: { ...COMMON_LAYOUT_BASE, height: 360 } };
  }

  const yearEnd = `${year}-12-31`;

  const traces: PlotData[] = [];
  // Union of every plotted y-value (actual cumulative averages + projections)
  // across all series — feeds deconflictAnnotations' px-per-unit mapping so the
  // year-end label spacing matches the chart's real y-range.
  const allDataY: number[] = [];

  for (const s of seriesDefs) {
    let cumSum = 0;
    let count  = 0;
    const actualDates: string[] = [];
    const actualAvgs:  number[] = [];
    // Track this series' own last non-null value/date — the subsidy series
    // (bba_import_parity_w_subsidy / petrobras_price_w_subsidy) trail off with
    // NULLs because the DB trigger only fills them once matching
    // anp_subsidy_commercialization data exists, which lags price_bands.
    let lastActualValue: number | null = null;
    let lastActualDate:  string | null = null;

    for (const r of yearRows) {
      const val = effectiveYtdValue(r, s.field);
      if (val == null) continue;
      cumSum += val;
      count++;
      actualDates.push(r.date);
      actualAvgs.push(cumSum / count);
      lastActualValue = val;
      lastActualDate  = r.date;
    }

    if (actualDates.length === 0) continue;

    allDataY.push(...actualAvgs);

    const isPetrobras = s.field === "petrobras_price";
    let ytdCustomdata: [string, string][] | undefined;
    if (isPetrobras) {
      let cumIpp = 0, cumEpp = 0, cntIpp = 0, cntEpp = 0;
      ytdCustomdata = yearRows.map((r) => {
        const ipp = r.bba_import_parity as number | null;
        const epp = r.bba_export_parity as number | null;
        if (ipp != null) { cumIpp += ipp; cntIpp++; }
        if (epp != null) { cumEpp += epp; cntEpp++; }
        return [cntIpp > 0 ? cumIpp / cntIpp : null, cntEpp > 0 ? cumEpp / cntEpp : null];
      }).filter((_, i) => (yearRows[i][s.field] as number | null) != null)
        .map((pair, i) => {
          const avgPtbr = actualAvgs[i];
          return [fmtPct(avgPtbr, pair[0]), fmtPct(avgPtbr, pair[1])] as [string, string];
        });
    }

    traces.push({
      type: "scatter",
      mode: "lines",
      name: s.label,
      x: actualDates,
      y: actualAvgs,
      line: { color: s.color, dash: s.dash === "dash" ? "dash" : "solid", shape: "linear", width: s.width },
      ...(isPetrobras && ytdCustomdata
        ? {
            customdata: ytdCustomdata,
            hovertemplate: `%{fullData.name}: %{y:.2f} · vs. IPP avg: %{customdata[0]}, vs. EPP avg: %{customdata[1]}<extra></extra>`,
          }
        : { hovertemplate: `%{fullData.name}: %{y:.2f}<extra></extra>` }),
    } as unknown as PlotData);

    // Project from THIS series' own last non-null point, holding its last
    // actual price constant — not the global lastRow, whose subsidy fields may
    // be NULL. projDates starts the day after this series ended, so there is no
    // gap between the real line and its dotted projection.
    const seriesProjDates = generateDailyDates(addDays(lastActualDate!, 1), yearEnd);
    if (seriesProjDates.length > 0 && lastActualValue != null) {
      const lastPrice = lastActualValue;

      let projSum   = cumSum;
      let projCount = count;
      const projX: string[] = [];
      const projY: number[] = [];

      for (const d of seriesProjDates) {
        projSum   += lastPrice;
        projCount += 1;
        projX.push(d);
        projY.push(projSum / projCount);
      }

      allDataY.push(...projY);

      traces.push({
        type: "scatter",
        mode: "lines",
        name: s.label + " (proj.)",
        x: projX,
        y: projY,
        line: { color: s.color, dash: "dot", shape: "linear", width: s.width },
        showlegend: false,
        hovertemplate: `%{fullData.name}: %{y:.2f}<extra></extra>`,
      } as unknown as PlotData);
    }
  }

  const rawAnnotations: Partial<Annotations>[] = seriesDefs.flatMap((s) => {
    const yearRowsForS = yearRows.filter((r) => effectiveYtdValue(r, s.field) != null);
    if (yearRowsForS.length === 0) return [];
    // Use this series' own last non-null value/date for the year-end label, so
    // the subsidy lines (which trail off with NULLs) still get a projection.
    // effectiveYtdValue blends in the base price before the subsidy date so the
    // year-end label matches the blended line.
    const lastRowForS = yearRowsForS[yearRowsForS.length - 1];
    const lastPrice   = effectiveYtdValue(lastRowForS, s.field) as number;
    const cumSum = yearRowsForS.reduce((acc, r) => acc + (effectiveYtdValue(r, s.field) as number), 0);
    const count  = yearRowsForS.length;
    const remainingDays = generateDailyDates(addDays(lastRowForS.date, 1), yearEnd).length;
    const finalAvg = (cumSum + remainingDays * lastPrice) / (count + remainingDays);
    return [{
      x: yearEnd,
      y: finalAvg,
      xanchor: "left" as const,
      yanchor: "middle" as const,
      text: finalAvg.toFixed(2),
      showarrow: false,
      font: { size: 11, color: s.color, family: "Arial" },
      xref: "x" as const,
      yref: "y" as const,
      xshift: 6,
    }];
  });

  // Match the YTD layout geometry below (height 360, margin t:20 / b:100) so the
  // pixel math lines up; without this the year-end labels collide when two
  // series end near the same value (e.g. Diesel "4.02" vs "3.91").
  const annotations = deconflictAnnotations(rawAnnotations, allDataY, 360, 20, 100);

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT_BASE,
      xaxis: { type: "date", tickformat: "%b", hoverformat: "%b %d, %Y", dtick: "M1", tickangle: -90, range: [`${year}-01-01`, addDays(yearEnd, 30)], showgrid: false, showline: true, linecolor: "#000000", linewidth: 1, showspikes: true, spikemode: "across", spikecolor: "#555555", spikethickness: 1, spikedash: "solid" },
      yaxis: { showgrid: false, showline: true, linecolor: "#000000", linewidth: 1, tickformat: ".2f", title: { text: "BRL/litro", font: { family: "Arial", size: 11, color: "#555" } }, automargin: true },
      legend: { orientation: "h", y: -0.28, x: 0.5, xanchor: "center" },
      height: 360,
      margin: { t: 20, b: 100, l: 65, r: 55 },
      annotations,
    },
  };
}

// ─── Current-values snapshot builder ─────────────────────────────────────────

function buildCurrentValues(
  rows: PriceBandsRow[],
  xMax: string | null,
): PriceBandsCurrentValues {
  const scoped = xMax ? rows.filter((r) => r.date <= xMax) : rows;
  const sorted = [...scoped].sort((a, b) => b.date.localeCompare(a.date));

  const last = sorted.find(
    (r) => r.petrobras_price != null && r.bba_import_parity != null && r.bba_export_parity != null,
  );
  const lastSubsidy = sorted.find(
    (r) => r.date >= SUBSIDY_CUTOFF && r.petrobras_price != null && r.bba_import_parity_w_subsidy != null,
  );
  const lastSubPetro = sorted.find(
    (r) => r.date >= SUBSIDY_CUTOFF && r.petrobras_price_w_subsidy != null && r.bba_import_parity_w_subsidy != null,
  );

  return {
    petrobrasPrice:          last?.petrobras_price ?? null,
    importParity:            last?.bba_import_parity ?? null,
    exportParity:            last?.bba_export_parity ?? null,
    importParitySubsidy:     lastSubsidy?.bba_import_parity_w_subsidy ?? null,
    petrobrasSubsidy:        lastSubPetro?.petrobras_price_w_subsidy ?? null,
    pctVsIpp:   last ? ((last.petrobras_price! / last.bba_import_parity!) - 1) * 100 : null,
    pctVsEpp:   last ? ((last.petrobras_price! / last.bba_export_parity!) - 1) * 100 : null,
    pctVsIppSubsidy: lastSubsidy ? ((lastSubsidy.petrobras_price! / lastSubsidy.bba_import_parity_w_subsidy!) - 1) * 100 : null,
    pctPetroSubVsIppSub: lastSubPetro ? ((lastSubPetro.petrobras_price_w_subsidy! / lastSubPetro.bba_import_parity_w_subsidy!) - 1) * 100 : null,
    lastDate: last?.date ?? null,
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

const currentYear = new Date().getFullYear();
const YTD_YEARS   = [currentYear, currentYear - 1, currentYear - 2];

const DEFAULT_FILTERS: PriceBandsFilters = {
  product:     "Diesel",
  sliderRange: [0, 0],
};

export function usePriceBandsData(): UsePriceBandsData {
  const supabase = getSupabaseClient();

  const [rows,    setRows]    = useState<PriceBandsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<Error | null>(null);

  const [filters, setFiltersState] = useState<PriceBandsFilters>(DEFAULT_FILTERS);
  const [ytdYear, setYtdYear]      = useState(currentYear);

  const fetchedRef = useRef(false);

  // Initial fetch — price_bands is small, no filters needed at fetch time.
  useEffect(() => {
    if (!supabase || fetchedRef.current) return;
    fetchedRef.current = true;
    setLoading(true);
    rpcGetPriceBandsData(supabase)
      .then((data) => {
        // Synthesize the fixed Gasoline "Petrobras Price w/ subsidy" series.
        // Gasoline's subsidy is a locked constant (GAS_PETRO_SUBSIDY_PRICE)
        // starting GAS_PETRO_SUBSIDY_START, NOT real DB data. Map to new
        // objects (no in-place mutation); leave Diesel rows untouched — their
        // petrobras_price_w_subsidy is real trigger-filled DB data.
        const synthesized = data.map((r) =>
          r.product === "Gasoline"
            ? {
                ...r,
                petrobras_price_w_subsidy:
                  r.date >= GAS_PETRO_SUBSIDY_START ? GAS_PETRO_SUBSIDY_PRICE : null,
              }
            : r,
        );
        setRows(synthesized);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
  }, [supabase]);

  // Stable partial-merge setter.
  const setFilters = useCallback((next: Partial<PriceBandsFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...next }));
  }, []);

  // Unique sorted dates across all rows.
  const datas = useMemo(() => {
    const seen = new Set<string>();
    for (const r of rows) seen.add(r.date);
    return Array.from(seen).sort();
  }, [rows]);

  // Initialise slider range once datas are known.
  useEffect(() => {
    if (datas.length === 0) return;
    const startIdx = Math.max(0, datas.findIndex((d) => d >= DEFAULT_START));
    setFilters({ sliderRange: [startIdx, datas.length - 1] });
  }, [datas.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const xMin = datas[filters.sliderRange[0]] ?? null;
  const xMax = datas[filters.sliderRange[1]] ?? null;

  const resetFilters = useCallback(() => {
    if (datas.length === 0) return;
    const startIdx = Math.max(0, datas.findIndex((d) => d >= DEFAULT_START));
    setFilters({ sliderRange: [startIdx, datas.length - 1] });
  }, [datas, setFilters]);

  const gasolineRows = useMemo(() => rows.filter((r) => r.product === "Gasoline"), [rows]);
  const dieselRows   = useMemo(() => rows.filter((r) => r.product === "Diesel"),   [rows]);

  const gasolineChart = useMemo(() => buildPriceBandsChart(rows, "Gasoline", xMin, xMax), [rows, xMin, xMax]);
  const dieselChart   = useMemo(() => buildPriceBandsChart(rows, "Diesel",   xMin, xMax), [rows, xMin, xMax]);
  const gasolineYtd   = useMemo(() => buildYtdChart(rows, "Gasoline", ytdYear), [rows, ytdYear]);
  const dieselYtd     = useMemo(() => buildYtdChart(rows, "Diesel",   ytdYear), [rows, ytdYear]);

  const currentValues = useMemo(() => ({
    Gasoline: buildCurrentValues(gasolineRows, xMax),
    Diesel:   buildCurrentValues(dieselRows,   xMax),
  }), [gasolineRows, dieselRows, xMax]);

  return {
    rows, loading, error,
    filters, setFilters,
    datas, xMin, xMax,
    gasolineRows, dieselRows,
    gasolineChart, dieselChart,
    gasolineYtd, dieselYtd,
    ytdYears: YTD_YEARS, ytdYear, setYtdYear,
    currentValues,
    resetFilters,
  };
}
