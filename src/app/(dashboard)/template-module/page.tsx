// ─── NEW MODULE TEMPLATE ──────────────────────────────────────────────────────
//
// HOW TO USE THIS TEMPLATE
// ────────────────────────
// 1. Copy this folder: cp -r template-module my-module-name
// 2. Rename the component at the bottom (MyModulePage → YourModulePage).
// 3. Add your route to NavBar:
//      src/components/NavBar.tsx → NAV_MODULES array
//      { href: "/my-module-name", label: "My Module" }
// 4. Add RPC wrappers in src/lib/rpc.ts under a new "MODULE:" section.
// 5. Auth is automatically enforced by src/app/(dashboard)/layout.tsx.
//    You do NOT need to add any session checks here.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useEffect, useMemo, useState } from "react";
import type { Layout, PlotData } from "plotly.js";

import NavBar from "../../../components/NavBar";
import PlotlyChart from "../../../components/PlotlyChart";
import PeriodSlider from "../../../components/PeriodSlider";
import { resolverDatas } from "../../../lib/filterUtils";
import { getSupabaseClient } from "../../../lib/supabaseClient";
// import { rpcGetMyModuleData, type MyModuleFilters } from "../../../lib/rpc";

// ─── Types ────────────────────────────────────────────────────────────────────

type MyModuleFilters = {
  data_inicio?: string | null;
  data_fim?: string | null;
  // add your filter fields here
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function MyModulePage() {
  const supabase = getSupabaseClient();

  // Filter options fetched from Supabase (dates, dropdown values, etc.)
  const [opcoes, setOpcoes] = useState<Record<string, unknown> | null>(null);
  const datas = useMemo(() => resolverDatas(opcoes ?? {}), [opcoes]);

  // Slider state (period range indices into `datas`)
  const [sliderRange, setSliderRange] = useState<[number, number]>([0, 0]);

  // Applied (committed) filter state — updated when user clicks "Apply"
  const [appliedFilters, setAppliedFilters] = useState<MyModuleFilters>({});

  // Chart / data state
  const [loading, setLoading] = useState(false);
  const [chartData, setChartData] = useState<{ x: string[]; y: number[] }>({ x: [], y: [] });

  // ── Step 1: Fetch filter options on mount ─────────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      // Replace with your actual RPC call:
      // const data = await rpcGetMyModuleOpcoesFiltros(supabase);
      const data = {};
      if (!cancelled) setOpcoes(data);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // ── Step 2: Initialise slider when dates load ─────────────────────────────
  useEffect(() => {
    if (!datas || datas.length === 0) return;
    setSliderRange([0, datas.length - 1]);
  }, [datas.length]);

  // ── Step 3: Fetch chart data when applied filters change ──────────────────
  useEffect(() => {
    if (!opcoes || !supabase) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        // Replace with your actual RPC call:
        // const rows = await rpcGetMyModuleData(supabase, appliedFilters);
        const rows: { x: string[]; y: number[] } = { x: [], y: [] };
        if (!cancelled) setChartData(rows);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [appliedFilters, opcoes, supabase]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  function applyFilters() {
    if (!datas || datas.length === 0) return;
    const [a, b] = sliderRange;
    setAppliedFilters({
      data_inicio: datas[a] ?? null,
      data_fim: datas[b] ?? null,
    });
  }

  function clearFilters() {
    setAppliedFilters({});
  }

  // ── Chart definition ──────────────────────────────────────────────────────
  const plotData: PlotData[] = chartData.x.length
    ? [{ type: "bar", x: chartData.x, y: chartData.y, marker: { color: "#FF5000" } } as PlotData]
    : [];

  const plotLayout: Partial<Layout> = {
    paper_bgcolor: "white",
    plot_bgcolor: "white",
    height: 320,
    margin: { t: 40, b: 30, l: 10, r: 10 },
  };

  // ── Guard: wait for filter options ───────────────────────────────────────
  if (!opcoes) return null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      <NavBar />

      <div className="container-fluid g-0">
        <div className="row g-0">
          {/* Sidebar */}
          <div className="col-2 p-0">
            <div id="sidebar">
              <div style={{ textAlign: "center" }}>
                <img src="/logo.png" alt="Logo" style={{ width: "100%", maxWidth: 300, marginBottom: 16 }} />
              </div>
              <hr style={{ borderTop: "1px solid #f0f0f0", marginBottom: 14 }} />

              <div className="sidebar-section-label">Filters</div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Period</div>
                <PeriodSlider
                  datas={datas}
                  value={sliderRange}
                  onChange={setSliderRange}
                  sliderId="my-module-slider-period"
                />
              </div>

              {/* Add more filter components (CheckList, RegionStateFilter, etc.) here */}

              <div className="row g-1 mt-1">
                <div className="col-6">
                  <button type="button" className="btn btn-apply" onClick={applyFilters}>
                    Apply
                  </button>
                </div>
                <div className="col-6">
                  <button type="button" className="btn btn-clear" onClick={clearFilters}>
                    Clear
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Main content */}
          <div className="col-10">
            <div id="page-content">
              <div className="mb-2">
                <div className="page-header-title">My Module</div>
                <div className="page-header-sub">Description of what this module shows</div>
              </div>

              {loading ? (
                <div className="d-flex justify-content-center my-5">
                  <img src="/barrel_loading.png" alt="Carregando..." width={80} height={80} />
                </div>
              ) : (
                <div className="row g-3">
                  <div className="col-md-6">
                    <div className="chart-container">
                      <PlotlyChart
                        data={plotData}
                        layout={plotLayout}
                        config={{ displayModeBar: false }}
                        style={{ width: "100%", height: 320 }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
