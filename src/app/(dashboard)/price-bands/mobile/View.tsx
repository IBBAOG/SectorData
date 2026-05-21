"use client";

// Mobile view for /price-bands.
//
// Archetype: chart-heavy + product tab switch (closest to market-share-mobile).
// Layout:
//   MobileTopBar (title + filter trigger)
//   MobileTabBar (Gasolina | Diesel)
//   Date chip strip (quick period shortcuts)
//   MobileChart (4-line multi-trace — price bands)
//   MobileDataCard rows (current values per band)
//   Section divider
//   MobileChart (YTD average)
//   YTD year pill strip
//   Footnote
//   ExportFAB
//   FilterDrawer (period slider + subsidy toggle for Diesel)
//
// Binding sync rule: any new filter, chart, or KPI added here must also land
// in desktop/View.tsx in the same commit, or declare [mobile-only] with reason.

import { useCallback, useMemo, useState } from "react";
import type { Layout } from "plotly.js";

import {
  MobileTopBar,
  MobileTabBar,
  FilterDrawer,
  MobileChart,
  MobileDataCard,
  ExportFAB,
  FunnelIcon,
} from "@/components/dashboard/mobile";
import BarrelLoading from "@/components/dashboard/BarrelLoading";
import PeriodSlider from "@/components/dashboard/PeriodSlider";
import { useModuleVisibilityGuard } from "@/hooks/useModuleVisibilityGuard";
import {
  usePriceBandsData,
  buildPriceBandsChart,
  buildYtdChart,
  fmtDateLabel,
  COLOR_IMPORT,
  COLOR_EXPORT,
  COLOR_PETRO,
  SUBSIDY_CUTOFF,
  GAS_SERIES,
  DSL_SERIES,
  type PriceBandsProduct,
  type PriceBandsCurrentValues,
} from "../usePriceBandsData";

// ─── Date-range chip helpers ──────────────────────────────────────────────────

interface DateChip {
  label: string;
  /** Months to go back from the latest data point. null = all. */
  months: number | null;
}

const DATE_CHIPS: DateChip[] = [
  { label: "3 M",  months: 3  },
  { label: "6 M",  months: 6  },
  { label: "1 Y",  months: 12 },
  { label: "2 Y",  months: 24 },
  { label: "All",  months: null },
];

function chipSliderRange(
  datas: string[],
  months: number | null,
): [number, number] {
  if (datas.length === 0) return [0, 0];
  const end = datas.length - 1;
  if (months == null) return [0, end];
  const latestDate = new Date(datas[end] + "T00:00:00Z");
  latestDate.setUTCMonth(latestDate.getUTCMonth() - months);
  const cutoff = latestDate.toISOString().slice(0, 10);
  const startIdx = Math.max(0, datas.findIndex((d) => d >= cutoff));
  return [startIdx, end];
}

function activeChip(datas: string[], sliderRange: [number, number]): number | null {
  for (const chip of DATE_CHIPS) {
    const [s, e] = chipSliderRange(datas, chip.months);
    if (s === sliderRange[0] && e === sliderRange[1]) return chip.months ?? -1;
  }
  return undefined as unknown as null;
}

// ─── Current-value card rows ──────────────────────────────────────────────────

interface BandRow {
  label: string;
  value: number | null;
  color: string;
  pct?: string;
}

function buildBandRows(
  product: PriceBandsProduct,
  cv: PriceBandsCurrentValues,
  showSubsidy: boolean,
): BandRow[] {
  if (product === "Gasoline") {
    const petrobras = cv.petrobrasPrice;
    return [
      {
        label: "Import Parity",
        value: cv.importParity,
        color: COLOR_IMPORT,
      },
      {
        label: "Export Parity",
        value: cv.exportParity,
        color: COLOR_EXPORT,
      },
      {
        label: "Petrobras Price",
        value: petrobras,
        color: COLOR_PETRO,
        pct: cv.pctVsIpp != null
          ? `${cv.pctVsIpp >= 0 ? "+" : ""}${cv.pctVsIpp.toFixed(0)}% vs IPP`
          : undefined,
      },
    ];
  }

  // Diesel
  const rows: BandRow[] = [
    { label: "BBA - Import Parity",   value: cv.importParity,   color: COLOR_IMPORT },
    { label: "BBA - Export Parity",   value: cv.exportParity,   color: COLOR_EXPORT },
    {
      label: "Petrobras Price",
      value: cv.petrobrasPrice,
      color: COLOR_PETRO,
      pct: cv.pctVsIpp != null
        ? `${cv.pctVsIpp >= 0 ? "+" : ""}${cv.pctVsIpp.toFixed(0)}% vs IPP`
        : undefined,
    },
  ];

  if (showSubsidy && cv.importParitySubsidy != null) {
    rows.splice(1, 0, {
      label: "Import Parity w/ subsidy",
      value: cv.importParitySubsidy,
      color: COLOR_IMPORT,
    });
  }

  return rows;
}

// ─── Color-dot helper for labels ─────────────────────────────────────────────

function ColorDot({ color }: { color: string }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: color,
        marginRight: 6,
        flexShrink: 0,
      }}
    />
  );
}

// ─── Thin mobile-chart layout override ───────────────────────────────────────

function mobileChartLayout(height: number): Partial<Layout> {
  return {
    height,
    legend: {
      orientation: "h",
      x: 0,
      y: -0.22,
      font: { size: 10 },
    },
    margin: { l: 40, r: 8, t: 8, b: 68 },
    xaxis: {
      tickformat: "%b-%y",
      nticks: 5,
      tickangle: -45,
    },
    yaxis: {
      title: { text: "R$/L", font: { size: 10 } },
      tickformat: ".2f",
      nticks: 4,
    },
  };
}

// ─── Section divider ─────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div
      style={{
        padding: "10px 16px 6px",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.07em",
        textTransform: "uppercase",
        color: "var(--mobile-text-muted)",
        fontFamily: "Arial, Helvetica, sans-serif",
        background: "var(--mobile-bg)",
      }}
    >
      {children}
    </div>
  );
}

// ─── Mobile View ──────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("price-bands");
  const {
    rows, loading,
    filters, setFilters,
    datas, xMin, xMax,
    ytdYears, ytdYear, setYtdYear,
    currentValues,
    exportExcel, exportCsv,
    excelLoading, csvLoading,
    resetFilters,
  } = usePriceBandsData();

  const [drawerOpen,   setDrawerOpen]   = useState(false);
  const [showSubsidy,  setShowSubsidy]  = useState(true);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  // Per-product label translation
  const productLabel = filters.product === "Gasoline" ? "Gasoline" : "Diesel";

  // Date chip active key
  const activeMonths = useMemo(
    () => activeChip(datas, filters.sliderRange),
    [datas, filters.sliderRange],
  );

  const handleChip = useCallback((months: number | null) => {
    setFilters({ sliderRange: chipSliderRange(datas, months) });
  }, [datas, setFilters]);

  // Chart data for currently selected product
  const chart = useMemo(
    () => buildPriceBandsChart(rows, filters.product, xMin, xMax),
    [rows, filters.product, xMin, xMax],
  );

  const ytdChart = useMemo(
    () => buildYtdChart(rows, filters.product, ytdYear),
    [rows, filters.product, ytdYear],
  );

  const cv: PriceBandsCurrentValues = currentValues[filters.product];

  // Series definitions for chart — Diesel shows subsidy line conditionally
  const seriesDefs = filters.product === "Gasoline" ? GAS_SERIES : DSL_SERIES;
  const visibleTraces = useMemo(() => {
    if (filters.product === "Gasoline" || showSubsidy) return chart.data;
    // Hide subsidy lines when toggle is off
    return chart.data.filter((_, i) => {
      const s = seriesDefs[i];
      return s && s.field !== "bba_import_parity_w_subsidy" && s.field !== "petrobras_price_w_subsidy";
    });
  }, [chart.data, filters.product, showSubsidy, seriesDefs]);

  const bandRows = useMemo(
    () => buildBandRows(filters.product, cv, showSubsidy),
    [filters.product, cv, showSubsidy],
  );

  if (visLoading || !visible) return <></>;

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "var(--mobile-bg)",
        paddingBottom: "calc(80px + var(--mobile-safe-bottom))",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <MobileTopBar
        title="Price Bands"
        rightSlot={
          <button
            type="button"
            aria-label="Open filters"
            onClick={() => setDrawerOpen(true)}
            style={{
              width: 44,
              height: 44,
              border: 0,
              background: "transparent",
              color: "var(--mobile-text-muted)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              borderRadius: 12,
            }}
          >
            {/* Funnel icon */}
            <FunnelIcon size={22} />
          </button>
        }
      />

      {/* ── Product tab bar ───────────────────────────────────────────────── */}
      <div style={{ padding: "12px 0 4px" }}>
        <MobileTabBar
          tabs={[
            { key: "Diesel",   label: "Diesel"   },
            { key: "Gasoline", label: "Gasoline" },
          ]}
          activeKey={filters.product}
          onChange={(k) => setFilters({ product: k as PriceBandsProduct })}
          ariaLabel="Product selection"
        />
      </div>

      {/* ── Date chip strip ───────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "8px 16px",
          overflowX: "auto",
          scrollbarWidth: "none",
        }}
      >
        {DATE_CHIPS.map((chip) => {
          const isActive = activeMonths === (chip.months ?? -1);
          return (
            <button
              key={chip.label}
              type="button"
              onClick={() => handleChip(chip.months)}
              style={{
                flexShrink: 0,
                padding: "6px 14px",
                borderRadius: 20,
                border: "1px solid",
                borderColor: isActive ? "var(--mobile-accent)" : "var(--mobile-divider)",
                background: isActive ? "var(--mobile-accent)" : "var(--mobile-surface)",
                color: isActive ? "#fff" : "var(--mobile-text-muted)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                minHeight: 36,
                fontFamily: "inherit",
                transition: "background 0.15s ease, color 0.15s ease",
              }}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div style={{ padding: "32px 0" }}>
          <BarrelLoading bare />
        </div>
      ) : (
        <>
          {/* ── Price bands chart ─────────────────────────────────────────── */}
          <SectionLabel>Price Bands — {productLabel}</SectionLabel>

          <div style={{ padding: "0 8px" }}>
            <MobileChart
              data={visibleTraces}
              layout={mobileChartLayout(260)}
              height={260}
            />
          </div>

          {/* ── Current value cards ───────────────────────────────────────── */}
          <SectionLabel>
            Latest values
            {cv.lastDate && (
              <span style={{ fontWeight: 400, marginLeft: 6, textTransform: "none", letterSpacing: 0 }}>
                · {fmtDateLabel(cv.lastDate)}
              </span>
            )}
          </SectionLabel>

          <div style={{ background: "var(--mobile-surface)", borderTop: "1px solid var(--mobile-divider)" }}>
            {bandRows.map((row) => (
              <MobileDataCard
                key={row.label}
                variant="compact"
                leftIcon={<ColorDot color={row.color} />}
                title={row.label}
                rightSlot={
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "var(--mobile-text)", fontFamily: "Arial" }}>
                      {row.value != null ? `R$ ${row.value.toFixed(2)}` : "—"}
                    </div>
                    {row.pct && (
                      <div style={{ fontSize: 11, color: "var(--mobile-text-muted)", fontFamily: "Arial" }}>
                        {row.pct}
                      </div>
                    )}
                  </div>
                }
              />
            ))}
          </div>

          {/* ── YTD section ──────────────────────────────────────────────── */}
          <SectionLabel>YTD Average — {productLabel}</SectionLabel>

          {/* Year pills */}
          <div style={{ display: "flex", gap: 8, padding: "4px 16px 8px" }}>
            {ytdYears.map((y) => {
              const active = ytdYear === y;
              return (
                <button
                  key={y}
                  type="button"
                  onClick={() => setYtdYear(y)}
                  style={{
                    padding: "5px 14px",
                    borderRadius: 20,
                    border: "1px solid",
                    borderColor: active ? "var(--mobile-accent)" : "var(--mobile-divider)",
                    background: active ? "var(--mobile-accent)" : "var(--mobile-surface)",
                    color: active ? "#fff" : "var(--mobile-text-muted)",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    minHeight: 36,
                    fontFamily: "inherit",
                  }}
                >
                  {y}
                </button>
              );
            })}
          </div>

          <div style={{ padding: "0 8px" }}>
            <MobileChart
              data={ytdChart.data}
              layout={mobileChartLayout(230)}
              height={230}
            />
          </div>

          {ytdYear === new Date().getFullYear() && (
            <div style={{ padding: "4px 16px 8px", fontSize: 11, color: "var(--mobile-text-muted)" }}>
              Solid: actual cumulative avg · Dotted: projection to Dec 31
            </div>
          )}
        </>
      )}

      {/* ── Filter drawer ────────────────────────────────────────────────── */}
      <FilterDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Filters"
        onReset={() => { resetFilters(); }}
        onApply={() => setDrawerOpen(false)}
        applyLabel="Apply"
      >
        {/* Period slider */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--mobile-text)", marginBottom: 10, fontFamily: "Arial" }}>
            Period
          </div>
          {datas.length > 0 && (
            <PeriodSlider
              dates={datas}
              value={filters.sliderRange}
              onChange={(v) => setFilters({ sliderRange: v })}
              sliderId="pb-slider-mobile"
            />
          )}
          {xMin && xMax && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--mobile-text-muted)", fontFamily: "Arial" }}>
              {fmtDateLabel(xMin)} – {fmtDateLabel(xMax)}
            </div>
          )}
        </div>

        {/* Subsidy toggle (Diesel only) */}
        {filters.product === "Diesel" && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 0",
              borderTop: "1px solid var(--mobile-divider)",
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--mobile-text)", fontFamily: "Arial" }}>
                Show subsidy lines
              </div>
              <div style={{ fontSize: 12, color: "var(--mobile-text-muted)", fontFamily: "Arial", marginTop: 2 }}>
                Import Parity w/ subsidy (from Mar 2026)
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={showSubsidy}
              onClick={() => setShowSubsidy((v) => !v)}
              style={{
                width: 48,
                height: 28,
                borderRadius: 14,
                border: 0,
                background: showSubsidy ? "var(--mobile-accent)" : "var(--mobile-divider)",
                position: "relative",
                cursor: "pointer",
                transition: "background 0.2s ease",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 3,
                  left: showSubsidy ? 22 : 3,
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: "#fff",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
                  transition: "left 0.18s ease",
                }}
              />
            </button>
          </div>
        )}
      </FilterDrawer>

      {/* ── Export FAB with mini-menu ─────────────────────────────────────── */}
      {exportMenuOpen && (
        <div
          style={{
            position: "fixed",
            right: "max(16px, calc((100vw - 428px) / 2 + 16px))",
            bottom: "calc(72px + var(--mobile-safe-bottom) + 72px)",
            zIndex: 36,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            alignItems: "flex-end",
          }}
        >
          {[
            { label: "Excel", busy: excelLoading, onClick: () => { exportExcel(); setExportMenuOpen(false); } },
            { label: "CSV",   busy: csvLoading,   onClick: () => { exportCsv();   setExportMenuOpen(false); } },
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={item.onClick}
              disabled={item.busy || rows.length === 0 || loading}
              style={{
                minHeight: 44,
                padding: "0 20px",
                borderRadius: 22,
                border: 0,
                background: "var(--mobile-surface)",
                color: "var(--mobile-text)",
                fontFamily: "Arial",
                fontSize: 14,
                fontWeight: 700,
                cursor: item.busy ? "default" : "pointer",
                boxShadow: "0 2px 12px rgba(0,0,0,0.12)",
                opacity: item.busy || rows.length === 0 || loading ? 0.6 : 1,
              }}
            >
              {item.busy ? "..." : item.label}
            </button>
          ))}
        </div>
      )}

      <ExportFAB
        icon="download"
        ariaLabel={exportMenuOpen ? "Close export menu" : "Export data"}
        onClick={() => setExportMenuOpen((v) => !v)}
        disabled={rows.length === 0 || loading}
      />
    </div>
  );
}
