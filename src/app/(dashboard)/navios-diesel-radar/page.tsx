"use client";

import { useEffect, useMemo, useState } from "react";

import NavBar from "../../../components/NavBar";
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

const STATUS_LABELS: Record<string, string> = {
  active: "Detected",
  in_lineup: "In line-up",
  arrived: "Arrived",
  dismissed: "Dismissed",
};

const STATUS_COLORS: Record<string, string> = {
  active: "#fff3cd",
  in_lineup: "#d4edda",
  arrived: "#d1ecf1",
  dismissed: "#e2e3e5",
};

const SIGNAL_LABELS: Record<string, string> = {
  destination_br_port: "BR destination",
  tanker: "Tanker",
  size_product_range: "Product size",
  origin_product_hub: "Product hub origin",
  loaded: "Loaded",
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

function confidenceColor(score: number | null): string {
  if (score == null) return "#999";
  if (score >= 80) return "#2eb85c";
  if (score >= 60) return "#e7a000";
  return "#d33";
}

export default function NaviosDieselRadarPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("navios-diesel-radar");
  const supabase = getSupabaseClient();

  const [candidates, setCandidates] = useState<ImportCandidateRow[]>([]);
  const [summary, setSummary] = useState<ImportCandidateSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [portFilter, setPortFilter] = useState<string | "all">("all");
  const [minConfidence, setMinConfidence] = useState(0);
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
      if ((c.confidence_score ?? 0) < minConfidence) return false;
      return true;
    });
  }, [candidates, portFilter, minConfidence, statusFilter]);

  const summaryByPort = useMemo(() => {
    const m = new Map<string, ImportCandidateSummaryRow>();
    for (const s of summary) m.set(s.destination_slug, s);
    return m;
  }, [summary]);

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

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Min. confidence: {minConfidence}</div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={20}
                  value={minConfidence}
                  onChange={(e) => setMinConfidence(Number(e.target.value))}
                  style={{ width: "100%" }}
                />
                <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>
                  0-100 composite score from AIS + VesselFinder signals
                </div>
              </div>

              <div className="sidebar-filter-section" style={{ marginTop: 12, fontSize: 10, color: "#888", lineHeight: 1.4 }}>
                <div style={{ fontWeight: 700, marginBottom: 4, color: "#555" }}>How scoring works</div>
                Each signal contributes up to 20 pts:
                <ul style={{ margin: "4px 0 0 14px", padding: 0 }}>
                  <li>BR destination</li>
                  <li>Tanker ship type</li>
                  <li>Product-tanker size</li>
                  <li>Origin = product hub</li>
                  <li>Currently loaded</li>
                </ul>
              </div>
            </div>
          </div>

          {/* ── Main ── */}
          <div className="col-10">
            <div id="page-content">
              <div className="mb-2">
                <div className="page-header-title">Diesel Imports Radar</div>
                <div className="page-header-sub">
                  Tankers worldwide signalling a Brazilian port via AIS — 10-30 days before port authorities publish the scheduled line-up.
                </div>
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
                            {s?.avg_confidence != null && (
                              <div>avg confidence: <b style={{ color: confidenceColor(s.avg_confidence) }}>{s.avg_confidence}</b></div>
                            )}
                          </div>
                        </div>
                      );
                    })}
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
                              "Vessel", "Flag", "Type",
                              "Destination", "ETA",
                              "Origin", "Departed",
                              "Draft", "Confidence",
                              "Signals", "Status", "First seen",
                            ].map((h) => (
                              <th key={h} style={{ padding: "6px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", textAlign: "left" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.length === 0 ? (
                            <tr>
                              <td colSpan={12} style={{ padding: "20px 10px", textAlign: "center", color: "#aaa", fontSize: 11 }}>
                                No candidates match current filters.
                              </td>
                            </tr>
                          ) : filtered.map((c, i) => {
                            const draftPct = c.current_draught_m && c.max_draught_m
                              ? Math.round((c.current_draught_m / c.max_draught_m) * 100)
                              : null;
                            const activeSignals = c.signals
                              ? Object.entries(c.signals).filter(([, v]) => v).map(([k]) => SIGNAL_LABELS[k] ?? k)
                              : [];
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
                                <td style={{ padding: "4px 10px", textAlign: "center" }}>
                                  <span style={{
                                    display: "inline-block",
                                    minWidth: 38,
                                    padding: "2px 8px",
                                    borderRadius: 4,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    color: "#fff",
                                    backgroundColor: confidenceColor(c.confidence_score),
                                  }}>{c.confidence_score ?? "—"}</span>
                                </td>
                                <td style={{ padding: "4px 10px", fontSize: 10, color: "#666" }}>
                                  {activeSignals.slice(0, 3).map(s => (
                                    <span key={s} style={{ display: "inline-block", marginRight: 4, padding: "1px 6px", fontSize: 9, borderRadius: 3, backgroundColor: "#eef6ff", color: "#0b4a84" }}>{s}</span>
                                  ))}
                                  {activeSignals.length > 3 && <span style={{ fontSize: 9, color: "#999" }}>+{activeSignals.length - 3}</span>}
                                </td>
                                <td style={{ padding: "4px 10px" }}>
                                  <span style={{
                                    display: "inline-block",
                                    padding: "2px 8px",
                                    borderRadius: 4,
                                    fontSize: 10,
                                    fontWeight: 600,
                                    backgroundColor: STATUS_COLORS[c.status] ?? "#f0f0f0",
                                  }}>
                                    {STATUS_LABELS[c.status] ?? c.status}
                                  </span>
                                </td>
                                <td style={{ padding: "4px 10px", whiteSpace: "nowrap", fontSize: 10, color: "#888" }}>
                                  {fmtTs(c.first_seen_at)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Disclaimer */}
                  <div style={{ marginTop: 20, backgroundColor: "#fffbf5", border: "1px solid #ffe0b2", borderRadius: 8, padding: "16px 20px", fontFamily: "Arial", fontSize: 12, color: "#555" }}>
                    <div style={{ fontWeight: 700, marginBottom: 8, color: "#1a1a1a", fontSize: 13 }}>
                      How this works
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      <li>Pipeline listens AIS globally for 10 min, 3× daily, and captures any vessel whose captain-declared <code>Destination</code> matches a Brazilian port.</li>
                      <li>Each candidate is enriched with VesselFinder last-port, flag, type, DWT and draft.</li>
                      <li>Cargo type isn't broadcast in AIS — the confidence score infers diesel likelihood from ship type, size, loaded state and origin hub.</li>
                      <li>When a candidate later appears in the port-scraped line-up, status automatically flips from <i>Detected</i> to <i>In line-up</i>.</li>
                      <li>False positives (gasoline or jet-fuel tankers) and negatives (ships with stale Destination field) are unavoidable — treat the confidence score as directional, not absolute.</li>
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
