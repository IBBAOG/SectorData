"use client";

// Mobile view for /anp-glp — chart-heavy archetype.
//
// Layout:
//   MobileTopBar (sticky)
//   Category MobileTabBar  — P13 / Other - LPG / Other - Special
//   Filter chip row        — period + distributor count + "Filters" button
//   MobileChart            — stacked area: selected category vs. national total
//   Section header: Top Distributors
//   MobileDataCard list    — top-N distributors for active category
//   ExportFAB              — download floating button
//   FilterDrawer           — period slider + distributor count info
//
// Architecture note:
//   Data comes entirely from useAnpGlpData. This View builds its own chart
//   traces locally (stacked area for mobile vs. multi-line for desktop) but
//   uses the same serieRows — no RPC duplication.
//
// Binding sync rule: any meaningful change here must land in desktop/View.tsx
// in the SAME commit, or the commit must declare [mobile-only] with explicit
// reason. See CLAUDE.md § "Dual-view policy".

import { useMemo, useState } from "react";
import type { PlotData } from "plotly.js";

import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import { kgToMilTon, LABEL } from "../../../../lib/units";
import { downloadGenericExcel } from "../../../../lib/exportExcel";
import { downloadCsv } from "../../../../lib/exportCsv";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import PeriodSlider from "../../../../components/dashboard/PeriodSlider";
import type { AnpGlpSerieRow } from "../../../../lib/rpc";

import {
  MobileTopBar,
  FilterDrawer,
  MobileChart,
  MobileDataCard,
  ExportFAB,
  MobileTabBar,
  FileLinesIcon,
  CalendarIcon,
} from "../../../../components/dashboard/mobile";

import {
  useAnpGlpData,
  CATEGORIA_INFO,
  MAIN_CATEGORIAS,
} from "../useAnpGlpData";

// ─── Mobile chart builder ─────────────────────────────────────────────────────
// Stacked area by month for the active category only, showing total national
// sales (all distributors aggregated). Single-trace keeps the chart readable
// at 280px height.

function buildMobileAreaChart(
  rows: AnpGlpSerieRow[],
  categoria: string,
): PlotData[] {
  const filtered = rows.filter((r) => r.categoria === categoria);
  if (!filtered.length) return [];

  const agg: Record<string, number> = {};
  for (const r of filtered) {
    const key = `${r.ano}-${String(r.mes).padStart(2, "0")}`;
    agg[key] = (agg[key] ?? 0) + (r.vendas_kg ?? 0);
  }

  const keys = Object.keys(agg).sort();
  const info = CATEGORIA_INFO[categoria];
  const color = info?.color ?? "#2196F3";

  return [
    {
      type: "scatter",
      mode: "lines",
      fill: "tozeroy",
      name: info?.label ?? categoria,
      x: keys,
      y: keys.map((k) => kgToMilTon(agg[k] ?? 0)),
      line: { width: 2, color },
      fillcolor: color + "26", // 15% alpha
      hovertemplate: `%{y:.1f} ${LABEL.MIL_T}<extra></extra>`,
    } as PlotData,
  ];
}

// ─── Export drawer ─────────────────────────────────────────────────────────────

interface ExportSheetProps {
  open: boolean;
  onClose: () => void;
  rows: AnpGlpSerieRow[];
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
          await downloadGenericExcel<AnpGlpSerieRow>({
            rows,
            filename: "ANP-GLP",
            title: "ANP — LPG Sales by Distributor",
            sheetName: "LPG Sales",
            columns: [
              { key: "ano",           header: "Year" },
              { key: "mes",           header: "Month" },
              { key: "distribuidora", header: "Distributor", width: 28 },
              { key: "categoria",     header: "Category",    width: 22 },
              { key: "vendas_kg",     header: "Sales (kg)",  format: "#,##0" },
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
              filename: "ANP-GLP",
            });
            onClose();
          }}
        >
          <FileLinesIcon size={18} />
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
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-glp");

  const {
    serieRows,
    allYears,
    yMin,
    yMax,
    topDist,
    loading,
    serieLoading,
    filters,
    setFilters,
    exportRows,
  } = useAnpGlpData();

  const [filterOpen, setFilterOpen]   = useState(false);
  const [exportOpen, setExportOpen]   = useState(false);

  // Active category tab drives the chart + top-dist list.
  // We repurpose topDistCat as the "active category" for mobile: single-tab
  // view. This means the mobile tab switches both the chart and the ranking.
  const activeCat = filters.topDistCat;

  const chartData = useMemo(
    () => buildMobileAreaChart(serieRows, activeCat),
    [serieRows, activeCat],
  );

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

  const hasData = serieRows.length > 0;
  const catInfo = CATEGORIA_INFO[activeCat];

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "var(--mobile-bg)",
        color: "var(--mobile-text)",
        fontFamily: "Arial, Helvetica, sans-serif",
        paddingBottom: "calc(var(--mobile-tabbar-h) + var(--mobile-safe-bottom) + 16px)",
      }}
    >
      {/* ── Top bar ────────────────────────────────────────────────────── */}
      <MobileTopBar title="LPG Sales" />

      {/* ── Category tab bar ────────────────────────────────────────────── */}
      <div style={{ paddingTop: 12, paddingBottom: 8 }}>
        <MobileTabBar
          tabs={MAIN_CATEGORIAS.map((c) => ({
            key: c,
            label: CATEGORIA_INFO[c]?.label ?? c,
          }))}
          activeKey={activeCat}
          onChange={(key) => setFilters({ topDistCat: key })}
          variant="container"
          ariaLabel="LPG category"
        />
      </div>

      {/* ── Filter chip row ─────────────────────────────────────────────── */}
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
        {/* Period chip */}
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
          <CalendarIcon size={14} />
          {periodLabel}
        </button>

        {/* Category color dot + label */}
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
            color: catInfo?.color ?? "var(--mobile-text)",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: catInfo?.color ?? "#999",
              flexShrink: 0,
            }}
          />
          {catInfo?.label ?? activeCat}
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

      {/* ── Chart ─────────────────────────────────────────────────────────── */}
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
          Monthly Sales — National Total ({LABEL.MIL_T})
        </div>
        {hasData ? (
          <MobileChart
            data={chartData}
            height={240}
            layout={{
              xaxis: { type: "date", nticks: 5 },
              yaxis: { title: { text: LABEL.MIL_T } },
              hovermode: "closest",
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
            }}
          >
            No data for selected period
          </div>
        )}
      </div>

      {/* ── Top Distributors section ─────────────────────────────────────── */}
      <div style={{ marginTop: 20, paddingBottom: 8 }}>
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
            Top Distributors
          </h2>
          <span
            style={{
              fontSize: 12,
              color: "var(--mobile-text-muted)",
              fontWeight: 600,
            }}
          >
            {catInfo?.label ?? activeCat} · {periodLabel}
          </span>
        </div>

        <div
          style={{
            background: "var(--mobile-surface)",
            borderRadius: 16,
            overflow: "hidden",
            margin: "0 16px",
            opacity: serieLoading ? 0.5 : 1,
            transition: "opacity 0.2s",
          }}
        >
          {topDist.length === 0 ? (
            <div
              style={{
                padding: 20,
                textAlign: "center",
                color: "var(--mobile-text-muted)",
                fontSize: 13,
              }}
            >
              No distributor data for selected period
            </div>
          ) : (
            topDist.map((entry, idx) => {
              const pct =
                topDist[0].totalKt > 0
                  ? (entry.totalKt / topDist[0].totalKt) * 100
                  : 0;
              return (
                <MobileDataCard
                  key={entry.distribuidora}
                  variant="compact"
                  leftIcon={
                    <span
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        background:
                          idx === 0
                            ? "var(--mobile-accent)"
                            : "var(--mobile-divider)",
                        color: idx === 0 ? "#fff" : "var(--mobile-text-muted)",
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
                  title={entry.distribuidora}
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
                            background: catInfo?.color ?? "var(--mobile-accent)",
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
                        {entry.totalKt.toFixed(1)}
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

      {/* ── Filter drawer ─────────────────────────────────────────────────── */}
      <FilterDrawer
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Filters"
        onReset={() => {
          if (allYears.length > 0) {
            const startIdx = Math.max(
              0,
              allYears.findIndex(
                (y) => y >= allYears[allYears.length - 1] - 9,
              ),
            );
            setFilters({ yearRangeIdx: [startIdx, allYears.length - 1] });
          }
          setFilterOpen(false);
        }}
        onApply={() => setFilterOpen(false)}
        applyLabel="Apply"
      >
        <div
          style={{
            fontFamily: "Arial, Helvetica, sans-serif",
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "var(--mobile-text)",
              marginBottom: 12,
            }}
          >
            Period
          </div>
          {allYears.length > 0 && (
            <PeriodSlider
              years={allYears}
              value={filters.yearRangeIdx}
              onChange={(v) =>
                setFilters({ yearRangeIdx: v as [number, number] })
              }
            />
          )}
          <div
            style={{
              marginTop: 16,
              fontSize: 12,
              color: "var(--mobile-text-muted)",
            }}
          >
            {periodLabel}
          </div>
        </div>
      </FilterDrawer>

      {/* ── Export sheet ──────────────────────────────────────────────────── */}
      <ExportSheet
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        rows={exportRows}
        disabled={loading || exportRows.length === 0}
      />

      {/* ── Export FAB ────────────────────────────────────────────────────── */}
      <ExportFAB
        icon="download"
        label="Export"
        disabled={loading || exportRows.length === 0}
        ariaLabel="Export LPG sales data"
        onClick={() => setExportOpen(true)}
      />
    </div>
  );
}
