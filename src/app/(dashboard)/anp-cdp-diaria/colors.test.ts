// Regression test for the company-view color assignment.
//
// Runner: vitest (configured in vitest.config.ts — `npm test` → `vitest run`).
//
// Background: the company line chart pins its "Company total" headline line to
// BRAND_ORANGE (#FF5000) and renders it in the SAME chart as the per-field
// traces. After the 2026-06-09 PALETTE reorder, orange moved from index 0 to
// index 1, which made the old `PALETTE[(i+1) % len]` offset hand the FIRST field
// the brand orange — colliding with the total line. The fix filters BRAND_ORANGE
// out of the field color sequence (companyFieldColorMap). These tests lock the
// invariant so a future reorder cannot reintroduce the collision.

import { describe, it, expect } from "vitest";
import { BRAND_ORANGE, PALETTE } from "@/lib/plotlyDefaults";
import { companyFieldColorMap } from "./useAnpCdpDiariaData";

const orange = BRAND_ORANGE.toLowerCase();

describe("companyFieldColorMap", () => {
  it("never assigns BRAND_ORANGE to a field (reserved for the total line)", () => {
    // Use more fields than the palette length to exercise the wrap-around.
    const fields = Array.from({ length: PALETTE.length + 5 }, (_, i) => `Field ${i}`);
    const map = companyFieldColorMap(fields);
    for (const dim of fields) {
      expect(map[dim].toLowerCase()).not.toBe(orange);
    }
  });

  it("colors the FIRST field with something other than orange", () => {
    // This is the exact case the reorder broke: field 0 must not be orange.
    const map = companyFieldColorMap(["A", "B", "C"]);
    expect(map["A"].toLowerCase()).not.toBe(orange);
  });

  it("gives distinct colors to all fields up to the (orange-excluded) palette size", () => {
    const max = PALETTE.length - 1; // one slot removed (BRAND_ORANGE)
    const fields = Array.from({ length: max }, (_, i) => `Field ${i}`);
    const map = companyFieldColorMap(fields);
    const colors = fields.map((f) => map[f].toLowerCase());
    expect(new Set(colors).size).toBe(max);
  });

  it("the full company chart palette (total line + fields) is mutually distinct", () => {
    // Simulate a company with N fields plus the always-orange total line, exactly
    // as buildCompanyChart renders them (`data: [totalTrace, ...fieldTraces]`).
    const max = PALETTE.length - 1;
    const fields = Array.from({ length: max }, (_, i) => `Field ${i}`);
    const map = companyFieldColorMap(fields);
    const chartColors = [BRAND_ORANGE, ...fields.map((f) => map[f])].map((c) => c.toLowerCase());
    expect(new Set(chartColors).size).toBe(chartColors.length);
  });

  it("keeps a field's color stable regardless of how many fields follow it (line ↔ bar parity)", () => {
    // The line chart and the monthly stacked bar both key on the FULL canonical
    // order, so the same field must map to the same color in both. Since the map
    // is positional on the shared order, a field's color depends only on its
    // index — verify a field keeps its color as the list grows.
    const shortMap = companyFieldColorMap(["A", "B", "C"]);
    const longMap = companyFieldColorMap(["A", "B", "C", "D", "E"]);
    expect(longMap["A"]).toBe(shortMap["A"]);
    expect(longMap["B"]).toBe(shortMap["B"]);
    expect(longMap["C"]).toBe(shortMap["C"]);
  });
});
