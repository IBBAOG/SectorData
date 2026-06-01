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
 * The 4 supported dynamic metrics. Adding a metric here makes it selectable in
 * the admin Source picker and computed below in `computeCatalogValues`.
 */
export const MARKET_DRIVER_CATALOG: DriverCatalogEntry[] = [
  { key: "avg_brent_2026", label: "Avg Brent 2026", unit: "USD/bbl" },
  { key: "avg_brent_2027", label: "Avg Brent 2027", unit: "USD/bbl" },
  { key: "avg_fx_2026", label: "Avg FX (USD/BRL) 2026", unit: "BRL/USD" },
  { key: "avg_fx_2027", label: "Avg FX (USD/BRL) 2027", unit: "BRL/USD" },
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
 *   • future month  → forward-curve price, else spot (the near 1–2 months may not
 *     be in the curve since it starts ~M+2, so they fall back to spot).
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
  const monthly: (number | null)[] = [];
  for (let m = 1; m <= 12; m++) {
    const isPast = year < curYear || (year === curYear && m < curMonth);
    const isCurrent = year === curYear && m === curMonth;
    if (isPast) {
      monthly.push(realizedMonthlyAvg(brentHist, year, m));
    } else if (isCurrent) {
      monthly.push(realizedMonthlyAvg(brentHist, year, m) ?? brentSpot);
    } else {
      // future
      monthly.push(forwardPrice(curve, year, m) ?? brentSpot);
    }
  }
  return meanNonNull(monthly);
}

/**
 * Average USD/BRL for a calendar `year` as the mean of its 12 monthly values
 * (SPOT-FLAT approximation — there is no FX forward in the proxy):
 *   • past month            → realized monthly average;
 *   • current/future month  → spot, held flat.
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
    avg_fx_2026: avgFxForYear(2026, now, fxHist, fxSpot),
    avg_fx_2027: avgFxForYear(2027, now, fxHist, fxSpot),
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
  avg_fx_2026: null,
  avg_fx_2027: null,
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
