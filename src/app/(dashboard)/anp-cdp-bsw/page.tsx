"use client";

import { useEffect, useMemo, useState } from "react";
import type { Layout, PlotData } from "plotly.js";

import NavBar from "../../../components/NavBar";
import PlotlyChart from "../../../components/PlotlyChart";
import DashboardHeader from "../../../components/dashboard/DashboardHeader";
import MultiSelectFilter from "../../../components/dashboard/MultiSelectFilter";
import ChartSection from "../../../components/dashboard/ChartSection";
import BarrelLoading from "../../../components/dashboard/BarrelLoading";
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
import { useDebouncedFetch } from "../../../hooks/useDebouncedFetch";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot, PALETTE } from "../../../lib/plotlyDefaults";
import {
  rpcGetAnpCdpFiltros,
  rpcGetAnpCdpBswScatter,
  type AnpCdpFiltros,
  type AnpCdpBswPoint,
} from "../../../lib/rpc";

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildScatterChart(
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnpCdpBswPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-cdp-bsw");
  const supabase = getSupabaseClient();

  const [filtros, setFiltros] = useState<AnpCdpFiltros>({
    bacoes: [], campos: [], locais: [], estados: [], operadores: [],
    instalacoes: [], tipos_instalacao: [], ano_min: null, ano_max: null,
  });
  const [filtrosLoading, setFiltrosLoading] = useState(true);
  const [points, setPoints] = useState<AnpCdpBswPoint[]>([]);
  const [selectedCampos, setSelectedCampos] = useState<string[]>([]);

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

  // ── Reactive scatter fetch (debounced 400ms) ──────────────────────────────
  const { data: refetched, loading: scatterLoading } = useDebouncedFetch(
    async () => {
      if (!supabase) return [] as AnpCdpBswPoint[];
      if (selectedCampos.length === 0) return [] as AnpCdpBswPoint[];
      return rpcGetAnpCdpBswScatter(supabase, selectedCampos);
    },
    [supabase, selectedCampos],
    { ms: 400, skipInitial: false },
  );

  useEffect(() => {
    if (refetched !== null) setPoints(refetched);
  }, [refetched]);

  // Reset points when selection is empty so the empty state renders cleanly.
  useEffect(() => {
    if (selectedCampos.length === 0 && points.length > 0) {
      setPoints([]);
    }
    // We intentionally don't depend on `points` to avoid an infinite loop;
    // we only want to drop stale data the moment selection becomes empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCampos.length]);

  const chart = useMemo(
    () => buildScatterChart(points, selectedCampos),
    [points, selectedCampos],
  );

  function toggleCampo(c: string) {
    setSelectedCampos((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );
  }

  function clearCampos() {
    setSelectedCampos([]);
  }

  const fieldColor = (c: string): string => {
    const i = selectedCampos.indexOf(c);
    return i >= 0 ? PALETTE[i % PALETTE.length] : "#dcdcdc";
  };

  if (visLoading || !visible) return null;

  return (
    <div>
      <NavBar />
      <div className="container-fluid">
        <DashboardHeader
          title="ANP CDP — BSW by Well"
          sub="Water cut (BSW) vs months since first production, by well"
        />

        {filtrosLoading ? (
          <BarrelLoading />
        ) : (
          <>
            {/* ── Filter panel above the chart ─────────────────────────── */}
            <div
              className="chart-container"
              style={{
                marginBottom: 16,
                padding: 16,
              }}
            >
              <div className="section-title">Field</div>
              <hr className="section-hr" />
              <div style={{ fontSize: 11, color: "#888", fontFamily: "Arial", marginBottom: 8 }}>
                Pick one or more fields. Each field gets a color in the chart (in selection order).
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                  columnGap: 16,
                  rowGap: 0,
                }}
              >
                <MultiSelectFilter
                  label={
                    <>
                      Field
                    </>
                  }
                  items={filtros.campos}
                  selected={selectedCampos}
                  onToggle={toggleCampo}
                  onClear={selectedCampos.length > 0 ? clearCampos : undefined}
                  swatch={fieldColor}
                  idPrefix="bsw-campo"
                  counterTotal={filtros.campos.length}
                />
              </div>
            </div>

            {/* ── Scatter chart ────────────────────────────────────────── */}
            <ChartSection
              title="BSW evolution per well"
              loading={scatterLoading}
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
  );
}
