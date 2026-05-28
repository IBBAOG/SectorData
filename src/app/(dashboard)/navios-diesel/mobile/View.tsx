"use client";

// ─── Mobile view — /navios-diesel ───────────────────────────────────────────
//
// Layout:
//   1. Title block + last-collected badge
//   2. Top tab row — All / Expected / Active (toggles which trace(s) of the
//      monthly stacked chart are visible; defaults to All = all 3 traces)
//   3. Hero — Plotly stacked bar chart: Monthly Diesel Volume (m³)
//      (mirrors desktop "Monthly Diesel Volume" chart — same 3 traces
//      Discharged / Pending / Indeterminate, same data source, adapted to
//      mobile viewport width via MobileChart)
//   4. Port summary table: Port | Volume (m³) | Next ETA | Vessels
//      Scope: CURRENT MONTH ONLY (the live bar of the stacked chart above).
//      Sourced from resumoMensal (port × month) filtered to the live month,
//      so SUM(rows) == SUM(stacked traces of the current month bar). Never
//      includes cabotagem (RPC enforces NOT is_cabotagem upstream).
//
// Tab semantics (filter on the monthly chart only):
//   • All       — all 3 stacks visible (Discharged + Pending + Indeterminate)
//   • Expected  — Pending only (vessels still expected to discharge)
//   • Active    — Discharged only (vessels that already delivered)
//
// Explicitly REMOVED vs desktop (mobile-only divergences):
//   • Radar / AIS live map         → desktop-only
//   • Per-vessel lineup table      → desktop-only
//   • Monthly Summary by Port      → desktop-only (cross-tab table)
//   • ExportFAB / Export buttons   → no export on mobile (§ 3.4)
//   • Sidebar calendar             → not present on mobile

import { useMemo, useState } from "react";
import type { PlotData } from "plotly.js";
import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import MobileChart from "../../../../components/dashboard/mobile/MobileChart";
import { useNaviosDieselData } from "../useNaviosDieselData";

// ─── Constants ────────────────────────────────────────────────────────────────

const BRAND_ORANGE = "#ff5000";
const DISCHARGED_COLOR = "#000000";
const PENDING_COLOR = BRAND_ORANGE;
const INDETERMINATE_COLOR = "#73C6A1";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtVolume(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function hoursAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "< 1h ago";
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Strip "Porto de " prefix for compact display. */
function shortPort(p: string): string {
  return p.replace(/^Porto de /i, "");
}

/** "2026-05" → "May 2026" (with "(live)" suffix when current). */
function monthLabel(ym: string, isCurrent: boolean): string {
  const [yr, mo] = ym.split("-");
  const base = new Date(Number(yr), Number(mo) - 1, 1)
    .toLocaleDateString("en-US", { month: "short", year: "numeric" });
  return isCurrent ? `${base} (live)` : base;
}

// ─── Port summary table ───────────────────────────────────────────────────────

interface PortTableRow {
  porto: string;
  totalVolume: number;
  vesselCount: number;
}

function PortSummaryTable({
  rows,
}: {
  rows: PortTableRow[];
}): React.ReactElement {
  const totalVolume = rows.reduce((acc, r) => acc + (r.totalVolume || 0), 0);
  const totalVessels = rows.reduce((acc, r) => acc + (r.vesselCount || 0), 0);
  return (
    <div
      style={{
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
        scrollbarWidth: "none",
      }}
      role="region"
      aria-label="Port summary table"
    >
      <table
        style={{
          borderCollapse: "collapse",
          width: "100%",
          minWidth: 320,
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 13,
        }}
      >
        <thead>
          <tr>
            {(["Port", "Volume (m³)", "Next ETA", "Vessels"] as const).map(
              (col, i) => (
                <th
                  key={col}
                  style={{
                    padding: "8px 12px",
                    textAlign: i === 0 ? "left" : "right",
                    fontWeight: 700,
                    fontSize: 11,
                    color: "var(--mobile-text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    borderBottom: "1px solid var(--mobile-divider)",
                    whiteSpace: "nowrap",
                    // First column is sticky
                    ...(i === 0
                      ? {
                          position: "sticky" as const,
                          left: 0,
                          background: "var(--mobile-surface)",
                          zIndex: 2,
                        }
                      : {}),
                  }}
                >
                  {col}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={r.porto}>
              {/* Port — sticky */}
              <td
                style={{
                  padding: "10px 12px",
                  fontWeight: 600,
                  color: idx === 0 ? BRAND_ORANGE : "var(--mobile-text)",
                  borderBottom: "1px solid var(--mobile-divider)",
                  whiteSpace: "nowrap",
                  position: "sticky" as const,
                  left: 0,
                  background: "var(--mobile-surface)",
                  zIndex: 1,
                }}
              >
                {shortPort(r.porto)}
              </td>

              {/* Volume */}
              <td
                style={{
                  padding: "10px 12px",
                  textAlign: "right",
                  color: "var(--mobile-text)",
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                  borderBottom: "1px solid var(--mobile-divider)",
                  whiteSpace: "nowrap",
                }}
              >
                {fmtVolume(r.totalVolume)}
              </td>

              {/* Next ETA — not available in aggregate-only mode */}
              <td
                style={{
                  padding: "10px 12px",
                  textAlign: "right",
                  color: "var(--mobile-text-faint)",
                  fontVariantNumeric: "tabular-nums",
                  borderBottom: "1px solid var(--mobile-divider)",
                  whiteSpace: "nowrap",
                  fontSize: 12,
                }}
              >
                —
              </td>

              {/* Vessels */}
              <td
                style={{
                  padding: "10px 12px",
                  textAlign: "right",
                  color: "var(--mobile-text)",
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                  borderBottom: "1px solid var(--mobile-divider)",
                  whiteSpace: "nowrap",
                }}
              >
                {r.vesselCount}
              </td>
            </tr>
          ))}

          {/* Total row — sums Volume + Vessels across all ports.
              Next ETA is per-vessel, so it cannot be aggregated → "—". */}
          {rows.length > 0 && (
            <tr>
              <td
                style={{
                  padding: "10px 12px",
                  fontWeight: 700,
                  color: "var(--mobile-text)",
                  borderTop: "2px solid var(--mobile-text)",
                  whiteSpace: "nowrap",
                  position: "sticky" as const,
                  left: 0,
                  background: "var(--mobile-surface)",
                  zIndex: 1,
                  textTransform: "uppercase",
                  fontSize: 11,
                  letterSpacing: "0.05em",
                }}
              >
                Total
              </td>
              <td
                style={{
                  padding: "10px 12px",
                  textAlign: "right",
                  color: "var(--mobile-text)",
                  fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                  borderTop: "2px solid var(--mobile-text)",
                  whiteSpace: "nowrap",
                }}
              >
                {fmtVolume(totalVolume)}
              </td>
              <td
                style={{
                  padding: "10px 12px",
                  textAlign: "right",
                  color: "var(--mobile-text-faint)",
                  fontVariantNumeric: "tabular-nums",
                  borderTop: "2px solid var(--mobile-text)",
                  whiteSpace: "nowrap",
                  fontSize: 12,
                }}
              >
                —
              </td>
              <td
                style={{
                  padding: "10px 12px",
                  textAlign: "right",
                  color: "var(--mobile-text)",
                  fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                  borderTop: "2px solid var(--mobile-text)",
                  whiteSpace: "nowrap",
                }}
              >
                {totalVessels}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("navios-diesel");

  // aggregateOnly:true — skip per-vessel RPCs (get_nd_navios, naviosDescarregados,
  // prev-day diff). Mobile still needs volumeMensal (Monthly Diesel Volume chart)
  // plus port aggregates and the monthly port summary.
  const {
    resumoMensal,
    volumeMensal,
    selectedColeta,
    loading,
    error,
  } = useNaviosDieselData({ aggregateOnly: true });

  // ── Tab state: All / Expected / Active ──────────────────────────────────────
  // The tabs filter which traces of the stacked monthly chart are visible.
  const [statusFilter, setStatusFilter] = useState<"all" | "expected" | "active">("all");

  // ── Derived: current month (matches the live bar of the stacked chart) ──────
  // Port Summary must reflect the SAME month shown live on the chart, not a
  // historical snapshot total. We pick the row tagged is_current=true; if no
  // row carries that flag (legacy RPC), we fall back to the last month in the
  // sorted volumeMensal series.
  const currentMonth = useMemo<string | null>(() => {
    if (volumeMensal.length === 0) return null;
    const live = volumeMensal.find((r) => r.is_current);
    if (live) return live.month;
    const sorted = [...volumeMensal].sort((a, b) => a.month.localeCompare(b.month));
    return sorted[sorted.length - 1].month;
  }, [volumeMensal]);

  // ── Derived: port aggregates for the current month only ─────────────────────
  // Source: resumoMensal (port × month) — same data structure that powers the
  // desktop "Monthly Summary by Port" matrix. Filtering to currentMonth keeps
  // the mobile summary aligned 1:1 with the live bar of the stacked chart.
  const tableRows = useMemo(
    (): PortTableRow[] => {
      if (!currentMonth) return [];
      return resumoMensal
        .filter((r) => r.month === currentMonth)
        .map((r) => ({
          porto: r.porto,
          totalVolume: r.volume,
          vesselCount: r.vessels,
        }))
        .sort((a, b) => b.totalVolume - a.totalVolume);
    },
    [resumoMensal, currentMonth],
  );

  // Human-readable label for the sub-header ("May 2026").
  const currentMonthLabel = useMemo<string>(() => {
    if (!currentMonth) return "";
    const [yr, mo] = currentMonth.split("-");
    return new Date(Number(yr), Number(mo) - 1, 1).toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });
  }, [currentMonth]);

  // ── Monthly stacked bar chart — same data shape as desktop ──────────────────
  const monthlyChart = useMemo((): {
    data: PlotData[];
    maxTotal: number;
    totals: { x: string; total: number }[];
  } => {
    if (volumeMensal.length === 0) {
      return { data: [], maxTotal: 0, totals: [] };
    }

    const labels = volumeMensal.map((r) => monthLabel(r.month, !!r.is_current));
    const hoverSuffix = volumeMensal.map((r) => (r.is_current ? " · live" : " · frozen"));

    // Per-bar totals (sum of the 3 traces) — used by tab-aware annotations
    // below so the label above each bar reflects what is currently visible.
    const showDischarged = statusFilter === "all" || statusFilter === "active";
    const showPending = statusFilter === "all" || statusFilter === "expected";
    const showIndeterminate = statusFilter === "all";
    const totals = volumeMensal.map((r, i) => ({
      x: labels[i],
      total:
        (showDischarged ? r.discharged_volume : 0) +
        (showPending ? r.pending_volume : 0) +
        (showIndeterminate ? r.indeterminate_volume : 0),
    }));

    const maxTotal = Math.max(...totals.map((t) => t.total), 0);

    // Visibility per tab. "Expected" → Pending only. "Active" → Discharged only.
    // "All" → all three traces stacked. (Booleans defined above for totals.)

    const data: PlotData[] = [];

    if (showDischarged) {
      data.push({
        type: "bar",
        name: "Discharged",
        x: labels,
        y: volumeMensal.map((r) => r.discharged_volume),
        marker: { color: DISCHARGED_COLOR, opacity: 0.85 },
        customdata: hoverSuffix,
        hovertemplate: "%{x}<br>Discharged: %{y:,.0f} m³%{customdata}<extra></extra>",
      } as unknown as PlotData);
    }

    if (showPending) {
      data.push({
        type: "bar",
        name: "Pending",
        x: labels,
        y: volumeMensal.map((r) => r.pending_volume),
        marker: { color: PENDING_COLOR, opacity: 0.85 },
        customdata: hoverSuffix,
        hovertemplate: "%{x}<br>Pending: %{y:,.0f} m³%{customdata}<extra></extra>",
      } as unknown as PlotData);
    }

    if (showIndeterminate) {
      data.push({
        type: "bar",
        name: "Indeterminate",
        x: labels,
        y: volumeMensal.map((r) => r.indeterminate_volume),
        marker: { color: INDETERMINATE_COLOR, opacity: 0.85 },
        customdata: hoverSuffix,
        hovertemplate: "%{x}<br>Indeterminate: %{y:,.0f} m³%{customdata}<extra></extra>",
      } as unknown as PlotData);
    }

    return { data, maxTotal, totals };
  }, [volumeMensal, statusFilter]);

  const chartLayout = useMemo(
    () => ({
      barmode: "stack" as const,
      margin: { l: 44, r: 10, t: 20, b: 56 },
      xaxis: {
        tickfont: { size: 10 },
        tickangle: -40,
        automargin: false,
        fixedrange: true,
      },
      yaxis: {
        showgrid: true,
        tickformat: "~s",
        title: { text: "m³", font: { size: 10 } },
        fixedrange: true,
        // Extra headroom (×1.22) so the total label above the tallest bar
        // does not clip against the legend / plot top edge on ~390px viewports.
        range: monthlyChart.maxTotal > 0 ? [0, monthlyChart.maxTotal * 1.22] : undefined,
      },
      bargap: 0.25,
      legend: {
        orientation: "h" as const,
        x: 0,
        y: 1.22,
        xanchor: "left" as const,
        yanchor: "bottom" as const,
        font: { size: 10 },
      },
      showlegend: monthlyChart.data.length > 1,
      // Total label above each stacked bar (compact format, e.g. "113K").
      // Reflects the currently visible traces (tab-aware via monthlyChart.totals).
      annotations: monthlyChart.totals
        .filter((t) => t.total > 0)
        .map((t) => ({
          x: t.x,
          y: t.total,
          text: fmtVolume(t.total),
          showarrow: false,
          yanchor: "bottom" as const,
          yshift: 2,
          font: { family: "Arial, Helvetica, sans-serif", size: 9, color: "#1a1a1a" },
        })),
    }),
    [monthlyChart.maxTotal, monthlyChart.data.length, monthlyChart.totals],
  );

  // Slightly taller when legend visible (multi-trace "All" view).
  const chartHeight = monthlyChart.data.length > 1 ? 280 : 240;

  // ── Render guard ──────────────────────────────────────────────────────────────
  if (visLoading || !visible) return <></>;

  return (
    <div
      style={{
        maxWidth: 428,
        margin: "0 auto",
        minHeight: "100dvh",
        background: "var(--mobile-bg)",
        // Padding for the floating MobileHomePill (global nav, Onda 2) + safe area
        paddingBottom: "calc(80px + var(--mobile-safe-bottom))",
        fontFamily: "Arial, Helvetica, sans-serif",
        color: "var(--mobile-text)",
      }}
    >
      {/* ── Title block ─────────────────────────────────────────────────────── */}
      <section style={{ padding: "16px 16px 12px" }}>
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: "0.005em",
            color: "var(--mobile-text)",
          }}
        >
          Diesel Vessels
        </h1>
        <div style={{ marginTop: 2, fontSize: 13, color: "var(--mobile-text-muted)" }}>
          Port import summary
        </div>

        {/* Last-collected badge */}
        {selectedColeta && (
          <div
            style={{
              marginTop: 8,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              borderRadius: 999,
              background: "rgba(255,80,0,0.10)",
              color: "var(--mobile-accent)",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.02em",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--mobile-accent)",
                display: "inline-block",
              }}
            />
            Last collected: {hoursAgo(selectedColeta)}
          </div>
        )}
      </section>

      {/* ── Sticky tab row (All / Expected / Active) ─────────────────────────── */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 22,
          background: "var(--mobile-glass-bg)",
          WebkitBackdropFilter: "var(--mobile-glass-blur)",
          backdropFilter: "var(--mobile-glass-blur)",
          borderBottom: "1px solid var(--mobile-glass-border)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          overflowX: "auto",
          padding: "10px 16px",
          WebkitOverflowScrolling: "touch",
          scrollbarWidth: "none",
        } as React.CSSProperties}
        role="tablist"
        aria-label="Status tabs"
      >
        {(["all", "expected", "active"] as const).map((f) => {
          const isActive = statusFilter === f;
          const label = f === "all" ? "All" : f === "expected" ? "Expected" : "Active";
          return (
            <button
              key={f}
              type="button"
              role="tab"
              onClick={() => setStatusFilter(f)}
              aria-selected={isActive}
              style={{
                flex: "0 0 auto",
                minHeight: 32,
                padding: "0 14px",
                borderRadius: 999,
                border: isActive
                  ? "1.5px solid var(--mobile-accent)"
                  : "1px solid var(--mobile-divider)",
                background: isActive
                  ? "rgba(255,80,0,0.08)"
                  : "var(--mobile-surface)",
                color: isActive
                  ? "var(--mobile-accent)"
                  : "var(--mobile-text-muted)",
                fontSize: 13,
                fontWeight: isActive ? 700 : 500,
                fontFamily: "inherit",
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "all 0.15s ease",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* ── Hero: Monthly Diesel Volume (stacked bars) ───────────────────────── */}
      <section
        style={{ margin: "16px 0 0", padding: "0 16px" }}
        aria-label="Monthly Diesel Volume"
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "var(--mobile-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            marginBottom: 4,
          }}
        >
          Monthly Diesel Volume (m³)
        </div>
        <div
          style={{
            fontSize: 11,
            color: "var(--mobile-text-faint)",
            marginBottom: 8,
          }}
        >
          Past months frozen · current and future are live
        </div>

        {loading ? (
          <div
            style={{
              height: 240,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--mobile-text-faint)",
              fontSize: 13,
            }}
          >
            Loading…
          </div>
        ) : error ? (
          <div
            style={{
              height: 100,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--mobile-text-faint)",
              fontSize: 13,
              textAlign: "center",
              padding: "0 8px",
            }}
          >
            Could not load monthly volume.
          </div>
        ) : volumeMensal.length === 0 ? (
          <div
            style={{
              height: 100,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--mobile-text-faint)",
              fontSize: 13,
            }}
          >
            No data available.
          </div>
        ) : (
          <div
            style={{
              borderRadius: 16,
              overflow: "hidden",
              border: "1px solid var(--mobile-divider)",
              background: "var(--mobile-surface)",
            }}
          >
            <MobileChart
              data={monthlyChart.data}
              layout={chartLayout}
              height={chartHeight}
            />
          </div>
        )}
      </section>

      {/* ── Summary table per port ───────────────────────────────────────────── */}
      {!loading && !error && tableRows.length > 0 && (
        <section
          style={{ margin: "20px 0 0", padding: "0 16px" }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "var(--mobile-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 2,
            }}
          >
            Port summary
          </div>
          <div
            style={{
              fontSize: 11,
              color: "var(--mobile-text-faint)",
              marginBottom: 10,
            }}
          >
            {currentMonthLabel
              ? `Current month · ${currentMonthLabel} (live)`
              : "Current month (live)"}
          </div>

          <div
            style={{
              borderRadius: 16,
              overflow: "hidden",
              border: "1px solid var(--mobile-divider)",
              background: "var(--mobile-surface)",
            }}
          >
            <PortSummaryTable rows={tableRows} />
          </div>

          <div
            style={{
              marginTop: 6,
              fontSize: 11,
              color: "var(--mobile-text-faint)",
            }}
          >
            Totals match the live bar of the chart above. Next ETA available on desktop (full vessel line-up).
          </div>
        </section>
      )}
    </div>
  );
}
