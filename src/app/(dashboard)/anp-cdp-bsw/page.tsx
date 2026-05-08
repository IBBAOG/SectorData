"use client";

import { useEffect, useMemo, useState } from "react";
import type { Layout, PlotData } from "plotly.js";

import NavBar from "../../../components/NavBar";
import PlotlyChart from "../../../components/PlotlyChart";
import SearchableMultiSelect from "../../../components/SearchableMultiSelect";
import DashboardHeader from "../../../components/dashboard/DashboardHeader";
import ChartSection from "../../../components/dashboard/ChartSection";
import BarrelLoading from "../../../components/dashboard/BarrelLoading";
import SegmentedToggle from "../../../components/dashboard/SegmentedToggle";
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
import { useDebouncedFetch } from "../../../hooks/useDebouncedFetch";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot, PALETTE } from "../../../lib/plotlyDefaults";
import {
  rpcGetAnpCdpFiltros,
  rpcGetAnpCdpBswScatter,
  rpcGetAnpCdpBswFieldAggregate,
  type AnpCdpFiltros,
  type AnpCdpBswPoint,
  type AnpCdpBswFieldPoint,
} from "../../../lib/rpc";

// ── View mode ─────────────────────────────────────────────────────────────────

type ViewMode = "well" | "field";

const VIEW_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: "well",  label: "Per well" },
  { value: "field", label: "Field average" },
];

// ── Chart builders ────────────────────────────────────────────────────────────

function buildPerWellChart(
  points: AnpCdpBswPoint[],
  selectedCampos: string[],
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!selectedCampos.length) {
    return emptyPlot(
      460,
      "Select one or more fields to plot BSW evolution.",
    );
  }
  if (!points.length) {
    return emptyPlot(460, "No data for the selected fields.");
  }

  // One trace per campo (in the order the user selected them, so colors stay
  // sticky per-field while a session is open). Each point = (poco × month).
  const traces: PlotData[] = selectedCampos.map((campo, i) => {
    const subset = points.filter((p) => p.campo === campo);
    const color = PALETTE[i % PALETTE.length];
    return {
      type: "scattergl",
      mode: "markers",
      name: campo,
      x: subset.map((p) => p.mes_desde_t0),
      y: subset.map((p) => p.bsw),
      customdata: subset.map((p) => [p.poco, p.ano, p.mes] as [string, number, number]),
      marker: { size: 4, opacity: 0.55, color },
      hovertemplate:
        "<b>%{customdata[0]}</b><br>" +
        "%{customdata[1]}-%{customdata[2]:02d}<br>" +
        "BSW: %{y:.1%}<br>" +
        "Months since start: %{x}" +
        "<extra>" + campo + "</extra>",
    } as unknown as PlotData;
  });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 460,
      margin: { t: 30, b: 60, l: 70, r: 30 },
      xaxis: {
        ...AXIS_LINE,
        title: { text: "Months since first production" },
        rangemode: "tozero",
      },
      yaxis: {
        ...AXIS_LINE,
        title: { text: "BSW (water cut)" },
        range: [0, 1],
        tickformat: ",.0%",
      },
      legend: {
        orientation: "v",
        x: 1.02,
        xanchor: "left",
        y: 1,
        yanchor: "top",
      },
      hovermode: "closest",
    },
  };
}

function buildFieldAverageChart(
  points: AnpCdpBswFieldPoint[],
  selectedCampos: string[],
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!selectedCampos.length) {
    return emptyPlot(
      460,
      "Select one or more fields to plot BSW evolution.",
    );
  }
  if (!points.length) {
    return emptyPlot(460, "No data for the selected fields.");
  }

  // One trace per campo (volume-weighted average across wells at each
  // month-since-first-production). lines+markers, low-volume scatter (not gl).
  const traces: PlotData[] = selectedCampos.map((campo, i) => {
    const subset = points
      .filter((p) => p.campo === campo)
      .sort((a, b) => a.mes_desde_t0 - b.mes_desde_t0);
    const color = PALETTE[i % PALETTE.length];
    return {
      type: "scatter",
      mode: "lines+markers",
      name: campo,
      x: subset.map((p) => p.mes_desde_t0),
      y: subset.map((p) => p.bsw),
      customdata: subset.map(
        (p) => [p.n_pocos, p.volume_total] as [number, number],
      ),
      line: { color, width: 2 },
      marker: { size: 6, color },
      hovertemplate:
        "<b>" + campo + "</b><br>" +
        "Months since start: %{x}<br>" +
        "BSW (vol-weighted): %{y:.1%}<br>" +
        "Wells: %{customdata[0]}<br>" +
        "Total volume: %{customdata[1]:,.0f}" +
        "<extra></extra>",
    } as unknown as PlotData;
  });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 460,
      margin: { t: 30, b: 60, l: 70, r: 30 },
      xaxis: {
        ...AXIS_LINE,
        title: { text: "Months since first production" },
        rangemode: "tozero",
      },
      yaxis: {
        ...AXIS_LINE,
        title: { text: "BSW (water cut, volume-weighted)" },
        range: [0, 1],
        tickformat: ",.0%",
      },
      legend: {
        orientation: "v",
        x: 1.02,
        xanchor: "left",
        y: 1,
        yanchor: "top",
      },
      hovermode: "closest",
    },
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnpCdpBswPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-cdp-bsw");
  const supabase = getSupabaseClient();

  const [filtros, setFiltros] = useState<AnpCdpFiltros>({
    bacoes: [], campos: [], locais: [], estados: [], operadores: [],
    instalacoes: [], tipos_instalacao: [], ano_min: null, ano_max: null,
  });
  const [filtrosLoading, setFiltrosLoading] = useState(true);
  const [selectedCampos, setSelectedCampos] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("well");
  const [wellPoints,  setWellPoints]  = useState<AnpCdpBswPoint[]>([]);
  const [fieldPoints, setFieldPoints] = useState<AnpCdpBswFieldPoint[]>([]);

  // ── Initial load: only the campos list ────────────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const f = await rpcGetAnpCdpFiltros(supabase);
      if (cancelled) return;
      setFiltros(f);
      setFiltrosLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // ── Reactive per-well fetch (debounced 400ms) ─────────────────────────────
  const { data: wellRefetched, loading: wellLoading } = useDebouncedFetch(
    async () => {
      if (!supabase) return [] as AnpCdpBswPoint[];
      if (viewMode !== "well") return [] as AnpCdpBswPoint[];
      if (selectedCampos.length === 0) return [] as AnpCdpBswPoint[];
      return rpcGetAnpCdpBswScatter(supabase, selectedCampos);
    },
    [supabase, selectedCampos, viewMode],
    { ms: 400, skipInitial: false },
  );

  useEffect(() => {
    if (wellRefetched !== null) setWellPoints(wellRefetched);
  }, [wellRefetched]);

  // ── Reactive field-average fetch (debounced 400ms) ────────────────────────
  const { data: fieldRefetched, loading: fieldLoading } = useDebouncedFetch(
    async () => {
      if (!supabase) return [] as AnpCdpBswFieldPoint[];
      if (viewMode !== "field") return [] as AnpCdpBswFieldPoint[];
      if (selectedCampos.length === 0) return [] as AnpCdpBswFieldPoint[];
      return rpcGetAnpCdpBswFieldAggregate(supabase, selectedCampos);
    },
    [supabase, selectedCampos, viewMode],
    { ms: 400, skipInitial: false },
  );

  useEffect(() => {
    if (fieldRefetched !== null) setFieldPoints(fieldRefetched);
  }, [fieldRefetched]);

  // Reset cached points when selection is empty so the empty state renders
  // cleanly. We intentionally don't depend on the cache arrays themselves to
  // avoid an infinite update loop.
  useEffect(() => {
    if (selectedCampos.length === 0) {
      setWellPoints([]);
      setFieldPoints([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCampos.length]);

  const chart = useMemo(() => {
    return viewMode === "well"
      ? buildPerWellChart(wellPoints, selectedCampos)
      : buildFieldAverageChart(fieldPoints, selectedCampos);
  }, [viewMode, wellPoints, fieldPoints, selectedCampos]);

  const chartLoading = viewMode === "well" ? wellLoading : fieldLoading;

  const fieldColor = (c: string): string => {
    const i = selectedCampos.indexOf(c);
    return i >= 0 ? PALETTE[i % PALETTE.length] : "#dcdcdc";
  };

  if (visLoading || !visible) return null;

  return (
    <div>
      <NavBar />
      <div className="container-fluid g-0">
        <div className="row g-0">

          {/* ── Sidebar ──────────────────────────────────────────────── */}
          <div className="col-xxl-2 col-md-3 p-0">
            <div id="sidebar">
              <div style={{ textAlign: "center" }}>
                <div style={{
                  width: "100%", maxWidth: 300, height: 60, display: "flex",
                  alignItems: "center", justifyContent: "center",
                  border: "2px dashed #ccc", color: "#aaa", fontSize: 18,
                  fontWeight: 700, letterSpacing: 3, marginBottom: 16, borderRadius: 6,
                }}>TBD</div>
              </div>
              <hr style={{ borderTop: "1px solid #f0f0f0", marginBottom: 14 }} />
              <div className="sidebar-section-label">Filters</div>

              {/* Field — searchable multi-select */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">
                  Field{" "}
                  <span style={{ color: "#888", fontWeight: 400 }}>
                    ({selectedCampos.length === 0 ? filtros.campos.length : selectedCampos.length}/{filtros.campos.length})
                  </span>
                </div>
                {!filtrosLoading && (
                  <SearchableMultiSelect
                    options={filtros.campos}
                    value={selectedCampos}
                    onChange={setSelectedCampos}
                  />
                )}
                <div style={{
                  fontSize: 10,
                  color: "#888",
                  fontFamily: "Arial",
                  marginTop: 8,
                  lineHeight: 1.4,
                }}>
                  Each field gets a chart color in selection order.
                </div>
              </div>

              {/* Selected fields — colored chips */}
              {selectedCampos.length > 0 && (
                <div className="sidebar-filter-section">
                  <div className="sidebar-filter-label">Selected fields</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {selectedCampos.map((c) => (
                      <span
                        key={c}
                        title={c}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          backgroundColor: "#f7f7f7",
                          border: "1px solid #ececec",
                          borderRadius: 999,
                          padding: "3px 10px 3px 8px",
                          fontFamily: "Arial",
                          fontSize: 11,
                          color: "#333",
                          maxWidth: "100%",
                        }}
                      >
                        <span
                          aria-hidden
                          style={{
                            display: "inline-block",
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            backgroundColor: fieldColor(c),
                            flexShrink: 0,
                          }}
                        />
                        <span style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          maxWidth: 160,
                        }}>
                          {c}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Main content ────────────────────────────────────────── */}
          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <DashboardHeader
                title="ANP CDP — BSW by Well"
                sub="Water cut (BSW) vs months since first production, by well"
              />

              {filtrosLoading ? (
                <BarrelLoading />
              ) : (
                <>
                  {/* View-mode toggle (above chart, right-aligned) */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      marginBottom: 10,
                    }}
                  >
                    <SegmentedToggle<ViewMode>
                      variant="compact"
                      options={VIEW_OPTIONS}
                      value={viewMode}
                      onChange={setViewMode}
                    />
                  </div>

                  <ChartSection
                    title={
                      viewMode === "well"
                        ? "BSW evolution per well"
                        : "BSW evolution — field average (volume-weighted)"
                    }
                    loading={chartLoading}
                    height={460}
                  >
                    <PlotlyChart
                      data={chart.data}
                      layout={chart.layout}
                      config={{ responsive: true, displayModeBar: false }}
                      style={{ width: "100%", height: 460 }}
                    />
                  </ChartSection>
                </>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
