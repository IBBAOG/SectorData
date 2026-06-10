// Tests for the central color assigner + the trace lock.
//
// Runner: vitest (configured in package.json — `npm test` → `vitest run`).
//
// Covers:
//   (a) assignSeriesColors — never repeats a color, honors canonical pins,
//       Others-last + grey, leader → BRAND_ORANGE, palette-exhaustion throw.
//   (b) validateTraces — throws in dev on a duplicate color (migrated ctx).
//   (c) validateTraces — throws in dev on a stacked chart without traceorder.
//   (d) validateTraces — in production, dedups + does NOT throw.

import { describe, it, expect, afterEach, vi } from "vitest";
import type { PlotData, Layout } from "plotly.js";
import { assignSeriesColors, applyStackedLegendOrder, OTHERS_GREY } from "../colors";
import { validateTraces, MIGRATED_CTX } from "../validateTraces";
import { BRAND_ORANGE, COMPANY_COLORS, PALETTE } from "@/lib/plotlyDefaults";

const MIGRATED = "imports-exports:by-importer";
const UNMIGRATED = "some-dashboard:not-migrated";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ─── (a) assignSeriesColors ────────────────────────────────────────────────────

describe("assignSeriesColors", () => {
  it("assigns the canonical color to each known company", () => {
    const out = assignSeriesColors(["Petrobras", "Vibra", "Ipiranga"], {
      canonical: COMPANY_COLORS,
      othersLabel: "Others",
    });
    expect(out.find((s) => s.entity === "Petrobras")?.color).toBe(COMPANY_COLORS.Petrobras);
    expect(out.find((s) => s.entity === "Vibra")?.color).toBe(COMPANY_COLORS.Vibra);
    expect(out.find((s) => s.entity === "Ipiranga")?.color).toBe(COMPANY_COLORS.Ipiranga);
  });

  it("never repeats a color, even with non-canonical entities", () => {
    const entities = ["Petrobras", "Vibra", "UnknownCo A", "UnknownCo B", "Others"];
    const out = assignSeriesColors(entities, {
      canonical: COMPANY_COLORS,
      othersLabel: "Others",
    });
    const colors = out.map((s) => s.color);
    expect(new Set(colors).size).toBe(colors.length); // all distinct
  });

  it("reproduces the reported bug scenario without collision (Royal FIC + Atem's)", () => {
    // Royal FIC + Atem's used to both render lime (#D2FF00) under the old
    // `colorIdx ?? i` fallback. Now they pin to distinct COMPANY_COLORS.
    const out = assignSeriesColors(
      ["Petrobras", "Vibra", "Ipiranga", "Raízen", "Atem's", "Royal FIC", "Others"],
      { canonical: COMPANY_COLORS, othersLabel: "Others" },
    );
    const colors = out.map((s) => s.color);
    expect(new Set(colors).size).toBe(colors.length);
    const royal = out.find((s) => s.entity === "Royal FIC")?.color;
    const atems = out.find((s) => s.entity === "Atem's")?.color;
    expect(royal).not.toBe(atems);
    expect(royal).not.toBe("#D2FF00");
    expect(atems).not.toBe("#D2FF00");
  });

  it("always renders Others last and grey", () => {
    const out = assignSeriesColors(["Others", "Petrobras", "Vibra"], {
      canonical: COMPANY_COLORS,
      othersLabel: "Others",
    });
    expect(out[out.length - 1].entity).toBe("Others");
    expect(out[out.length - 1].color).toBe(OTHERS_GREY);
  });

  it("forces the first entity to BRAND_ORANGE when leader=true", () => {
    const out = assignSeriesColors(["FieldX", "FieldY"], { leader: true });
    expect(out[0].color).toBe(BRAND_ORANGE);
    expect(out[1].color).not.toBe(BRAND_ORANGE);
  });

  it("throws when the palette is exhausted (too many distinct series)", () => {
    // PALETTE has 14 colors; one (grey) is reserved for Others → max 13 main.
    const tooMany = Array.from({ length: PALETTE.length + 1 }, (_, i) => `E${i}`);
    expect(() => assignSeriesColors(tooMany)).toThrow(/palette exhausted/);
  });
});

// ─── applyStackedLegendOrder ────────────────────────────────────────────────────

describe("applyStackedLegendOrder", () => {
  it("pins traceorder to normal without clobbering other legend props", () => {
    const layout: Partial<Layout> = { legend: { orientation: "h", x: 0 } };
    const out = applyStackedLegendOrder(layout);
    expect(out.legend?.traceorder).toBe("normal");
    expect(out.legend?.orientation).toBe("h");
    expect(out.legend?.x).toBe(0);
  });
});

// ─── (b)(c) validateTraces — dev throws ─────────────────────────────────────────

function stacked(name: string, color: string): Partial<PlotData> {
  return { type: "scatter", mode: "lines", stackgroup: "one", name, fillcolor: color } as Partial<PlotData>;
}

describe("validateTraces — dev/CI enforcement (migrated ctx)", () => {
  it("throws on a duplicate color among visible traces", () => {
    vi.stubEnv("NODE_ENV", "development");
    const data = [stacked("A", "#1D4080"), stacked("B", "#1D4080")];
    const layout: Partial<Layout> = { legend: { traceorder: "normal" } };
    expect(() => validateTraces(data, layout, MIGRATED)).toThrow(/color collision/);
  });

  it("throws on a stacked chart without an explicit traceorder", () => {
    vi.stubEnv("NODE_ENV", "development");
    const data = [stacked("A", "#1D4080"), stacked("B", "#0F766E")];
    const layout: Partial<Layout> = {}; // no legend.traceorder
    expect(() => validateTraces(data, layout, MIGRATED)).toThrow(/traceorder/);
  });

  it("does NOT throw for a clean migrated chart", () => {
    vi.stubEnv("NODE_ENV", "development");
    const data = [stacked("A", "#1D4080"), stacked("B", "#0F766E")];
    const layout: Partial<Layout> = { legend: { traceorder: "normal" } };
    expect(() => validateTraces(data, layout, MIGRATED)).not.toThrow();
  });

  it("ignores legendonly / hidden traces in the collision check", () => {
    vi.stubEnv("NODE_ENV", "development");
    const data = [
      stacked("A", "#1D4080"),
      { ...stacked("B", "#1D4080"), visible: "legendonly" } as Partial<PlotData>,
    ];
    const layout: Partial<Layout> = { legend: { traceorder: "normal" } };
    expect(() => validateTraces(data, layout, MIGRATED)).not.toThrow();
  });

  it("only warns (does not throw) for an unmigrated ctx", () => {
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const data = [stacked("A", "#1D4080"), stacked("B", "#1D4080")];
    const layout: Partial<Layout> = { legend: { traceorder: "normal" } };
    expect(() => validateTraces(data, layout, UNMIGRATED)).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });
});

// ─── (d) validateTraces — production auto-corrects, never throws ─────────────────

describe("validateTraces — production auto-correction", () => {
  it("dedups a colliding color and does not throw", () => {
    vi.stubEnv("NODE_ENV", "production");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const data = [stacked("A", "#1D4080"), stacked("B", "#1D4080")];
    const layout: Partial<Layout> = { legend: { traceorder: "normal" } };
    let result!: ReturnType<typeof validateTraces>;
    expect(() => {
      result = validateTraces(data, layout, MIGRATED);
    }).not.toThrow();
    const colors = result.data
      .map((t) => (t as { fillcolor?: string }).fillcolor)
      .filter(Boolean) as string[];
    expect(new Set(colors).size).toBe(colors.length); // collision resolved
    expect(err).toHaveBeenCalled();
  });

  it("forces legend.traceorder to normal on an unpinned stacked chart", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const data = [stacked("A", "#1D4080"), stacked("B", "#0F766E")];
    const result = validateTraces(data, {}, MIGRATED);
    expect(result.layout.legend?.traceorder).toBe("normal");
  });

  it("does not mutate the caller's source trace objects", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const src = [stacked("A", "#1D4080"), stacked("B", "#1D4080")];
    validateTraces(src, { legend: { traceorder: "normal" } }, MIGRATED);
    // Original objects unchanged (the lock clones before correcting).
    expect((src[1] as { fillcolor?: string }).fillcolor).toBe("#1D4080");
  });
});

// ─── (e) validateTraces — unmigrated charts are NEVER mutated ────────────────────
//
// Regression guard (2026-06-09): the lock used to auto-correct colors + force
// traceorder for ANY chart in production, repainting /price-bands' intentional
// solid+dashed color families (e.g. "Import Parity" + "Import Parity w/ subsidy"
// both #E8611A, distinguished only by dash style). Unmigrated charts — including
// ctx === undefined (price-bands passes no ctx) — must be a strict no-op.

describe("validateTraces — unmigrated charts never mutated", () => {
  function solidDashedPair(): Partial<PlotData>[] {
    // Mirrors /price-bands: two lines sharing one color, distinguished by dash.
    return [
      {
        type: "scatter",
        mode: "lines",
        name: "Import Parity",
        line: { color: "#E8611A" },
      } as Partial<PlotData>,
      {
        type: "scatter",
        mode: "lines",
        name: "Import Parity w/ subsidy",
        line: { color: "#E8611A", dash: "dash" },
      } as unknown as Partial<PlotData>,
    ];
  }

  it("keeps duplicate colors INTACT in production when ctx is undefined", () => {
    vi.stubEnv("NODE_ENV", "production");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const data = solidDashedPair();
    const result = validateTraces(data, {}); // ctx omitted, like /price-bands
    const colors = result.data.map((t) => (t as { line?: { color?: string } }).line?.color);
    expect(colors).toEqual(["#E8611A", "#E8611A"]); // no reassignment
    expect(err).not.toHaveBeenCalled(); // no auto-correct error logged
  });

  it("keeps duplicate colors INTACT in production for an unmigrated ctx", () => {
    vi.stubEnv("NODE_ENV", "production");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const data = solidDashedPair();
    const result = validateTraces(data, {}, UNMIGRATED);
    const colors = result.data.map((t) => (t as { line?: { color?: string } }).line?.color);
    expect(colors).toEqual(["#E8611A", "#E8611A"]);
    expect(err).not.toHaveBeenCalled();
  });

  it("does NOT force legend.traceorder on an unmigrated stacked chart in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const data = [stacked("A", "#1D4080"), stacked("B", "#0F766E")];
    const result = validateTraces(data, {}, UNMIGRATED); // no traceorder pinned
    expect(result.layout.legend?.traceorder).toBeUndefined();
  });

  it("does NOT mutate (only warns) for an unmigrated stacked chart in dev", () => {
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const data = [stacked("A", "#1D4080"), stacked("B", "#0F766E")];
    const result = validateTraces(data, {}, UNMIGRATED);
    expect(result.layout.legend?.traceorder).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});

// Sanity: the imports-exports charts are on the allowlist.
describe("MIGRATED_CTX allowlist", () => {
  it("includes the by-importer chart", () => {
    expect(MIGRATED_CTX.has("imports-exports:by-importer")).toBe(true);
  });
});
