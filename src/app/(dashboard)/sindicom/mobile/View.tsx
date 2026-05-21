"use client";

// Mobile view for /sindicom — chart-heavy archetype (closest reference:
// market-share-mobile.html / sales-volumes mobile).
//
// Layout:
//   MobileTopBar (sticky liquid glass)
//   Product MobileTabBar          — selects the single product driving chart + ranking
//   Filter chip row               — Period · Segments · "Filters" button
//   Title block + latest pill
//   MobileChart                   — stacked area, one trace per top-N company
//                                   for the active product (limited to 6 to keep
//                                   the legend readable at 240px)
//   Market Share section          — Top 15 distributors as MobileDataCard rows
//                                   (rank pill, share %, bar, volume in m³)
//   ExportFAB                     — opens download sheet (Excel / CSV)
//   FilterDrawer                  — period slider + segment multi-select
//
// Architecture note:
//   The mobile View reuses the same selectedProdutos / selectedSegmentos /
//   msProduto state managed by useSindicomData — when the product MobileTabBar
//   changes, we update BOTH selectedProdutos (single-product window for the
//   chart) and msProduto (driver for the Market Share ranking).
//   This keeps the analysis identical: "for this product + these segments +
//   this period, here is the time-series and the market-share."
//
// Empty state: mirrors desktop. When filtros.produtos.length === 0 (Cloudflare
// has blocked the pipeline locally), we show an instructional card pointing
// at the etl_sindicom.yml workflow.
//
// Binding sync rule: any meaningful change here must land in desktop/View.tsx
// in the SAME commit, or the commit must declare [mobile-only] with explicit
// reason. See CLAUDE.md § "Dual-view policy".

import { useMemo, useState } from "react";
import type { PlotData } from "plotly.js";

import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import { downloadGenericExcel } from "../../../../lib/exportExcel";
import { downloadCsv } from "../../../../lib/exportCsv";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import PeriodSlider from "../../../../components/dashboard/PeriodSlider";
import type { SindicomSerieRow } from "../../../../lib/rpc";

import {
  MobileTopBar,
  FilterDrawer,
  MobileChart,
  MobileDataCard,
  ExportFAB,
  MobileTabBar,
  FileLinesIcon,
} from "../../../../components/dashboard/mobile";

import {
  useSindicomData,
  PALETTE,
  colorForProduto,
  type MarketShareEntry,
} from "../useSindicomData";

// ─── Mobile chart builder ─────────────────────────────────────────────────────
//
// Stacked area by month, one trace per top-N company (default 6). Single-
// product view keeps the legend tight at 240px height.

const TOP_N_FOR_CHART = 6;

function buildMobileAreaChart(params: {
  serieRows: SindicomSerieRow[];
  produto: string;
  segmentos: string[];
  allProdutos: string[];
}): PlotData[] {
  const { serieRows, produto, segmentos } = params;
  if (!serieRows.length || !produto) return [];

  const segSet = new Set(segmentos);
  const filtered = serieRows.filter(
    (r) => r.nome_produto === produto && segSet.has(r.segmento),
  );
  if (!filtered.length) return [];

  // 1) Aggregate volume by company over the whole period — pick top N.
  const byEmpresa: Record<string, number> = {};
  for (const r of filtered) {
    byEmpresa[r.empresa] = (byEmpresa[r.empresa] ?? 0) + (r.volume ?? 0);
  }
  const top = Object.entries(byEmpresa)
    .sort(([, a], [, b]) => b - a)
    .slice(0, TOP_N_FOR_CHART)
    .map(([e]) => e);

  // 2) Build (date → empresa → volume) map for the top N.
  const topSet = new Set(top);
  const dateMap = new Map<string, Map<string, number>>();
  for (const r of filtered) {
    if (!topSet.has(r.empresa)) continue;
    const key = `${r.ano}-${String(r.mes).padStart(2, "0")}-01`;
    if (!dateMap.has(key)) dateMap.set(key, new Map());
    const inner = dateMap.get(key)!;
    inner.set(r.empresa, (inner.get(r.empresa) ?? 0) + (r.volume ?? 0));
  }

  const dates = Array.from(dateMap.keys()).sort();

  return top.map((empresa, idx) => {
    const color = PALETTE[idx % PALETTE.length];
    return {
      type: "scatter",
      mode: "lines",
      stackgroup: "vol",
      x: dates,
      y: dates.map((d) => dateMap.get(d)?.get(empresa) ?? 0),
      name: empresa,
      line: { width: 1.5, color },
      fillcolor: color + "33", // 20% alpha
      hovertemplate: `%{fullData.name}: %{y:,.0f} m³<extra></extra>`,
    } as unknown as PlotData;
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatVolume(m3: number): string {
  // Display in m³ but condense large numbers: 1.2M m³ / 540K m³ / 12,345 m³
  if (m3 >= 1_000_000) return `${(m3 / 1_000_000).toFixed(1)}M`;
  if (m3 >= 1_000) return `${(m3 / 1_000).toFixed(1)}K`;
  return Math.round(m3).toLocaleString();
}

// ─── Bottom icons (used by chart/ranking icons inside cards) ─────────────────

function FilterIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="8" y1="12" x2="16" y2="12" />
      <line x1="11" y1="18" x2="13" y2="18" />
    </svg>
  );
}

// ─── Export drawer (BottomSheet wrapping Excel + CSV actions) ────────────────

interface ExportSheetProps {
  open: boolean;
  onClose: () => void;
  rows: SindicomSerieRow[];
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
          await downloadGenericExcel<SindicomSerieRow>({
            rows,
            filename: "SINDICOM",
            title: "SINDICOM — Fuel Distribution by Company",
            sheetName: "SINDICOM",
            columns: [
              { key: "ano",          header: "Year" },
              { key: "mes",          header: "Month" },
              { key: "empresa",      header: "Company", width: 24 },
              { key: "nome_produto", header: "Product", width: 22 },
              { key: "segmento",     header: "Segment", width: 18 },
              { key: "volume",       header: "Volume (m³)", format: "#,##0" },
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
              filename: "SINDICOM",
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
          {rows.length.toLocaleString()} rows · period-filtered · volume in m³
        </p>
      </div>
    </FilterDrawer>
  );
}

// ─── View ─────────────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("sindicom");

  const {
    serieRows,
    filtros,
    allYears,
    yMin,
    yMax,
    hasData,
    loading,
    serieLoading,
    filters,
    setFilters,
    toggleSegmento,
    resetSegmentos,
    marketShare,
    exportRows,
  } = useSindicomData();

  const [filterOpen, setFilterOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  // ── Active product (single) — derived from filters.msProduto.
  //    Tapping a tab updates msProduto (Market Share driver) AND narrows
  //    selectedProdutos to that single product so the desktop trend chart
  //    keeps line traces in sync if the user switches viewports.
  const activeProduto = filters.msProduto || filtros.produtos[0] || "";

  // ── Chart data for the active product ────────────────────────────────────
  const chartTraces = useMemo(
    () =>
      buildMobileAreaChart({
        serieRows,
        produto: activeProduto,
        segmentos: filters.selectedSegmentos,
        allProdutos: filtros.produtos,
      }),
    [serieRows, activeProduto, filters.selectedSegmentos, filtros.produtos],
  );

  const activeProdutoColor = activeProduto
    ? colorForProduto(activeProduto, filtros.produtos)
    : "#999";

  // ── Period label ─────────────────────────────────────────────────────────
  const periodLabel =
    yMin != null && yMax != null
      ? yMin === yMax
        ? String(yMin)
        : `${yMin}–${yMax}`
      : "All periods";

  // ── Top-15 market share (already computed in the hook) ───────────────────
  const totalShareVolume = marketShare.reduce((s, e) => s + e.volume, 0);

  // ── Early returns ────────────────────────────────────────────────────────
  if (visLoading || !visible) return <></>;

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--mobile-bg, #f5f5f7)",
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
        background: "var(--mobile-bg, #f5f5f7)",
        color: "var(--mobile-text, #1a1a1a)",
        fontFamily: "Arial, Helvetica, sans-serif",
        paddingBottom: "calc(var(--mobile-safe-bottom, 0px) + 96px)",
      }}
    >
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <MobileTopBar
        title={
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: "0.04em", color: "var(--mobile-text, #1a1a1a)" }}>
              Sector<span style={{ color: "var(--mobile-accent, #ff5000)" }}>Data</span>
            </span>
          </span>
        }
      />

      {/* ── Title block ─────────────────────────────────────────────────── */}
      <div style={{ padding: "16px 16px 8px" }}>
        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: "var(--mobile-text, #1a1a1a)",
            letterSpacing: "0.005em",
            lineHeight: 1.15,
          }}
        >
          SINDICOM
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 13,
            color: "var(--mobile-text-muted, #6b6b73)",
            lineHeight: 1.35,
          }}
        >
          Fuel distribution by company — monthly volumes (m³)
        </div>
        {hasData && yMin != null && yMax != null && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              marginTop: 10,
              padding: "4px 10px",
              borderRadius: 999,
              background: "rgba(255,80,0,0.10)",
              color: "var(--mobile-accent, #ff5000)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--mobile-accent, #ff5000)", display: "inline-block" }} />
            {periodLabel}
          </div>
        )}
      </div>

      {/* ── Empty state (Cloudflare blocked or first run pending) ───────── */}
      {!hasData ? (
        <div style={{ padding: "12px 16px" }}>
          <div
            style={{
              background: "var(--mobile-surface, #ffffff)",
              border: "1px solid var(--mobile-border-soft, #f0f0f5)",
              borderRadius: 16,
              padding: "24px 20px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: 14,
                color: "var(--mobile-text, #1a1a1a)",
                fontWeight: 600,
                marginBottom: 8,
              }}
            >
              Waiting for data
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--mobile-text-muted, #6b6b73)",
                lineHeight: 1.5,
              }}
            >
              The pipeline has not run yet. The SINDICOM scraper is blocked by
              Cloudflare on local IPs. Trigger{" "}
              <code style={{ fontSize: 11 }}>etl_sindicom.yml</code> via
              GitHub Actions to populate the table. See{" "}
              <code style={{ fontSize: 11 }}>docs/app/sindicom.md</code>.
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* ── Product MobileTabBar ────────────────────────────────────── */}
          {filtros.produtos.length > 0 && (
            <div style={{ padding: "8px 0 12px", overflowX: "auto", WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}>
              <MobileTabBar
                tabs={filtros.produtos.map((p) => ({
                  key: p,
                  label: p,
                }))}
                activeKey={activeProduto}
                onChange={(key) => {
                  // Updating msProduto (market-share driver) is enough — the
                  // chart uses activeProduto = msProduto. We also pin
                  // selectedProdutos to [key] so desktop trend chart shows
                  // the same single product if the user resizes.
                  setFilters({ msProduto: key, selectedProdutos: [key] });
                }}
                variant="container"
                ariaLabel="Product selection"
              />
            </div>
          )}

          {/* ── Filter chip row ─────────────────────────────────────────── */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "0 16px 12px",
              overflowX: "auto",
              WebkitOverflowScrolling: "touch",
              scrollbarWidth: "none",
            }}
          >
            <button
              type="button"
              onClick={() => setFilterOpen(true)}
              style={{
                flex: "0 0 auto",
                minHeight: 32,
                padding: "0 14px",
                borderRadius: 999,
                border: "1px solid var(--mobile-accent, #ff5000)",
                background: "transparent",
                color: "var(--mobile-accent, #ff5000)",
                fontSize: 13,
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
                whiteSpace: "nowrap",
                fontFamily: "inherit",
              }}
            >
              <FilterIcon />
              Filters
            </button>

            {/* Period chip */}
            <span
              style={{
                flex: "0 0 auto",
                minHeight: 32,
                padding: "0 12px",
                borderRadius: 999,
                border: "1px solid var(--mobile-border, #e6e6ec)",
                background: "var(--mobile-surface, #ffffff)",
                color: "var(--mobile-text, #1a1a1a)",
                fontSize: 13,
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                whiteSpace: "nowrap",
                fontFamily: "inherit",
              }}
            >
              {periodLabel}
            </span>

            {/* Segments chip */}
            <span
              style={{
                flex: "0 0 auto",
                minHeight: 32,
                padding: "0 12px",
                borderRadius: 999,
                border: "1px solid var(--mobile-border, #e6e6ec)",
                background: "var(--mobile-surface, #ffffff)",
                color: "var(--mobile-text, #1a1a1a)",
                fontSize: 13,
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                whiteSpace: "nowrap",
                fontFamily: "inherit",
              }}
            >
              {filters.selectedSegmentos.length === filtros.segmentos.length
                ? "All segments"
                : `${filters.selectedSegmentos.length}/${filtros.segmentos.length} segments`}
            </span>
          </div>

          {/* ── Chart card ──────────────────────────────────────────────── */}
          <div style={{ padding: "0 16px 16px" }}>
            <div
              style={{
                background: "var(--mobile-surface, #ffffff)",
                border: "1px solid var(--mobile-border-soft, #f0f0f5)",
                borderRadius: 16,
                overflow: "hidden",
                opacity: serieLoading ? 0.5 : 1,
                transition: "opacity 0.2s",
              }}
            >
              <div
                style={{
                  padding: "14px 14px 6px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    minWidth: 0,
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: activeProdutoColor,
                      flexShrink: 0,
                    }}
                  />
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 700,
                      color: "var(--mobile-text, #1a1a1a)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {activeProduto || "—"} — Top {TOP_N_FOR_CHART}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--mobile-text-muted, #6b6b73)",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  m³
                </div>
              </div>
              {chartTraces.length > 0 ? (
                <MobileChart
                  data={chartTraces}
                  height={240}
                  layout={{
                    xaxis: { type: "date", nticks: 5 },
                    yaxis: { title: { text: "" } },
                    showlegend: true,
                    legend: {
                      orientation: "h",
                      y: -0.22,
                      x: 0.5,
                      xanchor: "center",
                      font: { size: 10 },
                    },
                    margin: { l: 50, r: 8, t: 4, b: 70 },
                  }}
                />
              ) : (
                <div
                  style={{
                    height: 240,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--mobile-text-muted, #6b6b73)",
                    fontSize: 13,
                  }}
                >
                  No data for the selected filters.
                </div>
              )}
            </div>
          </div>

          {/* ── Market Share section ───────────────────────────────────── */}
          <div style={{ paddingBottom: 8 }}>
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
                  color: "var(--mobile-text, #1a1a1a)",
                }}
              >
                Market Share (Top 15)
              </h2>
              <span
                style={{
                  fontSize: 12,
                  color: "var(--mobile-text-muted, #6b6b73)",
                  fontWeight: 600,
                }}
              >
                {activeProduto || "—"} · {periodLabel}
              </span>
            </div>

            <div
              style={{
                background: "var(--mobile-surface, #ffffff)",
                border: "1px solid var(--mobile-border-soft, #f0f0f5)",
                borderRadius: 16,
                overflow: "hidden",
                margin: "0 16px",
                opacity: serieLoading ? 0.5 : 1,
                transition: "opacity 0.2s",
              }}
            >
              {marketShare.length === 0 ? (
                <div
                  style={{
                    padding: 20,
                    textAlign: "center",
                    color: "var(--mobile-text-muted, #6b6b73)",
                    fontSize: 13,
                  }}
                >
                  No data for selected period.
                </div>
              ) : (
                marketShare.map((entry: MarketShareEntry, idx: number) => {
                  const isLeader = idx === 0;
                  return (
                    <MobileDataCard
                      key={entry.empresa}
                      variant="compact"
                      leftIcon={
                        <span
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: "50%",
                            background: isLeader
                              ? "var(--mobile-accent, #ff5000)"
                              : "var(--mobile-divider, #efeff3)",
                            color: isLeader ? "#fff" : "var(--mobile-text-muted, #6b6b73)",
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
                      title={entry.empresa}
                      subtitle={
                        <span
                          style={{
                            display: "block",
                            height: 4,
                            borderRadius: 2,
                            background: "var(--mobile-divider, #efeff3)",
                            marginTop: 4,
                            overflow: "hidden",
                          }}
                        >
                          <span
                            style={{
                              display: "block",
                              height: "100%",
                              width: `${entry.sharePct.toFixed(1)}%`,
                              background: activeProdutoColor,
                              borderRadius: 2,
                              transition: "width 0.3s ease",
                            }}
                          />
                        </span>
                      }
                      rightSlot={
                        <div style={{ textAlign: "right" }}>
                          <div
                            style={{
                              fontSize: 14,
                              fontWeight: 700,
                              color: "var(--mobile-text, #1a1a1a)",
                            }}
                          >
                            {entry.sharePct.toFixed(1)}%
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              color: "var(--mobile-text-muted, #6b6b73)",
                            }}
                          >
                            {formatVolume(entry.volume)} m³
                          </div>
                        </div>
                      }
                    />
                  );
                })
              )}
            </div>

            {marketShare.length > 0 && (
              <div
                style={{
                  margin: "8px 16px 0",
                  fontSize: 11,
                  color: "var(--mobile-text-muted, #6b6b73)",
                  lineHeight: 1.4,
                }}
              >
                Top-15 cumulative volume: {formatVolume(totalShareVolume)} m³.
                Shares computed over the top-15 total.
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Filter drawer (Period + Segments) ────────────────────────────── */}
      <FilterDrawer
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Filters"
        onReset={() => {
          resetSegmentos();
          if (allYears.length > 0) {
            const currentYear = new Date().getFullYear();
            const startIdx = Math.max(
              0,
              allYears.findIndex((y) => y >= currentYear - 5),
            );
            setFilters({ yearRangeIdx: [startIdx, allYears.length - 1] });
          }
        }}
        onApply={() => setFilterOpen(false)}
        applyLabel="Apply"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Period */}
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                marginBottom: 8,
                color: "var(--mobile-text-muted, #6b6b73)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Period
            </div>
            {allYears.length > 0 ? (
              <PeriodSlider
                years={allYears}
                value={filters.yearRangeIdx}
                onChange={(v) =>
                  setFilters({ yearRangeIdx: v as [number, number] })
                }
              />
            ) : (
              <div style={{ fontSize: 12, color: "var(--mobile-text-muted, #6b6b73)" }}>
                No years available yet.
              </div>
            )}
            <div
              style={{
                marginTop: 8,
                fontSize: 12,
                color: "var(--mobile-text-muted, #6b6b73)",
              }}
            >
              {periodLabel}
            </div>
          </div>

          {/* Segments */}
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--mobile-text-muted, #6b6b73)",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                Segments ({filters.selectedSegmentos.length}/{filtros.segmentos.length})
              </div>
              {filters.selectedSegmentos.length < filtros.segmentos.length && (
                <button
                  type="button"
                  onClick={resetSegmentos}
                  style={{
                    background: "transparent",
                    border: 0,
                    color: "var(--mobile-accent, #ff5000)",
                    fontFamily: "inherit",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Clear
                </button>
              )}
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              {filtros.segmentos.map((s) => {
                const active = filters.selectedSegmentos.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleSegmento(s)}
                    style={{
                      minHeight: 36,
                      padding: "0 14px",
                      borderRadius: 999,
                      border: active
                        ? "1px solid var(--mobile-accent, #ff5000)"
                        : "1px solid var(--mobile-border, #e6e6ec)",
                      background: active
                        ? "rgba(255,80,0,0.10)"
                        : "var(--mobile-surface, #ffffff)",
                      color: active
                        ? "var(--mobile-accent, #ff5000)"
                        : "var(--mobile-text, #1a1a1a)",
                      fontFamily: "inherit",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s || "—"}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </FilterDrawer>

      {/* ── Export sheet ─────────────────────────────────────────────────── */}
      <ExportSheet
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        rows={exportRows}
        disabled={!hasData || exportRows.length === 0}
      />

      {/* ── Export FAB ───────────────────────────────────────────────────── */}
      <ExportFAB
        icon="download"
        label="Export"
        disabled={!hasData || exportRows.length === 0}
        ariaLabel="Export SINDICOM data"
        onClick={() => setExportOpen(true)}
        bottom="calc(var(--mobile-safe-bottom, 0px) + 16px)"
      />
    </div>
  );
}
