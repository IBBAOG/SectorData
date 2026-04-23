"use client";

import { useEffect, useMemo, useState } from "react";
import type { Layout, PlotData } from "plotly.js";

import NavBar from "../../../components/NavBar";
import LineUpTabs from "../../../components/LineUpTabs";
import PlotlyChart from "../../../components/PlotlyChart";
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import {
  rpcGetIcActive,
  rpcGetIcSummary,
  type ImportCandidateRow,
  type ImportCandidateSummaryRow,
} from "../../../lib/rpc";

const ORANGE = "#FF5000";

const PORT_LABELS: Record<string, string> = {
  santos: "Santos",
  itaqui: "Itaqui",
  paranagua: "Paranaguá",
  sao_sebastiao: "São Sebastião",
  suape: "Suape",
};

const TITLE_STYLE: React.CSSProperties = {
  fontFamily: "Arial",
  fontSize: 14,
  fontWeight: 700,
  color: ORANGE,
  marginBottom: 4,
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
  return new Date(iso).toLocaleDateString("en-US", {
    month: "2-digit", day: "2-digit", year: "2-digit",
  });
}

export default function NaviosDieselRadarPage() {
  // Shares module visibility with the main line-up — both pages belong to one module
  const { visible, loading: visLoading } = useModuleVisibilityGuard("navios-diesel");
  const supabase = getSupabaseClient();

  const [candidates, setCandidates] = useState<ImportCandidateRow[]>([]);
  const [summary, setSummary] = useState<ImportCandidateSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [portFilter, setPortFilter] = useState<string | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "in_lineup">("all");

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [rows, sum] = await Promise.all([
        rpcGetIcActive(supabase),
        rpcGetIcSummary(supabase),
      ]);
      if (cancelled) return;
      setCandidates(rows);
      setSummary(sum);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  const filtered = useMemo(() => {
    return candidates.filter(c => {
      if (portFilter !== "all" && c.destination_slug !== portFilter) return false;
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      return true;
    });
  }, [candidates, portFilter, statusFilter]);

  const summaryByPort = useMemo(() => {
    const m = new Map<string, ImportCandidateSummaryRow>();
    for (const s of summary) m.set(s.destination_slug, s);
    return m;
  }, [summary]);

  // Build world map of last-seen positions for the filtered candidates.
  // Points are grouped by destination port (one trace per port) so each
  // port gets its own colour in the legend.
  const worldMap = useMemo(() => {
    const withPos = filtered.filter(
      c => c.last_seen_lat != null && c.last_seen_lon != null
    );
    if (withPos.length === 0) {
      return {
        data: [] as PlotData[],
        layout: {
          paper_bgcolor: "white", plot_bgcolor: "white",
          annotations: [{
            text: "No AIS positions yet — candidates appear here after the next discovery run",
            xref: "paper" as const, yref: "paper" as const,
            showarrow: false,
            font: { size: 13, family: "Arial", color: "#888" },
          }],
          height: 480, margin: { t: 0, b: 0, l: 0, r: 0 },
        } as Partial<Layout>,
      };
    }

    const PORT_COLORS: Record<string, string> = {
      santos:         "#ff5000",
      itaqui:         "#2196f3",
      paranagua:      "#2eb85c",
      sao_sebastiao:  "#9c27b0",
      suape:          "#ffc107",
    };

    const grouped = new Map<string, ImportCandidateRow[]>();
    for (const c of withPos) {
      const key = c.destination_slug ?? "unknown";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(c);
    }

    const data: PlotData[] = [];
    for (const [slug, rows] of grouped) {
      const label = PORT_LABELS[slug] ?? slug;
      data.push({
        type: "scattergeo",
        mode: "markers",
        lat: rows.map(r => r.last_seen_lat!),
        lon: rows.map(r => r.last_seen_lon!),
        text: rows.map(r => {
          const etaStr = r.eta
            ? new Date(r.eta).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" })
            : "—";
          const origin = r.origin_port_name
            ? `${r.origin_port_name}${r.origin_country ? ` (${r.origin_country})` : ""}`
            : "—";
          return (
            `<b>${r.navio}</b><br>` +
            `Flag: ${r.flag ?? "—"}<br>` +
            `Dest: ${label}<br>` +
            `ETA: ${etaStr}<br>` +
            `Last port: ${origin}`
          );
        }),
        hoverinfo: "text",
        name: `→ ${label}`,
        marker: {
          size: 12,
          color: PORT_COLORS[slug] ?? "#888",
          opacity: 0.9,
          line: { color: "#1a1a1a", width: 0.8 },
        },
      } as unknown as PlotData);
    }

    const layout: Partial<Layout> = {
      geo: {
        // IMPORTANT: no `scope: "world"` — when scope is set, Plotly ignores
        // lataxis/lonaxis.range and always draws the full globe including
        // Antarctica. Leaving scope out lets the range crop the basemap.
        projection: { type: "mercator" },
        lataxis: { range: [-55, 75] },
        lonaxis: { range: [-180, 180] },
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
      height: 480,
      // Fully static — no drag/pan/zoom. Hover tooltips still work.
      dragmode: false,
      showlegend: true,
      legend: {
        orientation: "h",
        x: 0.5, y: 0.02,
        xanchor: "center",
        yanchor: "bottom",
        bgcolor: "rgba(255,255,255,0.85)",
        bordercolor: "rgba(180,180,180,0.4)",
        borderwidth: 1,
        font: { family: "Arial", size: 11 },
      },
      hoverlabel: {
        bgcolor: "rgba(255,255,255,0.95)",
        bordercolor: "rgba(180,180,180,0.5)",
        font: { family: "Arial", color: "#1a1a1a", size: 12 },
      },
    };

    return { data, layout };
  }, [filtered]);

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

              <div className="sidebar-section-label">Filters</div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Destination Port</div>
                <select
                  value={portFilter}
                  onChange={(e) => setPortFilter(e.target.value)}
                  style={{ width: "100%", padding: "4px 8px", fontFamily: "Arial", fontSize: 11, border: "1px solid #ddd", borderRadius: 4 }}
                >
                  <option value="all">All ports</option>
                  {Object.entries(PORT_LABELS).map(([slug, label]) => (
                    <option key={slug} value={slug}>{label}</option>
                  ))}
                </select>
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Status</div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "in_lineup")}
                  style={{ width: "100%", padding: "4px 8px", fontFamily: "Arial", fontSize: 11, border: "1px solid #ddd", borderRadius: 4 }}
                >
                  <option value="all">All</option>
                  <option value="active">Radar-only (not yet in line-up)</option>
                  <option value="in_lineup">Confirmed in line-up</option>
                </select>
              </div>

            </div>
          </div>

          {/* ── Main ── */}
          <div className="col-10">
            <div id="page-content">
              <div className="mb-2">
                <div className="page-header-title">Diesel Imports Line-Up</div>
                <div className="page-header-sub">
                  Tankers worldwide signalling a Brazilian port via AIS — 10-30 days before port authorities publish the scheduled line-up.
                </div>
                <LineUpTabs active="radar" />
              </div>

              <hr style={{ borderTop: "2px solid #e0e0e0", marginBottom: 12 }} />

              {loading ? (
                <div className="d-flex justify-content-center my-5">
                  <img src="/barrel_loading.png" alt="Loading..." width={160} height={160} />
                </div>
              ) : (
                <>
                  {/* Summary cards */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 20 }}>
                    {Object.entries(PORT_LABELS).map(([slug, label]) => {
                      const s = summaryByPort.get(slug);
                      const n = s?.candidates ?? 0;
                      const nInLineup = s?.in_lineup ?? 0;
                      const radarOnly = n - nInLineup;
                      return (
                        <div key={slug} className="chart-container" style={{ padding: "12px 16px" }}>
                          <div style={{ fontFamily: "Arial", fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 4 }}>{label}</div>
                          <div style={{ fontFamily: "Arial", fontSize: 28, fontWeight: 700, color: ORANGE, lineHeight: 1 }}>{n}</div>
                          <div style={{ fontFamily: "Arial", fontSize: 10, color: "#888", marginTop: 4, lineHeight: 1.4 }}>
                            <div>{radarOnly} radar-only · {nInLineup} confirmed</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* World map of last-seen positions */}
                  <div className="chart-container" style={{ marginBottom: 20 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <div style={TITLE_STYLE}>Global AIS Positions</div>
                      <div style={{ fontSize: 10, color: "#888" }}>
                        {filtered.filter(c => c.last_seen_lat != null).length} / {filtered.length} with position
                      </div>
                    </div>
                    <hr className="section-hr" />
                    <PlotlyChart
                      data={worldMap.data}
                      layout={worldMap.layout}
                      config={{
                        displayModeBar: false,
                        scrollZoom: false,
                        doubleClick: false,
                        displaylogo: false,
                        showTips: false,
                        responsive: false,
                      }}
                      style={{ width: "100%", height: 480 }}
                    />
                  </div>

                  {/* Main table */}
                  <div className="chart-container">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <div style={TITLE_STYLE}>Candidates ({filtered.length})</div>
                    </div>
                    <hr className="section-hr" />
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "Arial", fontSize: 12 }}>
                        <thead>
                          <tr style={{ backgroundColor: "#000512", color: "#fff" }}>
                            {[
                              { label: "Vessel",      align: "left" as const },
                              { label: "Flag",        align: "left" as const },
                              { label: "Type",        align: "left" as const },
                              { label: "Capacity",    align: "right" as const,  title: "Deadweight tonnage (DWT, tonnes)" },
                              { label: "Destination", align: "left" as const },
                              { label: "ETA",         align: "left" as const },
                              { label: "Origin",      align: "left" as const },
                              { label: "Departed",    align: "left" as const },
                              { label: "Draft",       align: "left" as const },
                              { label: "Tanker",      align: "center" as const,  title: "Ship type classified as a tanker" },
                              { label: "Prod size",   align: "center" as const,  title: "Dimensions fit a product tanker (<230 m or <90k DWT)" },
                              { label: "Prod hub",    align: "center" as const,  title: "Last port is a refined-product export hub" },
                              { label: "Loaded",      align: "center" as const,  title: "Current draft >70% of design max → carrying cargo" },
                              { label: "First seen",  align: "left" as const },
                              { label: "Last seen",   align: "left" as const },
                            ].map((h) => (
                              <th key={h.label} title={h.title} style={{ padding: "6px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", textAlign: h.align }}>{h.label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.length === 0 ? (
                            <tr>
                              <td colSpan={15} style={{ padding: "20px 10px", textAlign: "center", color: "#aaa", fontSize: 11 }}>
                                No candidates match current filters.
                              </td>
                            </tr>
                          ) : filtered.map((c, i) => {
                            const draftPct = c.current_draught_m && c.max_draught_m
                              ? Math.round((c.current_draught_m / c.max_draught_m) * 100)
                              : null;
                            const signalTooltip = (
                              key: "tanker" | "size_product_range" | "origin_product_hub" | "loaded",
                              on: boolean | null | undefined,
                            ): string => {
                              const what: Record<typeof key, string> = {
                                tanker:
                                  "AIS ship-type code 80–89, or VesselFinder-reported Oil/Chemical Products tanker.",
                                size_product_range:
                                  "Length under 230 m or DWT under ~90 k tonnes — typical clean-products tanker range.",
                                origin_product_hub:
                                  "Last port is a refined-product export hub: ARA (Rotterdam/Antwerp/Amsterdam), US Gulf (Houston, Corpus Christi, Lake Charles), India (Sikka/Jamnagar), Middle East (Fujairah, Ras Tanura), Singapore, Mediterranean.",
                                loaded:
                                  "Current AIS draft is more than 70% of the vessel's design max — the ship is fully laden with cargo, not empty in ballast.",
                              };
                              const why: Record<typeof key, string> = {
                                tanker:
                                  "Only tankers carry liquid petroleum products. A non-tanker heading to a BR oil port wouldn't be discharging diesel.",
                                size_product_range:
                                  "Larger vessels (VLCC / Suezmax, >230 m) carry crude oil, not refined diesel. Product carriers are smaller.",
                                origin_product_hub:
                                  "Refined diesel is loaded at a refinery hub. Cargo coming out of a non-refining port is unlikely to be diesel.",
                                loaded:
                                  "An empty tanker in ballast is going to load, not to discharge. Loaded tankers are already carrying their cargo toward the buyer.",
                              };
                              const status = on == null ? "Unknown" : on ? "Yes" : "No";
                              return `${status}\n${what[key]}\n\nWhy it matters: ${why[key]}`;
                            };
                            const signalCell = (
                              key: "tanker" | "size_product_range" | "origin_product_hub" | "loaded",
                              on: boolean | null | undefined,
                            ) => {
                              const title = signalTooltip(key, on);
                              if (on == null) {
                                return (
                                  <span title={title} style={{ color: "#ccc", fontSize: 14, cursor: "help" }}>—</span>
                                );
                              }
                              return (
                                <span title={title} style={{
                                  color: on ? "#2eb85c" : "#d33",
                                  fontSize: 15,
                                  fontWeight: 700,
                                  cursor: "help",
                                }}>{on ? "✓" : "✗"}</span>
                              );
                            };
                            const sig = c.signals ?? {};
                            return (
                              <tr
                                key={c.id}
                                style={{ borderBottom: i === filtered.length - 1 ? "2px solid #d0d0d0" : "1px solid #eee" }}
                                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "#f8f8f8"; }}
                                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = ""; }}
                              >
                                <td style={{ padding: "4px 10px", fontWeight: 600, whiteSpace: "nowrap" }}>
                                  {c.navio}
                                  {c.imo && <span style={{ fontSize: 9, color: "#999", marginLeft: 6 }}>IMO {c.imo}</span>}
                                </td>
                                <td style={{ padding: "4px 10px", whiteSpace: "nowrap" }}>{c.flag ?? "—"}</td>
                                <td style={{ padding: "4px 10px", whiteSpace: "nowrap", fontSize: 11, color: "#555" }}>{c.ship_type ?? "—"}</td>
                                <td style={{ padding: "4px 10px", whiteSpace: "nowrap", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                                  {c.dwt != null
                                    ? `${c.dwt.toLocaleString("en-US")} t`
                                    : "—"}
                                </td>
                                <td style={{ padding: "4px 10px", whiteSpace: "nowrap", fontWeight: 600 }}>
                                  {c.destination_slug ? PORT_LABELS[c.destination_slug] ?? c.destination_slug : "—"}
                                  <span style={{ fontSize: 9, color: "#999", marginLeft: 6 }}>{c.destination_raw}</span>
                                </td>
                                <td style={{ padding: "4px 10px", whiteSpace: "nowrap" }}>{fmtDate(c.eta)}</td>
                                <td style={{ padding: "4px 10px", whiteSpace: "nowrap" }}>
                                  {c.origin_port_name ?? "—"}
                                  {c.origin_country && <span style={{ fontSize: 9, color: "#999", marginLeft: 4 }}>({c.origin_country})</span>}
                                </td>
                                <td style={{ padding: "4px 10px", whiteSpace: "nowrap", color: "#555" }}>{fmtDate(c.departure_ts)}</td>
                                <td style={{ padding: "4px 10px", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                                  {c.current_draught_m != null ? `${c.current_draught_m.toFixed(1)}m` : "—"}
                                  {draftPct != null && (
                                    <span style={{ fontSize: 9, color: draftPct > 70 ? "#2eb85c" : "#888", marginLeft: 4 }}>
                                      {draftPct}%
                                    </span>
                                  )}
                                </td>
                                <td style={{ padding: "4px 6px", textAlign: "center" }}>{signalCell("tanker", sig.tanker)}</td>
                                <td style={{ padding: "4px 6px", textAlign: "center" }}>{signalCell("size_product_range", sig.size_product_range)}</td>
                                <td style={{ padding: "4px 6px", textAlign: "center" }}>{signalCell("origin_product_hub", sig.origin_product_hub)}</td>
                                <td style={{ padding: "4px 6px", textAlign: "center" }}>{signalCell("loaded", sig.loaded)}</td>
                                <td style={{ padding: "4px 10px", whiteSpace: "nowrap", fontSize: 10, color: "#888" }}>
                                  {fmtTs(c.first_seen_at)}
                                </td>
                                <td style={{ padding: "4px 10px", whiteSpace: "nowrap", fontSize: 10, color: "#888" }}>
                                  {fmtTs(c.last_seen_at)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
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
