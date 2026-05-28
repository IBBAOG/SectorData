"use client";

/**
 * Mobile view — /anp-cdp-bsw (≤768px) · Onda 3 reform (2026-05-27).
 *
 * Spec: plan § 4.7 (non-flagship).
 *
 * Layout (top → bottom):
 *   Page heading
 *   Filter chip row — Campo multi-select only (opens FilterDrawer)
 *   Hero MobileChart — field-aggregate ONLY (no per-well toggle on mobile)
 *   FilterDrawer — campo chip-cloud + search
 *
 * Note: MobileTopBar and MobileHomePill are provided by MobileShell in
 * (dashboard)/layout.tsx — do NOT render them here.
 *
 * Intentionally omitted on mobile (vs desktop):
 *   - Per-well view toggle (MobileTabBar removed — field-aggregate only)
 *   - Drill-down BottomSheet
 *   - ExportFAB (no export by design — consistent with desktop)
 *   - Plot-style toggle (defaults to markers+lines; not a primary mobile concern)
 *
 * 2026-05-28 update [mobile-only]: the 12-month BSW history table from the
 * desktop View is now mirrored below the chart, adapted to mobile (compact
 * font, horizontal scroll with sticky first column, color swatch per field).
 * The table consumes the same `tableModel` from the hook the desktop reads
 * — no new RPC, no new derivation.
 */

import { useEffect, useMemo, useState } from "react";
import type { PlotData } from "plotly.js";

import {
  FilterDrawer,
  MobileChart,
  FilterIcon,
  CloseIcon,
} from "../../../../components/dashboard/mobile";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";

import {
  useAnpCdpBswData,
  PALETTE,
  BRAND_ORANGE,
} from "../useAnpCdpBswData";

// ─── Constants ────────────────────────────────────────────────────────────────

const MOBILE_CHART_HEIGHT = 300;
const MOBILE_LINE_STYLE = "markers+lines" as const;

// ─── Mobile field-aggregate trace builder ─────────────────────────────────────
//
// Builds Plotly traces from fieldPoints for the mobile field-aggregate view.
// Derived locally (not from mobileChartTraces) so the hook's viewMode state
// does not need to be forced to "field" — fieldPoints is always populated when
// the hook fetches in field mode.

function buildFieldTraces(
  fieldPoints: import("../useAnpCdpBswData").AnpCdpBswFieldPoint[],
  selectedCampos: string[],
): PlotData[] {
  if (!selectedCampos.length || !fieldPoints.length) return [];

  return selectedCampos.map((campo, i) => {
    const subset = fieldPoints
      .filter((p) => p.campo === campo)
      .sort((a, b) => a.pct_voip - b.pct_voip);
    const color = i === 0 ? BRAND_ORANGE : PALETTE[(i + 1) % PALETTE.length];
    return {
      type: "scatter",
      mode: MOBILE_LINE_STYLE,
      name: campo,
      x: subset.map((p) => p.pct_voip),
      y: subset.map((p) => p.bsw),
      line: { color, width: i === 0 ? 2.2 : 1.4 },
      marker: { size: 5, color },
      hovertemplate: `${campo}: %{y:.1%} @ %{x:.1%}<extra></extra>`,
    } as unknown as PlotData;
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement | null {
  const {
    visible,
    visLoading,
    filtrosLoading,
    chartLoading: hookChartLoading,
    campos,
    selectedCampos,
    viewMode,
    handleModeChange,
    handleCamposChange,
    setSelectedCampos,
    fieldPoints,
    fieldColor,
    tableModel,
    fmtBsw,
    fmtDelta,
    computeDeltas,
  } = useAnpCdpBswData();

  // Pin viewMode to "field" on mobile — field-aggregate is the only view.
  // We call handleModeChange once on mount; subsequent renders are stable.
  useEffect(() => {
    if (viewMode !== "field") {
      handleModeChange("field");
    }
    // We intentionally omit viewMode from deps to run only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Use the hook's real fetch-state loading flag (driven by useDebouncedFetch)
  // instead of deriving from `fieldPoints.length === 0`. A derived flag stays
  // stuck on TRUE forever when the RPC legitimately returns `[]` (e.g. silent
  // 42501 caught by the wrapper, or no rows for the selection) — that bug
  // surfaced on 2026-05-28 as a never-clearing "updating…" indicator when
  // the canonical-expansion migration (20260530000000) accidentally revoked
  // the anon grant on these RPCs. The fix migration is
  // 20260601400000_restore_anon_grants_cdp_canonical_rpcs.sql; this loading
  // change is defense-in-depth so a future silent-empty regression renders
  // the "No data" branch immediately instead of hanging on "updating…".
  // Only mark loading while the field-aggregate fetch is the active view's
  // fetch (the hook gates per-view internally, but during the initial
  // viewMode!=="field" tick the hookChartLoading reflects the well fetch).
  const chartLoading =
    viewMode === "field"
      ? hookChartLoading
      : selectedCampos.length > 0 && !filtrosLoading && fieldPoints.length === 0;

  const [filterOpen, setFilterOpen] = useState(false);
  const [filterSearch, setFilterSearch] = useState("");

  const filteredCampos = useMemo(() => {
    const q = filterSearch.trim().toLowerCase();
    if (!q) return campos;
    return campos.filter((c) => c.toLowerCase().includes(q));
  }, [campos, filterSearch]);

  const mobileTraces = useMemo(
    () => buildFieldTraces(fieldPoints, selectedCampos),
    [fieldPoints, selectedCampos],
  );

  function handleReset() {
    setSelectedCampos([]);
    setFilterSearch("");
  }

  if (visLoading || !visible) return null;

  const activeFilterCount = selectedCampos.length;

  return (
    <div
      style={{
        fontFamily: "Arial, Helvetica, sans-serif",
        background: "var(--mobile-bg, #f5f5f7)",
        minHeight: "100dvh",
        // Bottom padding: Home pill height (56px) + 16px gap + safe area
        paddingBottom: "calc(80px + var(--mobile-safe-bottom, 0px))",
      }}
    >
      {/* Page heading */}
      <section style={{ padding: "16px 16px 8px" }}>
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 700,
            color: "var(--mobile-text, #1a1a1a)",
            lineHeight: 1.15,
            letterSpacing: "-0.005em",
          }}
        >
          BSW by Well
        </h1>
        <p
          style={{
            margin: "4px 0 0",
            fontSize: 13,
            color: "var(--mobile-text-muted, #6b6b73)",
            lineHeight: 1.4,
          }}
        >
          Water cut (BSW%) vs. % of VOIP recovered — field average
        </p>
      </section>

      {/* Filter chip row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 16px 4px",
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
          whiteSpace: "nowrap",
          scrollbarWidth: "none",
        }}
      >
        {/* Filter trigger button */}
        <button
          type="button"
          onClick={() => setFilterOpen(true)}
          aria-label="Open field filter"
          style={{
            flex: "0 0 auto",
            minHeight: 36,
            padding: "0 12px",
            borderRadius: 999,
            border: "1px dashed var(--mobile-border, #e0e0e0)",
            background: "var(--mobile-surface, #fff)",
            color: "var(--mobile-text, #1a1a1a)",
            fontFamily: "inherit",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <FilterIcon size={14} strokeWidth={2.4} />
          Field
          {activeFilterCount > 0 && (
            <span
              style={{
                minWidth: 18,
                height: 18,
                borderRadius: 999,
                background: BRAND_ORANGE,
                color: "#fff",
                fontSize: 10,
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0 5px",
              }}
            >
              {activeFilterCount}
            </span>
          )}
        </button>

        {/* Active-field chips */}
        {selectedCampos.map((c) => (
          <span
            key={c}
            title={c}
            style={{
              flex: "0 0 auto",
              minHeight: 36,
              padding: "0 6px 0 10px",
              borderRadius: 999,
              background: "var(--mobile-surface, #fff)",
              border: "1px solid var(--mobile-border, #e0e0e0)",
              color: "var(--mobile-text, #1a1a1a)",
              fontSize: 12,
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              maxWidth: 200,
            }}
          >
            {/* Color swatch */}
            <span
              aria-hidden="true"
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: fieldColor(c),
                flexShrink: 0,
              }}
            />
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: 130,
              }}
            >
              {c}
            </span>
            {/* Remove button */}
            <button
              type="button"
              onClick={() =>
                handleCamposChange(selectedCampos.filter((x) => x !== c))
              }
              aria-label={`Remove ${c}`}
              style={{
                width: 22,
                height: 22,
                border: 0,
                background: "transparent",
                color: "var(--mobile-text-muted, #6b6b73)",
                cursor: "pointer",
                padding: 0,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "50%",
              }}
            >
              <CloseIcon size={11} strokeWidth={2.5} />
            </button>
          </span>
        ))}
      </div>

      {/* Main content */}
      {filtrosLoading ? (
        <div style={{ padding: "40px 16px" }}>
          <BarrelLoading bare />
        </div>
      ) : (
        <section
          style={{
            margin: "12px 16px 16px",
            padding: "14px 14px 12px",
            background: "var(--mobile-surface, #fff)",
            borderRadius: 14,
            border: "1px solid var(--mobile-border-soft, #f0f0f5)",
            boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
          }}
        >
          {/* Chart header row */}
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: 8,
              gap: 8,
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "var(--mobile-text, #1a1a1a)",
                letterSpacing: "0.02em",
              }}
            >
              BSW % vs VOIP recovered
              {chartLoading && (
                <span
                  style={{
                    marginLeft: 6,
                    fontSize: 11,
                    fontWeight: 400,
                    color: "var(--mobile-text-muted, #6b6b73)",
                  }}
                >
                  updating…
                </span>
              )}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--mobile-text-muted, #6b6b73)",
                fontWeight: 600,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                flexShrink: 0,
              }}
            >
              Field avg
            </div>
          </div>

          {/* Chart or empty state */}
          {selectedCampos.length === 0 ? (
            <div
              style={{
                height: MOBILE_CHART_HEIGHT,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                padding: "16px",
                textAlign: "center",
                color: "var(--mobile-text-muted, #6b6b73)",
                fontSize: 13,
                lineHeight: 1.5,
                border: "1px dashed var(--mobile-border, #e0e0e0)",
                borderRadius: 10,
                background: "var(--mobile-surface-2, #fafafc)",
              }}
            >
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                style={{ color: BRAND_ORANGE, opacity: 0.65 }}
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <span>Select one or more fields to plot BSW evolution.</span>
              <button
                type="button"
                onClick={() => setFilterOpen(true)}
                style={{
                  minHeight: 36,
                  padding: "0 16px",
                  border: 0,
                  borderRadius: 999,
                  background: BRAND_ORANGE,
                  color: "#fff",
                  fontFamily: "inherit",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                  boxShadow: "0 2px 8px rgba(255,80,0,0.25)",
                  marginTop: 4,
                }}
              >
                Choose field
              </button>
            </div>
          ) : mobileTraces.length === 0 && !chartLoading ? (
            <div
              style={{
                height: MOBILE_CHART_HEIGHT,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "16px",
                textAlign: "center",
                color: "var(--mobile-text-muted, #6b6b73)",
                fontSize: 13,
                lineHeight: 1.4,
                border: "1px dashed var(--mobile-border, #e0e0e0)",
                borderRadius: 10,
                background: "var(--mobile-surface-2, #fafafc)",
              }}
            >
              No data for the selected {selectedCampos.length === 1 ? "field" : "fields"}.
            </div>
          ) : (
            <MobileChart
              data={mobileTraces}
              height={MOBILE_CHART_HEIGHT}
              layout={{
                showlegend: selectedCampos.length > 1,
                legend: {
                  orientation: "h",
                  yanchor: "bottom",
                  y: 1.02,
                  xanchor: "left",
                  x: 0,
                  font: { size: 10 },
                },
                xaxis: {
                  tickformat: ",.0%",
                  nticks: 4,
                  rangemode: "tozero",
                },
                yaxis: {
                  rangemode: "tozero",
                  tickformat: ",.0%",
                  nticks: 4,
                },
                margin: { l: 38, r: 8, t: selectedCampos.length > 1 ? 28 : 6, b: 28 },
              }}
            />
          )}

          {/* Axis labels */}
          {selectedCampos.length > 0 && (
            <div
              style={{
                marginTop: 6,
                display: "flex",
                justifyContent: "space-between",
                fontSize: 10,
                color: "var(--mobile-text-muted, #6b6b73)",
                fontWeight: 600,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              <span>Y: BSW%</span>
              <span>X: VOIP recovered</span>
            </div>
          )}
        </section>
      )}

      {/* ── 12-month BSW history table (mirrors desktop) ──────────────────── */}
      {!filtrosLoading && tableModel.rows.length > 0 && (
        <section
          style={{
            margin: "0 16px 16px",
            padding: "14px 14px 12px",
            background: "var(--mobile-surface, #fff)",
            borderRadius: 14,
            border: "1px solid var(--mobile-border-soft, #f0f0f5)",
            boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: 10,
              gap: 8,
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "var(--mobile-text, #1a1a1a)",
                letterSpacing: "0.02em",
              }}
            >
              Recent BSW history
            </div>
            <div
              style={{
                fontSize: 10,
                color: "var(--mobile-text-muted, #6b6b73)",
                fontWeight: 600,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                flexShrink: 0,
              }}
            >
              Last 12 mo
            </div>
          </div>

          <div
            style={{
              overflowX: "auto",
              WebkitOverflowScrolling: "touch",
              border: "1px solid var(--mobile-border, #e6e6ec)",
              borderRadius: 10,
              maxHeight: 360,
              overflowY: "auto",
            }}
          >
            <table
              style={{
                borderCollapse: "separate",
                borderSpacing: 0,
                width: "100%",
                fontFamily: "Arial, Helvetica, sans-serif",
              }}
            >
              <thead>
                <tr>
                  <th
                    style={{
                      position: "sticky",
                      left: 0,
                      top: 0,
                      zIndex: 2,
                      background: "var(--mobile-surface-elevated, #fafafc)",
                      borderBottom: "1px solid var(--mobile-border, #e6e6ec)",
                      boxShadow: "1px 0 0 var(--mobile-border, #e6e6ec)",
                      padding: "8px 10px",
                      textAlign: "left",
                      fontSize: 10,
                      fontWeight: 700,
                      color: "var(--mobile-text-muted, #6b6b73)",
                      textTransform: "uppercase",
                      letterSpacing: "0.4px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Field
                  </th>
                  {tableModel.months.map((m) => (
                    <th
                      key={m}
                      style={{
                        position: "sticky",
                        top: 0,
                        zIndex: 1,
                        background: "var(--mobile-surface-elevated, #fafafc)",
                        borderBottom: "1px solid var(--mobile-border, #e6e6ec)",
                        padding: "8px 10px",
                        textAlign: "right",
                        fontSize: 10,
                        fontWeight: 700,
                        color: "var(--mobile-text-muted, #6b6b73)",
                        textTransform: "uppercase",
                        letterSpacing: "0.4px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {m}
                    </th>
                  ))}
                  <th
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 1,
                      background: "var(--mobile-surface-elevated, #fafafc)",
                      borderBottom: "1px solid var(--mobile-border, #e6e6ec)",
                      padding: "8px 10px",
                      textAlign: "right",
                      fontSize: 10,
                      fontWeight: 700,
                      color: "var(--mobile-text-muted, #6b6b73)",
                      textTransform: "uppercase",
                      letterSpacing: "0.4px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    MoM%
                  </th>
                  <th
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 1,
                      background: "var(--mobile-surface-elevated, #fafafc)",
                      borderBottom: "1px solid var(--mobile-border, #e6e6ec)",
                      padding: "8px 10px",
                      textAlign: "right",
                      fontSize: 10,
                      fontWeight: 700,
                      color: "var(--mobile-text-muted, #6b6b73)",
                      textTransform: "uppercase",
                      letterSpacing: "0.4px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    YTD%
                  </th>
                </tr>
              </thead>
              <tbody>
                {tableModel.rows.map((row) => {
                  const { mom, ytd } = computeDeltas(tableModel.months, row.values);
                  const momFmt = fmtDelta(mom);
                  const ytdFmt = fmtDelta(ytd);
                  return (
                    <tr key={row.item}>
                      <td
                        title={row.item}
                        style={{
                          position: "sticky",
                          left: 0,
                          zIndex: 1,
                          background: "var(--mobile-surface, #fff)",
                          boxShadow: "1px 0 0 var(--mobile-border, #e6e6ec)",
                          borderBottom: "1px solid var(--mobile-border, #f0f0f0)",
                          padding: "10px 10px",
                          fontSize: 11,
                          fontWeight: 600,
                          color: "var(--mobile-text, #1a1a1a)",
                          whiteSpace: "nowrap",
                          maxWidth: 140,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        <span
                          aria-hidden
                          style={{
                            display: "inline-block",
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            backgroundColor: row.color,
                            marginRight: 6,
                            verticalAlign: "middle",
                            flexShrink: 0,
                          }}
                        />
                        {row.item}
                      </td>
                      {tableModel.months.map((m) => (
                        <td
                          key={m}
                          style={{
                            borderBottom: "1px solid var(--mobile-border, #f0f0f0)",
                            padding: "10px 10px",
                            fontSize: 11,
                            color: "var(--mobile-text, #1a1a1a)",
                            textAlign: "right",
                            whiteSpace: "nowrap",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {fmtBsw(row.values[m])}
                        </td>
                      ))}
                      <td
                        style={{
                          borderBottom: "1px solid var(--mobile-border, #f0f0f0)",
                          padding: "10px 10px",
                          fontSize: 11,
                          textAlign: "right",
                          whiteSpace: "nowrap",
                          fontVariantNumeric: "tabular-nums",
                          color: momFmt.color,
                          fontWeight: 700,
                        }}
                      >
                        {momFmt.text}
                      </td>
                      <td
                        style={{
                          borderBottom: "1px solid var(--mobile-border, #f0f0f0)",
                          padding: "10px 10px",
                          fontSize: 11,
                          textAlign: "right",
                          whiteSpace: "nowrap",
                          fontVariantNumeric: "tabular-nums",
                          color: ytdFmt.color,
                          fontWeight: 700,
                        }}
                      >
                        {ytdFmt.text}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div
            style={{
              marginTop: 8,
              fontSize: 10,
              color: "var(--mobile-text-muted, #6b6b73)",
              lineHeight: 1.4,
            }}
          >
            Swipe horizontally to see all months. MoM and YTD compare the latest available month against the prior month and the first month of the same year.
          </div>
        </section>
      )}

      {/* Filter Drawer — campo multi-select + search */}
      <FilterDrawer
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Select Fields"
        onReset={handleReset}
        onApply={() => setFilterOpen(false)}
        applyLabel="Apply"
      >
        {/* Header: label + counter + clear */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 10,
            gap: 8,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--mobile-text, #1a1a1a)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            Field{" "}
            <span style={{ fontWeight: 400, color: "var(--mobile-text-muted, #6b6b73)" }}>
              ({selectedCampos.length}/{campos.length})
            </span>
          </div>
          {selectedCampos.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedCampos([])}
              style={{
                border: 0,
                background: "transparent",
                color: BRAND_ORANGE,
                fontFamily: "inherit",
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                cursor: "pointer",
                padding: 0,
              }}
            >
              Clear
            </button>
          )}
        </div>

        {/* Search input */}
        <input
          type="text"
          value={filterSearch}
          onChange={(e) => setFilterSearch(e.target.value)}
          placeholder="Search field…"
          style={{
            width: "100%",
            minHeight: 40,
            padding: "0 12px",
            borderRadius: 10,
            border: "1px solid var(--mobile-border, #e0e0e0)",
            background: "var(--mobile-surface, #fff)",
            color: "var(--mobile-text, #1a1a1a)",
            fontFamily: "inherit",
            fontSize: 13,
            marginBottom: 10,
            boxSizing: "border-box",
          }}
        />

        {/* Hint */}
        <div
          style={{
            fontSize: 11,
            color: "var(--mobile-text-muted, #6b6b73)",
            lineHeight: 1.4,
            marginBottom: 8,
          }}
        >
          Each field gets a chart color in selection order.
        </div>

        {/* Chip cloud */}
        <div
          style={{
            maxHeight: 280,
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            padding: 2,
          }}
        >
          {filteredCampos.length === 0 ? (
            <div
              style={{
                width: "100%",
                padding: "16px 8px",
                textAlign: "center",
                color: "var(--mobile-text-muted, #6b6b73)",
                fontSize: 12,
              }}
            >
              No fields match &ldquo;{filterSearch}&rdquo;.
            </div>
          ) : (
            filteredCampos.map((campo) => {
              const active = selectedCampos.includes(campo);
              const swatch = active ? fieldColor(campo) : null;
              return (
                <button
                  key={campo}
                  type="button"
                  onClick={() =>
                    handleCamposChange(
                      active
                        ? selectedCampos.filter((c) => c !== campo)
                        : [...selectedCampos, campo],
                    )
                  }
                  style={{
                    minHeight: 32,
                    padding: active ? "0 10px 0 8px" : "0 10px",
                    borderRadius: 999,
                    border: "1px solid",
                    borderColor: active
                      ? BRAND_ORANGE
                      : "var(--mobile-border, #e0e0e0)",
                    background: active ? "rgba(255,80,0,0.08)" : "transparent",
                    color: active
                      ? BRAND_ORANGE
                      : "var(--mobile-text-muted, #6b6b73)",
                    fontFamily: "inherit",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {active && swatch && (
                    <span
                      aria-hidden="true"
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: swatch,
                        flexShrink: 0,
                      }}
                    />
                  )}
                  {campo}
                </button>
              );
            })
          )}
        </div>
      </FilterDrawer>

    </div>
  );
}
