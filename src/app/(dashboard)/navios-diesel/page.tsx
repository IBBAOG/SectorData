"use client";

import { useEffect, useMemo, useState } from "react";
import type { Layout, PlotData } from "plotly.js";

import NavBar from "../../../components/NavBar";
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
import PlotlyChart from "../../../components/PlotlyChart";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import {
  rpcGetNdUltimaColeta,
  rpcGetNdColetasDistintas,
  rpcGetNdNavios,
  rpcGetNdResumoMensalPortos,
  rpcGetNdVolumeMensalDescarga,
  rpcGetNdNaviosDescarregados,
  type NavioDieselRow,
  type NdResumoMensalPortoRow,
  type NdVolumeMensalDescargaRow,
  type NdNavioDescarregadoRow,
} from "../../../lib/rpc";

const ORANGE = "#FF5000";
const ORANGE_HOVER = "#FFE8D9";

const PORT_COORDS: Record<string, { lat: number; lon: number }> = {
  "Porto de Santos":        { lat: -23.9543, lon: -46.3073 },
  "Porto de Itaqui":        { lat: -2.5657,  lon: -44.3484 },
  "Porto de Paranaguá":     { lat: -25.5163, lon: -48.5228 },
  "Porto de Suape":         { lat: -8.3943,  lon: -34.9630 },
  "Porto de São Sebastião": { lat: -23.8170, lon: -45.4170 },
};

const STATUS_COLORS: Record<string, string> = {
  Atracado:   "#d4edda",
  Esperado:   "#fff3cd",
  "Ao Largo": "#d1ecf1",
  Fundeado:   "#d1ecf1",
  Despachado: "#e2e3e5",
};

const STATUS_LABELS: Record<string, string> = {
  Atracado:   "Berthed",
  Esperado:   "Expected",
  "Ao Largo": "Offshore",
  Fundeado:   "Anchored",
  Despachado: "Departed",
};

function fmtTs(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "2-digit", day: "2-digit", year: "2-digit",
  });
}

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "2-digit", year: "numeric",
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit",
  });
}

function hoursAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "< 1 h ago";
  return `${h} h ago`;
}

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW = ["Su","Mo","Tu","We","Th","Fr","Sa"];

function calCells(year: number, month: number): (number | null)[] {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  return cells;
}

const TITLE_STYLE: React.CSSProperties = {
  fontFamily: "Arial",
  fontSize: 14,
  fontWeight: 700,
  color: ORANGE,
  marginBottom: 4,
};

export default function NaviosDieselPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("navios-diesel");
  const supabase = getSupabaseClient();

  const [coletas, setColetas] = useState<string[]>([]);
  const [selectedDay, setSelectedDay] = useState<string>("");
  const [selectedColeta, setSelectedColeta] = useState<string>("");
  const [volumeMensal, setVolumeMensal] = useState<NdVolumeMensalDescargaRow[]>([]);
  const [naviosDescarregados, setNaviosDescarregados] = useState<NdNavioDescarregadoRow[]>([]);
  const [calMonth, setCalMonth] = useState<number>(new Date().getMonth());
  const [calYear, setCalYear] = useState<number>(new Date().getFullYear());
  const [navios, setNavios] = useState<NavioDieselRow[]>([]);
  const [resumoMensal, setResumoMensal] = useState<NdResumoMensalPortoRow[]>([]);
  const [naviosAnteriores, setNaviosAnteriores] = useState<NavioDieselRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredDay, setHoveredDay] = useState<string | null>(null);
  const [hoveredColeta, setHoveredColeta] = useState<string | null>(null);
  const [hoveredNavBtn, setHoveredNavBtn] = useState<"prev" | "next" | null>(null);

  // Ports that failed data collection in this snapshot (used for the error notice in Vessel Details)
  const errorPorts = useMemo(
    () => navios.filter(n => n.status === "ERRO_COLETA").map(n => n.porto),
    [navios]
  );

  // Vessel rows without the error sentinels and without "Despachado" (Departed)
  const naviosDisplay = useMemo(
    () => navios.filter(n => n.status !== "ERRO_COLETA" && n.status !== "Despachado"),
    [navios]
  );

  // Per-port totals aggregated across all months — used by the map
  const resumoByPorto = useMemo(() => {
    const m = new Map<string, { total_navios: number; total_convertida: number }>();
    for (const r of resumoMensal) {
      const entry = m.get(r.porto) ?? { total_navios: 0, total_convertida: 0 };
      entry.total_navios += r.vessels;
      entry.total_convertida += r.volume;
      m.set(r.porto, entry);
    }
    return m;
  }, [resumoMensal]);

  // Vessels present today but absent from the previous day's last snapshot → "New!"
  const newVesselSet = useMemo(() => {
    if (naviosAnteriores.length === 0) return new Set<string>();
    const prevKeys = new Set(naviosAnteriores.map(n => `${n.navio}__${n.porto}`));
    return new Set(
      naviosDisplay
        .filter(n => !prevKeys.has(`${n.navio}__${n.porto}`))
        .map(n => `${n.navio}__${n.porto}`)
    );
  }, [naviosAnteriores, naviosDisplay]);

  // Group timestamps by day
  const coletasByDay = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const ts of coletas) {
      const day = ts.slice(0, 10);
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(ts);
    }
    return map;
  }, [coletas]);

  const days = useMemo(() => Array.from(coletasByDay.keys()), [coletasByDay]);
  const daysSet = useMemo(() => new Set(days), [days]);

  const timesForDay = useMemo(
    () => coletasByDay.get(selectedDay) ?? [],
    [coletasByDay, selectedDay]
  );

  // Most-recent snapshot of the day before selectedDay — reference for "new" vessels
  const prevDaySnapshot = useMemo(() => {
    const dayIdx = days.indexOf(selectedDay);
    if (dayIdx < 0 || dayIdx >= days.length - 1) return null;
    const prevDay = days[dayIdx + 1]; // days sorted DESC → next index = previous day
    const times = coletasByDay.get(prevDay) ?? [];
    return times[0] ?? null;         // times[0] = most recent of that day (DESC)
  }, [days, selectedDay, coletasByDay]);

  // 1. Load available collection timestamps
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const ts = await rpcGetNdColetasDistintas(supabase);
      if (cancelled) return;
      setColetas(ts);
      if (ts.length > 0) {
        const firstDay = ts[0].slice(0, 10);
        setSelectedDay(firstDay);
        setSelectedColeta(ts[0]);
        const [yr, mo] = firstDay.split("-").map(Number);
        setCalYear(yr);
        setCalMonth(mo - 1);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // 2. Load monthly discharged vs pending volume — re-runs when snapshot changes
  useEffect(() => {
    if (!supabase || !selectedColeta) return;
    let cancelled = false;
    (async () => {
      const [monthly, discharged] = await Promise.all([
        rpcGetNdVolumeMensalDescarga(supabase, selectedColeta),
        rpcGetNdNaviosDescarregados(supabase, selectedColeta),
      ]);
      if (cancelled) return;
      setVolumeMensal(monthly);
      setNaviosDescarregados(discharged);
    })();
    return () => { cancelled = true; };
  }, [supabase, selectedColeta]);

  // 3. Load data when selected timestamp changes
  useEffect(() => {
    if (!supabase || !selectedColeta) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [nav, mensal] = await Promise.all([
        rpcGetNdNavios(supabase, selectedColeta),
        rpcGetNdResumoMensalPortos(supabase, selectedColeta),
      ]);
      if (cancelled) return;
      setNavios(nav);
      setResumoMensal(mensal);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase, selectedColeta]);

  // 4. Load previous-day snapshot vessels for "New!" detection
  useEffect(() => {
    if (!supabase || !prevDaySnapshot) {
      setNaviosAnteriores([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const nav = await rpcGetNdNavios(supabase, prevDaySnapshot);
      if (!cancelled) setNaviosAnteriores(nav);
    })();
    return () => { cancelled = true; };
  }, [supabase, prevDaySnapshot]);

  // Build map traces
  const mapChart = useMemo(() => {
    if (resumoByPorto.size === 0) {
      return {
        data: [] as PlotData[],
        layout: {
          paper_bgcolor: "white", plot_bgcolor: "white",
          xaxis: { visible: false }, yaxis: { visible: false },
          annotations: [{ text: "No data", xref: "paper" as const, yref: "paper" as const, showarrow: false, font: { size: 13, family: "Arial", color: "#888" } }],
          height: 280, margin: { t: 10, b: 10, l: 10, r: 10 },
        } as Partial<Layout>,
      };
    }

    const lats: number[] = [];
    const lons: number[] = [];
    const texts: string[] = [];
    const sizes: number[] = [];
    const colors: string[] = [];

    for (const [porto, c] of Object.entries(PORT_COORDS)) {
      const p = resumoByPorto.get(porto);
      lats.push(c.lat);
      lons.push(c.lon);
      if (p) {
        texts.push(
          `<b>${porto}</b><br>` +
          `${p.total_navios} vessels<br>` +
          `${p.total_convertida.toLocaleString("en-US", { maximumFractionDigits: 0 })} m³`
        );
        sizes.push(Math.max(14, Math.sqrt(p.total_navios) * 16));
        colors.push(ORANGE);
      } else {
        texts.push(`<b>${porto}</b><br>0 vessels<br>0 m³`);
        sizes.push(9);
        colors.push("#cccccc");
      }
    }

    const data: PlotData[] = [
      {
        type: "scattergeo",
        lat: lats,
        lon: lons,
        text: texts,
        hoverinfo: "text",
        marker: {
          size: sizes,
          color: colors,
          opacity: 0.85,
          line: { color: "#000512", width: 1.5 },
        },
      } as unknown as PlotData,
    ];

    const layout: Partial<Layout> = {
      geo: {
        scope: "south america",
        resolution: 50,
        lonaxis: { range: [-65, -30] },
        lataxis: { range: [-35, 10] },
        showland: true,
        landcolor: "#f5f5f5",
        showocean: true,
        oceancolor: "#e8f4fd",
        showcountries: true,
        countrycolor: "#ccc",
        showcoastlines: true,
        coastlinecolor: "#aaa",
      } as Layout["geo"],
      paper_bgcolor: "white",
      margin: { t: 0, b: 0, l: 0, r: 0 },
      height: 280,
      hoverlabel: {
        bgcolor: "rgba(255,255,255,0.95)",
        bordercolor: "rgba(180,180,180,0.5)",
        font: { family: "Arial", color: "#1a1a1a", size: 12 },
      },
    };

    return { data, layout };
  }, [resumoByPorto]);

  // Build monthly stacked bar chart: discharged (black) + pending (orange)
  const monthlyChart = useMemo(() => {
    if (volumeMensal.length === 0) {
      return {
        data: [] as PlotData[],
        layout: {
          paper_bgcolor: "white", plot_bgcolor: "white",
          xaxis: { visible: false }, yaxis: { visible: false },
          annotations: [{ text: "No data", xref: "paper" as const, yref: "paper" as const,
            showarrow: false, font: { size: 13, family: "Arial", color: "#888" } }],
          height: 220, margin: { t: 30, b: 36, l: 110, r: 0 },
        } as Partial<Layout>,
      };
    }

    const labels = volumeMensal.map(r => {
      const [yr, mo] = r.month.split("-");
      return new Date(Number(yr), Number(mo) - 1, 1)
        .toLocaleDateString("en-US", { month: "short", year: "numeric" });
    });

    const INDETERMINATE_COLOR = "#73C6A1";

    const maxTotal = Math.max(...volumeMensal.map(r =>
      r.discharged_volume + r.pending_volume + r.indeterminate_volume
    ));

    const data: PlotData[] = [
      {
        type: "bar",
        name: "Discharged",
        x: labels,
        y: volumeMensal.map(r => r.discharged_volume),
        text: volumeMensal.map(r =>
          r.discharged_volume > 0
            ? r.discharged_volume.toLocaleString("en-US", { maximumFractionDigits: 0 })
            : ""
        ),
        textposition: "inside",
        textfont: { family: "Arial", size: 10, color: "#ffffff" },
        marker: { color: "#000000", opacity: 0.85 },
        hovertemplate: "%{x}<br>Discharged: %{y:,.0f} m³<extra></extra>",
      } as unknown as PlotData,
      {
        type: "bar",
        name: "Pending Discharge",
        x: labels,
        y: volumeMensal.map(r => r.pending_volume),
        text: volumeMensal.map(r =>
          r.pending_volume > 0
            ? r.pending_volume.toLocaleString("en-US", { maximumFractionDigits: 0 })
            : ""
        ),
        textposition: "inside",
        textfont: { family: "Arial", size: 10, color: "#ffffff" },
        marker: { color: ORANGE, opacity: 0.85 },
        hovertemplate: "%{x}<br>Pending: %{y:,.0f} m³<extra></extra>",
      } as unknown as PlotData,
      {
        type: "bar",
        name: "Indeterminate Status",
        x: labels,
        y: volumeMensal.map(r => r.indeterminate_volume),
        text: volumeMensal.map(r =>
          r.indeterminate_volume > 0
            ? r.indeterminate_volume.toLocaleString("en-US", { maximumFractionDigits: 0 })
            : ""
        ),
        textposition: "inside",
        textfont: { family: "Arial", size: 10, color: "#ffffff" },
        marker: { color: INDETERMINATE_COLOR, opacity: 0.85 },
        hovertemplate: "%{x}<br>Indeterminate Status: %{y:,.0f} m³<extra></extra>",
      } as unknown as PlotData,
    ];

    // Total label above each stacked bar via annotations
    const totalAnnotations = volumeMensal.map((r, i) => ({
      x: labels[i],
      y: r.discharged_volume + r.pending_volume + r.indeterminate_volume,
      text: (r.discharged_volume + r.pending_volume + r.indeterminate_volume)
        .toLocaleString("en-US", { maximumFractionDigits: 0 }),
      showarrow: false,
      yanchor: "bottom" as const,
      yshift: 4,
      font: { family: "Arial", size: 10, color: "#1a1a1a" },
    }));

    const layout: Partial<Layout> = {
      barmode: "stack",
      paper_bgcolor: "white",
      plot_bgcolor: "white",
      // t: 54 dá espaço para a legenda horizontal acima das barras
      margin: { t: 54, b: 36, l: 110, r: 0 },
      height: 220,
      // bargap: 0 + range explícito eliminam o padding lateral padrão do Plotly,
      // fazendo cada barra cobrir exatamente a largura de uma coluna da tabela abaixo
      bargap: 0,
      yaxis: { visible: false, range: [0, maxTotal * 1.25] },
      xaxis: {
        tickfont: { family: "Arial", size: 11 },
        range: [-0.5, volumeMensal.length - 0.5],
      },
      annotations: totalAnnotations,
      legend: {
        orientation: "h",
        x: -0.3,
        y: 1.02,
        xanchor: "left",
        yanchor: "bottom",
        traceorder: "normal",
        font: { family: "Arial", size: 11 },
      },
      hoverlabel: {
        bgcolor: "rgba(255,255,255,0.95)",
        bordercolor: "rgba(180,180,180,0.5)",
        font: { family: "Arial", color: "#1a1a1a", size: 12 },
      },
    };

    return { data, layout };
  }, [volumeMensal]);

  // Build port monthly summary from all three status categories (via resumoMensal)
  const portMonthlySummary = useMemo(() => {
    const portMap = new Map<string, Map<string, { vessels: number; volume: number }>>();
    const monthsSet = new Set<string>();

    for (const r of resumoMensal) {
      monthsSet.add(r.month);
      if (!portMap.has(r.porto)) portMap.set(r.porto, new Map());
      portMap.get(r.porto)!.set(r.month, { vessels: r.vessels, volume: r.volume });
    }

    const months = Array.from(monthsSet).sort();
    const ports = Array.from(portMap.keys()).sort();
    const monthLabels: Record<string, string> = {};
    for (const m of months) {
      const [yr, mo] = m.split("-");
      monthLabels[m] = new Date(Number(yr), Number(mo) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
    }

    return { ports, months, monthLabels, portMap };
  }, [resumoMensal]);

  if (visLoading || !visible) return null;

  return (
    <div>
      <NavBar />

      <div className="container-fluid g-0">
        <div className="row g-0">
          {/* ── Sidebar ── */}
          <div className="col-2 p-0">
            <div id="sidebar">
              <div style={{ textAlign: "center" }}>
                <img src="/logo.png" alt="Itaú BBA" style={{ width: "100%", maxWidth: 300, marginBottom: 16 }} />
              </div>

              <hr style={{ borderTop: "1px solid #f0f0f0", marginBottom: 14 }} />

              <div className="sidebar-section-label">Snapshot</div>

              {/* Inline Calendar */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Date</div>
                <div style={{ fontFamily: "Arial", userSelect: "none" }}>
                  {/* Month/Year navigation */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <button
                      type="button"
                      className="btn-hover-transition"
                      onClick={() => { if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); } else setCalMonth(m => m - 1); }}
                      onMouseEnter={() => setHoveredNavBtn("prev")}
                      onMouseLeave={() => setHoveredNavBtn(null)}
                      style={{ background: hoveredNavBtn === "prev" ? ORANGE_HOVER : "none", border: "none", borderRadius: 4, cursor: "pointer", color: ORANGE, fontSize: 16, lineHeight: 1, padding: "0 4px" }}
                    >‹</button>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#1a1a1a" }}>
                      {MONTH_NAMES[calMonth]} {calYear}
                    </span>
                    <button
                      type="button"
                      className="btn-hover-transition"
                      onClick={() => { if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); } else setCalMonth(m => m + 1); }}
                      onMouseEnter={() => setHoveredNavBtn("next")}
                      onMouseLeave={() => setHoveredNavBtn(null)}
                      style={{ background: hoveredNavBtn === "next" ? ORANGE_HOVER : "none", border: "none", borderRadius: 4, cursor: "pointer", color: ORANGE, fontSize: 16, lineHeight: 1, padding: "0 4px" }}
                    >›</button>
                  </div>
                  {/* Day-of-week headers */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", textAlign: "center", marginBottom: 2 }}>
                    {DOW.map(d => (
                      <div key={d} style={{ fontSize: 9, color: "#aaa", fontWeight: 700, padding: "2px 0" }}>{d}</div>
                    ))}
                  </div>
                  {/* Day cells */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", textAlign: "center" }}>
                    {calCells(calYear, calMonth).map((d, i) => {
                      if (!d) return <div key={i} />;
                      const dayStr = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                      const hasData = daysSet.has(dayStr);
                      const isSelected = selectedDay === dayStr;
                      return (
                        <button
                          key={i}
                          type="button"
                          className="btn-hover-transition"
                          disabled={!hasData}
                          onClick={() => {
                            if (!hasData) return;
                            setSelectedDay(dayStr);
                            const times = coletasByDay.get(dayStr) ?? [];
                            if (times.length > 0) setSelectedColeta(times[0]);
                          }}
                          onMouseEnter={() => { if (hasData) setHoveredDay(dayStr); }}
                          onMouseLeave={() => setHoveredDay(null)}
                          style={{
                            padding: "4px 0",
                            margin: "1px",
                            borderRadius: 4,
                            border: "none",
                            backgroundColor: isSelected ? ORANGE : hasData && hoveredDay === dayStr ? ORANGE_HOVER : "transparent",
                            color: isSelected ? "#fff" : hasData ? "#1a1a1a" : "#ddd",
                            fontFamily: "Arial",
                            fontSize: 10,
                            fontWeight: hasData ? 600 : 400,
                            cursor: hasData ? "pointer" : "default",
                          }}
                        >
                          {d}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Time filter */}
              {timesForDay.length > 0 && (
                <div className="sidebar-filter-section">
                  <div className="sidebar-filter-label">Collection Time</div>
                  <div style={{ maxHeight: 160, overflowY: "auto" }}>
                    {timesForDay.map((ts) => (
                      <button
                        key={ts}
                        type="button"
                        className="btn-hover-transition"
                        onClick={() => setSelectedColeta(ts)}
                        onMouseEnter={() => setHoveredColeta(ts)}
                        onMouseLeave={() => setHoveredColeta(null)}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          padding: "5px 10px",
                          marginBottom: 3,
                          borderRadius: 6,
                          border: selectedColeta === ts ? `2px solid ${ORANGE}` : "1px solid #ddd",
                          backgroundColor: selectedColeta === ts ? "#fff5f0" : hoveredColeta === ts ? ORANGE_HOVER : "#fff",
                          fontFamily: "Arial",
                          fontSize: 11,
                          fontWeight: selectedColeta === ts ? 700 : 400,
                          color: "#1a1a1a",
                          cursor: "pointer",
                        }}
                      >
                        {fmtTime(ts)} BRT
                        <span style={{ display: "block", fontSize: 9, color: "#888" }}>
                          {hoursAgo(ts)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Main Content ── */}
          <div className="col-10">
            <div id="page-content">
              <div className="mb-2">
                <div className="page-header-title">Diesel Imports Line-Up</div>
                <div className="page-header-sub">
                  Expected diesel vessel arrivals at Brazilian ports
                  {selectedColeta && (
                    <span style={{ marginLeft: 12, fontSize: 11, color: "#888" }}>
                      Last update: {fmtTs(selectedColeta)} BRT ({hoursAgo(selectedColeta)})
                    </span>
                  )}
                </div>
              </div>

              <hr style={{ borderTop: "2px solid #e0e0e0", marginBottom: 12 }} />

              {loading ? (
                <div className="d-flex justify-content-center my-5">
                  <img src="/barrel_loading.png" alt="Loading..." width={160} height={160} />
                </div>
              ) : (
                <>
                  {/* Grid: 3 columns (map | bar+summary | vessel details), 2 rows */}
                  <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1.5fr 3fr", gap: 16, alignItems: "start", marginBottom: 24 }}>
                    {/* Row 1 — Col 1: Map */}
                    <div className="chart-container">
                      <div style={TITLE_STYLE}>Distribution by Port</div>
                      <hr className="section-hr" />
                      <PlotlyChart
                        data={mapChart.data}
                        layout={{ ...mapChart.layout, height: 500 }}
                        config={{ displayModeBar: false }}
                        style={{ width: "100%", height: 500 }}
                      />
                    </div>
                    {/* Row 1 — Col 2: Bar chart + Monthly Summary */}
                    <div className="chart-container">
                      <div style={TITLE_STYLE}>Monthly Diesel Volume (m³)</div>
                      <hr className="section-hr" />
                      <PlotlyChart
                        data={monthlyChart.data}
                        layout={{ ...monthlyChart.layout, height: 240 }}
                        config={{ displayModeBar: false }}
                        style={{ width: "100%", height: 240 }}
                      />
                      <div style={{ marginTop: 8 }}>
                        <div style={{ ...TITLE_STYLE, marginBottom: 6 }}>Monthly Summary by Port</div>
                        <hr className="section-hr" />
                        <div style={{ overflowX: "auto" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "Arial", fontSize: 12, tableLayout: "fixed" }}>
                            <thead>
                              <tr style={{ backgroundColor: "#000512", color: "#fff" }}>
                                <th style={{ width: 110, padding: "6px 10px", fontSize: 11, fontWeight: 700, textAlign: "left" }}>Port</th>
                                {portMonthlySummary.months.map(m => (
                                  <th key={m} style={{ padding: "6px 4px", fontSize: 11, fontWeight: 700, textAlign: "center", whiteSpace: "nowrap" }}>
                                    {portMonthlySummary.monthLabels[m]}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {portMonthlySummary.ports.map((porto, i) => (
                                <tr
                                  key={porto}
                                  style={{ borderBottom: i === portMonthlySummary.ports.length - 1 ? "2px solid #d0d0d0" : "1px solid #eee" }}
                                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "#f8f8f8"; }}
                                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = ""; }}
                                >
                                  <td style={{ width: 110, padding: "4px 10px", fontWeight: 600, whiteSpace: "nowrap" }}>
                                    {porto.replace("Porto de ", "")}
                                  </td>
                                  {portMonthlySummary.months.map(m => {
                                    const cell = portMonthlySummary.portMap.get(porto)?.get(m);
                                    return (
                                      <td key={m} style={{ padding: "4px 10px", textAlign: "center" }}>
                                        {cell ? (
                                          <>
                                            <div style={{ fontWeight: 700 }}>{cell.vessels} vessel{cell.vessels !== 1 ? "s" : ""}</div>
                                            <div style={{ fontSize: 11, color: "#666" }}>
                                              {cell.volume.toLocaleString("en-US", { maximumFractionDigits: 0 })} m³
                                            </div>
                                          </>
                                        ) : (
                                          <span style={{ color: "#ccc" }}>—</span>
                                        )}
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>

                    {/* Row 1 — Col 3: Vessel Details */}
                    <div className="chart-container">
                    <div style={{ marginBottom: 8 }}>
                      <div style={TITLE_STYLE}>Expected Vessels / Pending Discharge</div>
                      <hr className="section-hr" />
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "Arial", fontSize: 12 }}>
                        <thead>
                          <tr style={{ backgroundColor: "#000512", color: "#fff" }}>
                            {["Port", "Status", "Vessel", "Volume (m³)", "Date", "Unload Start", "Unload End"].map((h) => (
                              <th key={h} style={{ padding: "6px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {naviosDisplay.map((r, i) => (
                            <tr
                              key={r.id}
                              style={{ borderBottom: i === naviosDisplay.length - 1 ? "2px solid #d0d0d0" : "1px solid #eee" }}
                              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "#f8f8f8"; }}
                              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = ""; }}
                            >
                              <td style={{ padding: "4px 10px", fontWeight: 600 }}>{r.porto.replace("Porto de ", "")}</td>
                              <td style={{ padding: "4px 10px" }}>
                                <span style={{
                                  display: "inline-block",
                                  padding: "2px 8px",
                                  borderRadius: 4,
                                  fontSize: 10,
                                  fontWeight: 600,
                                  backgroundColor: STATUS_COLORS[r.status] ?? "#f0f0f0",
                                }}>
                                  {STATUS_LABELS[r.status] ?? r.status}
                                </span>
                              </td>
                              <td style={{ padding: "4px 10px" }}>
                                {r.navio}
                                {newVesselSet.has(`${r.navio}__${r.porto}`) && (
                                  <span style={{
                                    marginLeft: 7,
                                    display: "inline-block",
                                    padding: "1px 6px",
                                    borderRadius: 4,
                                    fontSize: 9,
                                    fontWeight: 700,
                                    backgroundColor: "#198754",
                                    color: "#fff",
                                    verticalAlign: "middle",
                                    letterSpacing: "0.04em",
                                  }}>New!</span>
                                )}
                              </td>
                              <td style={{ padding: "4px 10px", textAlign: "right" }}>
                                {r.quantidade_convertida?.toLocaleString("en-US", { maximumFractionDigits: 0 }) ?? "—"}
                              </td>
                              <td style={{ padding: "4px 10px", whiteSpace: "nowrap" }}>{fmtDate(r.eta)}</td>
                              <td style={{ padding: "4px 10px", whiteSpace: "nowrap" }}>{fmtDate(r.inicio_descarga)}</td>
                              <td style={{ padding: "4px 10px", whiteSpace: "nowrap" }}>{fmtDate(r.fim_descarga)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {errorPorts.length > 0 && (
                      <div style={{ marginTop: 8, fontFamily: "Arial", fontSize: 10, color: "#999" }}>
                        {errorPorts.map(p => p.replace("Porto de ", "")).join(", ")}
                        {errorPorts.length === 1
                          ? ": dados não disponíveis nesta coleta."
                          : ": dados não disponíveis nesta coleta."}
                      </div>
                    )}

                    </div>

                    {/* Row 2 — Col 1–2: Disclaimer, aligned below Map + Monthly Summary */}
                    <div style={{ gridColumn: "span 2", backgroundColor: "#fffbf5", border: "1px solid #ffe0b2", borderRadius: 8, padding: "16px 20px", fontFamily: "Arial", fontSize: 12, color: "#555" }}>
                      <div style={{ fontWeight: 700, marginBottom: 8, color: "#1a1a1a", fontSize: 13 }}>
                        Data Limitations & Disclaimer
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        <li>Data is collected at 6-hour intervals and may not reflect real-time conditions or recent changes in vessel schedules.</li>
                        <li>Ports monitored: Santos, Itaqui, Paranaguá, Suape, and São Sebastião. Ports with no vessels in the selected snapshot are shown in gray on the map.</li>
                        <li>We consider a vessel as delivered when it disappears from the list of expected vessels. Note that this is an estimate and may be subject to error.</li>
                      </ul>
                    </div>

                    {/* Row 2 — Col 3: Delivered Vessels, aligned below Vessel Details */}
                    <div className="chart-container">
                      <div style={{ ...TITLE_STYLE, marginBottom: 4 }}>Delivered Vessels / Discharged</div>
                      <hr className="section-hr" />
                      <div style={{ overflowX: "auto", maxHeight: 280, overflowY: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "Arial", fontSize: 12 }}>
                          <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
                            <tr style={{ backgroundColor: "#000512", color: "#fff" }}>
                              {["Port", "Vessel", "Last Seen (BRT)", "Est. Discharge Month", "Volume (m³)"].map(h => (
                                <th key={h} style={{ padding: "6px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", textAlign: h === "Volume (m³)" ? "right" : "left" }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {naviosDescarregados.length === 0 ? (
                              <tr>
                                <td colSpan={5} style={{ padding: "12px 10px", textAlign: "center", color: "#aaa", fontFamily: "Arial", fontSize: 11 }}>
                                  No delivered vessels found for this snapshot.
                                </td>
                              </tr>
                            ) : naviosDescarregados.map((r, i) => {
                              const [yr, mo] = r.discharge_month.split("-");
                              const monthLabel = new Date(Number(yr), Number(mo) - 1, 1)
                                .toLocaleDateString("en-US", { month: "short", year: "numeric" });
                              return (
                                <tr
                                  key={`${r.navio}-${r.porto}`}
                                  style={{ borderBottom: i === naviosDescarregados.length - 1 ? "2px solid #d0d0d0" : "1px solid #eee" }}
                                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "#f8f8f8"; }}
                                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = ""; }}
                                >
                                  <td style={{ padding: "4px 10px", fontWeight: 600, whiteSpace: "nowrap" }}>{r.porto.replace("Porto de ", "")}</td>
                                  <td style={{ padding: "4px 10px", whiteSpace: "nowrap" }}>{r.navio}</td>
                                  <td style={{ padding: "4px 10px", whiteSpace: "nowrap", color: "#555" }}>{r.last_seen}</td>
                                  <td style={{ padding: "4px 10px", whiteSpace: "nowrap", color: "#555" }}>{monthLabel}</td>
                                  <td style={{ padding: "4px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                                    {r.last_volume.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
