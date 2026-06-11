/**
 * Locks the contract of the shared cap-safe pager `paginateRpc`.
 *
 * The termination semantics here are the institutional knowledge from the
 * /well-by-well export incident: PostgREST silently clamps every SETOF response
 * to the project db-max-rows cap, so a "stop on a short page" condition truncates
 * silently whenever the server cap is BELOW the client page size. paginateRpc
 * instead appends the RAW page, advances by rows-actually-received, and stops
 * ONLY on an empty page — correct for ANY server cap at the cost of one extra
 * round-trip.
 *
 * These tests verify: (a) an empty first page returns []; (b) a multi-page run
 * concatenates every page and ends with one empty fetch; (c) advance-by-received
 * survives a SERVER-CLAMPED page smaller than the requested pageSize (THE
 * regression that motivated this helper); (d) the runaway maxOffset guard stops a
 * misbehaving RPC that returns full pages forever; (e) the default pageSize is the
 * project cap; (f) fetcher errors propagate.
 */
import { describe, it, expect, vi } from "vitest";
import { paginateRpc, POSTGREST_MAX_ROWS } from "../paginateRpc";

type Row = { i: number };

/**
 * A fetcher that serves successive pages. Advance-by-received means the offset
 * the loop passes equals the running total of rows already received, so we map
 * each distinct requested offset to the next page in order.
 */
function pagedFetcher(pages: Row[][]) {
  const calls: Array<{ limit: number; offset: number }> = [];
  const offsetToIndex = new Map<number, number>();
  const fetchPage = vi.fn(async (limit: number, offset: number): Promise<Row[]> => {
    calls.push({ limit, offset });
    if (!offsetToIndex.has(offset)) offsetToIndex.set(offset, offsetToIndex.size);
    return pages[offsetToIndex.get(offset)!] ?? [];
  });
  return { fetchPage, calls };
}

function rows(n: number, base = 0): Row[] {
  return Array.from({ length: n }, (_, i) => ({ i: base + i }));
}

describe("paginateRpc", () => {
  it("exposes the project db-max-rows cap as the default page size", () => {
    expect(POSTGREST_MAX_ROWS).toBe(50_000);
  });

  it("returns [] and fetches exactly once for an empty first page", async () => {
    const { fetchPage, calls } = pagedFetcher([[]]);
    const out = await paginateRpc(fetchPage, { pageSize: 1000 });
    expect(out).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ limit: 1000, offset: 0 });
  });

  it("concatenates multiple pages and stops on the trailing empty page", async () => {
    // 2 full pages of 100 + a short page of 30.
    const pages = [rows(100, 0), rows(100, 100), rows(30, 200)];
    const { fetchPage, calls } = pagedFetcher(pages);

    const out = await paginateRpc(fetchPage, { pageSize: 100 });

    expect(out).toHaveLength(230);
    expect(out[0].i).toBe(0);
    expect(out[229].i).toBe(229);
    // offsets advance by rows received: 0, 100, 200, 230 (empty) → stop.
    expect(calls).toEqual([
      { limit: 100, offset: 0 },
      { limit: 100, offset: 100 },
      { limit: 100, offset: 200 },
      { limit: 100, offset: 230 },
    ]);
  });

  it("advance-by-received survives a SERVER-CLAMPED page smaller than pageSize (the well-by-well regression)", async () => {
    // The caller requests pageSize 50000 but the server cap is 1000: every page
    // comes back clamped to 1000. A short-page-stop would ship only 1000 rows.
    // advance-by-received + empty-stop pages all the way through.
    const SERVER_CAP = 1000;
    const TOTAL = 3500; // 3 clamped pages of 1000 + a final 500.
    const fetchPage = vi.fn(async (_limit: number, offset: number): Promise<Row[]> => {
      const remaining = TOTAL - offset;
      if (remaining <= 0) return [];
      return rows(Math.min(SERVER_CAP, remaining), offset);
    });

    const out = await paginateRpc(fetchPage, { pageSize: 50_000 });

    expect(out).toHaveLength(TOTAL); // NOT truncated to the first 1000
    // 1000, 1000, 1000, 500, then empty → 5 calls. Offsets advance by RECEIVED
    // length (1000s, not the requested 50000), proving we never trust pageSize.
    expect(fetchPage.mock.calls.map((c) => c[1])).toEqual([0, 1000, 2000, 3000, 3500]);
  });

  it("stops via the maxOffset runaway guard when the RPC never returns empty", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // A misbehaving fetcher that ALWAYS returns a full page — would loop forever.
    const fetchPage = vi.fn(async (limit: number, offset: number): Promise<Row[]> =>
      rows(limit, offset),
    );

    const out = await paginateRpc(fetchPage, { pageSize: 100, maxOffset: 250 });

    // pages at offset 0,100,200 (offset becomes 300 > 250 → guard trips).
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(out).toHaveLength(300);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("defaults pageSize to the project cap", async () => {
    const { fetchPage, calls } = pagedFetcher([rows(10)]);
    await paginateRpc(fetchPage);
    expect(calls[0].limit).toBe(POSTGREST_MAX_ROWS);
  });

  it("propagates an error thrown by fetchPage", async () => {
    const fetchPage = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(paginateRpc(fetchPage)).rejects.toThrow("boom");
  });
});
