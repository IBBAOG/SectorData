/**
 * Locks the timezone contract of rpcGetAdminAnalyticsViewsByHour.
 *
 * Migration 20260602200000 changed the SQL to bucket in BRT and return
 * `timestamp without time zone`. The RPC wrapper must append "Z" so that JS
 * `new Date(...)` treats the string as literal UTC — otherwise V8/SpiderMonkey
 * parse it as browser-local time, which double-shifts the chart and breaks
 * the rendered hour label.
 *
 * If you remove the Z-append and the test still passes, you've regressed
 * Eduardo's "16h vs 18h" bug.
 */
import { describe, it, expect, vi } from "vitest";
import { rpcGetAdminAnalyticsViewsByHour } from "../rpc";
import type { SupabaseClient } from "@supabase/supabase-js";

function mockSupabaseRpc(rows: Array<{ hour_bucket: string; event_count: number }>) {
  return {
    rpc: vi.fn(async () => ({ data: rows, error: null })),
  } as unknown as SupabaseClient;
}

describe("rpcGetAdminAnalyticsViewsByHour timezone handling", () => {
  it("appends Z to no-TZ ISO strings from the server", async () => {
    const supabase = mockSupabaseRpc([
      { hour_bucket: "2026-05-28T16:00:00", event_count: 149 },
      { hour_bucket: "2026-05-28T15:00:00", event_count: 262 },
    ]);
    const result = await rpcGetAdminAnalyticsViewsByHour(supabase, 30);
    expect(result).toHaveLength(2);
    expect(result[0].hour_bucket).toBe("2026-05-28T16:00:00Z");
    expect(result[1].hour_bucket).toBe("2026-05-28T15:00:00Z");
  });

  it("parses Z-suffixed string as UTC 16:00 (not local-shifted)", async () => {
    const supabase = mockSupabaseRpc([
      { hour_bucket: "2026-05-28T16:00:00", event_count: 1 },
    ]);
    const [row] = await rpcGetAdminAnalyticsViewsByHour(supabase, 1);
    const d = new Date(row.hour_bucket);
    expect(d.getUTCHours()).toBe(16);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.toISOString()).toBe("2026-05-28T16:00:00.000Z");
  });

  it("does not double-append Z if server already returned a TZ-qualified string", async () => {
    const supabase = mockSupabaseRpc([
      { hour_bucket: "2026-05-28T16:00:00Z", event_count: 1 },
      { hour_bucket: "2026-05-28T16:00:00+00:00", event_count: 1 },
      { hour_bucket: "2026-05-28T16:00:00-03:00", event_count: 1 },
    ]);
    const rows = await rpcGetAdminAnalyticsViewsByHour(supabase, 1);
    expect(rows[0].hour_bucket).toBe("2026-05-28T16:00:00Z");
    expect(rows[1].hour_bucket).toBe("2026-05-28T16:00:00+00:00");
    expect(rows[2].hour_bucket).toBe("2026-05-28T16:00:00-03:00");
  });

  it("returns [] on RPC error (silent degrade)", async () => {
    const supabase = {
      rpc: vi.fn(async () => ({ data: null, error: { message: "boom" } })),
    } as unknown as SupabaseClient;
    const result = await rpcGetAdminAnalyticsViewsByHour(supabase, 30);
    expect(result).toEqual([]);
  });
});
