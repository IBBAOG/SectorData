"use client";

/**
 * Mobile view — ANP CDP Depletion.
 *
 * § 4.8 of the mobile reform plan (Wave 3, non-flagship).
 * Field-aggregate view ONLY — no well-level toggle, no Plot-style toggle.
 *
 * Layout (top → bottom):
 *   Sticky top block:
 *     Campo multi-select chip (opens FilterDrawer)
 *     Period inputs: Recent (m) / Prior (m) — inline, compact
 *   X-axis toggle  — Calendar / % VOIP recovered
 *   Active campo chip row
 *   Hero scatter chart  (field-aggregate only)
 *   Depletion comparison table — horizontal scroll, real <table>
 *   FilterDrawer  — campo multi-select (no Plot style)
 *
 * Non-negotiables (§ 4.8):
 *   - No ExportFAB
 *   - No MobileBottomTabBar
 *   - No NavBar / MobileTopBar (MobileShell provides it at layout level)
 *   - No useIsMobile() inside this View
 *   - Light-only
 *
 * Binding sync rule: any change to the analyses (filter, chart, KPI, copy)
 * must land in desktop/View.tsx in the same commit, OR commit must declare
 * [mobile-only] with an explicit reason.
 */

import { useMemo, useState } from "react";
import type { Layout, PlotData } from "plotly.js";

import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import {
  FilterDrawer,
  MobileChart,
  MobileTabBar,
  FilterIcon,
} from "../../../../components/dashboard/mobile";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import SearchableMultiSelect from "../../../../components/SearchableMultiSelect";
import { PALETTE } from "../../../../lib/plotlyDefaults";

import {
  useAnpCdpDepletionData,
  rollingDepletion,
  computeRowMetrics,
  fmtNp,
  fmtDelta,
  plotlyMode,
  ymSort,
  MAX_FIELDS_IN_FIELD_MODE,
  type AnpCdpDepletionFieldPoint,
  type XMode,
} from "../useAnpCdpDepletionData";

// ── Field-aggregate trace builder (mobile-tuned) ───────────────────────────────

function buildFieldAggregateTraces(
  points: AnpCdpDepletionFieldPoint[],
  selectedCampos: string[],
  xMode: XMode,
  recentMonths: number,
  priorMonths: number,
): PlotData[] {
  const mode = plotlyMode("markers+lines");
  return selectedCampos.map((campo, i) => {
    const fullSeries = points
      .filter((p) => p.campo === campo)
      .sort((a, b) => ymSort(a.ano, a.mes) - ymSort(b.ano, b.mes));
    const color = PALETTE[i % PALETTE.length];

    const depletionByYm = new Map<number, number>();
    for (const d of rollingDepletion(
      fullSeries.map((p) => ({ ano: p.ano, mes: p.mes, np: p.np_kbpd })),
      recentMonths,
      priorMonths,
    )) {
      depletionByYm.set(ymSort(d.ano, d.mes), d.depletion);
    }

    const renderedPoints = fullSeries
      .map((p) => {
        const dep = depletionByYm.get(ymSort(p.ano, p.mes));
        if (dep === undefined) return null;
        return { p, dep };
      })
      .filter((x): x is { p: AnpCdpDepletionFieldPoint; dep: number } => x !== null);

    const subset =
      xMode === "voip"
        ? renderedPoints.slice().sort((a, b) => a.p.pct_voip - b.p.pct_voip)
        : renderedPoints;

    return {
      type: "scatter",
      mode,
      name: campo,
      x:
        xMode === "voip"
          ? subset.map(({ p }) => p.pct_voip)
          : subset.map(({ p }) => `${p.ano}-${String(p.mes).padStart(2, "0")}-01`),
      y: subset.map(({ dep }) => dep),
      customdata: subset.map(
        ({ p }) =>
          [p.ano, p.mes, p.n_pocos, p.pct_voip, p.cumulative_oil_bbl] as [
            number,
            number,
            number,
            number,
            number,
          ],
      ),
      line: { color, width: 2 },
      marker: { size: 5, color },
      hovertemplate:
        "<b>" +
        campo +
        "</b><br>" +
        "%{customdata[0]}-%{customdata[1]:02d}<br>" +
        "Depletion: %{y:.2%}<br>" +
        "Wells: %{customdata[2]}<br>" +
        "VOIP: %{customdata[3]:.1%}" +
        "<extra></extra>",
    } as unknown as PlotData;
  });
}

// ── Campo filter chip (top bar) ────────────────────────────────────────────────

function CampoChip({
  selectedCount,
  totalCount,
  onOpen,
}: {
  selectedCount: number;
  totalCount: number;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 36,
        padding: "0 14px",
        borderRadius: 999,
        border: "1.5px solid var(--mobile-accent, #ff5000)",
        background:
          selectedCount > 0
            ? "var(--mobile-accent-fill, rgba(255,80,0,0.08))"
            : "var(--mobile-surface, #fff)",
        color: "var(--mobile-accent, #ff5000)",
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        whiteSpace: "nowrap",
        minHeight: 44,
      }}
    >
      <FilterIcon size={14} strokeWidth={2.2} />
      {selectedCount > 0
        ? `${selectedCount} / ${totalCount} ${selectedCount === 1 ? "field" : "fields"}`
        : "Select fields"}
    </button>
  );
}

// ── Comparison table ───────────────────────────────────────────────────────────

function ComparisonTable({
  rows,
  recentMonths,
  priorMonths,
}: {
  rows: { item: string; color: string; series: { ym: string; np: number }[] }[];
  recentMonths: number;
  priorMonths: number;
}) {
  if (rows.length === 0) return null;

  const cellBase: React.CSSProperties = {
    padding: "8px 10px",
    fontSize: 12,
    whiteSpace: "nowrap",
    verticalAlign: "middle",
    borderBottom: "1px solid var(--mobile-border, #e6e6ec)",
    fontFamily: "Arial, Helvetica, sans-serif",
  };

  const headerCell: React.CSSProperties = {
    ...cellBase,
    fontSize: 10,
    fontWeight: 700,
    color: "var(--mobile-text-muted, #6b6b73)",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    background: "var(--mobile-surface-2, #fafafc)",
    position: "sticky",
    top: 0,
    zIndex: 1,
  };

  return (
    <section style={{ marginTop: 18 }}>
      <div
        style={{
          padding: "4px 16px 8px",
          fontSize: 11,
          fontWeight: 700,
          color: "var(--mobile-text-muted, #6b6b73)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        Depletion comparison
      </div>
      <div
        style={{
          overflowX: "auto",
          WebkitOverflowScrolling: "touch" as React.CSSProperties["WebkitOverflowScrolling"],
          borderTop: "1px solid var(--mobile-border, #e6e6ec)",
          borderBottom: "1px solid var(--mobile-border, #e6e6ec)",
          background: "var(--mobile-surface, #fff)",
        }}
      >
        <table
          style={{
            borderCollapse: "collapse",
            width: "100%",
            minWidth: 480,
          }}
        >
          <thead>
            <tr>
              <th
                style={{
                  ...headerCell,
                  textAlign: "left",
                  position: "sticky",
                  left: 0,
                  zIndex: 2,
                  minWidth: 120,
                  background: "var(--mobile-surface-2, #fafafc)",
                }}
              >
                Field
              </th>
              <th style={{ ...headerCell, textAlign: "right" }}>
                NP last (kbpd)
              </th>
              <th style={{ ...headerCell, textAlign: "right" }}>
                Recent {recentMonths}m (kbpd)
              </th>
              <th style={{ ...headerCell, textAlign: "right" }}>
                Prior {priorMonths}m (kbpd)
              </th>
              <th style={{ ...headerCell, textAlign: "right" }}>
                Depletion %
              </th>
              <th style={{ ...headerCell, textAlign: "right" }}>YoY %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const m = computeRowMetrics(row.series, recentMonths, priorMonths);
              const dep = fmtDelta(m.depletion);
              const yoy = fmtDelta(m.yoy);
              return (
                <tr key={row.item}>
                  <td
                    style={{
                      ...cellBase,
                      textAlign: "left",
                      fontWeight: 600,
                      color: "var(--mobile-text, #1a1a1a)",
                      position: "sticky",
                      left: 0,
                      background: "var(--mobile-surface, #fff)",
                      zIndex: 1,
                    }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <span
                        aria-hidden
                        style={{
                          display: "inline-block",
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          backgroundColor: row.color,
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          maxWidth: 100,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={row.item}
                      >
                        {row.item}
                      </span>
                    </span>
                  </td>
                  <td
                    style={{
                      ...cellBase,
                      textAlign: "right",
                      color: "var(--mobile-text, #1a1a1a)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {fmtNp(m.last)}
                  </td>
                  <td
                    style={{
                      ...cellBase,
                      textAlign: "right",
                      color: "var(--mobile-text, #1a1a1a)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {fmtNp(m.avgRecent)}
                  </td>
                  <td
                    style={{
                      ...cellBase,
                      textAlign: "right",
                      color: "var(--mobile-text, #1a1a1a)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {fmtNp(m.avgPrior)}
                  </td>
                  <td
                    style={{
                      ...cellBase,
                      textAlign: "right",
                      fontWeight: 700,
                      color: dep.color,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {dep.text}
                  </td>
                  <td
                    style={{
                      ...cellBase,
                      textAlign: "right",
                      fontWeight: 600,
                      color: yoy.color,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {yoy.text}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div
        style={{
          padding: "6px 16px 0",
          fontSize: 10,
          color: "var(--mobile-text-faint, #9a9aa3)",
          lineHeight: 1.4,
        }}
      >
        Green = rising NP (healthy) · Red = falling NP (depletion). Inverse of BSW.
      </div>
    </section>
  );
}

// ── Mobile View ───────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement | null {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-cdp-depletion");

  const {
    campos,
    filtrosLoading,
    selectedCampos,
    xMode,
    recentMonths,
    priorMonths,
    effectiveXMode,
    setSelectedCampos,
    setViewMode,
    setXMode,
    setRecentMonths,
    setPriorMonths,
    fieldPoints,
    chartLoading,
    tableModel,
    periodHelper,
    fieldColor,
    clampWindow,
  } = useAnpCdpDepletionData();

  // Pin view mode to "field" on mount and whenever it might drift.
  // The hook allows viewMode changes; mobile simply never exposes the toggle.
  const [viewPinned] = useState(() => {
    setViewMode("field");
    return true;
  });
  void viewPinned; // suppress unused warning

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draftCampos, setDraftCampos] = useState<string[]>(selectedCampos);

  const openDrawer = () => {
    setDraftCampos(selectedCampos);
    setDrawerOpen(true);
  };
  const applyDrawer = () => {
    setSelectedCampos(draftCampos);
    setDrawerOpen(false);
  };
  const resetDrawer = () => {
    setDraftCampos([]);
  };

  // Build field-aggregate chart traces.
  const traces = useMemo<PlotData[]>(() => {
    if (selectedCampos.length === 0) return [];
    return buildFieldAggregateTraces(
      fieldPoints,
      selectedCampos,
      effectiveXMode,
      recentMonths,
      priorMonths,
    );
  }, [fieldPoints, selectedCampos, effectiveXMode, recentMonths, priorMonths]);

  // Chart layout — adapts per X mode.
  const chartLayout = useMemo<Partial<Layout>>(() => {
    const base: Partial<Layout> = {
      yaxis: {
        tickformat: ",.1%",
        zeroline: true,
        zerolinecolor: "rgba(0,0,0,0.15)",
        zerolinewidth: 1,
        nticks: 5,
        fixedrange: true,
      },
      margin: { l: 44, r: 12, t: 8, b: 36 },
      showlegend: false,
      hovermode: "closest",
    };
    if (effectiveXMode === "voip") {
      return {
        ...base,
        xaxis: {
          type: "linear",
          tickformat: ",.0%",
          rangemode: "tozero",
          tickfont: { size: 9 },
          nticks: 5,
          fixedrange: true,
        },
      };
    }
    return {
      ...base,
      xaxis: {
        type: "date",
        tickfont: { size: 9 },
        nticks: 5,
        fixedrange: true,
      },
    };
  }, [effectiveXMode]);

  if (visLoading || !visible) return null;

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "var(--mobile-bg, #f5f5f7)",
        paddingBottom: "calc(32px + var(--mobile-safe-bottom, 0px))",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      {/* ── Top sticky block ──────────────────────────────────────────────── */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: "var(--mobile-bg, #f5f5f7)",
          borderBottom: "1px solid var(--mobile-border-soft, #f0f0f5)",
          padding: "10px 16px 10px",
        }}
      >
        {/* Row 1: title + campo chip */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            marginBottom: 10,
          }}
        >
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: "var(--mobile-text, #1a1a1a)",
              letterSpacing: "-0.01em",
              lineHeight: 1.2,
            }}
          >
            Depletion
          </div>
          <CampoChip
            selectedCount={selectedCampos.length}
            totalCount={campos.length}
            onOpen={openDrawer}
          />
        </div>

        {/* Row 2: Recent / Prior period inputs */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
          }}
        >
          <div>
            <label
              htmlFor="depletion-recent-m"
              style={{
                display: "block",
                fontSize: 10,
                fontWeight: 700,
                color: "var(--mobile-text-muted, #6b6b73)",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                marginBottom: 3,
              }}
            >
              Recent (months)
            </label>
            <input
              id="depletion-recent-m"
              type="number"
              inputMode="numeric"
              min={1}
              max={60}
              value={recentMonths}
              onChange={(e) => setRecentMonths(clampWindow(Number(e.target.value)))}
              style={{
                width: "100%",
                minHeight: 40,
                fontSize: 14,
                fontFamily: "Arial",
                padding: "6px 10px",
                border: "1px solid var(--mobile-border, #e6e6ec)",
                borderRadius: 8,
                background: "var(--mobile-surface, #fff)",
                boxSizing: "border-box",
              }}
            />
            {periodHelper && (
              <div
                style={{
                  fontSize: 10,
                  color: "var(--mobile-accent, #ff5000)",
                  marginTop: 2,
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: 1.3,
                }}
              >
                {periodHelper.recentLabel}
              </div>
            )}
          </div>
          <div>
            <label
              htmlFor="depletion-prior-m"
              style={{
                display: "block",
                fontSize: 10,
                fontWeight: 700,
                color: "var(--mobile-text-muted, #6b6b73)",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                marginBottom: 3,
              }}
            >
              Prior (months)
            </label>
            <input
              id="depletion-prior-m"
              type="number"
              inputMode="numeric"
              min={1}
              max={60}
              value={priorMonths}
              onChange={(e) => setPriorMonths(clampWindow(Number(e.target.value)))}
              style={{
                width: "100%",
                minHeight: 40,
                fontSize: 14,
                fontFamily: "Arial",
                padding: "6px 10px",
                border: "1px solid var(--mobile-border, #e6e6ec)",
                borderRadius: 8,
                background: "var(--mobile-surface, #fff)",
                boxSizing: "border-box",
              }}
            />
            {periodHelper && (
              <div
                style={{
                  fontSize: 10,
                  color: "var(--mobile-accent, #ff5000)",
                  marginTop: 2,
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: 1.3,
                }}
              >
                {periodHelper.priorLabel}
              </div>
            )}
          </div>
        </div>

        {/* Clipping warning */}
        {periodHelper?.warning && (
          <div
            style={{
              marginTop: 6,
              fontSize: 10,
              color: "#b8860b",
              lineHeight: 1.4,
              whiteSpace: "pre-line",
            }}
          >
            {periodHelper.warning}
          </div>
        )}
      </div>

      {/* ── X-axis toggle ─────────────────────────────────────────────────── */}
      <div style={{ padding: "10px 16px 0" }}>
        <MobileTabBar
          tabs={[
            { key: "calendar", label: "Calendar" },
            { key: "voip", label: "% VOIP recovered" },
          ]}
          activeKey={xMode}
          onChange={(k) => setXMode(k as XMode)}
          variant="underline"
          ariaLabel="X axis mode"
        />
      </div>

      {/* ── Active campo chips ────────────────────────────────────────────── */}
      <div
        style={{
          padding: "8px 16px 0",
          display: "flex",
          flexWrap: "wrap",
          gap: 5,
        }}
      >
        {selectedCampos.length === 0 ? (
          <div
            style={{
              fontSize: 12,
              color: "var(--mobile-text-muted, #6b6b73)",
              fontStyle: "italic",
              padding: "2px 0",
            }}
          >
            No fields selected — tap &ldquo;Select fields&rdquo; above.
          </div>
        ) : (
          selectedCampos.map((c) => (
            <span
              key={c}
              title={c}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                background: "var(--mobile-surface, #fff)",
                border: "1px solid var(--mobile-border, #e6e6ec)",
                borderRadius: 999,
                padding: "3px 9px 3px 7px",
                fontSize: 11,
                color: "var(--mobile-text, #1a1a1a)",
              }}
            >
              <span
                aria-hidden
                style={{
                  display: "inline-block",
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  backgroundColor: fieldColor(c),
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: 150,
                }}
              >
                {c}
              </span>
            </span>
          ))
        )}
      </div>

      {/* ── Hero scatter chart ────────────────────────────────────────────── */}
      <section
        style={{
          margin: "10px 16px 0",
          padding: "10px 10px 8px",
          background: "var(--mobile-surface, #fff)",
          border: "1px solid var(--mobile-border-soft, #f0f0f5)",
          borderRadius: 14,
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: 6,
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "var(--mobile-text, #1a1a1a)",
            }}
          >
            Rolling depletion
          </div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "var(--mobile-text-muted, #6b6b73)",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            {recentMonths}m vs prior {priorMonths}m
          </div>
        </div>

        {filtrosLoading ? (
          <div
            style={{
              height: 260,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <BarrelLoading bare />
          </div>
        ) : selectedCampos.length === 0 ? (
          <div
            style={{
              height: 220,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              padding: "0 16px",
              fontSize: 13,
              color: "var(--mobile-text-muted, #6b6b73)",
              lineHeight: 1.5,
            }}
          >
            Select one or more fields to plot rolling depletion.
          </div>
        ) : chartLoading ? (
          <div
            style={{
              height: 260,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <BarrelLoading bare />
          </div>
        ) : traces.length === 0 ? (
          <div
            style={{
              height: 220,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              color: "var(--mobile-text-muted, #6b6b73)",
            }}
          >
            No data for selected fields.
          </div>
        ) : (
          <MobileChart data={traces} layout={chartLayout} height={260} />
        )}
      </section>

      {/* ── Depletion comparison table ────────────────────────────────────── */}
      <ComparisonTable
        rows={tableModel.rows}
        recentMonths={recentMonths}
        priorMonths={priorMonths}
      />

      {/* ── Filter drawer — campo multi-select only ───────────────────────── */}
      <FilterDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Fields"
        onReset={resetDrawer}
        onApply={applyDrawer}
        applyLabel="Apply"
        resetLabel="Clear all"
      >
        <div style={{ paddingBottom: 8 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--mobile-text-muted, #6b6b73)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              marginBottom: 4,
            }}
          >
            Field
            <span
              style={{
                marginLeft: 6,
                fontWeight: 400,
                textTransform: "none",
                letterSpacing: 0,
              }}
            >
              ({draftCampos.length} / {campos.length})
            </span>
          </div>
          <div
            style={{
              fontSize: 11,
              color: "var(--mobile-text-muted, #6b6b73)",
              marginBottom: 10,
              lineHeight: 1.4,
            }}
          >
            Multi-select up to {MAX_FIELDS_IN_FIELD_MODE} fields.
          </div>
          <SearchableMultiSelect
            options={campos}
            value={draftCampos}
            onChange={(next) => {
              if (next.length > MAX_FIELDS_IN_FIELD_MODE) {
                setDraftCampos(next.slice(0, MAX_FIELDS_IN_FIELD_MODE));
                return;
              }
              setDraftCampos(next);
            }}
          />
        </div>
      </FilterDrawer>
    </div>
  );
}
