"use client";

/**
 * Mobile view — ANP CDP / Depletion.
 *
 * Archetype: single Plotly scatter chart with multi-trace overlay, two
 * orthogonal toggles (View mode × X axis), one multi-select filter (campos),
 * and a period-comparison readout. Mirrors the desktop analyses but adapts
 * the chrome for touch — chips replace sidebar lists, bottom-sheet drawer
 * replaces the field multi-select, and the table is rendered as
 * MobileDataCard rows.
 *
 * Layout (top → bottom):
 *   MobileTopBar    — title + filter trigger
 *   View MobileTabBar  — Per well / Field avg
 *   X-axis MobileTabBar — Calendar / % VOIP
 *   Active-chip row — selected campos + (placeholder when empty)
 *   MobileChart     — rolling depletion scatter
 *   Period readout  — Recent / Prior inputs + helper text
 *   "Depletion comparison" — MobileDataCard rows (one per item)
 *   FilterDrawer    — multi-select campos + Plot style toggle
 *
 * No export FAB — by product design (consistent with /anp-cdp-bsw).
 *
 * Binding sync rule: any change to the analyses (new filter / chart / KPI /
 * copy) must also land in desktop/View.tsx in the same commit, OR the commit
 * must declare [mobile-only] with an explicit reason.
 */

import { useMemo, useState } from "react";
import type { Layout, PlotData } from "plotly.js";

import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import {
  MobileTopBar,
  FilterDrawer,
  MobileChart,
  MobileDataCard,
  MobileTabBar,
  FilterIcon,
} from "../../../../components/dashboard/mobile";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import SearchableMultiSelect from "../../../../components/SearchableMultiSelect";
import SegmentedToggle from "../../../../components/dashboard/SegmentedToggle";
import { PALETTE } from "../../../../lib/plotlyDefaults";

import {
  useAnpCdpDepletionData,
  rollingDepletion,
  computeRowMetrics,
  fmtNp,
  fmtDelta,
  plotlyMode,
  ymSort,
  LINE_STYLE_OPTIONS,
  MAX_FIELDS_IN_FIELD_MODE,
  type AnpCdpDepletionPoint,
  type AnpCdpDepletionFieldPoint,
  type LineStyle,
  type XMode,
  type ViewMode,
} from "../useAnpCdpDepletionData";

// ── Chart trace builders (mobile-tuned) ───────────────────────────────────────
//
// Mobile uses SVG `scatter` even for Per-well mode (mobile selects fewer
// fields and the SVG renderer plays nicer with the smaller canvas + tooltips).

function buildPerWellMobileTraces(
  points: AnpCdpDepletionPoint[],
  lineStyle: LineStyle,
  xMode: XMode,
  recentMonths: number,
  priorMonths: number,
): PlotData[] {
  const seen: string[] = [];
  for (const p of points) {
    if (!seen.includes(p.poco)) seen.push(p.poco);
  }
  const mode = plotlyMode(lineStyle);
  return seen.map((poco, i) => {
    const fullSeries = points
      .filter((p) => p.poco === poco)
      .sort((a, b) => ymSort(a.ano, a.mes) - ymSort(b.ano, b.mes));
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
        if (xMode === "voip" && (p.pct_voip_poco === null || !Number.isFinite(p.pct_voip_poco))) {
          return null;
        }
        return { p, dep };
      })
      .filter((x): x is { p: AnpCdpDepletionPoint; dep: number } => x !== null);

    const subset =
      xMode === "voip"
        ? renderedPoints.slice().sort(
            (a, b) => (a.p.pct_voip_poco ?? 0) - (b.p.pct_voip_poco ?? 0),
          )
        : renderedPoints;

    const color = PALETTE[i % PALETTE.length];
    return {
      type: "scatter",
      mode,
      name: poco,
      x:
        xMode === "voip"
          ? subset.map(({ p }) => p.pct_voip_poco ?? 0)
          : subset.map(({ p }) => `${p.ano}-${String(p.mes).padStart(2, "0")}-01`),
      y: subset.map(({ dep }) => dep),
      customdata: subset.map(
        ({ p }) =>
          [p.poco, p.ano, p.mes, p.pct_voip_poco ?? 0] as [string, number, number, number],
      ),
      marker: { size: 4, opacity: 0.8, color },
      line: { color, width: 1.5 },
      hovertemplate:
        xMode === "voip"
          ? "<b>%{customdata[0]}</b><br>" +
            "%{customdata[1]}-%{customdata[2]:02d}<br>" +
            "VOIP: %{customdata[3]:.1%}<br>" +
            "Depletion: %{y:.2%}" +
            "<extra></extra>"
          : "<b>%{customdata[0]}</b><br>" +
            "%{customdata[1]}-%{customdata[2]:02d}<br>" +
            "Depletion: %{y:.2%}" +
            "<extra></extra>",
    } as unknown as PlotData;
  });
}

function buildFieldAverageMobileTraces(
  points: AnpCdpDepletionFieldPoint[],
  selectedCampos: string[],
  lineStyle: LineStyle,
  xMode: XMode,
  recentMonths: number,
  priorMonths: number,
): PlotData[] {
  const mode = plotlyMode(lineStyle);
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
      marker: { size: 6, color },
      hovertemplate:
        "<b>" + campo + "</b><br>" +
        "%{customdata[0]}-%{customdata[1]:02d}<br>" +
        "Depletion: %{y:.2%}<br>" +
        "Wells: %{customdata[2]}<br>" +
        "VOIP: %{customdata[3]:.1%}" +
        "<extra></extra>",
    } as unknown as PlotData;
  });
}

// ── Filter trigger chip (top bar right) ───────────────────────────────────────

function FilterChip({
  selectedCount,
  onOpen,
}: {
  selectedCount: number;
  onOpen: () => void;
}) {
  const label = selectedCount > 0
    ? `${selectedCount} ${selectedCount === 1 ? "field" : "fields"}`
    : "Fields";
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display:      "inline-flex",
        alignItems:   "center",
        gap:          6,
        height:       36,
        padding:      "0 14px",
        borderRadius: 999,
        border:       "1.5px solid var(--mobile-accent)",
        background:   "var(--mobile-accent-fill, rgba(255,80,0,0.08))",
        color:        "var(--mobile-accent)",
        fontFamily:   "Arial, Helvetica, sans-serif",
        fontSize:     13,
        fontWeight:   600,
        cursor:       "pointer",
        whiteSpace:   "nowrap",
        minHeight:    44,
      }}
    >
      <FilterIcon size={14} strokeWidth={2.2} />
      {label}
    </button>
  );
}

// ── Mobile View ───────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement | null {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-cdp-depletion");

  const {
    campos,
    filtrosLoading,
    selectedCampos,
    viewMode,
    xMode,
    lineStyle,
    recentMonths,
    priorMonths,
    effectiveXMode,
    setSelectedCampos,
    setViewMode,
    setXMode,
    setLineStyle,
    setRecentMonths,
    setPriorMonths,
    wellPoints,
    fieldPoints,
    chartLoading,
    uniqueWellCount,
    tableModel,
    periodHelper,
    fieldColor,
    clampWindow,
  } = useAnpCdpDepletionData();

  const [drawerOpen, setDrawerOpen] = useState(false);
  // Drawer-draft selection so the user can reset before applying.
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

  // Build chart traces from the cached points (memoised).
  const traces = useMemo<PlotData[]>(() => {
    if (selectedCampos.length === 0) return [];
    if (viewMode === "well") {
      return buildPerWellMobileTraces(
        wellPoints,
        lineStyle,
        effectiveXMode,
        recentMonths,
        priorMonths,
      );
    }
    return buildFieldAverageMobileTraces(
      fieldPoints,
      selectedCampos,
      lineStyle,
      effectiveXMode,
      recentMonths,
      priorMonths,
    );
  }, [viewMode, wellPoints, fieldPoints, selectedCampos, lineStyle, effectiveXMode, recentMonths, priorMonths]);

  // Layout override per X mode.
  const chartLayout = useMemo<Partial<Layout>>(() => {
    const base: Partial<Layout> = {
      yaxis: {
        tickformat: ",.1%",
        zeroline: true,
        zerolinecolor: "rgba(0,0,0,0.18)",
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
          tickformat: ",.1%",
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
        paddingBottom: "calc(24px + var(--mobile-safe-bottom, 0px))",
        fontFamily: "Arial, Helvetica, sans-serif",
        position: "relative",
      }}
    >
      {/* Top bar — title + filter trigger */}
      <MobileTopBar
        title="Depletion"
        rightSlot={
          <FilterChip
            selectedCount={selectedCampos.length}
            onOpen={openDrawer}
          />
        }
      />

      {/* View mode tabs (Per well / Field average) */}
      <div style={{ padding: "12px 16px 0" }}>
        <MobileTabBar
          tabs={[
            { key: "well",  label: "Per well" },
            { key: "field", label: "Field avg" },
          ]}
          activeKey={viewMode}
          onChange={(k) => setViewMode(k as ViewMode)}
          variant="container"
          ariaLabel="View mode"
        />
      </div>

      {/* X axis tabs (Calendar / % VOIP recovered) */}
      <div style={{ padding: "10px 16px 0" }}>
        <MobileTabBar
          tabs={[
            { key: "calendar", label: "Calendar" },
            { key: "voip",     label: "% VOIP" },
          ]}
          activeKey={xMode}
          onChange={(k) => setXMode(k as XMode)}
          variant="underline"
          ariaLabel="X axis"
        />
      </div>

      {/* Active campos chip row */}
      <div
        style={{
          padding: "10px 16px 0",
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        {selectedCampos.length === 0 ? (
          <div
            style={{
              fontSize: 12,
              color: "var(--mobile-text-muted, #6b6b73)",
              fontStyle: "italic",
              padding: "4px 0",
            }}
          >
            No fields selected — tap “Fields” above to pick one or more.
          </div>
        ) : (
          selectedCampos.map((c) => (
            <span
              key={c}
              title={c}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "var(--mobile-surface, #ffffff)",
                border: "1px solid var(--mobile-border, #e6e6ec)",
                borderRadius: 999,
                padding: "4px 10px 4px 8px",
                fontFamily: "Arial",
                fontSize: 11,
                color: "var(--mobile-text, #1a1a1a)",
                maxWidth: "100%",
              }}
            >
              <span
                aria-hidden
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  backgroundColor: fieldColor(c),
                  flexShrink: 0,
                }}
              />
              <span style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: 160,
              }}>
                {c}
              </span>
            </span>
          ))
        )}
      </div>

      {/* Chart card */}
      <section
        style={{
          margin: "12px 16px 0",
          padding: "10px 12px 8px",
          background: "var(--mobile-surface, #ffffff)",
          border: "1px solid var(--mobile-border-soft, #f0f0f5)",
          borderRadius: 14,
          boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
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
              letterSpacing: "0.02em",
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
          <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <BarrelLoading bare />
          </div>
        ) : selectedCampos.length === 0 ? (
          <div
            style={{
              height: 240,
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
          <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <BarrelLoading bare />
          </div>
        ) : traces.length === 0 ? (
          <div
            style={{
              height: 240,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              color: "var(--mobile-text-muted, #6b6b73)",
            }}
          >
            No data for the selected fields.
          </div>
        ) : (
          <MobileChart data={traces} layout={chartLayout} height={260} />
        )}

        {viewMode === "well" && uniqueWellCount > 0 && selectedCampos.length === 1 && (
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

      {/* Period comparison inputs */}
      <section
        style={{
          margin: "12px 16px 0",
          padding: "12px",
          background: "var(--mobile-surface, #ffffff)",
          border: "1px solid var(--mobile-border-soft, #f0f0f5)",
          borderRadius: 14,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--mobile-text-muted, #6b6b73)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            marginBottom: 10,
          }}
        >
          Period comparison
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label
              htmlFor="recent-window-mobile"
              style={{
                display: "block",
                fontSize: 11,
                color: "var(--mobile-text-muted, #6b6b73)",
                marginBottom: 4,
              }}
            >
              Recent (m)
            </label>
            <input
              id="recent-window-mobile"
              type="number"
              inputMode="numeric"
              min={1}
              max={60}
              value={recentMonths}
              onChange={(e) => setRecentMonths(clampWindow(Number(e.target.value)))}
              style={{
                width: "100%",
                minHeight: 44,
                fontSize: 14,
                fontFamily: "Arial",
                padding: "8px 10px",
                border: "1px solid var(--mobile-border, #e6e6ec)",
                borderRadius: 8,
                background: "var(--mobile-surface-2, #fafafc)",
              }}
            />
            <div
              style={{
                fontSize: 11,
                color: periodHelper === null ? "var(--mobile-text-faint, #9a9aa3)" : "var(--mobile-accent, #ff5000)",
                marginTop: 4,
                fontVariantNumeric: "tabular-nums",
              }}
              title={periodHelper?.recentLabel ?? ""}
            >
              {periodHelper?.recentLabel ?? "—"}
            </div>
          </div>
          <div>
            <label
              htmlFor="prior-window-mobile"
              style={{
                display: "block",
                fontSize: 11,
                color: "var(--mobile-text-muted, #6b6b73)",
                marginBottom: 4,
              }}
            >
              Prior (m)
            </label>
            <input
              id="prior-window-mobile"
              type="number"
              inputMode="numeric"
              min={1}
              max={60}
              value={priorMonths}
              onChange={(e) => setPriorMonths(clampWindow(Number(e.target.value)))}
              style={{
                width: "100%",
                minHeight: 44,
                fontSize: 14,
                fontFamily: "Arial",
                padding: "8px 10px",
                border: "1px solid var(--mobile-border, #e6e6ec)",
                borderRadius: 8,
                background: "var(--mobile-surface-2, #fafafc)",
              }}
            />
            <div
              style={{
                fontSize: 11,
                color: periodHelper === null ? "var(--mobile-text-faint, #9a9aa3)" : "var(--mobile-accent, #ff5000)",
                marginTop: 4,
                fontVariantNumeric: "tabular-nums",
              }}
              title={periodHelper?.priorLabel ?? ""}
            >
              {periodHelper?.priorLabel ?? "—"}
            </div>
          </div>
        </div>
        <div
          style={{
            fontSize: 11,
            color: "var(--mobile-text-muted, #6b6b73)",
            marginTop: 10,
            lineHeight: 1.4,
          }}
        >
          Recent vs prior windows for the chart Y axis and the table below (1–60 months).
        </div>
        {periodHelper?.warning && (
          <div
            style={{
              fontSize: 11,
              color: "#b8860b",
              marginTop: 8,
              lineHeight: 1.4,
              whiteSpace: "pre-line",
            }}
          >
            {periodHelper.warning}
          </div>
        )}
      </section>

      {/* Depletion comparison — MobileDataCard rows */}
      {tableModel.rows.length > 0 && (
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
              background: "var(--mobile-surface, #ffffff)",
              borderTop:    "1px solid var(--mobile-border, #e6e6ec)",
              borderBottom: "1px solid var(--mobile-border, #e6e6ec)",
            }}
          >
            {tableModel.rows.map((row) => {
              const m = computeRowMetrics(row.series, recentMonths, priorMonths);
              const dep = fmtDelta(m.depletion);
              const yoy = fmtDelta(m.yoy);
              return (
                <MobileDataCard
                  key={row.item}
                  variant="expanded"
                  leftIcon={
                    <div
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        background: row.color,
                        flexShrink: 0,
                      }}
                    />
                  }
                  title={row.item}
                  subtitle={
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>
                      Last {fmtNp(m.last)} · Recent {fmtNp(m.avgRecent)} · Prior {fmtNp(m.avgPrior)}
                    </span>
                  }
                  rightSlot={
                    <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          color: dep.color,
                          lineHeight: 1.1,
                        }}
                      >
                        {dep.text}
                      </div>
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 11,
                          fontWeight: 600,
                          color: yoy.color,
                        }}
                      >
                        YoY {yoy.text}
                      </div>
                    </div>
                  }
                />
              );
            })}
          </div>
          <div
            style={{
              padding: "8px 16px 0",
              fontSize: 10,
              color: "var(--mobile-text-faint, #9a9aa3)",
              lineHeight: 1.4,
            }}
          >
            Green = rising NP (healthy) · Red = falling NP (depletion). Inverse of BSW.
          </div>
        </section>
      )}

      {/* Filter drawer — campos multi-select + plot style */}
      <FilterDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Filters"
        onReset={resetDrawer}
        onApply={applyDrawer}
        applyLabel="Apply"
        resetLabel="Clear"
      >
        <div style={{ paddingBottom: 8 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--mobile-text-muted, #6b6b73)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            Field
            <span style={{ marginLeft: 6, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
              ({draftCampos.length}/{campos.length})
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
            {viewMode === "well"
              ? "Per well — single-select. Last picked field overrides previous."
              : `Field avg — multi-select up to ${MAX_FIELDS_IN_FIELD_MODE}.`}
          </div>
          <SearchableMultiSelect
            options={campos}
            value={draftCampos}
            onChange={(next) => {
              // Mirror hook's mode-aware selection rules in the draft.
              if (viewMode === "well") {
                if (next.length === 0) {
                  setDraftCampos([]);
                  return;
                }
                const added = next.find((c) => !draftCampos.includes(c));
                setDraftCampos([added ?? next[next.length - 1]]);
                return;
              }
              if (next.length > MAX_FIELDS_IN_FIELD_MODE) {
                setDraftCampos(next.slice(0, MAX_FIELDS_IN_FIELD_MODE));
                return;
              }
              setDraftCampos(next);
            }}
          />

          <div style={{ marginTop: 18, marginBottom: 8 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--mobile-text-muted, #6b6b73)",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                marginBottom: 8,
              }}
            >
              Plot style
            </div>
            <SegmentedToggle<LineStyle>
              options={LINE_STYLE_OPTIONS}
              value={lineStyle}
              onChange={setLineStyle}
            />
          </div>
        </div>
      </FilterDrawer>
    </div>
  );
}
