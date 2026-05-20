"use client";

// Mobile view for /anp-desembaracos — chart-heavy archetype.
// Archetype: mockups/market-share-mobile.html (chart + filter sheet).
// Adaptation: a single MobileChart with monthly volumes per NCM (top-N traces
// capped for readability), preceded by a MobileTabBar that drives the Top
// Origin Countries section below. Two sticky rows above the chart: period +
// NCM count + Filters button. ExportFAB opens a Tier 1 export sheet.
//
// Layout:
//   MobileTopBar (sticky)
//   Title block (kt unit hint)
//   Filter chip row (period + NCM count + Filters button)
//   Top-NCM MobileTabBar (one tab per NCM that drives Top Countries)
//   MobileChart — multi-line monthly volumes by NCM (kt / month)
//   Section header: Top Origin Countries — <topNcm>
//   MobileDataCard list — countries ranked by total kt
//   ExportFAB — opens Tier 1 export sheet
//   FilterDrawer — period slider + NCM multi-select (min-1) + Top NCM picker
//
// Architecture note:
//   All data comes from useAnpDesembaracosData. This View builds chart traces
//   locally (capped to top-N NCMs for readability) but uses shared serieRows
//   + topCountries + topNcms — no RPC duplication.
//
// Binding sync rule: any meaningful change here must land in desktop/View.tsx
// in the SAME commit, or the commit must declare [mobile-only] with an
// explicit reason. See CLAUDE.md § "Dual-view (web + mobile) policy".

import { useMemo, useState } from "react";
import type { PlotData } from "plotly.js";

import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import { kgToMilTon, LABEL } from "../../../../lib/units";
import { downloadGenericExcel } from "../../../../lib/exportExcel";
import { downloadCsv } from "../../../../lib/exportCsv";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import PeriodSlider from "../../../../components/dashboard/PeriodSlider";
import CheckList from "../../../../components/CheckList";
import type { AnpDesembaracosRow } from "../../../../lib/rpc";

import {
  MobileTopBar,
  FilterDrawer,
  MobileChart,
  MobileDataCard,
  ExportFAB,
  MobileTabBar,
} from "../../../../components/dashboard/mobile";

import {
  useAnpDesembaracosData,
  MOBILE_CHART_MAX_NCMS,
  TOP_COUNTRIES_COLOR,
} from "../useAnpDesembaracosData";

// ─── Mobile chart builder ─────────────────────────────────────────────────────
// Multi-line monthly series. Caps to the top-N NCMs by volume (computed in
// the hook via topNcms) so the legend / overlap stays manageable on 375px.

function buildMobileChart(params: {
  rows: AnpDesembaracosRow[];
  ncms: string[];
  topNcms: string[];
  colorForNcm: (ncm: string) => string;
  ncmNomeMap: Record<string, string>;
}): PlotData[] {
  const { rows, ncms, topNcms, colorForNcm, ncmNomeMap } = params;
  if (!ncms.length || !topNcms.length) return [];

  // Intersect: only display NCMs that are BOTH selected and in the top-N list.
  const visible = new Set(ncms.filter((n) => topNcms.includes(n)));
  if (!visible.size) return [];

  const filtered = rows.filter((r) => visible.has(r.ncm_codigo));
  if (!filtered.length) return [];

  const allDates = Array.from(
    new Set(filtered.map((r) => `${r.ano}-${String(r.mes).padStart(2, "0")}`)),
  ).sort();

  const byKey: Record<string, number> = {};
  for (const r of filtered) {
    const key = `${r.ncm_codigo}|${r.ano}-${String(r.mes).padStart(2, "0")}`;
    byKey[key] = (byKey[key] ?? 0) + (r.quantidade_kg ?? 0);
  }

  return Array.from(visible).map((ncm) => {
    const label = ncmNomeMap[ncm] ?? ncm;
    return {
      type: "scatter",
      mode: "lines",
      name: label,
      x: allDates,
      y: allDates.map((d) => kgToMilTon(byKey[`${ncm}|${d}`] ?? 0)),
      line: { width: 1.5, color: colorForNcm(ncm) },
      hovertemplate: `${label}: %{y:.1f} ${LABEL.MIL_T}<extra></extra>`,
    } as PlotData;
  });
}

// ─── Export drawer (Tier 1 — direct Excel/CSV) ────────────────────────────────

interface ExportSheetProps {
  open: boolean;
  onClose: () => void;
  rows: AnpDesembaracosRow[];
  disabled: boolean;
}

function ExportSheet(props: ExportSheetProps): React.ReactElement {
  const { open, onClose, rows, disabled } = props;
  const [excelBusy, setExcelBusy] = useState(false);

  if (!open) return <></>;

  return (
    <FilterDrawer
      open={open}
      onClose={onClose}
      title="Export data"
      applyLabel={excelBusy ? "Generating..." : "Download Excel"}
      onApply={async () => {
        if (disabled || excelBusy) return;
        setExcelBusy(true);
        try {
          await downloadGenericExcel<AnpDesembaracosRow>({
            rows,
            filename: "ANP-Customs-Clearances",
            title: "ANP — Import Customs Clearances",
            sheetName: "Clearances",
            columns: [
              { key: "ano",           header: "Year" },
              { key: "mes",           header: "Month" },
              { key: "ncm_codigo",    header: "NCM" },
              { key: "ncm_nome",      header: "NCM Description", width: 36 },
              { key: "pais_origem",   header: "Origin Country",  width: 22 },
              { key: "quantidade_kg", header: "Quantity (kg)",   format: "#,##0" },
            ],
          });
        } catch (e) {
          console.error("Excel export failed", e);
        } finally {
          setExcelBusy(false);
          onClose();
        }
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <button
          type="button"
          disabled={disabled}
          style={{
            minHeight: 44,
            border: "1px solid var(--mobile-border)",
            background: "var(--mobile-surface)",
            color: "var(--mobile-text)",
            borderRadius: 12,
            fontFamily: "inherit",
            fontSize: 14,
            fontWeight: 600,
            cursor: disabled ? "default" : "pointer",
            opacity: disabled ? 0.5 : 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
          }}
          onClick={() => {
            if (disabled) return;
            downloadCsv({
              rows: rows as unknown as Record<string, unknown>[],
              filename: "ANP-Customs-Clearances",
            });
            onClose();
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
            <path d="M16 13H8" />
            <path d="M16 17H8" />
            <path d="M10 9H8" />
          </svg>
          Download CSV
        </button>
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: "var(--mobile-text-muted)",
            lineHeight: 1.5,
          }}
        >
          {rows.length.toLocaleString()} rows · period-filtered · raw kg values
        </p>
      </div>
    </FilterDrawer>
  );
}

// ─── View ─────────────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-desembaracos");

  const {
    filtros,
    serieRows,
    allYears,
    yMin,
    yMax,
    hasData,
    loading,
    serieLoading,
    topLoading,
    filters,
    setFilters,
    toggleNcm,
    resetNcms,
    setTopNcm,
    ncmCodigos,
    ncmNomeMap,
    topNcmNome,
    colorForNcm,
    topNcms,
    topCountries,
  } = useAnpDesembaracosData();

  const [filterOpen, setFilterOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  // ── Cap chart traces to top-N NCMs for legibility on small screens. ──────
  // topNcms is already sorted by total kt in the current period; we keep only
  // those that are also currently selected so the chip count and chart agree.
  const topNcmCodes = useMemo(
    () =>
      topNcms
        .filter((e) => filters.selectedNcms.includes(e.ncm_codigo))
        .slice(0, MOBILE_CHART_MAX_NCMS)
        .map((e) => e.ncm_codigo),
    [topNcms, filters.selectedNcms],
  );

  const chartData = useMemo(
    () =>
      buildMobileChart({
        rows: serieRows,
        ncms: filters.selectedNcms,
        topNcms: topNcmCodes,
        colorForNcm,
        ncmNomeMap,
      }),
    [serieRows, filters.selectedNcms, topNcmCodes, colorForNcm, ncmNomeMap],
  );

  // ── Top-NCM tab bar tabs (limited to the same top-N pool the chart uses) ─
  // Falls back to all selected NCMs if topNcms hasn't been computed yet.
  const tabbarTabs = useMemo(() => {
    const codes = topNcmCodes.length
      ? topNcmCodes
      : filters.selectedNcms.slice(0, MOBILE_CHART_MAX_NCMS);
    return codes.map((code) => ({
      key: code,
      label: ncmNomeMap[code] ?? code,
    }));
  }, [topNcmCodes, filters.selectedNcms, ncmNomeMap]);

  // Keep filters.topNcm in sync with available tabs (handled in hook init;
  // we just preserve the current key when possible).
  const activeTabKey = useMemo(() => {
    if (filters.topNcm && tabbarTabs.some((t) => t.key === filters.topNcm)) {
      return filters.topNcm;
    }
    return tabbarTabs[0]?.key ?? "";
  }, [filters.topNcm, tabbarTabs]);

  const periodLabel =
    yMin != null && yMax != null
      ? yMin === yMax
        ? String(yMin)
        : `${yMin}–${yMax}`
      : "All periods";

  if (visLoading || !visible) return <></>;
  if (loading) {
    return (
      <div
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--mobile-bg)",
        }}
      >
        <BarrelLoading bare />
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "var(--mobile-bg)",
        color: "var(--mobile-text)",
        fontFamily: "Arial, Helvetica, sans-serif",
        paddingBottom: "calc(var(--mobile-safe-bottom) + 80px)",
      }}
    >
      {/* ── Top bar ────────────────────────────────────────────────────── */}
      <MobileTopBar title="Customs Clearances" />

      {/* ── Title block ─────────────────────────────────────────────────── */}
      <div style={{ padding: "16px 16px 8px" }}>
        <div
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: "var(--mobile-text)",
            letterSpacing: "0.005em",
            lineHeight: 1.15,
          }}
        >
          ANP — Customs Clearances
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 12,
            color: "var(--mobile-text-muted)",
            lineHeight: 1.3,
          }}
        >
          Monthly imports by NCM and origin country ({LABEL.MIL_T})
        </div>
      </div>

      {/* ── Filter chip row (period + NCM count + Filters) ──────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 16px",
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
          scrollbarWidth: "none",
        }}
      >
        {/* Period chip — opens the filter drawer */}
        <button
          type="button"
          onClick={() => setFilterOpen(true)}
          style={{
            flex: "0 0 auto",
            minHeight: 36,
            padding: "0 14px",
            border: "1px solid var(--mobile-border)",
            borderRadius: 999,
            background: "var(--mobile-surface)",
            color: "var(--mobile-text)",
            fontFamily: "inherit",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          {periodLabel}
        </button>

        {/* NCM count chip */}
        <span
          style={{
            flex: "0 0 auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            minHeight: 36,
            padding: "0 14px",
            border: "1px solid var(--mobile-border)",
            borderRadius: 999,
            background: "var(--mobile-surface)",
            fontSize: 12,
            fontWeight: 600,
            color: "var(--mobile-text)",
          }}
        >
          {filters.selectedNcms.length}/{ncmCodigos.length} NCMs
        </span>

        {/* Filters button */}
        <button
          type="button"
          onClick={() => setFilterOpen(true)}
          style={{
            flex: "0 0 auto",
            minHeight: 36,
            padding: "0 14px",
            border: "1px solid var(--mobile-border)",
            borderRadius: 999,
            background: "var(--mobile-surface)",
            color: "var(--mobile-text-muted)",
            fontFamily: "inherit",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            marginLeft: "auto",
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="8" y1="12" x2="16" y2="12" />
            <line x1="11" y1="18" x2="13" y2="18" />
          </svg>
          Filters
        </button>
      </div>

      {/* ── Chart (multi-line monthly) ──────────────────────────────────── */}
      <div
        style={{
          margin: "4px 16px 0",
          background: "var(--mobile-surface)",
          borderRadius: 16,
          overflow: "hidden",
          opacity: serieLoading ? 0.5 : 1,
          transition: "opacity 0.2s",
        }}
      >
        <div
          style={{
            padding: "12px 16px 4px",
            fontSize: 12,
            fontWeight: 700,
            color: "var(--mobile-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          Imported Volumes — Monthly ({LABEL.MIL_T})
        </div>
        {hasData && chartData.length > 0 ? (
          <MobileChart
            data={chartData}
            height={260}
            layout={{
              xaxis: { type: "date", nticks: 5 },
              yaxis: { title: { text: LABEL.MIL_T } },
              hovermode: "closest",
              showlegend: true,
              legend: {
                orientation: "h",
                y: -0.22,
                x: 0.5,
                xanchor: "center",
                font: { size: 10 },
              },
              margin: { l: 40, r: 8, t: 4, b: 60 },
            }}
          />
        ) : (
          <div
            style={{
              height: 240,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--mobile-text-muted)",
              fontSize: 13,
              padding: 16,
              textAlign: "center",
            }}
          >
            {!hasData
              ? "No data available for this module at this time."
              : "No data for the selected filters."}
          </div>
        )}
      </div>

      {/* ── Top-NCM tab bar (drives the Top Countries section below) ────── */}
      {tabbarTabs.length > 0 && (
        <div style={{ padding: "16px 0 4px" }}>
          <div
            style={{
              padding: "0 16px 8px",
              fontSize: 11,
              fontWeight: 700,
              color: "var(--mobile-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Select NCM to rank countries
          </div>
          <MobileTabBar
            tabs={tabbarTabs}
            activeKey={activeTabKey}
            onChange={(key) => setTopNcm(key)}
            variant="container"
            ariaLabel="NCM for ranking"
          />
        </div>
      )}

      {/* ── Top Origin Countries ranking ────────────────────────────────── */}
      <div style={{ marginTop: 12, paddingBottom: 8 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            padding: "0 16px 8px",
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 700,
              color: "var(--mobile-text)",
            }}
          >
            Top Origin Countries
          </h2>
          <span
            style={{
              fontSize: 12,
              color: "var(--mobile-text-muted)",
              fontWeight: 600,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {topNcmNome} · {periodLabel}
          </span>
        </div>

        <div
          style={{
            background: "var(--mobile-surface)",
            borderRadius: 16,
            overflow: "hidden",
            margin: "0 16px",
            opacity: topLoading ? 0.5 : 1,
            transition: "opacity 0.2s",
          }}
        >
          {topCountries.length === 0 ? (
            <div
              style={{
                padding: 20,
                textAlign: "center",
                color: "var(--mobile-text-muted)",
                fontSize: 13,
              }}
            >
              No data for the selected filters.
            </div>
          ) : (
            topCountries.map((entry, idx) => {
              const isLeader   = idx === 0;
              const leaderKt   = topCountries[0].totalKt;
              const pct        = leaderKt > 0 ? (entry.totalKt / leaderKt) * 100 : 0;
              return (
                <MobileDataCard
                  key={entry.pais_origem}
                  variant="compact"
                  leftIcon={
                    <span
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        background: isLeader
                          ? TOP_COUNTRIES_COLOR
                          : "var(--mobile-divider)",
                        color: isLeader ? "#fff" : "var(--mobile-text-muted)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {idx + 1}
                    </span>
                  }
                  title={entry.pais_origem}
                  subtitle={
                    <span>
                      <span
                        style={{
                          display: "block",
                          height: 4,
                          borderRadius: 2,
                          background: "var(--mobile-divider)",
                          marginTop: 4,
                          overflow: "hidden",
                        }}
                      >
                        <span
                          style={{
                            display: "block",
                            height: "100%",
                            width: `${pct.toFixed(1)}%`,
                            background: TOP_COUNTRIES_COLOR,
                            opacity: isLeader ? 1 : 0.55,
                            borderRadius: 2,
                            transition: "width 0.3s ease",
                          }}
                        />
                      </span>
                    </span>
                  }
                  rightSlot={
                    <div style={{ textAlign: "right" }}>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          color: "var(--mobile-text)",
                        }}
                      >
                        {entry.totalKt.toLocaleString(undefined, {
                          maximumFractionDigits: 1,
                        })}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--mobile-text-muted)",
                        }}
                      >
                        {LABEL.MIL_T}
                      </div>
                    </div>
                  }
                />
              );
            })
          )}
        </div>
      </div>

      {/* ── Filter drawer ───────────────────────────────────────────────── */}
      <FilterDrawer
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Filters"
        resetLabel="Reset"
        applyLabel="Apply"
        onReset={
          filters.selectedNcms.length < ncmCodigos.length ? resetNcms : undefined
        }
        onApply={() => setFilterOpen(false)}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 20,
            fontFamily: "Arial, Helvetica, sans-serif",
          }}
        >
          {/* Period */}
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                marginBottom: 8,
                color: "var(--mobile-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Period
            </div>
            {allYears.length > 0 && (
              <PeriodSlider
                years={allYears}
                value={filters.yearRangeIdx}
                onChange={(v) => setFilters({ yearRangeIdx: v })}
              />
            )}
          </div>

          {/* NCMs */}
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                marginBottom: 8,
                color: "var(--mobile-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              NCMs ({filters.selectedNcms.length}/{ncmCodigos.length})
            </div>
            {/* CheckList shows raw codes; we adapt by using a parallel array
                with NCM descriptions, mapping the chosen ones back to codes. */}
            <NcmCheckListAdapter
              codes={ncmCodigos}
              selected={filters.selectedNcms}
              labelOf={(code) => ncmNomeMap[code] ?? code}
              onChange={(next) => {
                // Min-1 guard at drawer level: never let the list go empty.
                if (next.length === 0) return;
                setFilters({ selectedNcms: next });
              }}
            />
          </div>

          {/* Top Countries — NCM picker (mirrors desktop <select>) */}
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                marginBottom: 8,
                color: "var(--mobile-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Top Countries — NCM
            </div>
            <select
              className="form-select form-select-sm"
              value={filters.topNcm}
              onChange={(e) => setTopNcm(e.target.value)}
              style={{
                width: "100%",
                fontFamily: "Arial, Helvetica, sans-serif",
                fontSize: 13,
                minHeight: 44,
              }}
            >
              {filtros.ncms.map((n) => (
                <option key={n.ncm_codigo} value={n.ncm_codigo}>
                  {n.ncm_nome ?? n.ncm_codigo}
                </option>
              ))}
            </select>
          </div>
        </div>
      </FilterDrawer>

      {/* ── Export FAB ──────────────────────────────────────────────────── */}
      <ExportFAB
        label="Export"
        onClick={() => setExportOpen(true)}
        disabled={loading || serieRows.length === 0}
        bottom="calc(var(--mobile-safe-bottom, 0px) + 24px)"
      />

      {/* ── Export sheet (Tier 1) ───────────────────────────────────────── */}
      <ExportSheet
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        rows={serieRows}
        disabled={loading || serieRows.length === 0}
      />
    </div>
  );
}

// ─── Small adapter so CheckList can show NCM descriptions but emit codes ─────

function NcmCheckListAdapter(props: {
  codes: string[];
  selected: string[];
  labelOf: (code: string) => string;
  onChange: (next: string[]) => void;
}): React.ReactElement {
  const { codes, selected, labelOf, onChange } = props;

  // CheckList works on string equality of options. We feed it the labels and
  // translate selected ↔ codes via a label↔code map.
  const labels = useMemo(() => codes.map(labelOf), [codes, labelOf]);
  const labelToCode = useMemo(() => {
    const m: Record<string, string> = {};
    codes.forEach((c, i) => { m[labels[i]] = c; });
    return m;
  }, [codes, labels]);
  const codeToLabel = useMemo(() => {
    const m: Record<string, string> = {};
    codes.forEach((c, i) => { m[c] = labels[i]; });
    return m;
  }, [codes, labels]);

  const selectedLabels = selected
    .map((c) => codeToLabel[c])
    .filter((l): l is string => !!l);

  return (
    <CheckList
      label="NCMs"
      options={labels}
      value={selectedLabels}
      onChange={(nextLabels) => {
        const nextCodes = nextLabels
          .map((l) => labelToCode[l])
          .filter((c): c is string => !!c);
        onChange(nextCodes);
      }}
      allLabel="All"
      clearLabel="Clear"
    />
  );
}
