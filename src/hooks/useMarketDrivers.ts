"use client";

// ─── useMarketDrivers — live market-data catalog for dynamic Stock Guide drivers ─
//
// A Stock Guide driver (see `StockGuideDriver`) can be:
//   • STATIC  — admin types a `current_value`; `source` is null/''. Its "today"
//               value is just `driver.current_value`.
//   • DYNAMIC — `source` is a key in MARKET_DRIVER_CATALOG below. Its "today"
//               value is computed LIVE in the browser from the Yahoo proxy
//               (Brent forward curve + realized history + spot, USD/BRL spot +
//               realized history) and is exposed here as `values[source]`.
//
// This hook fetches the underlying market data ONCE on mount and computes the
// catalog. It is reused by BOTH the dashboard brain (`useStockGuideData`) and the
// admin-panel Drivers editor, so the same numbers drive the sensitivity-table
// highlight AND the admin "Computed: …" preview.
//
// All computations use the REAL current date (`new Date()` in the browser) to
// split each year's 12 months into past (realized monthly average) / current
// (month-to-date, falls back to spot) / future (forward curve, falls back to
// spot). Everything is null-safe: when the inputs are missing, the metric value
// is null and the UI renders "—".
//
// Network: 3 GETs to the existing Yahoo proxy (CORS-safe), in parallel on mount:
//   • GET /api/stocks/futures-curve            → monthly Brent forward curve
//   • GET /api/stocks/history?ticker=BZ=F…     → Brent realized daily history
//   • GET /api/stocks/history?ticker=USDBRL=X… → USD/BRL realized daily history
//   • GET /api/stocks/quote?tickers=BZ=F,USDBRL=X → spot fallbacks
// No polling — these are slow-moving macro assumptions and the proxy is per-IP
// rate-limited.

import { useEffect, useRef, useState } from "react";
import type { StockGuideDriver } from "@/types/stockGuide";

// ─── Catalog ──────────────────────────────────────────────────────────────────

/** A pre-defined market metric a dynamic driver can bind to via `source`. */
export interface DriverCatalogEntry {
  /** Stable key stored in `stock_guide_drivers.source`. */
  key: string;
  /** Human label shown in the admin Source picker + the dynamic badge. */
  label: string;
  /** Display unit (auto-filled into the driver's `unit` when bound). */
  unit: string;
}

/**
 * The 6 supported dynamic metrics (Brent + FX, three forward years each). Adding
 * a metric here makes it selectable in the admin Source picker and computed below
 * in `computeCatalogValues`. The 2028 keys were added 2026-06-11 for the elastic
 * multi-year sensitivity sliders. With the extended forward curve (now through
 * Dec of current-year + 3), `avg_brent_2028` is curve-based — see `avgBrentForYear`
 * for the edge-aware fallbacks (flat-extrapolate the curve tail rather than snap
 * to spot). `avg_fx_2028` stays spot-flat (the proxy has no FX forward).
 */
export const MARKET_DRIVER_CATALOG: DriverCatalogEntry[] = [
  { key: "avg_brent_2026", label: "Avg Brent 2026", unit: "USD/bbl" },
  { key: "avg_brent_2027", label: "Avg Brent 2027", unit: "USD/bbl" },
  { key: "avg_brent_2028", label: "Avg Brent 2028", unit: "USD/bbl" },
  { key: "avg_fx_2026", label: "Avg FX (USD/BRL) 2026", unit: "BRL/USD" },
  { key: "avg_fx_2027", label: "Avg FX (USD/BRL) 2027", unit: "BRL/USD" },
  { key: "avg_fx_2028", label: "Avg FX (USD/BRL) 2028", unit: "BRL/USD" },
];

/** Quick lookup: catalog key → entry. */
export const MARKET_DRIVER_CATALOG_BY_KEY: Record<string, DriverCatalogEntry> =
  Object.fromEntries(MARKET_DRIVER_CATALOG.map((e) => [e.key, e]));

/** True when `source` references a known catalog metric (→ dynamic driver). */
export function isDynamicSource(source: string | null | undefined): boolean {
  return source != null && source !== "" && source in MARKET_DRIVER_CATALOG_BY_KEY;
}

/**
 * Resolve a driver's effective "today" value:
 *   • dynamic (source is a catalog key) → the live computed `marketValues[source]`
 *     (may be null if the market data is missing);
 *   • static (no/empty/unknown source)  → the admin-typed `current_value`.
 * Reused by both the dashboard highlight and the admin preview.
 */
export function resolveDriverValue(
  driver: Pick<StockGuideDriver, "current_value"> & { source?: string | null },
  marketValues: Record<string, number | null>,
): number | null {
  const src = driver.source;
  if (isDynamicSource(src)) {
    const v = marketValues[src as string];
    return v != null && Number.isFinite(v) ? v : null;
  }
  return driver.current_value != null && Number.isFinite(driver.current_value)
    ? driver.current_value
    : null;
}

// ─── Raw market-data shapes (from the proxy) ──────────────────────────────────

interface CurveContract {
  /** 0-indexed month (Jan = 0). */
  month: number;
  year: number;
  price: number | null;
}

interface HistoryPoint {
  /** Unix seconds. */
  date: number;
  close: number | null;
}

interface QuotePoint {
  symbol?: string;
  regularMarketPrice?: number;
}

// ─── Pure computation helpers (exported for unit-level reasoning / QA) ─────────

/**
 * Mean of `close` over candles whose UTC date falls in {year, month} (month is
 * 1–12). Returns null if no candle matches or none has a finite close.
 */
export function realizedMonthlyAvg(
  history: HistoryPoint[],
  year: number,
  month: number,
): number | null {
  let sum = 0;
  let n = 0;
  for (const p of history) {
    if (p.close == null || !Number.isFinite(p.close)) continue;
    const d = new Date(p.date * 1000);
    if (d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month) {
      sum += p.close;
      n += 1;
    }
  }
  return n > 0 ? sum / n : null;
}

/**
 * Price of the forward contract with `c.year === year && c.month + 1 === month`
 * (month is 1–12; the curve stores month 0-indexed). Null if absent or non-finite.
 */
export function forwardPrice(
  curve: CurveContract[],
  year: number,
  month: number,
): number | null {
  for (const c of curve) {
    if (c.year === year && c.month + 1 === month) {
      return c.price != null && Number.isFinite(c.price) && c.price > 0
        ? c.price
        : null;
    }
  }
  return null;
}

/** A month index = year*12 + (month0). Monotone key for ordering the curve. */
function monthIndex(year: number, month1: number): number {
  return year * 12 + (month1 - 1);
}

/**
 * The valid (finite, positive) contracts of the curve sorted ascending by
 * (year, month). Used to find the curve's first/last contract and to flat-fill
 * gaps. Returns each as `{ idx, price }` where `idx` is the month index.
 */
function sortedValidCurve(
  curve: CurveContract[],
): { idx: number; price: number }[] {
  const out: { idx: number; price: number }[] = [];
  for (const c of curve) {
    if (c.price != null && Number.isFinite(c.price) && c.price > 0) {
      out.push({ idx: monthIndex(c.year, c.month + 1), price: c.price });
    }
  }
  out.sort((a, b) => a.idx - b.idx);
  return out;
}

/**
 * Resolve a FUTURE month against the forward curve with edge-aware fallbacks.
 * `sorted` is the ascending list of valid contracts (see `sortedValidCurve`);
 * `brentSpot` is the spot fallback. The rules (backwardation-safe):
 *   • month present in the curve            → that contract's price;
 *   • empty curve                           → spot (legacy behavior);
 *   • month BEFORE the first contract        → spot (near-month gap: the curve
 *     starts ~M+2, so M / M+1 don't exist and spot is the best estimate);
 *   • month AFTER the last contract          → the LAST contract's price
 *     (flat-extrapolation off the curve tail — the right answer in
 *     backwardation, where spot systematically overstates the far tenor);
 *   • gap in the MIDDLE of the curve         → the nearest preceding valid
 *     contract (flat carry-forward — simplest equivalent to interpolation and
 *     keeps the function monotone-cheap).
 */
function futureBrentForMonth(
  sorted: { idx: number; price: number }[],
  year: number,
  month1: number,
  brentSpot: number | null,
): number | null {
  if (sorted.length === 0) return brentSpot;
  const target = monthIndex(year, month1);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  // Before the curve starts → near-month gap → spot.
  if (target < first.idx) return brentSpot;
  // After the curve ends → flat-extrapolate the tail (not spot).
  if (target > last.idx) return last.price;
  // Inside the curve span [first.idx, last.idx]: exact match, else carry the
  // nearest preceding valid contract. `chosen` is always set on the first
  // iteration (the first element has idx <= target), so it is never null here.
  let chosen = first.price;
  for (const c of sorted) {
    if (c.idx === target) return c.price;
    if (c.idx < target) chosen = c.price;
    else break;
  }
  return chosen;
}

/** Mean of the non-null values in a 12-element monthly array; null if all null. */
function meanNonNull(values: (number | null)[]): number | null {
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (v != null && Number.isFinite(v)) {
      sum += v;
      n += 1;
    }
  }
  return n > 0 ? sum / n : null;
}

/**
 * Average Brent for a calendar `year` as the mean of its 12 monthly values,
 * each resolved relative to `now`:
 *   • past month    → realized monthly average;
 *   • current month → month-to-date realized average, else spot;
 *   • future month  → forward curve, with EDGE-AWARE fallbacks (see
 *     `futureBrentForMonth`): curve price when present; spot for the near 1–2
 *     months BEFORE the curve starts (it begins ~M+2); the LAST contract's price
 *     (flat-extrapolation) for months BEYOND the curve tail; the nearest preceding
 *     contract for a mid-curve gap.
 *
 * Works for ANY forward year (2026 / 2027 / 2028 …). Since the proxy now extends
 * the Brent curve through Dec of (current year + 3), 2028 is fully curve-based —
 * months past the curve tail flat-extrapolate the last contract instead of
 * snapping to spot, which in backwardation systematically overstated the far
 * tenor. Null only when there is no spot AND no realized/forward data at all.
 */
export function avgBrentForYear(
  year: number,
  now: Date,
  brentHist: HistoryPoint[],
  curve: CurveContract[],
  brentSpot: number | null,
): number | null {
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1; // 1–12
  const sorted = sortedValidCurve(curve);
  const monthly: (number | null)[] = [];
  for (let m = 1; m <= 12; m++) {
    const isPast = year < curYear || (year === curYear && m < curMonth);
    const isCurrent = year === curYear && m === curMonth;
    if (isPast) {
      monthly.push(realizedMonthlyAvg(brentHist, year, m));
    } else if (isCurrent) {
      monthly.push(realizedMonthlyAvg(brentHist, year, m) ?? brentSpot);
    } else {
      // future → edge-aware curve resolution (flat-extrapolate the tail, not spot)
      monthly.push(futureBrentForMonth(sorted, year, m, brentSpot));
    }
  }
  return meanNonNull(monthly);
}

/**
 * Average USD/BRL for a calendar `year` as the mean of its 12 monthly values
 * (SPOT-FLAT approximation — there is no FX forward in the proxy):
 *   • past month            → realized monthly average;
 *   • current/future month  → spot, held flat.
 * For a fully-future year (2027 / 2028) every month → spot, so the mean = spot.
 */
export function avgFxForYear(
  year: number,
  now: Date,
  fxHist: HistoryPoint[],
  fxSpot: number | null,
): number | null {
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1; // 1–12
  const monthly: (number | null)[] = [];
  for (let m = 1; m <= 12; m++) {
    const isPast = year < curYear || (year === curYear && m < curMonth);
    if (isPast) {
      monthly.push(realizedMonthlyAvg(fxHist, year, m));
    } else {
      // current + future → spot held flat
      monthly.push(fxSpot);
    }
  }
  return meanNonNull(monthly);
}

/**
 * Compute the whole catalog from the fetched market data + `now`. Pure — the
 * hook calls it once per fetch; exported so QA can cross-check the math.
 */
export function computeCatalogValues(input: {
  now: Date;
  curve: CurveContract[];
  brentHist: HistoryPoint[];
  fxHist: HistoryPoint[];
  brentSpot: number | null;
  fxSpot: number | null;
}): Record<string, number | null> {
  const { now, curve, brentHist, fxHist, brentSpot, fxSpot } = input;
  return {
    avg_brent_2026: avgBrentForYear(2026, now, brentHist, curve, brentSpot),
    avg_brent_2027: avgBrentForYear(2027, now, brentHist, curve, brentSpot),
    // 2028: now within the extended forward curve (proxy reaches Dec of
    // current-year + 3). Months past the curve tail flat-extrapolate the last
    // contract inside avgBrentForYear (no longer spot-flat).
    avg_brent_2028: avgBrentForYear(2028, now, brentHist, curve, brentSpot),
    avg_fx_2026: avgFxForYear(2026, now, fxHist, fxSpot),
    avg_fx_2027: avgFxForYear(2027, now, fxHist, fxSpot),
    // 2028 FX = spot-flat (no FX forward in the proxy), same as 2027.
    avg_fx_2028: avgFxForYear(2028, now, fxHist, fxSpot),
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseMarketDrivers {
  /** key → live computed value (or null when the inputs are missing). */
  values: Record<string, number | null>;
  loading: boolean;
  error: string | null;
  /** The static catalog (stable reference) for building the Source picker. */
  catalog: DriverCatalogEntry[];
}

/** Empty-while-loading default so callers never see `undefined[key]`. */
const EMPTY_VALUES: Record<string, number | null> = {
  avg_brent_2026: null,
  avg_brent_2027: null,
  avg_brent_2028: null,
  avg_fx_2026: null,
  avg_fx_2027: null,
  avg_fx_2028: null,
};

/** Last finite close in a history series (the spot fallback). */
function lastClose(history: HistoryPoint[]): number | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const c = history[i]?.close;
    if (c != null && Number.isFinite(c)) return c;
  }
  return null;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function useMarketDrivers(): UseMarketDrivers {
  const [values, setValues] = useState<Record<string, number | null>>(EMPTY_VALUES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    // `loading` already defaults to true and this effect runs exactly once
    // (fetchedRef guard), so we don't synchronously set loading/error here —
    // that would trigger a cascading render. State is updated only when the
    // async fetch settles below.
    let cancelled = false;

    Promise.all([
      fetchJson<{ contracts?: CurveContract[] }>("/api/stocks/futures-curve"),
      fetchJson<HistoryPoint[]>(
        "/api/stocks/history?ticker=BZ%3DF&range=1y&interval=1d",
      ),
      fetchJson<HistoryPoint[]>(
        "/api/stocks/history?ticker=USDBRL%3DX&range=1y&interval=1d",
      ),
      fetchJson<QuotePoint[]>("/api/stocks/quote?tickers=BZ%3DF%2CUSDBRL%3DX"),
    ])
      .then(([curveRes, brentHistRes, fxHistRes, quotesRes]) => {
        if (cancelled) return;

        const curve = Array.isArray(curveRes?.contracts)
          ? curveRes!.contracts
          : [];
        const brentHist = Array.isArray(brentHistRes) ? brentHistRes : [];
        const fxHist = Array.isArray(fxHistRes) ? fxHistRes : [];
        const quotes = Array.isArray(quotesRes) ? quotesRes : [];

        // Spot fallbacks: prefer the live quote, else the last realized close.
        const quoteFor = (sym: string): number | null => {
          const q = quotes.find(
            (x) => (x.symbol ?? "").toUpperCase() === sym.toUpperCase(),
          );
          const p = q?.regularMarketPrice;
          return p != null && Number.isFinite(p) && p > 0 ? p : null;
        };
        const brentSpot = quoteFor("BZ=F") ?? lastClose(brentHist);
        const fxSpot = quoteFor("USDBRL=X") ?? lastClose(fxHist);

        const computed = computeCatalogValues({
          now: new Date(),
          curve,
          brentHist,
          fxHist,
          brentSpot,
          fxSpot,
        });
        setValues(computed);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load market data");
        setValues(EMPTY_VALUES);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { values, loading, error, catalog: MARKET_DRIVER_CATALOG };
}
