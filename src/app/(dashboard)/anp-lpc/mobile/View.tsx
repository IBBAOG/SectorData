"use client";

// Mobile view for /anp-lpc — chart-heavy archetype (closest reference:
// market-share-mobile.html / anp-daie mobile views).
//
// Layout (top → bottom):
//   MobileTopBar          (sticky liquid glass)
//   Title block           (h1 + subtitle + period badge)
//   Filter chip row       (Period + selected products + "Filters" button)
//   Product MobileTabBar  (single-product driver — selects detailProduto;
//                          also the lone trace shown in the chart for clarity)
//   MobileChart           (national average for the active product, brand
//                          orange; secondary lines for the other top products
//                          rendered in muted grey for context)
//   "Top States" ranking  (MobileDataCard rows — rank badge, UF, region pill,
//                          price R$/L|kg, bar relative to highest)
//   ExportFAB             (Tier 2 → opens same ExportModal as desktop)
//   FilterDrawer          (UF multi-select + period year-range slider +
//                          product checklist for the chart)
//
// Analyses preserved from desktop:
//   - National weekly trend line per product (chart) — exposed via the
//     MobileChart with one strong line (active product) + N muted lines.
//   - Regional breakdown — surfaced as a sortable per-UF ranking with the
//     macro-region pill (N/NE/CO/SE/S). Same UF → Region client-side rollup.
//   - Period filter (year-range slider; converts to ISO dates inside the hook).
//   - Product multi-select (limits which products appear on chart + ranking).
//   - Tier 2 export with the same active filters & live size calculator.
//
// Binding sync rule: any new filter / chart / KPI added here must also land in
// desktop/View.tsx in the same commit, OR the commit must declare [mobile-only]
// with an explicit reason. See CLAUDE.md § Dual-view policy.

import { useMemo, useState } from "react";
import type { PlotData } from "plotly.js";

import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import PeriodSlider from "../../../../components/dashboard/PeriodSlider";
import ExportModal from "../../../../components/dashboard/ExportModal";
import {
  MobileTopBar,
  FilterDrawer,
  MobileChart,
  ExportFAB,
  MobileTabBar,
  PlusIcon,
} from "../../../../components/dashboard/mobile";

import {
  useAnpLpcData,
  PRODUTO_COLORS,
  PALETTE,
  REGIAO_COLORS,
  unitForProduto,
  type UfLatestPrice,
} from "../useAnpLpcData";

// ─── Chart builder (national average — active product highlighted) ───────────

function buildMobileNationalChart(params: {
  rows: import("../../../../lib/rpc").AnpLpcNacionalRow[];
  produtos: string[];
  activeProduto: string;
}): PlotData[] {
  const { rows, produtos, activeProduto } = params;
  if (!rows.length || produtos.length === 0) return [];

  const filtered = rows.filter((r) => produtos.includes(r.produto));
  if (!filtered.length) return [];

  const byProduto: Record<string, typeof filtered> = {};
  for (const r of filtered) (byProduto[r.produto] ??= []).push(r);

  // Active product first → render order matters (last trace painted on top)
  const ordered = [
    ...produtos.filter((p) => p !== activeProduto),
    activeProduto,
  ].filter((p) => byProduto[p]?.length);

  return ordered.map((p, i) => {
    const data = byProduto[p].sort((a, b) =>
      a.data_fim.localeCompare(b.data_fim),
    );
    const isActive = p === activeProduto;
    const color = isActive
      ? "#ff5000"
      : (PRODUTO_COLORS[p] ?? PALETTE[i % PALETTE.length]) + "55";
    return {
      type: "scatter",
      mode: "lines",
      name: p,
      x: data.map((r) => r.data_fim),
      y: data.map((r) => r.preco_medio_venda),
      line: { width: isActive ? 2.6 : 1.2, color },
      hovertemplate: `${p}: R$ %{y:.3f}<extra></extra>`,
    } as PlotData;
  });
}

// ─── UF ranking card ──────────────────────────────────────────────────────────

function UfPriceCard({
  row,
  unit,
}: {
  row: UfLatestPrice;
  unit: "kg" | "L";
}) {
  const regColor = REGIAO_COLORS[row.regiao] ?? "var(--mobile-text-faint)";

  return (
    <div
      style={{
        minHeight: 72,
        padding: "12px 14px",
        display: "grid",
        gridTemplateColumns: "32px 1fr auto",
        gridTemplateRows: "auto auto",
        columnGap: 12,
        rowGap: 4,
        alignItems: "center",
        borderBottom: "1px solid var(--mobile-divider)",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      {/* Rank badge */}
      <div
        style={{
          gridRow: "1 / 3",
          width: 28,
          height: 28,
          borderRadius: 8,
          background:
            row.rank === 1 ? "var(--mobile-accent)" : "var(--mobile-divider)",
          color: row.rank === 1 ? "#fff" : "var(--mobile-text-muted)",
          fontSize: 13,
          fontWeight: 700,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow:
            row.rank === 1 ? "0 2px 6px rgba(255,80,0,0.30)" : "none",
          flexShrink: 0,
        }}
      >
        {row.rank}
      </div>

      {/* UF + Region pill */}
      <div
        style={{
          fontSize: 16,
          fontWeight: 600,
          color: "var(--mobile-text)",
          lineHeight: 1.1,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          whiteSpace: "nowrap",
        }}
      >
        <span>{row.estado}</span>
        <span
          aria-label={`Region ${row.regiao}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "1px 8px",
            borderRadius: 999,
            background: regColor + "22",
            color: regColor,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          {row.regiao}
        </span>
      </div>

      {/* Price */}
      <div
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: "var(--mobile-text)",
          lineHeight: 1.1,
          fontVariantNumeric: "tabular-nums",
          textAlign: "right",
        }}
      >
        R$ {row.preco.toFixed(3)}
      </div>

      {/* Bar */}
      <div
        style={{
          height: 4,
          borderRadius: 2,
          background: "var(--mobile-divider)",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            bottom: 0,
            width: `${row.barWidth}%`,
            background:
              row.rank === 1
                ? "var(--mobile-accent)"
                : "var(--mobile-text-faint)",
            borderRadius: 2,
            opacity: row.rank === 1 ? 1 : 0.55,
          }}
        />
      </div>

      {/* Unit suffix */}
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "var(--mobile-text-muted)",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        per {unit}
      </div>
    </div>
  );
}

// ─── Filter chips strip ───────────────────────────────────────────────────────

function ActiveChips({
  periodLabel,
  productCount,
  totalProducts,
  onOpenFilters,
}: {
  periodLabel: string | null;
  productCount: number;
  totalProducts: number;
  onOpenFilters: () => void;
}) {
  const chipBase: React.CSSProperties = {
    flexShrink: 0,
    minHeight: 32,
    padding: "0 12px",
    borderRadius: 999,
    border: "1px solid var(--mobile-border)",
    background: "var(--mobile-surface)",
    color: "var(--mobile-text)",
    fontSize: 13,
    fontWeight: 600,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    whiteSpace: "nowrap",
    fontFamily: "Arial, Helvetica, sans-serif",
  };

  return (
    <nav
      aria-label="Active filters"
      style={{
        position: "sticky",
        top: "var(--mobile-topbar-h)",
        zIndex: 25,
        height: 52,
        background: "var(--mobile-glass-bg)",
        WebkitBackdropFilter: "var(--mobile-glass-blur)",
        backdropFilter: "var(--mobile-glass-blur)",
        borderBottom: "1px solid var(--mobile-glass-border)",
        display: "flex",
        alignItems: "center",
        overflowX: "auto",
        overflowY: "hidden",
        gap: 8,
        padding: "0 16px",
        WebkitOverflowScrolling: "touch",
        scrollbarWidth: "none",
      }}
    >
      {periodLabel && (
        <div style={{ ...chipBase, color: "var(--mobile-text-muted)" }}>
          {periodLabel}
        </div>
      )}

      <div style={chipBase}>
        {productCount} of {totalProducts} products
      </div>

      <button
        type="button"
        onClick={onOpenFilters}
        style={{
          flexShrink: 0,
          minHeight: 32,
          padding: "0 14px",
          borderRadius: 999,
          border: "1px solid var(--mobile-accent)",
          background: "transparent",
          color: "var(--mobile-accent)",
          fontSize: 13,
          fontWeight: 700,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          cursor: "pointer",
          whiteSpace: "nowrap",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <PlusIcon size={14} strokeWidth={2.5} />
        Filters
      </button>
    </nav>
  );
}

// ─── Pill checkbox row (inside FilterDrawer) ──────────────────────────────────

function CheckPills({
  options,
  value,
  onToggle,
  swatch,
}: {
  options: string[];
  value: string[];
  onToggle: (opt: string) => void;
  swatch?: (opt: string) => string;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {options.map((opt) => {
        const on = value.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            style={{
              minHeight: 36,
              padding: "0 12px",
              borderRadius: 999,
              border: `1px solid ${on ? "var(--mobile-accent)" : "var(--mobile-border)"}`,
              background: on ? "var(--mobile-accent)" : "var(--mobile-surface)",
              color: on ? "#fff" : "var(--mobile-text)",
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              boxShadow: on ? "0 2px 6px rgba(255,80,0,0.25)" : "none",
              transition: "background 0.15s, border-color 0.15s, color 0.15s",
            }}
          >
            {swatch && (
              <span
                aria-hidden="true"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: swatch(opt),
                  display: "inline-block",
                  opacity: on ? 1 : 0.85,
                }}
              />
            )}
            {opt}
          </button>
        );
      })}
    </div>
  );
}

// ─── View ─────────────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-lpc");

  const lpc = useAnpLpcData();

  // Local drawer state (committed into the hook on Apply)
  const [drawerOpen, setDrawerOpen]         = useState(false);
  const [drawerProdutos, setDrawerProdutos] = useState<string[]>([]);
  const [drawerEstados, setDrawerEstados]   = useState<string[]>([]);
  const [drawerRange, setDrawerRange]       = useState<[number, number]>([0, 0]);

  const openDrawer = () => {
    setDrawerProdutos(lpc.selectedProdutos);
    setDrawerEstados(lpc.exportEstados);
    setDrawerRange(lpc.yearRange);
    setDrawerOpen(true);
  };

  const handleDrawerApply = () => {
    // Enforce min 1 product
    const products =
      drawerProdutos.length > 0 ? drawerProdutos : [lpc.filtros.produtos[0]].filter(Boolean);
    lpc.setSelectedProdutos(products);
    if (!products.includes(lpc.detailProduto) && products[0]) {
      lpc.setDetailProduto(products[0]);
    }
    lpc.setExportEstados(drawerEstados);
    lpc.setYearRange(drawerRange);
    setDrawerOpen(false);
  };

  const handleDrawerReset = () => {
    setDrawerProdutos(lpc.filtros.produtos);
    setDrawerEstados([]);
    setDrawerRange([0, lpc.allYears.length - 1]);
  };

  const toggleDrawerProduto = (p: string) => {
    setDrawerProdutos((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );
  };

  const toggleDrawerEstado = (e: string) => {
    setDrawerEstados((prev) =>
      prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e],
    );
  };

  // Hero chart traces
  const heroTraces = useMemo<PlotData[]>(() => {
    if (lpc.initialLoading) return [];
    return buildMobileNationalChart({
      rows: lpc.nacionalRows,
      produtos: lpc.selectedProdutos,
      activeProduto: lpc.detailProduto,
    });
  }, [
    lpc.initialLoading,
    lpc.nacionalRows,
    lpc.selectedProdutos,
    lpc.detailProduto,
  ]);

  // Period badge
  const periodBadge =
    lpc.hasYears && lpc.yMin != null && lpc.yMax != null
      ? lpc.yMin === lpc.yMax
        ? `${lpc.yMin}`
        : `${lpc.yMin}–${lpc.yMax}`
      : null;

  if (visLoading || !visible) return <></>;

  const unit = unitForProduto(lpc.detailProduto);

  // Limit ranking to top 15 to keep the screen scannable
  const topUfRows = lpc.ufLatestPrices.slice(0, 15);

  const latestLabel = lpc.latestDate
    ? (() => {
        const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const d = lpc.latestDate;
        return `${MONTHS[parseInt(d.slice(5, 7), 10) - 1]} ${d.slice(8, 10)}, ${d.slice(0, 4)}`;
      })()
    : null;

  return (
    <div
      style={{
        maxWidth: 428,
        margin: "0 auto",
        minHeight: "100dvh",
        background: "var(--mobile-bg)",
        paddingBottom: "calc(72px + var(--mobile-safe-bottom))",
        position: "relative",
      }}
    >
      {/* Top bar */}
      <MobileTopBar
        title={
          <span style={{ fontWeight: 700, letterSpacing: "0.04em" }}>
            SECTORDATA
            <span style={{ color: "var(--mobile-accent)" }}>.</span>
          </span>
        }
        showAvatar
        avatarInitials="SB"
        avatarLabel="SectorData user"
      />

      {/* Title block */}
      <section style={{ padding: "16px 16px 12px" }}>
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 700,
            color: "var(--mobile-text)",
            letterSpacing: "0.005em",
            lineHeight: 1.15,
            fontFamily: "Arial, Helvetica, sans-serif",
          }}
        >
          ANP LPC
        </h1>
        <p
          style={{
            margin: "4px 0 0",
            fontSize: 13,
            color: "var(--mobile-text-muted)",
            lineHeight: 1.3,
            fontFamily: "Arial, Helvetica, sans-serif",
          }}
        >
          Weekly fuel prices at gas stations (weighted by surveyed stations)
        </p>
        {periodBadge && (
          <span
            aria-label="Period"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              marginTop: 10,
              padding: "4px 10px",
              borderRadius: 999,
              background: "var(--mobile-accent-soft)",
              color: "var(--mobile-accent)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              fontFamily: "Arial, Helvetica, sans-serif",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--mobile-accent)",
                display: "inline-block",
              }}
            />
            {periodBadge}
          </span>
        )}
      </section>

      {/* Sticky filter chip row */}
      <ActiveChips
        periodLabel={periodBadge}
        productCount={lpc.selectedProdutos.length}
        totalProducts={lpc.filtros.produtos.length}
        onOpenFilters={openDrawer}
      />

      {/* Initial barrel */}
      {lpc.initialLoading ? (
        <div style={{ padding: "24px 16px" }}>
          <BarrelLoading bare />
        </div>
      ) : (
        <>
          {/* Product MobileTabBar — drives the active line + ranking */}
          {lpc.filtros.produtos.length > 0 && (
            <div style={{ padding: "8px 0 12px" }}>
              <div
                style={{
                  overflowX: "auto",
                  overflowY: "hidden",
                  scrollbarWidth: "none",
                  WebkitOverflowScrolling: "touch",
                  padding: "0 16px",
                }}
              >
                <MobileTabBar
                  tabs={lpc.filtros.produtos.map((p) => ({
                    key: p,
                    label: p,
                  }))}
                  activeKey={lpc.detailProduto}
                  onChange={(k) => lpc.setDetailProduto(k)}
                  variant="underline"
                  ariaLabel="Product"
                />
              </div>
            </div>
          )}

          {/* Hero chart card */}
          <div style={{ padding: "0 16px" }}>
            <div
              style={{
                background: "var(--mobile-surface)",
                border: "1px solid var(--mobile-divider)",
                borderRadius: 16,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "14px 14px 6px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: "var(--mobile-text)",
                    fontFamily: "Arial, Helvetica, sans-serif",
                  }}
                >
                  National avg — {lpc.detailProduto}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--mobile-text-muted)",
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    fontFamily: "Arial, Helvetica, sans-serif",
                  }}
                >
                  R$/{unit}
                </div>
              </div>

              {heroTraces.length > 0 ? (
                <MobileChart
                  data={heroTraces}
                  height={280}
                  layout={{
                    xaxis: { type: "date" as const, tickformat: "%b %y", nticks: 6 },
                    hovermode: "x unified",
                  }}
                />
              ) : (
                <div
                  style={{
                    height: 280,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--mobile-text-muted)",
                    fontSize: 13,
                    fontFamily: "Arial, Helvetica, sans-serif",
                  }}
                >
                  No data for the selected filters.
                </div>
              )}
            </div>
          </div>

          {/* Per-UF ranking */}
          <div style={{ padding: "16px 16px 0" }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                paddingBottom: 10,
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: 17,
                  fontWeight: 700,
                  color: "var(--mobile-text)",
                  fontFamily: "Arial, Helvetica, sans-serif",
                }}
              >
                Top States — {lpc.detailProduto}
              </h2>
              {latestLabel && (
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--mobile-text-muted)",
                    fontFamily: "Arial, Helvetica, sans-serif",
                  }}
                >
                  {latestLabel}
                </span>
              )}
            </div>

            {topUfRows.length > 0 ? (
              <div
                style={{
                  background: "var(--mobile-surface)",
                  border: "1px solid var(--mobile-divider)",
                  borderRadius: 16,
                  overflow: "hidden",
                }}
              >
                {topUfRows.map((row) => (
                  <UfPriceCard key={row.estado} row={row} unit={unit} />
                ))}
              </div>
            ) : (
              <div
                style={{
                  padding: 16,
                  color: "var(--mobile-text-muted)",
                  fontSize: 13,
                  fontFamily: "Arial, Helvetica, sans-serif",
                }}
              >
                No data available.
              </div>
            )}
          </div>
        </>
      )}

      {/* Export FAB */}
      <ExportFAB
        icon="download"
        onClick={lpc.openExportModal}
        disabled={lpc.initialLoading || lpc.excelLoading || lpc.csvLoading}
        ariaLabel="Export data"
      />

      {/* Filter drawer */}
      <FilterDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Filters"
        onReset={handleDrawerReset}
        onApply={handleDrawerApply}
        applyLabel="Apply filters"
        resetLabel="Reset"
      >
        {/* Period */}
        <div style={{ marginBottom: 22 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--mobile-text-muted)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              marginBottom: 10,
              fontFamily: "Arial, Helvetica, sans-serif",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>Period</span>
            {lpc.hasYears && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--mobile-text-faint)",
                  letterSpacing: 0,
                  textTransform: "none",
                }}
              >
                {lpc.allYears[drawerRange[0]]}
                {drawerRange[0] !== drawerRange[1] && ` – ${lpc.allYears[drawerRange[1]]}`}
              </span>
            )}
          </div>
          {lpc.hasYears && (
            <PeriodSlider
              years={lpc.allYears}
              value={drawerRange}
              onChange={setDrawerRange}
            />
          )}
        </div>

        {/* Products */}
        <div style={{ marginBottom: 22 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--mobile-text-muted)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              marginBottom: 10,
              fontFamily: "Arial, Helvetica, sans-serif",
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>Products</span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--mobile-text-faint)",
                textTransform: "none",
                letterSpacing: 0,
              }}
            >
              {drawerProdutos.length} of {lpc.filtros.produtos.length}
            </span>
          </div>
          <CheckPills
            options={lpc.filtros.produtos}
            value={drawerProdutos}
            onToggle={toggleDrawerProduto}
            swatch={(p) => {
              const i = lpc.filtros.produtos.indexOf(p);
              return PRODUTO_COLORS[p] ?? PALETTE[i % PALETTE.length];
            }}
          />
        </div>

        {/* States (UF) */}
        {lpc.filtros.estados.length > 0 && (
          <div style={{ marginBottom: 22 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--mobile-text-muted)",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                marginBottom: 10,
                fontFamily: "Arial, Helvetica, sans-serif",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>States (for export)</span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--mobile-text-faint)",
                  textTransform: "none",
                  letterSpacing: 0,
                }}
              >
                {drawerEstados.length > 0
                  ? `${drawerEstados.length} of ${lpc.filtros.estados.length}`
                  : "All"}
              </span>
            </div>
            <CheckPills
              options={lpc.filtros.estados}
              value={drawerEstados}
              onToggle={toggleDrawerEstado}
            />
          </div>
        )}
      </FilterDrawer>

      {/* Export Modal (same Tier 2 contract as desktop) */}
      <ExportModal
        open={lpc.exportOpen}
        onClose={lpc.closeExportModal}
        title="Export — ANP LPC"
        datasetKey="anp_lpc"
        currentFilters={lpc.exportFilters}
        countFetcher={lpc.fetchExportCount}
        excelBusy={lpc.excelLoading}
        csvBusy={lpc.csvLoading}
        loadingLabel={lpc.excelLoading ? "Generating Excel..." : "Downloading CSV..."}
        onExportExcel={lpc.onExportExcel}
        onExportCsv={lpc.onExportCsv}
        filters={
          <div
            style={{
              fontFamily: "Arial, Helvetica, sans-serif",
              fontSize: 13,
              color: "var(--mobile-text-muted)",
            }}
          >
            Period, products and states from the filter drawer apply to this
            export.
          </div>
        }
      />
    </div>
  );
}
