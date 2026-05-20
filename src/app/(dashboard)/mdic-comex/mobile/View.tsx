"use client";

// Mobile view of /mdic-comex — "same analysis, adapted clothing".
// Consumes useMdicComexData (same brain as desktop/View.tsx).
//
// Layout:
//   MobileTopBar (sticky)
//   MobileTabBar — flow (Imports / Exports)
//   MobileTabBar — product (Crude Oil / Gasoline / Diesel)  [consolidated mode]
//   Metric pills (scrollable horizontal row)
//   Chart area  — MobileChart (line chart, 240px)
//   Summary cards — top 3 recent months from tableData
//   ExportFAB → opens ExportModal (Tier 2, same as desktop)

import { useMemo, useState } from "react";
import type { PlotData } from "plotly.js";

import {
  MobileTopBar,
  MobileTabBar,
  FilterDrawer,
  MobileChart,
  MobileDataCard,
  ExportFAB,
} from "../../../../components/dashboard/mobile";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import ExportModal from "../../../../components/dashboard/ExportModal";
import MultiSelectFilter from "../../../../components/dashboard/MultiSelectFilter";
import PeriodSlider from "../../../../components/dashboard/PeriodSlider";
import { PALETTE } from "../../../../lib/plotlyDefaults";
import { getMdicComexExportCount } from "../../../../lib/rpc";
import { getSupabaseClient } from "../../../../lib/supabaseClient";

import {
  useMdicComexData,
  NCM_INFO,
  ALL_NCMS,
  METRIC_CONFIG,
  METRIC_OPTIONS,
  MDIC_GRANULARITY_OPTIONS,
  MDIC_AGG_ESTIMATE,
  INDIVIDUAL_WARN_THRESHOLD,
  formatPct,
  type Metric,
  type ViewMode,
  type MdicComexGranularity,
} from "../useMdicComexData";

import type { MdicComexAggregatedRow } from "../../../../lib/rpc";

// ── Mobile chart builder (minimal margins, closest hover) ────────────────────

function buildMobileChart(
  rows: MdicComexAggregatedRow[],
  flow: string,
  activeNcms: string[],
  metric: Metric,
  viewMode: ViewMode,
): PlotData[] {
  const cfg = METRIC_CONFIG[metric];

  if (viewMode === "consolidated") {
    const filtered = rows.filter(r => r.flow === flow && r.ncm_codigo && activeNcms.includes(r.ncm_codigo));
    if (!filtered.length) return [];

    const byNcm: Record<string, MdicComexAggregatedRow[]> = {};
    for (const r of filtered) {
      if (r.ncm_codigo) (byNcm[r.ncm_codigo] ??= []).push(r);
    }

    return activeNcms
      .filter(ncm => byNcm[ncm])
      .map(ncm => {
        const data = byNcm[ncm].sort((a, b) =>
          (a.ano ?? 0) !== (b.ano ?? 0) ? (a.ano ?? 0) - (b.ano ?? 0) : (a.mes ?? 0) - (b.mes ?? 0)
        );
        const info = NCM_INFO[ncm];
        return {
          type: "scatter", mode: "lines",
          name: info?.label ?? ncm,
          x: data.map(r => `${r.ano}-${String(r.mes ?? 1).padStart(2, "0")}`),
          y: data.map(r => cfg.select(r)),
          line:  { width: 2, color: info?.color ?? "#999" },
          hovertemplate: `%{y:.2f} ${cfg.hoverUnit()}<extra></extra>`,
        } as PlotData;
      });
  }

  // individual mode
  const filtered = rows.filter(r => r.flow === flow && r.pais);
  if (!filtered.length) return [];

  const byPais: Record<string, MdicComexAggregatedRow[]> = {};
  for (const r of filtered) {
    if (r.pais) (byPais[r.pais] ??= []).push(r);
  }

  return Object.keys(byPais).sort().slice(0, 10).map((pais, idx) => {
    const data = byPais[pais].sort((a, b) =>
      (a.ano ?? 0) !== (b.ano ?? 0) ? (a.ano ?? 0) - (b.ano ?? 0) : (a.mes ?? 0) - (b.mes ?? 0)
    );
    return {
      type: "scatter", mode: "lines",
      name: pais,
      x: data.map(r => `${r.ano}-${String(r.mes ?? 1).padStart(2, "0")}`),
      y: data.map(r => cfg.select(r)),
      line:  { width: 2, color: PALETTE[idx % PALETTE.length] },
      hovertemplate: `${pais}: %{y:.2f} ${cfg.hoverUnit()}<extra></extra>`,
    } as PlotData;
  });
}

// ── Mobile view ───────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement {
  const {
    loading, visLoading, visible,
    anos, allPaises, yearRange, setYearRange,
    selectedNCMs, toggleNcm, resetNcms,
    selectedPaises, setSelectedPaises,
    metric, setMetric,
    viewMode, setViewMode,
    showIndividualWarn, setShowIndividualWarn,
    hasYears,
    chartRows, chartLoading, tableData,
    exportOpen, setExportOpen,
    excelLoading, csvLoading,
    exportFlow, setExportFlow,
    exportNcms, setExportNcms,
    exportRange, setExportRange,
    exportGranularity, setExportGranularity,
    exportRawCount, setExportRawCount,
    exportFilters,
    rawOverExcel, rawOverAbs,
    openExportModal, handleExportExcel, handleExportCsv,
  } = useMdicComexData();

  const supabase = getSupabaseClient();
  const [filterOpen, setFilterOpen] = useState(false);

  // Active flow tab — "import" | "export"
  const [activeFlow, setActiveFlow] = useState<"import" | "export">("import");

  const cfg = METRIC_CONFIG[metric];

  // Memoised chart traces for the active flow
  const chartTraces = useMemo(() =>
    buildMobileChart(chartRows, activeFlow, selectedNCMs, metric, viewMode),
    [chartRows, activeFlow, selectedNCMs, metric, viewMode],
  );

  // Top 3 summary cards from tableData
  const topRows = tableData.slice(0, 3);

  // Filter drawer reset
  function handleReset() {
    setSelectedPaises(allPaises);
    setViewMode("consolidated");
    if (anos.length > 0) {
      const currentYear = new Date().getFullYear();
      const startIdx    = Math.max(0, anos.findIndex(yr => yr >= currentYear - 9));
      const endIdx      = anos.length - 1;
      setYearRange([startIdx, endIdx]);
    }
  }

  if (visLoading || !visible) return <></>;

  return (
    <div
      style={{
        fontFamily: "Arial, Helvetica, sans-serif",
        background: "var(--mobile-bg, #f5f5f7)",
        minHeight: "100dvh",
        paddingBottom: "calc(72px + var(--mobile-safe-bottom, 0px) + 80px)",
      }}
    >
      {/* Sticky top bar */}
      <MobileTopBar title="Comex Stat" />

      {/* Flow tabs */}
      <div style={{ padding: "12px 0 0" }}>
        <MobileTabBar
          tabs={[
            { key: "import", label: "Imports" },
            { key: "export", label: "Exports" },
          ]}
          activeKey={activeFlow}
          onChange={(k) => setActiveFlow(k as "import" | "export")}
          ariaLabel="Trade flow"
        />
      </div>

      {/* Metric pills (horizontal scroll) */}
      <div
        style={{
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
          display: "flex",
          gap: 8,
          padding: "10px 16px",
          scrollbarWidth: "none",
        }}
      >
        {METRIC_OPTIONS.map(opt => {
          const active = opt.value === metric;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setMetric(opt.value as Metric)}
              style={{
                flexShrink: 0,
                minHeight: 36,
                padding: "0 14px",
                border: "1px solid",
                borderColor: active ? "var(--mobile-accent, #ff5000)" : "var(--mobile-border, #e0e0e0)",
                borderRadius: 999,
                background: active ? "var(--mobile-accent, #ff5000)" : "var(--mobile-surface, #fff)",
                color: active ? "#fff" : "var(--mobile-text-muted, #6b6b73)",
                fontFamily: "inherit",
                fontSize: 12,
                fontWeight: active ? 700 : 600,
                cursor: "pointer",
                transition: "background 0.15s ease, color 0.15s ease, border-color 0.15s ease",
                whiteSpace: "nowrap",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Product tabs (only in consolidated mode) */}
      {viewMode === "consolidated" && (
        <div style={{ padding: "0 0 8px" }}>
          <MobileTabBar
            tabs={ALL_NCMS.map(ncm => ({
              key: ncm,
              label: (
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span
                    style={{
                      display: "inline-block",
                      width: 8, height: 8,
                      borderRadius: "50%",
                      background: NCM_INFO[ncm].color,
                      flexShrink: 0,
                    }}
                  />
                  {NCM_INFO[ncm].label}
                  {!selectedNCMs.includes(ncm) && (
                    <span style={{ fontSize: 9, opacity: 0.5 }}>(off)</span>
                  )}
                </span>
              ),
            }))}
            activeKey={selectedNCMs[0] ?? ALL_NCMS[0]}
            onChange={(k) => {
              // Tap = toggle the NCM
              toggleNcm(k);
            }}
            variant="underline"
            ariaLabel="Product filter"
          />
        </div>
      )}

      {/* Individual mode advisory banner */}
      {showIndividualWarn && (
        <div
          style={{
            margin: "0 16px 8px",
            padding: "8px 12px",
            background: "#fff8e1",
            border: "1px solid #ffe082",
            borderRadius: 8,
            fontSize: 12,
            color: "#7a5200",
            lineHeight: 1.5,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 8,
          }}
        >
          <span>Individual mode shows 1 series per country. Narrow your country filter.</span>
          <button
            type="button"
            onClick={() => setShowIndividualWarn(false)}
            aria-label="Dismiss"
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 16, color: "#999", lineHeight: 1, padding: 0, flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Main content */}
      {loading ? (
        <div style={{ padding: "32px 16px" }}>
          <BarrelLoading bare />
        </div>
      ) : (
        <>
          {/* Chart */}
          <div
            style={{
              margin: "0 16px 12px",
              background: "var(--mobile-surface, #fff)",
              borderRadius: 12,
              border: "1px solid var(--mobile-border, #e0e0e0)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "10px 12px 4px",
                fontSize: 12,
                fontWeight: 700,
                color: "var(--mobile-text, #1a1a1a)",
                opacity: chartLoading ? 0.5 : 1,
              }}
            >
              {activeFlow === "import" ? "Imports" : "Exports"} — {cfg.axisTitle()} / month
              {viewMode === "individual" && " — by country"}
              {chartLoading && (
                <span style={{ fontSize: 11, fontWeight: 400, color: "var(--mobile-text-muted, #6b6b73)", marginLeft: 6 }}>
                  updating...
                </span>
              )}
            </div>
            <MobileChart
              data={chartTraces}
              height={240}
              layout={{
                xaxis: { type: "date" as const, nticks: 4 },
                yaxis: { title: { text: cfg.axisTitle() }, nticks: 4 },
                showlegend: selectedNCMs.length > 1 || viewMode === "individual",
                legend: {
                  orientation: "h",
                  yanchor: "bottom",
                  y: 1.01,
                  xanchor: "left",
                  x: 0,
                  font: { size: 10 },
                },
              }}
            />
          </div>

          {/* Summary cards (top 3 months) */}
          {topRows.length > 0 && (
            <div
              style={{
                margin: "0 16px 12px",
                background: "var(--mobile-surface, #fff)",
                borderRadius: 12,
                border: "1px solid var(--mobile-border, #e0e0e0)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "10px 16px 8px",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--mobile-text, #1a1a1a)",
                  borderBottom: "1px solid var(--mobile-divider, #f0f0f0)",
                }}
              >
                Monthly Summary ({cfg.tableHeader()})
              </div>
              {topRows.map(row => {
                const impMoM = formatPct(row.impMoM);
                const impYoY = formatPct(row.impYoY);
                const expMoM = formatPct(row.expMoM);
                const expYoY = formatPct(row.expYoY);

                // Show the active flow's values prominently
                const mainVal = activeFlow === "import" ? row.imp : row.exp;
                const mainMoM = activeFlow === "import" ? impMoM : expMoM;
                const mainYoY = activeFlow === "import" ? impYoY : expYoY;

                return (
                  <MobileDataCard
                    key={row.label}
                    variant="compact"
                    title={row.label}
                    subtitle={
                      mainVal != null
                        ? `${mainVal.toLocaleString("en-US", { maximumFractionDigits: 1 })} ${cfg.tableHeader()}`
                        : "—"
                    }
                    rightSlot={
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: mainMoM.color,
                            whiteSpace: "nowrap",
                          }}
                        >
                          MoM: {mainMoM.text}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: mainYoY.color,
                            whiteSpace: "nowrap",
                          }}
                        >
                          YoY: {mainYoY.text}
                        </span>
                      </div>
                    }
                  />
                );
              })}
            </div>
          )}

          {/* View mode toggle */}
          <div style={{ margin: "0 16px 8px", display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--mobile-text-muted, #6b6b73)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              View
            </span>
            {(["consolidated", "individual"] as ViewMode[]).map(vm => {
              const active = viewMode === vm;
              return (
                <button
                  key={vm}
                  type="button"
                  onClick={() => {
                    setViewMode(vm);
                    if (vm === "individual" && selectedPaises.length > INDIVIDUAL_WARN_THRESHOLD) {
                      setShowIndividualWarn(true);
                    } else {
                      setShowIndividualWarn(false);
                    }
                  }}
                  style={{
                    minHeight: 32,
                    padding: "0 12px",
                    border: "1px solid",
                    borderColor: active ? "var(--mobile-accent, #ff5000)" : "var(--mobile-border, #e0e0e0)",
                    borderRadius: 999,
                    background: active ? "var(--mobile-accent, #ff5000)" : "transparent",
                    color: active ? "#fff" : "var(--mobile-text-muted, #6b6b73)",
                    fontFamily: "inherit",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    textTransform: "capitalize",
                  }}
                >
                  {vm}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Filter FAB → open filter drawer */}
      <button
        type="button"
        onClick={() => setFilterOpen(true)}
        aria-label="Open filters"
        style={{
          position: "fixed",
          left: "max(16px, calc((100vw - 428px) / 2 + 16px))",
          bottom: "calc(72px + var(--mobile-safe-bottom, 0px) + 16px)",
          zIndex: 35,
          height: 48,
          minWidth: 48,
          padding: "0 16px",
          borderRadius: 24,
          border: 0,
          background: "var(--mobile-surface, #fff)",
          color: "var(--mobile-text, #1a1a1a)",
          fontFamily: "inherit",
          fontSize: 13,
          fontWeight: 700,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          cursor: "pointer",
          boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="4" y1="6" x2="20" y2="6" />
          <line x1="8" y1="12" x2="16" y2="12" />
          <line x1="11" y1="18" x2="13" y2="18" />
        </svg>
        Filters
        {selectedPaises.length < allPaises.length && (
          <span
            style={{
              minWidth: 18,
              height: 18,
              borderRadius: 999,
              background: "var(--mobile-accent, #ff5000)",
              color: "#fff",
              fontSize: 10,
              fontWeight: 700,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 4px",
            }}
          >
            !
          </span>
        )}
      </button>

      {/* Export FAB */}
      <ExportFAB
        icon="download"
        label="Export"
        onClick={openExportModal}
        disabled={loading || excelLoading || csvLoading}
        ariaLabel="Export data"
      />

      {/* Filter drawer */}
      <FilterDrawer
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Filters"
        onReset={handleReset}
        onApply={() => setFilterOpen(false)}
        applyLabel="Apply"
      >
        {/* Country filter */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8, color: "var(--mobile-text, #1a1a1a)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Countries
            <span style={{ fontWeight: 400, marginLeft: 4, color: "var(--mobile-text-muted, #6b6b73)" }}>
              ({selectedPaises.length}/{allPaises.length})
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button
              type="button"
              onClick={() => setSelectedPaises(allPaises)}
              style={{
                minHeight: 32, padding: "0 12px", borderRadius: 999, border: "1px solid var(--mobile-border, #e0e0e0)",
                background: "transparent", fontSize: 12, fontWeight: 600, cursor: "pointer",
                color: "var(--mobile-text-muted, #6b6b73)", fontFamily: "inherit",
              }}
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => setSelectedPaises([])}
              style={{
                minHeight: 32, padding: "0 12px", borderRadius: 999, border: "1px solid var(--mobile-border, #e0e0e0)",
                background: "transparent", fontSize: 12, fontWeight: 600, cursor: "pointer",
                color: "var(--mobile-text-muted, #6b6b73)", fontFamily: "inherit",
              }}
            >
              Clear
            </button>
          </div>
          {/* Scrollable country list */}
          <div style={{ maxHeight: 200, overflowY: "auto", WebkitOverflowScrolling: "touch", display: "flex", flexWrap: "wrap", gap: 6 }}>
            {allPaises.map(pais => {
              const active = selectedPaises.includes(pais);
              return (
                <button
                  key={pais}
                  type="button"
                  onClick={() => {
                    setSelectedPaises(
                      active
                        ? selectedPaises.length > 1 ? selectedPaises.filter(p => p !== pais) : selectedPaises
                        : [...selectedPaises, pais]
                    );
                  }}
                  style={{
                    minHeight: 30, padding: "0 10px", borderRadius: 999,
                    border: "1px solid",
                    borderColor: active ? "var(--mobile-accent, #ff5000)" : "var(--mobile-border, #e0e0e0)",
                    background: active ? "rgba(255,80,0,0.08)" : "transparent",
                    color: active ? "var(--mobile-accent, #ff5000)" : "var(--mobile-text-muted, #6b6b73)",
                    fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                    whiteSpace: "nowrap",
                  }}
                >
                  {pais}
                </button>
              );
            })}
          </div>
        </div>

        {/* Period filter */}
        {hasYears && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8, color: "var(--mobile-text, #1a1a1a)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Period
            </div>
            <PeriodSlider years={anos} value={yearRange} onChange={setYearRange} />
          </div>
        )}

        {/* Product filter */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8, color: "var(--mobile-text, #1a1a1a)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Product
          </div>
          <MultiSelectFilter
            label="Product"
            items={ALL_NCMS}
            selected={selectedNCMs}
            onToggle={toggleNcm}
            onClear={selectedNCMs.length < ALL_NCMS.length ? resetNcms : undefined}
            swatch={(n) => NCM_INFO[n].color}
            itemLabel={(n) => NCM_INFO[n].label}
            idPrefix="ncm-mobile"
            counterTotal={ALL_NCMS.length}
          />
        </div>
      </FilterDrawer>

      {/* Export modal (Tier 2 — identical to desktop) */}
      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export — MDIC Comex"
        datasetKey="mdic_comex"
        currentFilters={{ ...exportFilters, _g: exportGranularity }}
        countFetcher={async () => {
          if (!supabase) return 0;
          if (exportGranularity !== "raw") {
            setExportRawCount(null);
            return MDIC_AGG_ESTIMATE[exportGranularity as Exclude<MdicComexGranularity, "raw">];
          }
          const c = await getMdicComexExportCount(supabase, exportFilters);
          setExportRawCount(c);
          return c;
        }}
        excelBusy={excelLoading}
        csvBusy={csvLoading}
        loadingLabel={excelLoading ? "Generating Excel..." : "Downloading CSV..."}
        onExportExcel={handleExportExcel}
        onExportCsv={handleExportCsv}
        filters={
          <div style={{ display: "flex", flexDirection: "column", gap: 14, fontFamily: "Arial" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                Granularity
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {MDIC_GRANULARITY_OPTIONS.map((opt) => (
                  <div key={opt.value} className="form-check" style={{ marginBottom: 0 }}>
                    <input
                      className="form-check-input"
                      type="radio"
                      id={`mdic-mobile-export-g-${opt.value}`}
                      name="mdic-mobile-export-granularity"
                      checked={exportGranularity === opt.value}
                      onChange={() => setExportGranularity(opt.value)}
                    />
                    <label
                      className="form-check-label"
                      htmlFor={`mdic-mobile-export-g-${opt.value}`}
                      style={{ fontFamily: "Arial", fontSize: 12, cursor: "pointer" }}
                    >
                      <strong>{opt.label}</strong>
                      <span style={{ color: "#888", marginLeft: 6, fontSize: 11 }}>— {opt.hint}</span>
                    </label>
                  </div>
                ))}
              </div>
            </div>

            {rawOverAbs && (
              <div style={{ fontSize: 11.5, fontWeight: 600, color: "#7a1a1a", backgroundColor: "#fdecea", border: "1px solid #f5c2bc", borderRadius: 4, padding: "8px 10px", lineHeight: 1.4 }}>
                Very high volume ({(exportRawCount ?? 0).toLocaleString("en-US")} rows). Choose an <strong>aggregated granularity</strong>.
              </div>
            )}
            {!rawOverAbs && rawOverExcel && (
              <div style={{ fontSize: 11.5, fontWeight: 600, color: "#7a4a00", backgroundColor: "#fff3cd", border: "1px solid #ffe69c", borderRadius: 4, padding: "8px 10px", lineHeight: 1.4 }}>
                High volume for Excel ({(exportRawCount ?? 0).toLocaleString("en-US")} rows). We recommend <strong>CSV</strong>.
              </div>
            )}

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>Period</div>
              {hasYears && <PeriodSlider years={anos} value={exportRange} onChange={setExportRange} />}
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>Flow</div>
              <select
                className="form-select form-select-sm"
                value={exportFlow}
                onChange={e => setExportFlow(e.target.value)}
                style={{ fontFamily: "Arial", fontSize: 12 }}
              >
                <option value="ALL">Imports + Exports</option>
                <option value="import">Imports</option>
                <option value="export">Exports</option>
              </select>
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>NCMs</div>
              <MultiSelectFilter
                label="NCMs"
                items={ALL_NCMS}
                selected={exportNcms}
                onToggle={(ncm) => {
                  const next = exportNcms.includes(ncm)
                    ? exportNcms.length > 1 ? exportNcms.filter((n: string) => n !== ncm) : exportNcms
                    : [...exportNcms, ncm];
                  setExportNcms(next);
                }}
                onClear={exportNcms.length < ALL_NCMS.length ? () => setExportNcms(ALL_NCMS) : undefined}
                swatch={(n) => NCM_INFO[n].color}
                itemLabel={(n) => NCM_INFO[n].label}
                idPrefix="ncm-mobile-export"
                counterTotal={ALL_NCMS.length}
              />
            </div>
          </div>
        }
      />
    </div>
  );
}
