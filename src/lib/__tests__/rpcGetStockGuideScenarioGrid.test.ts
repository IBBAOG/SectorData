/**
 * Locks the pagination contract of rpcGetStockGuideScenarioGrid.
 *
 * A dense multi-axis × multi-metric × multi-ticker scenario-grid mesh exceeds
 * the PostgREST project max-rows cap (50,000). A single unpaginated SETOF RPC
 * call would silently truncate to the first 50k rows and starve the multilinear
 * interpolator of most of the later tickers/metrics. The wrapper therefore pages
 * through the RPC with p_limit/p_offset (page size 40,000) via the shared
 * `paginateRpc` helper, which advances by rows-actually-received and stops ONLY
 * on an EMPTY page (cap-safe — see src/lib/__tests__/paginateRpc.test.ts for the
 * generic loop tests and the well-by-well regression).
 *
 * These tests focus on the WRAPPER's responsibilities (coercion + integration):
 * (a) it concatenates every page; (b) a final short page triggers one more fetch
 * that returns empty (empty-page-stop, NOT short-page-stop); (c) coercion runs on
 * the RAW page (a full page of all-dropped NaN rows must still fetch the next
 * page); (d) an empty first page returns []; (e) a blank metric coerces to
 * 'target_price'; (f) an error propagates (throws).
 */
import { describe, it, expect, vi } from "vitest";
import { rpcGetStockGuideScenarioGrid } from "../rpc";
import type { SupabaseClient } from "@supabase/supabase-js";

const PAGE = 40_000;

type Row = {
  ticker: string;
  metric: string;
  x_value: number | string;
  y_value: number | string;
  z_value: number | string;
  primary_value: number | string;
};

function makeRow(i: number): Row {
  return {
    ticker: "PETR4",
    metric: "target_price",
    x_value: 40 + (i % 10),
    y_value: 0,
    z_value: 0,
    primary_value: 30 + (i % 100),
  };
}

/**
 * Build a mock supabase whose rpc() serves successive pages from `pages`.
 *
 * paginateRpc advances the offset by the number of rows ACTUALLY received
 * (not by the page size), so we map each requested offset to a page index by
 * the order of distinct offsets seen — the Nth distinct offset returns the Nth
 * page. This mirrors a real server that honours p_offset/p_limit windows.
 */
function mockPagedSupabase(pages: Row[][]) {
  const calls: Array<{ p_limit: number; p_offset: number }> = [];
  const offsetToIndex = new Map<number, number>();
  const supabase = {
    rpc: vi.fn(async (_name: string, params: { p_limit: number; p_offset: number }) => {
      calls.push({ p_limit: params.p_limit, p_offset: params.p_offset });
      if (!offsetToIndex.has(params.p_offset)) {
        offsetToIndex.set(params.p_offset, offsetToIndex.size);
      }
      const pageIndex = offsetToIndex.get(params.p_offset)!;
      return { data: pages[pageIndex] ?? [], error: null };
    }),
  } as unknown as SupabaseClient;
  return { supabase, calls };
}

describe("rpcGetStockGuideScenarioGrid pagination", () => {
  it("concatenates all pages across a > max-rows mesh", async () => {
    // 90,000 points = 2 full pages of 40k + a final 10k page.
    const all = Array.from({ length: 90_000 }, (_, i) => makeRow(i));
    const pages = [all.slice(0, PAGE), all.slice(PAGE, 2 * PAGE), all.slice(2 * PAGE)];
    const { supabase, calls } = mockPagedSupabase(pages);

    const out = await rpcGetStockGuideScenarioGrid(supabase, 18);

    expect(out).toHaveLength(90_000);
    // 4 calls: offsets 0, 40000, 80000, then 90000 returning [] → stop.
    // (Empty-page-stop: the short final 10k page does NOT end the loop; the
    // extra empty fetch does — cap-safe semantics from paginateRpc.)
    expect(calls).toEqual([
      { p_limit: PAGE, p_offset: 0 },
      { p_limit: PAGE, p_offset: PAGE },
      { p_limit: PAGE, p_offset: 2 * PAGE },
      { p_limit: PAGE, p_offset: 90_000 },
    ]);
    expect(out[0].x_value).toBe(40);
    expect(out[0].metric).toBe("target_price");
  });

  it("fetches one extra empty page after a single short page", async () => {
    // Empty-page-stop: a short first page is followed by exactly one empty fetch.
    const pages = [Array.from({ length: 1234 }, (_, i) => makeRow(i))];
    const { supabase, calls } = mockPagedSupabase(pages);
    const out = await rpcGetStockGuideScenarioGrid(supabase, 1);
    expect(out).toHaveLength(1234);
    expect(calls).toHaveLength(2); // page 1 (1234 rows) → empty page 2 → stop
    expect(calls[0]).toEqual({ p_limit: PAGE, p_offset: 0 });
    expect(calls[1]).toEqual({ p_limit: PAGE, p_offset: 1234 }); // advance-by-received
  });

  it("stops on an EXACTLY full page followed by an empty page", async () => {
    // Boundary: a page of exactly PAGE rows is NOT end-of-data → another page
    // fetched, which comes back empty → stop.
    const pages = [Array.from({ length: PAGE }, (_, i) => makeRow(i)), []];
    const { supabase, calls } = mockPagedSupabase(pages);
    const out = await rpcGetStockGuideScenarioGrid(supabase, 1);
    expect(out).toHaveLength(PAGE);
    expect(calls).toHaveLength(2); // forced to fetch the empty second page
  });

  it("coerces on the RAW page, not the post-NaN-drop length", async () => {
    // A FULL page (PAGE rows) where every row has a non-finite coord → all dropped.
    // The next page carries the only valid rows. paginateRpc advances by RAW
    // length (40k on page 1), so page 2 is fetched; coercion drops the bad rows.
    const badPage: Row[] = Array.from({ length: PAGE }, () => ({
      ticker: "PETR4",
      metric: "target_price",
      x_value: "NaN",
      y_value: 0,
      z_value: 0,
      primary_value: 10,
    }));
    const goodPage: Row[] = Array.from({ length: 5 }, (_, i) => makeRow(i));
    const { supabase, calls } = mockPagedSupabase([badPage, goodPage]);

    const out = await rpcGetStockGuideScenarioGrid(supabase, 1);

    // page 1 (RAW 40k) → page 2 (5 rows, short) → page 3 empty → stop.
    expect(calls).toHaveLength(3);
    expect(out).toHaveLength(5); // the bad page's rows are all dropped
    expect(out[0].primary_value).toBe(30);
  });

  it("returns [] for an empty first page", async () => {
    const { supabase, calls } = mockPagedSupabase([[]]);
    const out = await rpcGetStockGuideScenarioGrid(supabase, 99);
    expect(out).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("coerces a blank/missing metric to 'target_price'", async () => {
    const pages: Row[][] = [
      [
        { ticker: "PRIO3", metric: "", x_value: 60, y_value: 0, z_value: 0, primary_value: 45 } as Row,
      ],
    ];
    const { supabase } = mockPagedSupabase(pages);
    const out = await rpcGetStockGuideScenarioGrid(supabase, 1);
    expect(out).toHaveLength(1);
    expect(out[0].metric).toBe("target_price");
  });

  it("throws on an RPC error", async () => {
    const supabase = {
      rpc: vi.fn(async () => ({ data: null, error: { message: "boom" } })),
    } as unknown as SupabaseClient;
    await expect(rpcGetStockGuideScenarioGrid(supabase, 1)).rejects.toBeTruthy();
  });
});
