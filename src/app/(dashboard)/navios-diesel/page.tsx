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

function hoursAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "< 1 h ago";
  return `${h} h ago`;
}

export default function NaviosDieselPage() {
  const supabase = getSupabaseClient();

  const [coletas, setColetas] = useState<string[]>([]);
  const [selectedColeta, setSelectedColeta] = useState<string>("");
  const [navios, setNavios] = useState<NavioDieselRow[]>([]);
  const [resumo, setResumo] = useState<PortoResumo[]>([]);
  const [loading, setLoading] = useState(true);

  // 1. Load available collection timestamps
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const ts = await rpcGetNdColetasDistintas(supabase);
      if (cancelled) return;
      setColetas(ts);
      if (ts.length > 0) setSelectedColeta(ts[0]);
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
          height: 450, margin: { t: 10, b: 10, l: 10, r: 10 },
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
        `${p.total_convertida.toLocaleString("en-US", { maximumFractionDigits: 0 })} t`
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
        lonaxis: { range: [-56, -30] },
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
      height: 450,
      hoverlabel: {
        bgcolor: "rgba(255,255,255,0.95)",
        bordercolor: "rgba(180,180,180,0.5)",
        font: { family: "Arial", color: "#1a1a1a", size: 12 },
      },
    };

    return { data, layout };
  }, [resumo]);

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

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Collection Time</div>
                <div style={{ maxHeight: 320, overflowY: "auto" }}>
                  {coletas.map((ts) => (
                    <button
                      key={ts}
                      type="button"
                      onClick={() => setSelectedColeta(ts)}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "6px 10px",
                        marginBottom: 4,
                        borderRadius: 6,
                        border: selectedColeta === ts ? `2px solid ${ORANGE}` : "1px solid #ddd",
                        backgroundColor: selectedColeta === ts ? "#fff5f0" : "#fff",
                        fontFamily: "Arial",
                        fontSize: 12,
                        fontWeight: selectedColeta === ts ? 700 : 400,
                        color: "#1a1a1a",
                        cursor: "pointer",
                      }}
                    >
                      {fmtTs(ts)}
                      <span style={{ display: "block", fontSize: 10, color: "#888" }}>
                        {hoursAgo(ts)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
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

                  {/* Map */}
                  <div className="chart-container" style={{ flex: "0 0 420px" }}>
                    <div style={{ fontFamily: "Arial", fontSize: 13, fontWeight: 700, marginBottom: 6, color: "#1a1a1a" }}>
                      Port Distribution — Brazil
                    </div>
                    <PlotlyChart
                      data={mapChart.data}
                      layout={{ ...mapChart.layout, height: 420 }}
                      config={{ displayModeBar: false }}
                      style={{ width: "100%", height: 420 }}
                    />
                  </div>

                  {/* Vessel table */}
                  <div className="chart-container" style={{ flex: 1, minWidth: 0, marginBottom: 0 }}>
                    <div style={{ fontFamily: "Arial", fontSize: 13, fontWeight: 700, marginBottom: 6, color: "#1a1a1a" }}>
                      Vessel Details — {fmtTs(selectedColeta)}
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
