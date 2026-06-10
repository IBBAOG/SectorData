/**
 * Locks the multilinear scenario-grid interpolation contract used by /stock-guide.
 *
 * The dashboard reads, per company, a regular Cartesian mesh over 1..3 driver
 * axes (Avg Brent 2026 / 2027 / 2028+) and interpolates the output (target price)
 * live as the analyst drags one slider per axis. `buildGridMesh` indexes the
 * point cloud; `interpolateMesh` does the 2^d corner blend (linear / bilinear /
 * trilinear), clamps each axis to its domain, and returns `null` (never `NaN`)
 * when a corner the active cell requires is missing.
 *
 * If you change the blend, the clamp semantics or the "collapse on frac===0 /
 * lo===hi" rule and these vectors still pass, you've kept the contract; if they
 * break, you've regressed the live sensitivity sliders.
 */
import { describe, it, expect } from "vitest";
import {
  buildGridMesh,
  interpolateMesh,
  type MeshPoint,
} from "../stockGuideSensitivity";

/** Build a mesh from terse coord/value tuples + interpolate in one shot. */
function interp(points: MeshPoint[], dim: number, at: number[]): number | null {
  const mesh = buildGridMesh(points, dim);
  if (mesh == null) return null;
  return interpolateMesh(mesh, at);
}

describe("buildGridMesh / interpolateMesh — 1-D parity with the old linear grid", () => {
  const pts: MeshPoint[] = [
    { coords: [60], value: 10 },
    { coords: [70], value: 20 },
  ];

  it("linear blend at the midpoint: 65 → 15", () => {
    expect(interp(pts, 1, [65])).toBeCloseTo(15, 10);
  });

  it("clamps below the domain: 50 → first y (10)", () => {
    expect(interp(pts, 1, [50])).toBeCloseTo(10, 10);
  });

  it("clamps above the domain: 80 → last y (20)", () => {
    expect(interp(pts, 1, [80])).toBeCloseTo(20, 10);
  });

  it("single node → its value at any x", () => {
    const one: MeshPoint[] = [{ coords: [80], value: 42 }];
    expect(interp(one, 1, [10])).toBe(42);
    expect(interp(one, 1, [80])).toBe(42);
    expect(interp(one, 1, [999])).toBe(42);
  });

  it("non-finite query clamps to the axis minimum", () => {
    expect(interp(pts, 1, [NaN])).toBeCloseTo(10, 10);
  });
});

describe("interpolateMesh — bilinear (2 axes)", () => {
  // Corners: (0,0)=0, (10,0)=10, (0,10)=20, (10,10)=40.
  const pts: MeshPoint[] = [
    { coords: [0, 0], value: 0 },
    { coords: [10, 0], value: 10 },
    { coords: [0, 10], value: 20 },
    { coords: [10, 10], value: 40 },
  ];

  it("(2.5, 7.5) → 19.375", () => {
    expect(interp(pts, 2, [2.5, 7.5])).toBeCloseTo(19.375, 10);
  });

  it("(5, 5) → 17.5 (cell centre)", () => {
    expect(interp(pts, 2, [5, 5])).toBeCloseTo(17.5, 10);
  });

  it("edge clamp (10, 5) → 25 (upper x edge, mid y)", () => {
    expect(interp(pts, 2, [10, 5])).toBeCloseTo(25, 10);
  });

  it("exact corners reproduce", () => {
    expect(interp(pts, 2, [0, 0])).toBeCloseTo(0, 10);
    expect(interp(pts, 2, [10, 0])).toBeCloseTo(10, 10);
    expect(interp(pts, 2, [0, 10])).toBeCloseTo(20, 10);
    expect(interp(pts, 2, [10, 10])).toBeCloseTo(40, 10);
  });
});

describe("interpolateMesh — trilinear (3 axes), exact on a multilinear field", () => {
  // v = x + 2y + 4z over the unit cube → multilinear, so interpolation is exact.
  const pts: MeshPoint[] = [];
  for (const x of [0, 1])
    for (const y of [0, 1])
      for (const z of [0, 1])
        pts.push({ coords: [x, y, z], value: x + 2 * y + 4 * z });

  it("(0.3, 0.6, 0.9) → 5.1", () => {
    expect(interp(pts, 3, [0.3, 0.6, 0.9])).toBeCloseTo(5.1, 10);
  });

  it("interior point matches the closed form", () => {
    const at = [0.25, 0.5, 0.75];
    expect(interp(pts, 3, at)).toBeCloseTo(0.25 + 2 * 0.5 + 4 * 0.75, 10);
  });
});

describe("interpolateMesh — degenerate axis (a 2-D mesh with one y level ≡ 1-D)", () => {
  // y is held at a single level → axis collapses; result must equal the 1-D blend.
  const pts: MeshPoint[] = [
    { coords: [60, 5], value: 10 },
    { coords: [70, 5], value: 20 },
  ];

  it("equals the 1-D interpolation along x", () => {
    expect(interp(pts, 2, [65, 5])).toBeCloseTo(15, 10);
    expect(interp(pts, 2, [65, 999])).toBeCloseTo(15, 10); // y clamps, no effect
    expect(interp(pts, 2, [50, 5])).toBeCloseTo(10, 10); // x clamp low
    expect(interp(pts, 2, [80, 5])).toBeCloseTo(20, 10); // x clamp high
  });
});

describe("interpolateMesh — missing corners", () => {
  it("a corner missing from the ACTIVE cell → null (never NaN)", () => {
    // 2x2 grid missing (10,10): the cell [(0..10),(0..10)] is incomplete.
    const pts: MeshPoint[] = [
      { coords: [0, 0], value: 0 },
      { coords: [10, 0], value: 10 },
      { coords: [0, 10], value: 20 },
    ];
    const r = interp(pts, 2, [5, 5]);
    expect(r).toBeNull();
  });

  it("a corner missing OUTSIDE the active cell still interpolates (clamped query)", () => {
    // 3 x-levels {0,10,20}, 2 y-levels {0,10}; the (20,10) node is missing.
    // Query (5, 10): y is at the upper edge → y collapses (lo=hi at level 10),
    // x active cell is [0,10] → corners (0,10)=20 and (10,10)=40, both present.
    // The missing (20,10) corner is OUTSIDE the active cell → still resolves.
    const pts: MeshPoint[] = [
      { coords: [0, 0], value: 0 },
      { coords: [10, 0], value: 10 },
      { coords: [20, 0], value: 100 },
      { coords: [0, 10], value: 20 },
      { coords: [10, 10], value: 40 },
      // (20,10) intentionally absent
    ];
    expect(interp(pts, 2, [5, 10])).toBeCloseTo(30, 10); // 0.5*20 + 0.5*40
  });
});

describe("buildGridMesh — edge cases", () => {
  it("duplicate coordinate tuple → last write wins", () => {
    const pts: MeshPoint[] = [
      { coords: [60], value: 10 },
      { coords: [70], value: 20 },
      { coords: [70], value: 99 }, // overwrites the 70-node
    ];
    expect(interp(pts, 1, [70])).toBe(99);
    // and the blend toward it uses the overwritten value:
    expect(interp(pts, 1, [65])).toBeCloseTo((10 + 99) / 2, 10);
  });

  it("empty point cloud → null mesh", () => {
    expect(buildGridMesh([], 2)).toBeNull();
  });

  it("dim < 1 → null mesh", () => {
    expect(buildGridMesh([{ coords: [1], value: 1 }], 0)).toBeNull();
  });
});
