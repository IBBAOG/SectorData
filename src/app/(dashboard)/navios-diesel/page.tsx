"use client";

import { useEffect, useMemo, useState } from "react";
import type { Layout, PlotData } from "plotly.js";

import NavBar from "../../../components/NavBar";
import PlotlyChart from "../../../components/PlotlyChart";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import {
  rpcGetNdUltimaColeta,
  rpcGetNdColetasDistintas,
  rpcGetNdNavios,
  rpcGetNdResumoPortos,
  type NavioDieselRow,
  type PortoResumo,
} from "../../../lib/rpc";

const ORANGE = "#FF5000";

const PORT_COORDS: Record<string, { lat: number; lon: number }> = {
  "Porto de Santos":    { lat: -23.9543, lon: -46.3073 },
  "Porto de Itaqui":    { lat: -2.5657,  lon: -44.3484 },
  "Porto de Paranaguá": { lat: -25.5163, lon: -48.5228 },
  "Porto de Suape":     { lat: -8.3943,  lon: -34.9630 },
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
  const supabase = getSupabaseClient();

  const [coletas, setColetas] = useState<string[]>([]);
  const [selectedDay, setSelectedDay] = useState<string>("");
  const [selectedColeta, setSelectedColeta] = useState<string>("");
  const [calMonth, setCalMonth] = useState<number>(new Date().getMonth());
  const [calYear, setCalYear] = useState<number>(new Date().getFullYear());
  const [navios, setNavios] = useState<NavioDieselRow[]>([]);
  const [resumo, setResumo] = useState<PortoResumo[]>([]);
  const [loading, setLoading] = useState(true);

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

  // 2. Load data when selected timestamp changes
  useEffect(() => {
    if (!supabase || !selectedColeta) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [nav, res] = await Promise.all([
        rpcGetNdNavios(supabase, selectedColeta),
        rpcGetNdResumoPortos(supabase, selectedColeta),
      ]);
      if (cancelled) return;
      setNavios(nav);
      setResumo(res);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase, selectedColeta]);

  // Build map traces
  const mapChart = useMemo(() => {
    if (resumo.length === 0) {
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

    for (const p of resumo) {
      const c = PORT_COORDS[p.porto];
      if (!c) continue;
      lats.push(c.lat);
      lons.push(c.lon);
      texts.push(
        `<b>${p.porto}</b><br>` +
        `${p.total_navios} vessels<br>` +
        `${p.total_convertida.toLocaleString("en-US", { maximumFractionDigits: 0 })} m³`
      );
      sizes.push(Math.max(14, Math.sqrt(p.total_navios) * 16));
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
          color: ORANGE,
          opacity: 0.75,
          line: { color: "#000512", width: 1.5 },
        },
      } as unknown as PlotData,
    ];

    const layout: Partial<Layout> = {
      geo: {
        scope: "south america",
        resolution: 50,
        lonaxis: { range: [-75, -20] },
        lataxis: { range: [-32, 2] },
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
      margin: { t: 10, b: 10, l: 10, r: 10 },
      height: 280,
      hoverlabel: {
        bgcolor: "rgba(255,255,255,0.95)",
        bordercolor: "rgba(180,180,180,0.5)",
        font: { family: "Arial", color: "#1a1a1a", size: 12 },
      },
    };

    return { data, layout };
  }, [resumo]);

  // Build monthly bar chart
  const monthlyChart = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of navios) {
      if (!r.eta || r.quantidade_convertida == null) continue;
      const month = r.eta.slice(0, 7);
      totals.set(month, (totals.get(month) ?? 0) + r.quantidade_convertida);
    }
    const months = Array.from(totals.keys()).sort();
    const labels = months.map(m => {
      const [yr, mo] = m.split("-");
      return new Date(Number(yr), Number(mo) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
    });
    const values = months.map(m => totals.get(m)!);

    const data: PlotData[] = [{
      type: "bar",
      x: labels,
      y: values,
      text: values.map(v => v.toLocaleString("en-US", { maximumFractionDigits: 0 })),
      textposition: "outside",
      textfont: { family: "Arial", size: 12, color: "#1a1a1a" },
      marker: { color: ORANGE, opacity: 0.85 },
      hovertemplate: "%{x}: %{y:,.0f} m³<extra></extra>",
    } as unknown as PlotData];

    const layout: Partial<Layout> = {
      paper_bgcolor: "white",
      plot_bgcolor: "white",
      margin: { t: 30, b: 48, l: 10, r: 10 },
      height: 220,
      bargap: 0.3,
      yaxis: { visible: false },
      xaxis: { tickfont: { family: "Arial", size: 12 } },
      hoverlabel: {
        bgcolor: "rgba(255,255,255,0.95)",
        bordercolor: "rgba(180,180,180,0.5)",
        font: { family: "Arial", color: "#1a1a1a", size: 12 },
      },
    };

    return { data, layout };
  }, [navios]);

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
                      onClick={() => { if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); } else setCalMonth(m => m - 1); }}
                      style={{ background: "none", border: "none", cursor: "pointer", color: ORANGE, fontSize: 16, lineHeight: 1, padding: "0 4px" }}
                    >‹</button>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#1a1a1a" }}>
                      {MONTH_NAMES[calMonth]} {calYear}
                    </span>
                    <button
                      type="button"
                      onClick={() => { if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); } else setCalMonth(m => m + 1); }}
                      style={{ background: "none", border: "none", cursor: "pointer", color: ORANGE, fontSize: 16, lineHeight: 1, padding: "0 4px" }}
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
                          disabled={!hasData}
                          onClick={() => {
                            if (!hasData) return;
                            setSelectedDay(dayStr);
                            const times = coletasByDay.get(dayStr) ?? [];
                            if (times.length > 0) setSelectedColeta(times[0]);
                          }}
                          style={{
                            padding: "4px 0",
                            margin: "1px",
                            borderRadius: 4,
                            border: "none",
                            backgroundColor: isSelected ? ORANGE : "transparent",
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
                        onClick={() => setSelectedColeta(ts)}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          padding: "5px 10px",
                          marginBottom: 3,
                          borderRadius: 6,
                          border: selectedColeta === ts ? `2px solid ${ORANGE}` : "1px solid #ddd",
                          backgroundColor: selectedColeta === ts ? "#fff5f0" : "#fff",
                          fontFamily: "Arial",
                          fontSize: 11,
                          fontWeight: selectedColeta === ts ? 700 : 400,
                          color: "#1a1a1a",
                          cursor: "pointer",
                        }}
                      >
                        {fmtTime(ts)}
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
                      Last update: {fmtTs(selectedColeta)} ({hoursAgo(selectedColeta)})
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
                  {/* Map + Table side by side */}
                  <div style={{ display: "flex", gap: 16, alignItems: "flex-start", marginBottom: 16 }}>

                    {/* Left column: map + monthly bar chart */}
                    <div style={{ flex: "0 0 520px", display: "flex", flexDirection: "column", gap: 12 }}>

                      {/* Map */}
                      <div className="chart-container">
                        <div style={TITLE_STYLE}>Distribution by Port</div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={mapChart.data}
                          layout={{ ...mapChart.layout, height: 280 }}
                          config={{ displayModeBar: false }}
                          style={{ width: "100%", height: 280 }}
                        />
                      </div>

                      {/* Monthly bar chart */}
                      <div className="chart-container">
                        <div style={TITLE_STYLE}>Monthly Diesel Volume (m³)</div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={monthlyChart.data}
                          layout={monthlyChart.layout}
                          config={{ displayModeBar: false }}
                          style={{ width: "100%", height: 220 }}
                        />
                      </div>
                    </div>

                    {/* Vessel table */}
                    <div className="chart-container" style={{ flex: 1, minWidth: 0, marginBottom: 0 }}>
                      <div style={{ marginBottom: 8 }}>
                        <div style={TITLE_STYLE}>Vessel Details</div>
                        <hr className="section-hr" />
                        <div style={{ fontFamily: "Arial", fontSize: 10, color: "#999" }}>
                          {fmtTs(selectedColeta)}{selectedColeta ? ` (${hoursAgo(selectedColeta)})` : ""}
                        </div>
                      </div>
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "Arial", fontSize: 11 }}>
                          <thead>
                            <tr style={{ backgroundColor: "#000512", color: "#fff" }}>
                              {["Port", "Status", "Vessel", "Qty", "Unit", "Conv. Qty (m³)", "ETA", "Unload Start", "Unload End", "Origin", "Berth"].map((h) => (
                                <th key={h} style={{ padding: "6px 10px", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {navios.map((r) => (
                              <tr
                                key={r.id}
                                style={{ borderBottom: "1px solid #eee" }}
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
                                <td style={{ padding: "4px 10px" }}>{r.navio}</td>
                                <td style={{ padding: "4px 10px", textAlign: "right" }}>
                                  {r.quantidade?.toLocaleString("en-US", { maximumFractionDigits: 0 }) ?? "—"}
                                </td>
                                <td style={{ padding: "4px 10px" }}>{r.unidade ?? "—"}</td>
                                <td style={{ padding: "4px 10px", textAlign: "right" }}>
                                  {r.quantidade_convertida?.toLocaleString("en-US", { maximumFractionDigits: 0 }) ?? "—"}
                                </td>
                                <td style={{ padding: "4px 10px", whiteSpace: "nowrap" }}>{fmtDate(r.eta)}</td>
                                <td style={{ padding: "4px 10px", whiteSpace: "nowrap" }}>{fmtDate(r.inicio_descarga)}</td>
                                <td style={{ padding: "4px 10px", whiteSpace: "nowrap" }}>{fmtDate(r.fim_descarga)}</td>
                                <td style={{ padding: "4px 10px" }}>{r.origem ?? "—"}</td>
                                <td style={{ padding: "4px 10px" }}>{r.berco ?? "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>{/* end flex row */}

                  {/* Disclaimer */}
                  <div
                    style={{
                      backgroundColor: "#fffbf5",
                      border: "1px solid #ffe0b2",
                      borderRadius: 8,
                      padding: "16px 20px",
                      fontFamily: "Arial",
                      fontSize: 12,
                      color: "#555",
                      marginBottom: 24,
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 8, color: "#1a1a1a", fontSize: 13 }}>
                      Data Limitations & Disclaimer
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      <li>Data is collected at 6-hour intervals and may not reflect real-time conditions or recent changes in vessel schedules.</li>
                      <li>Port locations are approximate and for reference only.</li>
                      <li>Expected ship counts are based on historical patterns and are subject to change.</li>
                      <li>This data does not account for operational delays, weather impacts, or force majeure events.</li>
                      <li>For operational decisions, please verify with official port authorities and vessel tracking systems.</li>
                    </ul>
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
