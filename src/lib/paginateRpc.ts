// ─────────────────────────────────────────────────────────────────────────────
// paginateRpc.ts — shared client-side pager for large SETOF RPCs
//
// One battle-tested loop for any RPC whose result may exceed the project's
// PostgREST `db-max-rows` cap. Importable by both `src/lib/rpc.ts` (wrappers)
// and the export specs under `src/lib/export/` — it deliberately lives at the
// `src/lib` root so neither side has to reach into the other's tree.
//
// NOTE on the OTHER pager: `paginatedRpc()` inside `rpc.ts` is a Market-Share-
// specific helper that pages 1 000 rows at a time over a handful of RPCs that
// never approach the cap. This module is for the few RPCs that DO approach or
// exceed the cap and therefore need the cap-safe termination semantics below.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The project's PostgREST `db-max-rows` cap — the single place that encodes it.
 *
 * Configured server-side in the Supabase Dashboard → Project Settings → API →
 * "Max rows" (currently 50 000, raised from the PostgREST default of 1 000).
 * Every `SETOF` RPC response is silently clamped to this many rows by PostgREST
 * — there is NO error, the array just comes back capped. Lowering it server-side
 * is safe for THIS pager: it only degrades to more round-trips, never to silent
 * truncation, because the loop advances by the number of rows actually received
 * and stops only on an empty page (see {@link paginateRpc}). Raising a client
 * page size above this value has no effect — the server still clamps.
 */
export const POSTGREST_MAX_ROWS = 50_000;

export interface PaginateRpcOptions {
  /**
   * Rows requested per round-trip. Defaults to {@link POSTGREST_MAX_ROWS} so a
   * full-cap response is one round-trip. Setting it ABOVE the server cap is a
   * no-op (PostgREST clamps); setting it BELOW just adds round-trips.
   */
  pageSize?: number;
  /**
   * Runaway guard. If `offset` ever exceeds this, the loop stops and returns
   * what it has (logging a warning) rather than spinning forever should the
   * underlying RPC misbehave and return full pages indefinitely. Default
   * 5 000 000 — comfortably past any realistic dataset (the well-by-well export
   * uses exactly this value: at 5 000 000 rows the largest sheet would still
   * finish in ~100 round-trips).
   */
  maxOffset?: number;
}

const DEFAULT_MAX_OFFSET = 5_000_000;

/**
 * Page through a SETOF RPC, accumulating every row.
 *
 * STOP CONDITION — append the RAW page, advance `offset` by the number of rows
 * ACTUALLY RECEIVED (not by `pageSize`), and stop ONLY when a page comes back
 * EMPTY.
 *
 * WHY (institutional knowledge — the well-by-well incident): PostgREST silently
 * clamps every response to the project `db-max-rows` cap. A "stop on a short
 * page" condition (`page.length < pageSize`) therefore silently TRUNCATES the
 * result whenever the server cap is LOWER than the client page size — every
 * page comes back clamped to the cap, the short-page check trips after page 1,
 * and the caller ships only one cap's worth of rows. This misfired
 * catastrophically in the `/well-by-well` export while the cap was still 1 000
 * but the client requested 50 000: every sheet shipped with only 1 000 rows.
 *
 * Advance-by-received + empty-stop is correct for ANY server cap (whether the
 * cap is above, equal to, or below `pageSize`) at the cost of exactly ONE extra
 * round-trip: the final non-empty page is followed by one empty fetch that ends
 * the loop. An exactly-`pageSize` (or exactly-cap) final page is indistinguishable
 * from a full one, so that extra fetch is unavoidable and intentional.
 *
 * REQUIREMENT: the underlying RPC MUST have a deterministic `ORDER BY` so the
 * `limit`/`offset` windows are stable and non-overlapping across round-trips.
 *
 * `fetchPage(limit, offset)` is responsible for the actual `supabase.rpc(...)`
 * call (and for throwing on RPC error — errors propagate out of this loop). Any
 * per-row coercion / filtering the caller needs must be applied to the RETURNED
 * accumulator, or inside `fetchPage` AFTER it has measured the raw page length
 * for pagination — never let a post-filter length drive the loop.
 *
 * @param fetchPage async `(limit, offset) => Row[]` — one page of raw rows.
 * @param opts `pageSize` (default {@link POSTGREST_MAX_ROWS}), `maxOffset`
 *             (runaway guard, default 5 000 000).
 * @returns every row across all pages, in fetch order.
 */
export async function paginateRpc<Row>(
  fetchPage: (limit: number, offset: number) => Promise<Row[]>,
  opts?: PaginateRpcOptions,
): Promise<Row[]> {
  const pageSize = opts?.pageSize ?? POSTGREST_MAX_ROWS;
  const maxOffset = opts?.maxOffset ?? DEFAULT_MAX_OFFSET;

  const all: Row[] = [];
  let offset = 0;
  for (;;) {
    const page = await fetchPage(pageSize, offset);
    if (page.length === 0) break; // end-of-data — a short page is NOT a reliable signal (see WHY)
    all.push(...page);
    // Advance by rows ACTUALLY received, never by pageSize — cap-safe.
    offset += page.length;
    if (offset > maxOffset) {
      console.warn("[paginateRpc] maxOffset guard reached", offset);
      break;
    }
  }
  return all;
}
