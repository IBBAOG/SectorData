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
  rpcGetAnpCdpBswCampos,
  rpcGetAnpCdpBswScatter,
  rpcGetAnpCdpBswFieldAggregate,
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
      "Select a field to plot BSW evolution.",
    );
  }
  if (!points.length) {
    return emptyPlot(460, "No data for the selected field.");
  }

  // Per-well mode: one trace per unique poco (in first-appearance order so
  // colors stay stable between renders). Single field is selected at a time
  // in this mode, so the legend shows the wells of that field.
  const seen: string[] = [];
  for (const p of points) {
    if (!seen.includes(p.poco)) seen.push(p.poco);
  }
  const traces: PlotData[] = seen.map((poco, i) => {
    const subset = points.filter((p) => p.poco === poco);
    const color = PALETTE[i % PALETTE.length];
    return {
      type: "scattergl",
      mode: "markers",
      name: poco,
      x: subset.map((p) => p.mes_desde_t0),
      y: subset.map((p) => p.bsw),
      customdata: subset.map((p) => [p.poco, p.ano, p.mes] as [string, number, number]),
      marker: { size: 4, opacity: 0.7, color },
      hovertemplate:
        "<b>%{customdata[0]}</b><br>" +
        "Reference month: %{customdata[1]}-%{customdata[2]:02d}<br>" +
        "BSW: %{y:.1%}<br>" +
        "Months since start: %{x}" +
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
        itemsizing: "constant",
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
        (p) =>
          [p.n_pocos, p.volume_total, p.ref_ano, p.ref_mes] as [
            number,
            number,
            number,
            number,
          ],
      ),
      line: { color, width: 2 },
      marker: { size: 6, color },
      hovertemplate:
        "<b>" + campo + "</b><br>" +
        "Reference month: %{customdata[2]}-%{customdata[3]:02d}<br>" +
        "Months since start: %{x}<br>" +
        "BSW (vol-weighted): %{y:.1%}<br>" +
        "Wells contributing: %{customdata[0]}<br>" +
        "Total volume: %{customdata[1]:,.0f} bbl/d" +
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

  // Offshore-only field list (PreSal + PosSal). Sourced from the dedicated
  // `get_anp_cdp_bsw_campos` RPC so the sidebar dropdown never shows onshore
  // fields that aren't relevant for this dashboard's BSW analysis.
  const [campos, setCampos] = useState<string[]>([]);
  const [filtrosLoading, setFiltrosLoading] = useState(true);
  const [selectedCampos, setSelectedCampos] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("well");
  const [wellPoints,  setWellPoints]  = useState<AnpCdpBswPoint[]>([]);
  const [fieldPoints, setFieldPoints] = useState<AnpCdpBswFieldPoint[]>([]);

  // ── Initial load: only the offshore campos list ──────────────────────────
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const list = await rpcGetAnpCdpBswCampos(supabase);
      if (cancelled) return;
      setCampos(list);
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

  // Per-well mode: count unique wells in the currently fetched points so the
  // sidebar can hint at the legend size for the selected field.
  const uniqueWellCount = useMemo(() => {
    if (viewMode !== "well") return 0;
    if (!wellPoints.length) return 0;
    const set = new Set<string>();
    for (const p of wellPoints) set.add(p.poco);
    return set.size;
  }, [viewMode, wellPoints]);

  // Mode-aware setters. In Per-well mode the field filter behaves as a
  // single-select: picking a 2nd field replaces the first, and switching
  // from Field-average → Per-well trims the selection to the first field.
  const handleModeChange = (next: ViewMode) => {
    setViewMode(next);
    if (next === "well" && selectedCampos.length > 1) {
      setSelectedCampos(selectedCampos.slice(0, 1));
    }
  };

  const handleCamposChange = (next: string[]) => {
    if (viewMode === "well") {
      if (next.length === 0) {
        setSelectedCampos([]);
        return;
      }
      // Single-select: prefer the newly added field (the one not in the
      // previous selection); fall back to the last entry if no diff is
      // detectable (e.g. user used "Select all").
      const added = next.find((c) => !selectedCampos.includes(c));
      setSelectedCampos([added ?? next[next.length - 1]]);
      return;
    }
    setSelectedCampos(next);
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

              {/* ── View-mode toggle (pill) ─────────────────────────── */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">View</div>
                <SegmentedToggle<ViewMode>
                  options={VIEW_OPTIONS}
                  value={viewMode}
                  onChange={handleModeChange}
                />
              </div>

              <div className="sidebar-section-label">Filters</div>

              {/* Field — searchable multi-select (offshore: Pre-Salt + Post-Salt) */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">
                  Field{" "}
                  <span style={{ color: "#888", fontWeight: 400 }}>
                    ({selectedCampos.length === 0 ? campos.length : selectedCampos.length}/{campos.length})
                  </span>
                </div>
                {!filtrosLoading && (
                  <SearchableMultiSelect
                    options={campos}
                    value={selectedCampos}
                    onChange={handleCamposChange}
                  />
                )}
                <div style={{
                  fontSize: 10,
                  color: "#888",
                  fontFamily: "Arial",
                  marginTop: 8,
                  lineHeight: 1.4,
                }}>
                  {viewMode === "well"
                    ? "Single-select: each well gets its own color in the chart legend."
                    : "Each field gets a chart color in selection order."}
                </div>
                {viewMode === "well" && selectedCampos.length === 1 && uniqueWellCount > 0 && (
                  <div style={{
                    fontSize: 10,
                    color: "#888",
                    fontFamily: "Arial",
                    marginTop: 4,
                    lineHeight: 1.4,
                  }}>
                    {uniqueWellCount} {uniqueWellCount === 1 ? "well" : "wells"} in this field
                  </div>
                )}
              </div>

              {/* Selected fields — colored chips */}
              {selectedCampos.length > 0 && (
                <div className="sidebar-filter-section">
                  <div className="sidebar-filter-label">
                    {viewMode === "well" && selectedCampos.length === 1
                      ? "Selected field"
                      : "Selected fields"}
                  </div>
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
                  <ChartSection
                    title={
                      viewMode === "well"
                        ? selectedCampos.length === 1
                          ? `BSW evolution per well — ${selectedCampos[0]}`
                          : "BSW evolution per well"
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
