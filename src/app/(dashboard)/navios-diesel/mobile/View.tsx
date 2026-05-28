"use client";

// ─── Mobile view — /navios-diesel (v2 radical simplification) ───────────────
//
// Spec: /.claude/plans/o-modo-mobile-da-tranquil-giraffe.md § 4.6
//
// Layout:
//   1. Title block + last-collected badge
//   2. Top sticky filter chip row (Status display only — aggregate mode)
//   3. Hero — Plotly horizontal bar chart: total diesel volume by port (MobileChart)
//   4. Summary table: Port | Total volume | Next ETA | Vessels
//
// Explicitly REMOVED vs mobile v1 (CTO approval, § 4.6):
//   • Radar / AIS live map       → desktop-only
//   • Per-vessel lineup table    → desktop-only
//   • "Next vessel" hero card    → desktop-only
//   • ExportFAB                  → removed per § 3.4 (no export on mobile)
//   • MobileBottomTabBar         → replaced by floating MobileHomePill (global nav, Onda 2)
//   • MobileTopBar               → NavBar hidden by MobileLayout (Onda 2)
//   • Tabs (Lineup / Radar / Ports) → removed
//   • Cabotage / multi-select / country filters → not on mobile
//   • useIsMobile()              → NOT called (mobile/View.tsx is always mobile)
//
// Hook: aggregateOnly:true skips get_nd_navios, get_nd_volume_mensal_descarga,
//   get_nd_navios_descarregados, and the previous-day diff fetch.
//
// Binding sync rule: this view is [mobile-only] — the radical simplification
// is intentional and was approved by the CTO. Desktop retains full lineup /
// AIS / monthly chart / cross-port table. Any new data-layer addition must
// land in BOTH views in the same commit, or declare [mobile-only] / [desktop-only].

import { useMemo, useState } from "react";
import type { PlotData } from "plotly.js";
import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import MobileChart from "../../../../components/dashboard/mobile/MobileChart";
import { useNaviosDieselData } from "../useNaviosDieselData";

// ─── Constants ────────────────────────────────────────────────────────────────

const BRAND_ORANGE = "#ff5000";

/** Colors for bar segments — first slot is always orange (leader port). */
const BAR_COLORS = [
  BRAND_ORANGE,
  "#1a1a1a",
  "#73C6A1",
  "#5B9BD5",
  "#E07B39",
  "#9B59B6",
  "#2ECC71",
  "#E74C3C",
];

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
        </tbody>
      </table>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("navios-diesel");

  // aggregateOnly:true — skip per-vessel RPCs (get_nd_navios, volume mensal,
  // navios descarregados, prev-day diff). Mobile only needs port aggregates.
  const {
    resumoPortos,
    selectedColeta,
    loading,
    error,
  } = useNaviosDieselData({ aggregateOnly: true });

  // ── Local UI state ────────────────────────────────────────────────────────────
  // Status filter chip — visual affordance only; in aggregate-only mode there
  // is no per-vessel data to filter. The chip communicates the "lens" to the
  // user; desktop provides the filtered breakdown.
  const [statusFilter, setStatusFilter] = useState<"all" | "expected" | "active">("all");

  // ── Derived: sort ports by volume DESC ────────────────────────────────────────
  const sortedPortos = useMemo(
    () => [...resumoPortos].sort((a, b) => b.total_convertida - a.total_convertida),
    [resumoPortos],
  );

  const tableRows = useMemo(
    (): PortTableRow[] =>
      sortedPortos.map((r) => ({
        porto: r.porto,
        totalVolume: r.total_convertida,
        vesselCount: r.total_navios,
      })),
    [sortedPortos],
  );

  // ── Plotly horizontal bar chart ───────────────────────────────────────────────
  const chartData = useMemo((): PlotData[] => {
    const labels = sortedPortos.map((r) => shortPort(r.porto));
    const values = sortedPortos.map((r) => r.total_convertida);
    const colors = sortedPortos.map(
      (_, i) => BAR_COLORS[i % BAR_COLORS.length] ?? BRAND_ORANGE,
    );

    return [
      {
        type: "bar",
        orientation: "h",
        x: values,
        y: labels,
        marker: {
          color: colors,
          opacity: 0.9,
        },
        hovertemplate: "%{y}: %{x:,.0f} m³<extra></extra>",
      } as PlotData,
    ];
  }, [sortedPortos]);

  // Dynamic height: ~44px per bar, clamped to [180, 420]
  const chartHeight = useMemo(
    () => Math.max(180, Math.min(sortedPortos.length * 44 + 48, 420)),
    [sortedPortos.length],
  );

  const chartLayout = useMemo(
    () => ({
      margin: { l: 90, r: 14, t: 8, b: 32 },
      xaxis: {
        showgrid: true,
        tickformat: "~s",
        title: { text: "m³", font: { size: 10 } },
      },
      yaxis: {
        automargin: false,
        tickfont: { size: 11 },
        fixedrange: true,
      },
      bargap: 0.3,
    }),
    [],
  );

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

      {/* ── Sticky filter chip row ───────────────────────────────────────────── */}
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
        aria-label="Status filter"
      >
        {(["all", "expected", "active"] as const).map((f) => {
          const isActive = statusFilter === f;
          const label = f === "all" ? "All" : f === "expected" ? "Expected" : "Active";
          return (
            <button
              key={f}
              type="button"
              onClick={() => setStatusFilter(f)}
              aria-pressed={isActive}
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

      {/* ── Hero bar chart by port ───────────────────────────────────────────── */}
      <section
        style={{ margin: "16px 0 0", padding: "0 16px" }}
        aria-label="Diesel volume by port"
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "var(--mobile-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            marginBottom: 8,
          }}
        >
          Volume by port (m³)
        </div>

        {loading ? (
          <div
            style={{
              height: 180,
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
            Could not load port data.
          </div>
        ) : sortedPortos.length === 0 ? (
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
              data={chartData}
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
              marginBottom: 10,
            }}
          >
            Port summary
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
            Next ETA available on desktop (full vessel line-up).
          </div>
        </section>
      )}
    </div>
  );
}
