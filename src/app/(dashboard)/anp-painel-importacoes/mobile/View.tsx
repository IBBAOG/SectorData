"use client";

// Mobile view for /anp-painel-importacoes — chart + ranking archetype.
// Archetype: mockups/market-share-mobile.html + mockups/anp-cdp-mobile.html.
//
// Layout:
//   MobileTopBar (sticky)
//   Product MobileTabBar — picks the ACTIVE product (drives both chart and
//                          the Top Distributors ranking via topProduto).
//   Sticky chip row     — period + UF count + distributor count + Filters
//   Title block         — dashboard title + sub
//   MobileChart         — single-trace monthly series for the active product
//                          (national total, in mil m³)
//   Top Distributors    — MobileDataCard list (ranking with progress bars)
//   FilterDrawer        — period slider + UF multi-select + distributor
//                          multi-select (distributor is a client-side filter)
//   ExportFAB           — opens Tier 1 export sheet (Excel + CSV)
//
// Design rationale (divergence from desktop):
//   Desktop shows the line chart with one trace per selected product. Mobile
//   simplifies to ONE product at a time, driven by the same `topProduto`
//   field used for the Top Distributors RPC. This keeps the chart legible on
//   375px screens AND ties the line series + ranking to the same product
//   (single mental model). Selecting all products on mobile would produce a
//   spaghetti chart that fails the legibility bar.
//
// Architecture note:
//   All data comes from useAnpPainelImpData. UF + distributor multi-selects
//   are new filters (mobile-only) — UF is pushed to the serie RPC; distributor
//   is applied client-side to the ranking (RPC does not accept distributors).
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
import type { AnpPainelImpSerieRow } from "../../../../lib/rpc";

import {
  MobileTopBar,
  FilterDrawer,
  MobileChart,
  MobileDataCard,
  ExportFAB,
  MobileTabBar,
} from "../../../../components/dashboard/mobile";

import {
  useAnpPainelImpData,
  PALETTE,
  TOP_DIST_COLOR,
} from "../useAnpPainelImpData";

// ─── Mobile chart builder ─────────────────────────────────────────────────────
// Single-trace monthly series for the active product (national total). Uses
// the brand-orange accent for the line so it always reads as the active product.

function buildMobileSerie(params: {
  rows: AnpPainelImpSerieRow[];
  produto: string;
  color: string;
}): PlotData[] {
  const { rows, produto, color } = params;
  if (!produto) return [];

  const filtered = rows
    .filter((r) => r.nome_produto === produto)
    .sort((a, b) => (a.ano !== b.ano ? a.ano - b.ano : a.mes - b.mes));
  if (!filtered.length) return [];

  return [
    {
      type: "scatter",
      mode: "lines",
      name: produto,
      x: filtered.map((r) => `${r.ano}-${String(r.mes).padStart(2, "0")}`),
      y: filtered.map((r) => m3ToMilM3(r.volume_m3 ?? 0)),
      line: { width: 2, color },
      hovertemplate: `${produto}: %{y:.1f} ${LABEL.MIL_M3}<extra></extra>`,
    } as PlotData,
  ];
}

// ─── Export drawer (Tier 1 — direct Excel/CSV) ────────────────────────────────

interface ExportSheetProps {
  open: boolean;
  onClose: () => void;
  rows: AnpPainelImpSerieRow[];
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
          await downloadGenericExcel<AnpPainelImpSerieRow>({
            rows,
            filename: "ANP-Imports-Panel",
            title: "ANP Panel — Distributor Imports (National Total)",
            sheetName: "Imports",
            columns: [
              { key: "ano",          header: "Year" },
              { key: "mes",          header: "Month" },
              { key: "nome_produto", header: "Product",     width: 26 },
              { key: "volume_m3",    header: "Volume (m³)", format: "#,##0" },
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
              filename: "ANP-Imports-Panel",
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
          {rows.length.toLocaleString()} rows · period + product-filtered ·
          raw m³ values
        </p>
      </div>
    </FilterDrawer>
  );
}

// ─── View ─────────────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard(
    "anp-painel-importacoes",
  );

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
    topDistributors,
    exportRows,
  } = useAnpPainelImpData();

  const [filterOpen, setFilterOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  // Color the active series line by the product's slot in the brand palette
  // (matches the swatch the user would see on desktop).
  const activeProductColor = useMemo(() => {
    if (!filters.topProduto) return PALETTE[0];
    const i = filtros.produtos.indexOf(filters.topProduto);
    return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
  }, [filters.topProduto, filtros.produtos]);

  const chartData = useMemo(
    () =>
      buildMobileSerie({
        rows: serieRows,
        produto: filters.topProduto,
        color: activeProductColor,
      }),
    [serieRows, filters.topProduto, activeProductColor],
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
      <MobileTopBar title="Distributor Imports" />

      {/* ── Product tab bar (drives chart + Top Distributors RPC) ───────── */}
      {filtros.produtos.length > 0 && (
        <div
          style={{
            paddingTop: 12,
            paddingBottom: 8,
            overflowX: "auto",
            WebkitOverflowScrolling: "touch",
          }}
        >
          <MobileTabBar
            tabs={filtros.produtos.map((p) => ({ key: p, label: p }))}
            activeKey={filters.topProduto}
            onChange={(key) => setFilters({ topProduto: key })}
            variant="container"
            ariaLabel="Active product"
          />
        </div>
      )}

      {/* ── Filter chip row (period + UF + distributor + Filters btn) ──── */}
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

        {/* UF chip */}
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
          {filters.selectedUfs.length || "All"}/{filtros.ufs.length} UFs
        </span>

        {/* Distributor chip */}
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
          {filters.selectedDistribuidores.length || "All"}/
          {filtros.distribuidores.length} dist.
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
          ANP Panel — Distributor Imports
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 12,
            color: "var(--mobile-text-muted)",
            lineHeight: 1.3,
          }}
        >
          Monthly volumes by distributor, state and product ({LABEL.MIL_M3})
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
          {filters.topProduto || "Imports"} — Monthly ({LABEL.MIL_M3})
        </div>
        {hasData && chartData.length > 0 ? (
          <MobileChart
            data={chartData}
            height={240}
            layout={{
              xaxis: { type: "date", nticks: 5 },
              yaxis: { title: { text: LABEL.MIL_M3 } },
              hovermode: "closest",
              showlegend: false,
              margin: { l: 40, r: 8, t: 4, b: 28 },
            }}
          />
        ) : (
          <div
            style={{
              height: 220,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--mobile-text-muted)",
              fontSize: 13,
              padding: "0 16px 12px",
              textAlign: "center",
            }}
          >
            {!hasData
              ? "No data available for this module at this time."
              : "No data for the selected filters."}
          </div>
        )}
      </div>

      {/* ── Top Distributors ranking ────────────────────────────────────── */}
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
            {filters.topProduto || "—"} · {periodLabel}
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
          {topDistributors.length === 0 ? (
            <div
              style={{
                padding: 20,
                textAlign: "center",
                color: "var(--mobile-text-muted)",
                fontSize: 13,
              }}
            >
              No distributors for the selected filters.
            </div>
          ) : (
            topDistributors.map((entry, idx) => {
              const isLeader = idx === 0;
              const leaderTotal = topDistributors[0].totalMilM3;
              const pct =
                leaderTotal > 0 ? (entry.totalMilM3 / leaderTotal) * 100 : 0;
              return (
                <MobileDataCard
                  key={entry.distribuidor}
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
                  title={entry.distribuidor}
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
                            background: TOP_DIST_COLOR,
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

      {/* ── Filter drawer (period + UF + distributor) ───────────────────── */}
      <FilterDrawer
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Filters"
        resetLabel="Reset"
        applyLabel="Apply"
        onReset={
          filters.selectedUfs.length > 0 ||
          filters.selectedDistribuidores.length > 0
            ? () => {
                setFilters({
                  selectedUfs:            [],
                  selectedDistribuidores: [],
                });
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

          {/* UFs */}
          {filtros.ufs.length > 0 && (
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
                States ({filters.selectedUfs.length || "All"}/
                {filtros.ufs.length})
              </div>
              <CheckList
                label="States"
                options={filtros.ufs}
                value={filters.selectedUfs}
                onChange={(next) => {
                  // Empty list = no filter (server returns all UFs aggregated).
                  // Selecting every UF is treated the same as no filter to keep
                  // the request payload minimal.
                  const isAll = next.length === filtros.ufs.length;
                  setFilters({ selectedUfs: isAll ? [] : next });
                }}
                allLabel="All"
                clearLabel="Clear"
              />
            </div>
          )}

          {/* Distributors */}
          {filtros.distribuidores.length > 0 && (
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
                Distributors ({filters.selectedDistribuidores.length || "All"}/
                {filtros.distribuidores.length})
              </div>
              <CheckList
                label="Distributors"
                options={filtros.distribuidores}
                value={filters.selectedDistribuidores}
                onChange={(next) => {
                  // Client-side filter on the Top Distributors ranking.
                  // Empty (or all-selected) = no filter.
                  const isAll = next.length === filtros.distribuidores.length;
                  setFilters({
                    selectedDistribuidores: isAll ? [] : next,
                  });
                }}
                allLabel="All"
                clearLabel="Clear"
              />
            </div>
          )}
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
