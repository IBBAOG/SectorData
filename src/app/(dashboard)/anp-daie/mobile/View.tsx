"use client";

// Mobile view for /anp-daie — chart-heavy archetype.
// Archetype: mockups/market-share-mobile.html (chart + filter sheet).
// Adaptation: a single MobileChart driven by an Imports / Exports tab bar,
// followed by a Top Products ranking list. Two product traces are visible at
// most by default (top-N by selected period) so the chart stays legible on
// 375px screens.
//
// Layout:
//   MobileTopBar (sticky)
//   Sticky filter chip row (period + product count + Filters button)
//   Operation MobileTabBar (Imports / Exports) — top of content
//   MobileChart — multi-line series for the active operation
//   Section header: Top Products
//   MobileDataCard list — ranking by total volume (mil m³) with brand-orange leader
//   ExportFAB — opens Tier 1 export sheet
//   FilterDrawer — period slider + product multi-select
//
// Architecture note:
//   All data comes from useAnpDaieData. This View builds its own chart traces
//   locally (line series capped to top-N products for readability) but uses
//   the shared serieRows + rankings — no RPC duplication.
//
// Binding sync rule: any meaningful change here must land in desktop/View.tsx
// in the SAME commit, or the commit must declare [mobile-only] with an
// explicit reason. See CLAUDE.md § "Dual-view (web + mobile) policy".

import { useMemo, useState } from "react";
import type { PlotData } from "plotly.js";

import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import { m3ToMilM3, LABEL } from "../../../../lib/units";
import { downloadGenericExcel } from "../../../../lib/exportExcel";
import { downloadCsv } from "../../../../lib/exportCsv";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import PeriodSlider from "../../../../components/dashboard/PeriodSlider";
import CheckList from "../../../../components/CheckList";
import type { AnpDaieRow } from "../../../../lib/rpc";

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
  useAnpDaieData,
  PRODUTO_COLORS,
  PALETTE,
  capitalize,
  colorForProduto,
  type TopCountryEntry,
} from "../useAnpDaieData";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Cap chart traces so the small viewport stays legible. */
const MOBILE_CHART_MAX_PRODUCTS = 6;

// ─── Mobile chart builder ─────────────────────────────────────────────────────
// Multi-line for the active operation. Caps to the top-N products by total
// volume so the legend / overlap stays manageable on 375px screens.

function buildMobileChart(params: {
  rows: AnpDaieRow[];
  operacao: string;
  produtos: string[];
  topProdutos: string[];
}): PlotData[] {
  const { rows, operacao, produtos, topProdutos } = params;
  if (!operacao) return [];

  const allowed = new Set(topProdutos);
  const filtered = rows.filter(
    (r) =>
      r.operacao === operacao &&
      produtos.includes(r.produto) &&
      allowed.has(r.produto),
  );
  if (!filtered.length) return [];

  const byProduto: Record<string, AnpDaieRow[]> = {};
  for (const r of filtered) (byProduto[r.produto] ??= []).push(r);

  return topProdutos
    .filter((p) => byProduto[p])
    .map((p, i) => {
      const data = byProduto[p].sort((a, b) =>
        a.ano !== b.ano ? a.ano - b.ano : a.mes - b.mes,
      );
      const color = colorForProduto(p, i);
      return {
        type: "scatter",
        mode: "lines",
        name: capitalize(p),
        x: data.map((r) => `${r.ano}-${String(r.mes).padStart(2, "0")}`),
        y: data.map((r) => m3ToMilM3(r.volume_m3 ?? 0)),
        line: { width: 1.5, color },
        hovertemplate: `${capitalize(p)}: %{y:.1f} ${LABEL.MIL_M3}<extra></extra>`,
      } as PlotData;
    });
}

// ─── Export drawer (Tier 1 — direct Excel/CSV) ────────────────────────────────

interface ExportSheetProps {
  open: boolean;
  onClose: () => void;
  rows: AnpDaieRow[];
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
          await downloadGenericExcel<AnpDaieRow>({
            rows,
            filename: "ANP-DAIE",
            title: "ANP — Open Data Imports and Exports",
            sheetName: "DAIE",
            columns: [
              { key: "ano",       header: "Year" },
              { key: "mes",       header: "Month" },
              { key: "produto",   header: "Product",     width: 32 },
              { key: "operacao",  header: "Operation",   width: 16 },
              { key: "volume_m3", header: "Volume (m³)", format: "#,##0" },
              { key: "valor_usd", header: "Value (USD)", format: "#,##0.00" },
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
              filename: "ANP-DAIE",
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
          {rows.length.toLocaleString()} rows · period + product-filtered ·
          raw m³ / USD values
        </p>
      </div>
    </FilterDrawer>
  );
}

// ─── View ─────────────────────────────────────────────────────────────────────

type OperationTab = "imports" | "exports";

export default function MobileView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-daie");

  const {
    filtros,
    serieRows,
    allYears,
    yMin,
    yMax,
    hasData,
    importOp,
    exportOp,
    loading,
    serieLoading,
    filters,
    setFilters,
    toggleProduto,
    resetProdutos,
    topImports,
    topExports,
    exportRows,
  } = useAnpDaieData();

  const [opTab, setOpTab]           = useState<OperationTab>("imports");
  const [filterOpen, setFilterOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  // Active operation tab → operation string + ranking
  const activeOp = opTab === "imports" ? importOp : exportOp;
  const activeRanking: TopCountryEntry[] =
    opTab === "imports" ? topImports : topExports;

  // Cap chart traces to top-N products for readability on small screens.
  const topProdutos = useMemo(
    () =>
      activeRanking
        .slice(0, MOBILE_CHART_MAX_PRODUCTS)
        .map((e) => e.produto),
    [activeRanking],
  );

  const chartData = useMemo(
    () =>
      buildMobileChart({
        rows: serieRows,
        operacao: activeOp,
        produtos: filters.selectedProdutos,
        topProdutos,
      }),
    [serieRows, activeOp, filters.selectedProdutos, topProdutos],
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
      <MobileTopBar title="Imports & Exports" />

      {/* ── Operation tab bar (Imports / Exports) ───────────────────────── */}
      <div style={{ paddingTop: 12, paddingBottom: 8 }}>
        <MobileTabBar
          tabs={[
            { key: "imports", label: capitalize(importOp || "Imports") },
            { key: "exports", label: capitalize(exportOp || "Exports") },
          ]}
          activeKey={opTab}
          onChange={(key) => setOpTab(key as OperationTab)}
          variant="container"
          ariaLabel="Operation"
        />
      </div>

      {/* ── Filter chip row (period + product count + Filters) ──────────── */}
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

        {/* Products chip */}
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
          {filters.selectedProdutos.length}/{filtros.produtos.length} products
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

      {/* ── Title block ─────────────────────────────────────────────────── */}
      <div style={{ padding: "0 16px 8px" }}>
        <div
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: "var(--mobile-text)",
            letterSpacing: "0.005em",
            lineHeight: 1.15,
          }}
        >
          ANP — Open Data IE
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 12,
            color: "var(--mobile-text-muted)",
            lineHeight: 1.3,
          }}
        >
          Monthly volumes of petroleum derivatives ({LABEL.MIL_M3})
        </div>
      </div>

      {/* ── Chart ───────────────────────────────────────────────────────── */}
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
          {capitalize(activeOp || (opTab === "imports" ? "Imports" : "Exports"))} —
          Monthly ({LABEL.MIL_M3})
        </div>
        {hasData && chartData.length > 0 ? (
          <MobileChart
            data={chartData}
            height={260}
            layout={{
              xaxis: { type: "date", nticks: 5 },
              yaxis: { title: { text: LABEL.MIL_M3 } },
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
            }}
          >
            {!hasData
              ? "No data available for this module at this time."
              : "No data for the selected filters."}
          </div>
        )}
      </div>

      {/* ── Top Products ranking ────────────────────────────────────────── */}
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
            Top Products
          </h2>
          <span
            style={{
              fontSize: 12,
              color: "var(--mobile-text-muted)",
              fontWeight: 600,
            }}
          >
            {capitalize(activeOp || (opTab === "imports" ? "Imports" : "Exports"))} ·{" "}
            {periodLabel}
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
          {activeRanking.length === 0 ? (
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
            activeRanking.map((entry, idx) => {
              const isLeader = idx === 0;
              const leaderTotal = activeRanking[0].totalMilM3;
              const pct = leaderTotal > 0 ? (entry.totalMilM3 / leaderTotal) * 100 : 0;
              const productColor =
                PRODUTO_COLORS[entry.produto] ??
                PALETTE[
                  filtros.produtos.indexOf(entry.produto) % PALETTE.length
                ];
              return (
                <MobileDataCard
                  key={entry.produto}
                  variant="compact"
                  leftIcon={
                    <span
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        background: isLeader
                          ? "var(--mobile-accent)"
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
                  title={capitalize(entry.produto)}
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
                            background: productColor,
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
                        {entry.totalMilM3.toLocaleString(undefined, {
                          maximumFractionDigits: 1,
                        })}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--mobile-text-muted)",
                        }}
                      >
                        {LABEL.MIL_M3}
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
          filters.selectedProdutos.length < filtros.produtos.length
            ? () => {
                resetProdutos();
              }
            : undefined
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

          {/* Products */}
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
              Products ({filters.selectedProdutos.length}/{filtros.produtos.length})
            </div>
            <CheckList
              label="Products"
              options={filtros.produtos}
              value={filters.selectedProdutos}
              onChange={(next) => {
                // Min-1 guard at drawer level: never let the list go empty.
                if (next.length === 0) return;
                setFilters({ selectedProdutos: next });
              }}
              allLabel="All"
              clearLabel="Clear"
            />
          </div>
        </div>
      </FilterDrawer>

      {/* ── Export FAB ──────────────────────────────────────────────────── */}
      <ExportFAB
        label="Export"
        onClick={() => setExportOpen(true)}
        disabled={loading || exportRows.length === 0}
        bottom="calc(var(--mobile-safe-bottom, 0px) + 24px)"
      />

      {/* ── Export sheet (Tier 1) ───────────────────────────────────────── */}
      <ExportSheet
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        rows={exportRows}
        disabled={loading || exportRows.length === 0}
      />
    </div>
  );
}
