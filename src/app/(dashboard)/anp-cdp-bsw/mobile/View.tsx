"use client";

// Mobile View — /anp-cdp-bsw (≤768px).
//
// Single-chart archetype (closest mockup: mockups/anp-cdp-mobile.html — hero
// chart pattern). The dashboard has ONE chart and ONE filter (field
// multi-select), so the mobile layout is intentionally minimal:
//
//   MobileTopBar              — sticky liquid-glass wordmark + title
//   Page heading              — title + subtitle
//   MobileTabBar (underline)  — View toggle: Per well / Field average
//   Filter chip row           — sticky, opens FilterDrawer; shows selected
//                               fields with their PALETTE color swatch
//   Hero MobileChart          — brand orange leader trace, PALETTE followers
//   Empty state               — instructional copy when no field selected
//   12-month BSW table        — mirrors desktop "Recent BSW history"
//   FilterDrawer              — field multi-select with color swatches +
//                               plot style toggle (no period slider, no
//                               export — by design)
//
// No ExportFAB by design — per README ("Export: No") and sub-PRD § Antipatterns
// ("Adding an ExportPanel 'for symmetry' with the rest of /anp-*").
// No MobileBottomTabBar — single-analysis page; the page's own viewport is
// the entire UX (the global navbar replacement happens at the desktop layer).
//
// Binding sync rule (CLAUDE.md § Dual-view policy): meaningful changes here
// must land in ../desktop/View.tsx in the SAME commit, OR the commit message
// must declare `[mobile-only]` with an explicit reason.

import { useMemo, useState } from "react";

import {
  MobileTopBar,
  MobileTabBar,
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
  LINE_STYLE_OPTIONS,
  MAX_FIELDS_IN_FIELD_MODE,
  type ViewMode,
  type LineStyle,
} from "../useAnpCdpBswData";

// ─── Constants ────────────────────────────────────────────────────────────────

const MOBILE_CHART_HEIGHT = 280;

export default function MobileView(): React.ReactElement | null {
  const {
    visible,
    visLoading,
    filtrosLoading,
    chartLoading,
    campos,
    selectedCampos,
    viewMode,
    lineStyle,
    handleModeChange,
    handleCamposChange,
    setSelectedCampos,
    setLineStyle,
    mobileChartTraces,
    tableModel,
    uniqueWellCount,
    fieldColor,
    fmtBsw,
    fmtDelta,
    computeDeltas,
  } = useAnpCdpBswData();

  const [filterOpen, setFilterOpen] = useState(false);

  // Build a chip count (= number of selected fields). Always at least 0.
  const activeFilterCount = selectedCampos.length;

  // Search filter inside the drawer — touch users benefit from a quick
  // type-ahead because the field list can have hundreds of entries.
  const [filterSearch, setFilterSearch] = useState("");
  const filteredCampos = useMemo(() => {
    const q = filterSearch.trim().toLowerCase();
    if (!q) return campos;
    return campos.filter((c) => c.toLowerCase().includes(q));
  }, [campos, filterSearch]);

  const chartTitle = useMemo(() => {
    if (viewMode === "well") {
      return selectedCampos.length === 1
        ? `Per well — ${selectedCampos[0]}`
        : "Per well";
    }
    return "Field average";
  }, [viewMode, selectedCampos]);

  const chartSubtitle = viewMode === "well"
    ? "Months since first production"
    : "% of VOIP recovered";

  function handleReset() {
    setSelectedCampos([]);
    setFilterSearch("");
  }

  if (visLoading || !visible) return null;

  return (
    <div
      style={{
        fontFamily: "Arial, Helvetica, sans-serif",
        background: "var(--mobile-bg, #f5f5f7)",
        minHeight: "100dvh",
        paddingBottom: "calc(24px + var(--mobile-safe-bottom, 0px))",
      }}
    >
      {/* Sticky top bar */}
      <MobileTopBar title="ANP BSW by Well" />

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
        <div
          style={{
            marginTop: 4,
            fontSize: 13,
            color: "var(--mobile-text-muted, #6b6b73)",
          }}
        >
          Water cut vs depletion proxy, per field
        </div>
      </section>

      {/* View-mode tabs (underline variant — minimal chrome) */}
      <div style={{ padding: "4px 0 0" }}>
        <MobileTabBar
          tabs={[
            { key: "well",  label: "Per well" },
            { key: "field", label: "Field avg" },
          ]}
          activeKey={viewMode}
          onChange={(k) => handleModeChange(k as ViewMode)}
          variant="underline"
          ariaLabel="View mode"
        />
      </div>

      {/* Filter chip row (sticky just under MobileTabBar) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 16px 4px",
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
          whiteSpace: "nowrap",
          scrollbarWidth: "none",
        }}
      >
        <button
          type="button"
          onClick={() => setFilterOpen(true)}
          aria-label="Open filters"
          style={{
            flex: "0 0 auto",
            minHeight: 32,
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
          Filters
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

        {/* Selected-field chips with color swatches */}
        {selectedCampos.map((c) => (
          <span
            key={c}
            title={c}
            style={{
              flex: "0 0 auto",
              minHeight: 32,
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
        <div style={{ padding: "32px 16px" }}>
          <BarrelLoading bare />
        </div>
      ) : (
        <>
          {/* Chart card */}
          <section
            style={{
              margin: "12px 16px 16px",
              padding: "14px 14px 12px",
              background: "var(--mobile-surface, #fff)",
              borderRadius: 14,
              border: "1px solid var(--mobile-border-soft, #f0f0f5)",
              boxShadow: "0 1px 2px rgba(0, 0, 0, 0.03)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                marginBottom: 6,
                opacity: chartLoading ? 0.6 : 1,
                gap: 8,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--mobile-text, #1a1a1a)",
                  letterSpacing: "0.02em",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={chartTitle}
              >
                {chartTitle}
                {chartLoading && (
                  <span
                    style={{
                      marginLeft: 6,
                      fontSize: 11,
                      fontWeight: 400,
                      color: "var(--mobile-text-muted, #6b6b73)",
                    }}
                  >
                    updating...
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
                BSW %
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
                  gap: 8,
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
                  style={{ color: BRAND_ORANGE, opacity: 0.6 }}
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <span>
                  {viewMode === "well"
                    ? "Select a field to plot BSW evolution per well."
                    : "Select one or more fields to plot BSW evolution."}
                </span>
                <button
                  type="button"
                  onClick={() => setFilterOpen(true)}
                  style={{
                    minHeight: 36,
                    padding: "0 14px",
                    border: 0,
                    borderRadius: 999,
                    background: BRAND_ORANGE,
                    color: "#fff",
                    fontFamily: "inherit",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                    boxShadow: "0 2px 8px rgba(255, 80, 0, 0.25)",
                    marginTop: 4,
                  }}
                >
                  Choose field
                </button>
              </div>
            ) : mobileChartTraces.length === 0 && !chartLoading ? (
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
                data={mobileChartTraces}
                height={MOBILE_CHART_HEIGHT}
                layout={{
                  showlegend: selectedCampos.length > 1 || viewMode === "well",
                  legend: {
                    orientation: "h",
                    yanchor: "bottom",
                    y: 1.02,
                    xanchor: "left",
                    x: 0,
                    font: { size: 10 },
                  },
                  xaxis: viewMode === "field"
                    ? { tickformat: ",.0%", nticks: 4 }
                    : { nticks: 5 },
                  yaxis: {
                    range: [0, 1],
                    tickformat: ",.0%",
                    nticks: 4,
                  },
                  margin: { l: 38, r: 8, t: 6, b: 28 },
                }}
              />
            )}

            {/* Subtitle / X-axis description */}
            {selectedCampos.length > 0 && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 11,
                  color: "var(--mobile-text-muted, #6b6b73)",
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  textAlign: "center",
                }}
              >
                X: {chartSubtitle}
              </div>
            )}

            {/* Per-well legend hint */}
            {viewMode === "well" && selectedCampos.length === 1 && uniqueWellCount > 0 && (
              <div
                style={{
                  marginTop: 6,
                  fontSize: 11,
                  color: "var(--mobile-text-muted, #6b6b73)",
                  textAlign: "center",
                }}
              >
                {uniqueWellCount} {uniqueWellCount === 1 ? "well" : "wells"} in this field
              </div>
            )}
          </section>

          {/* 12-month BSW history table */}
          {tableModel.rows.length > 0 && (
            <section
              style={{
                margin: "0 16px 16px",
                padding: "12px 12px 8px",
                background: "var(--mobile-surface, #fff)",
                borderRadius: 14,
                border: "1px solid var(--mobile-border-soft, #f0f0f5)",
                boxShadow: "0 1px 2px rgba(0, 0, 0, 0.03)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  marginBottom: 8,
                  padding: "0 4px",
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
                    fontSize: 11,
                    color: "var(--mobile-text-muted, #6b6b73)",
                    fontWeight: 600,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                  }}
                >
                  12 mo
                </div>
              </div>
              <div
                style={{
                  maxHeight: 320,
                  overflowY: "auto",
                  overflowX: "auto",
                  WebkitOverflowScrolling: "touch",
                  borderRadius: 8,
                }}
              >
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontFamily: "Arial",
                    fontSize: 11,
                  }}
                >
                  <thead
                    style={{
                      position: "sticky",
                      top: 0,
                      background: "var(--mobile-surface, #fff)",
                      zIndex: 1,
                    }}
                  >
                    <tr>
                      <th
                        style={{
                          textAlign: "left",
                          whiteSpace: "nowrap",
                          padding: "6px 8px",
                          borderBottom: "2px solid var(--mobile-border, #e0e0e0)",
                          color: "var(--mobile-text-muted, #6b6b73)",
                          fontWeight: 700,
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                          fontSize: 10,
                        }}
                      >
                        Item
                      </th>
                      {tableModel.months.map((m) => (
                        <th
                          key={m}
                          style={{
                            textAlign: "right",
                            whiteSpace: "nowrap",
                            padding: "6px 8px",
                            borderBottom: "2px solid var(--mobile-border, #e0e0e0)",
                            color: "var(--mobile-text-muted, #6b6b73)",
                            fontWeight: 700,
                            letterSpacing: "0.02em",
                            fontSize: 10,
                          }}
                        >
                          {m.slice(2)}
                        </th>
                      ))}
                      <th
                        style={{
                          textAlign: "right",
                          whiteSpace: "nowrap",
                          padding: "6px 8px",
                          borderBottom: "2px solid var(--mobile-border, #e0e0e0)",
                          color: "var(--mobile-text-muted, #6b6b73)",
                          fontWeight: 700,
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                          fontSize: 10,
                        }}
                      >
                        MoM
                      </th>
                      <th
                        style={{
                          textAlign: "right",
                          whiteSpace: "nowrap",
                          padding: "6px 8px",
                          borderBottom: "2px solid var(--mobile-border, #e0e0e0)",
                          color: "var(--mobile-text-muted, #6b6b73)",
                          fontWeight: 700,
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                          fontSize: 10,
                        }}
                      >
                        YTD
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableModel.rows.map((row, idx) => {
                      const { mom, ytd } = computeDeltas(tableModel.months, row.values);
                      const momFmt = fmtDelta(mom);
                      const ytdFmt = fmtDelta(ytd);
                      return (
                        <tr
                          key={row.item}
                          style={{
                            background: idx % 2 === 0
                              ? "transparent"
                              : "var(--mobile-surface-2, #fafafc)",
                          }}
                        >
                          <td
                            style={{
                              whiteSpace: "nowrap",
                              maxWidth: 140,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              padding: "5px 8px",
                              color: "var(--mobile-text, #1a1a1a)",
                              fontWeight: 600,
                            }}
                            title={row.item}
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
                              }}
                            />
                            {row.item}
                          </td>
                          {tableModel.months.map((m) => (
                            <td
                              key={m}
                              style={{
                                textAlign: "right",
                                whiteSpace: "nowrap",
                                fontVariantNumeric: "tabular-nums",
                                padding: "5px 8px",
                                color: "var(--mobile-text, #1a1a1a)",
                              }}
                            >
                              {fmtBsw(row.values[m])}
                            </td>
                          ))}
                          <td
                            style={{
                              textAlign: "right",
                              whiteSpace: "nowrap",
                              fontVariantNumeric: "tabular-nums",
                              padding: "5px 8px",
                              color: momFmt.color,
                              fontWeight: 600,
                            }}
                          >
                            {momFmt.text}
                          </td>
                          <td
                            style={{
                              textAlign: "right",
                              whiteSpace: "nowrap",
                              fontVariantNumeric: "tabular-nums",
                              padding: "5px 8px",
                              color: ytdFmt.color,
                              fontWeight: 600,
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
            </section>
          )}
        </>
      )}

      {/* Filter drawer */}
      <FilterDrawer
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Filters"
        onReset={handleReset}
        onApply={() => setFilterOpen(false)}
        applyLabel="Apply"
      >
        {/* Plot-style toggle (shared by both views) */}
        <div style={{ marginBottom: 18 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              marginBottom: 8,
              color: "var(--mobile-text, #1a1a1a)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            Plot style
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {LINE_STYLE_OPTIONS.map((opt) => {
              const active = opt.value === lineStyle;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setLineStyle(opt.value)}
                  style={{
                    minHeight: 36,
                    padding: "0 14px",
                    borderRadius: 999,
                    border: `1px solid ${active ? BRAND_ORANGE : "var(--mobile-border, #e0e0e0)"}`,
                    background: active ? BRAND_ORANGE : "var(--mobile-surface, #fff)",
                    color: active ? "#fff" : "var(--mobile-text, #1a1a1a)",
                    fontFamily: "inherit",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    boxShadow: active ? "0 2px 8px rgba(255, 80, 0, 0.25)" : "none",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Field multi-select (chip cloud + search) */}
        <div style={{ marginBottom: 8 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              marginBottom: 8,
              color: "var(--mobile-text, #1a1a1a)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <span>
              Field
              <span style={{ fontWeight: 400, marginLeft: 4, color: "var(--mobile-text-muted, #6b6b73)" }}>
                ({selectedCampos.length}/{campos.length})
              </span>
            </span>
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
            placeholder="Search field..."
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

          {/* Helper hint */}
          <div
            style={{
              fontSize: 11,
              color: "var(--mobile-text-muted, #6b6b73)",
              lineHeight: 1.4,
              marginBottom: 8,
            }}
          >
            {viewMode === "well"
              ? "Single-select: each well gets its own color in the chart legend."
              : `Each field gets a chart color in selection order (up to ${MAX_FIELDS_IN_FIELD_MODE}).`}
          </div>

          {/* Field chip cloud */}
          <div
            style={{
              maxHeight: 260,
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
                    onClick={() => {
                      handleCamposChange(
                        active
                          ? selectedCampos.filter((c) => c !== campo)
                          : [...selectedCampos, campo],
                      );
                    }}
                    style={{
                      minHeight: 32,
                      padding: active ? "0 10px 0 8px" : "0 10px",
                      borderRadius: 999,
                      border: "1px solid",
                      borderColor: active ? BRAND_ORANGE : "var(--mobile-border, #e0e0e0)",
                      background: active ? "rgba(255,80,0,0.08)" : "transparent",
                      color: active ? BRAND_ORANGE : "var(--mobile-text-muted, #6b6b73)",
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

          {viewMode === "field" && selectedCampos.length >= MAX_FIELDS_IN_FIELD_MODE && (
            <div
              style={{
                marginTop: 8,
                fontSize: 11,
                color: BRAND_ORANGE,
                lineHeight: 1.4,
              }}
            >
              Limit reached ({MAX_FIELDS_IN_FIELD_MODE}). Remove a field to add another.
            </div>
          )}
        </div>
      </FilterDrawer>
    </div>
  );
}
