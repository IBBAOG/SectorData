"use client";

/**
 * Mobile view — /anp-precos-produtores (≤768px).
 *
 * Layout (chart-heavy archetype, per mockups/market-share-mobile.html):
 *   MobileTopBar        (sticky liquid-glass)
 *   Title block         (h1 + subtitle + period badge)
 *   Product MobileTabBar (horizontal scroll, one tab per product)
 *   Filter chip row     (sticky — active region chips + "+ Filters" button)
 *   Hero MobileChart    (per-region lines, brand orange for highest-price region)
 *   2-column legend
 *   MobileDataCard list (current price per region, ranked by price level)
 *   ExportFAB           (floating download button)
 *   FilterDrawer        (region multi-select + period slider)
 *
 * Analyses preserved from desktop:
 *   - Multi-region line chart (all 5 regions, per-region colour coding)
 *   - Region filter (min 1 always selected)
 *   - Product selector (all products from filtros.produtos)
 *   - Period range slider (set once at mount, not reset on product change)
 *   - Export (Tier 1 — direct download via FAB)
 *
 * Binding sync rule: any meaningful change here must land in
 * ../desktop/View.tsx in the SAME commit, or the commit message must
 * declare `[mobile-only]` with an explicit reason.
 */

import { useState, useMemo } from "react";
import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import {
  MobileTopBar,
  FilterDrawer,
  MobileChart,
  MobileDataCard,
  ExportFAB,
  MobileTabBar,
  CloseIcon,
  PlusIcon,
} from "../../../../components/dashboard/mobile";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import PeriodSlider from "../../../../components/dashboard/PeriodSlider";
import { downloadGenericExcel } from "../../../../lib/exportExcel";
import { downloadCsv } from "../../../../lib/exportCsv";
import {
  useAnpPrecosProdutoresData,
  ALL_REGIOES,
  REGIAO_COLOR,
  buildMobileChart,
} from "../useAnpPrecosProdutoresData";
import type { AnpPprodutoresRow } from "../useAnpPrecosProdutoresData";

// ─── CheckPills (reusable local pill multi-select) ────────────────────────────

function CheckPills({
  options,
  value,
  onChange,
  swatchMap,
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  swatchMap?: Record<string, string>;
}) {
  const isOn = (opt: string) => value.includes(opt);

  const toggle = (opt: string) => {
    if (isOn(opt)) {
      // Preserve min-1 invariant
      if (value.length > 1) onChange(value.filter((v) => v !== opt));
    } else {
      onChange([...value, opt]);
    }
  };

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => toggle(opt)}
          style={{
            minHeight: 36,
            padding: "0 12px 0 10px",
            borderRadius: 999,
            border: `1px solid ${isOn(opt) ? "var(--mobile-accent)" : "var(--mobile-border)"}`,
            background: isOn(opt) ? "var(--mobile-accent)" : "var(--mobile-surface)",
            color: isOn(opt) ? "#fff" : "var(--mobile-text)",
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            boxShadow: isOn(opt) ? "0 2px 6px rgba(255,80,0,0.25)" : "none",
            transition: "background 0.15s, border-color 0.15s, color 0.15s",
          }}
        >
          {swatchMap && swatchMap[opt] && (
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: isOn(opt) ? "rgba(255,255,255,0.8)" : swatchMap[opt],
                flexShrink: 0,
              }}
            />
          )}
          {opt}
        </button>
      ))}
    </div>
  );
}

// ─── RegionCard — price ranking row ──────────────────────────────────────────

function RegionCard({
  regiao,
  preco,
  date,
  unidade,
  isTop,
  sparkline,
}: {
  regiao: string;
  preco: number | null;
  date: string | null;
  unidade: string;
  isTop: boolean;
  sparkline: number[];
}) {
  const color = REGIAO_COLOR[regiao] ?? "#999";

  const dateLabel = useMemo(() => {
    if (!date) return null;
    try {
      const MONTHS = [
        "Jan","Feb","Mar","Apr","May","Jun",
        "Jul","Aug","Sep","Oct","Nov","Dec",
      ];
      const m = parseInt(date.slice(5, 7), 10) - 1;
      return `wk of ${MONTHS[m]} ${date.slice(0, 4)}`;
    } catch {
      return date;
    }
  }, [date]);

  return (
    <MobileDataCard
      leftIcon={
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: isTop ? "var(--mobile-accent)" : color,
            display: "inline-block",
            boxShadow: isTop ? "0 2px 6px rgba(255,80,0,0.35)" : "none",
          }}
        />
      }
      title={regiao}
      subtitle={dateLabel ?? undefined}
      sparkline={sparkline.length >= 2 ? sparkline : undefined}
      sparklineColor={isTop ? "var(--mobile-accent)" : color}
      rightSlot={
        preco !== null ? (
          <span
            style={{
              fontSize: 17,
              fontWeight: 700,
              color: isTop ? "var(--mobile-accent)" : "var(--mobile-text)",
              fontFamily: "Arial, Helvetica, sans-serif",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            R$ {preco.toFixed(4)}
            <span
              style={{
                display: "block",
                fontSize: 10,
                fontWeight: 600,
                color: "var(--mobile-text-muted)",
                textAlign: "right",
              }}
            >
              /{unidade}
            </span>
          </span>
        ) : (
          <span
            style={{
              fontSize: 14,
              color: "var(--mobile-text-muted)",
              fontFamily: "Arial, Helvetica, sans-serif",
            }}
          >
            —
          </span>
        )
      }
    />
  );
}

// ─── Filter chip row ──────────────────────────────────────────────────────────

function ActiveChips({
  selectedRegioes,
  onOpenFilters,
  onRemoveRegiao,
}: {
  selectedRegioes: string[];
  onOpenFilters: () => void;
  onRemoveRegiao: (r: string) => void;
}) {
  const X = <CloseIcon size={10} strokeWidth={2.5} />;

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
      {selectedRegioes.map((r) => (
        <div
          key={r}
          style={{
            flexShrink: 0,
            minHeight: 32,
            padding: "0 8px 0 10px",
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
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: REGIAO_COLOR[r] ?? "#999",
              flexShrink: 0,
            }}
          />
          {r}
          {selectedRegioes.length > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemoveRegiao(r);
              }}
              style={{
                width: 18,
                height: 18,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "50%",
                background: "var(--mobile-row-press)",
                color: "var(--mobile-text-muted)",
                border: 0,
                cursor: "pointer",
                flexShrink: 0,
                padding: 0,
              }}
              aria-label={`Remove ${r}`}
            >
              {X}
            </button>
          )}
        </div>
      ))}

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

// ─── Mobile View ──────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard(
    "anp-precos-produtores",
  );

  const data = useAnpPrecosProdutoresData();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerRegioes, setDrawerRegioes] = useState<string[]>(ALL_REGIOES);
  const [exportLoading, setExportLoading] = useState(false);

  const openDrawer = () => {
    setDrawerRegioes([...data.selectedRegioes]);
    setDrawerOpen(true);
  };

  const handleDrawerApply = () => {
    // Ensure min-1 invariant before applying
    const next =
      drawerRegioes.length > 0 ? drawerRegioes : data.selectedRegioes;
    data.setRegioes(next);
    setDrawerOpen(false);
  };

  const handleDrawerReset = () => {
    setDrawerRegioes(ALL_REGIOES);
  };

  // Product tabs from filtros
  const productTabs = useMemo(
    () =>
      data.filtros.produtos.map((p) => ({
        key: p,
        label: p,
      })),
    [data.filtros.produtos],
  );

  // Mobile chart traces
  const mobileTraces = useMemo(
    () => buildMobileChart(data.serieRows, data.selectedRegioes),
    [data.serieRows, data.selectedRegioes],
  );

  // Sparkline per region: last 52 points of weekly series, sorted
  const sparklineByRegiao = useMemo(() => {
    const map: Record<string, number[]> = {};
    for (const r of ALL_REGIOES) {
      const regionRows = data.serieRows
        .filter((row) => row.regiao === r)
        .sort((a, b) => a.data_inicio.localeCompare(b.data_inicio));
      map[r] = regionRows
        .slice(-52)
        .map((row) => row.preco ?? 0);
    }
    return map;
  }, [data.serieRows]);

  // Period badge
  const periodBadge = useMemo(() => {
    if (data.allYears.length === 0) return null;
    const start = data.allYears[data.yearRange[0]];
    const end = data.allYears[data.yearRange[1]];
    if (!start || !end) return null;
    return `${start} – ${end}`;
  }, [data.allYears, data.yearRange]);

  const fmtLabel = (n: number) => String(n);

  if (visLoading || !visible) return <></>;

  return (
    <div
      style={{
        maxWidth: 428,
        margin: "0 auto",
        minHeight: "100dvh",
        background: "var(--mobile-bg)",
        paddingBottom: "calc(16px + var(--mobile-safe-bottom))",
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
        avatarInitials="SD"
        avatarLabel="SectorData user"
      />

      {/* Title block */}
      <section style={{ padding: "16px 16px 12px" }}>
        <h1
          style={{
            margin: 0,
            fontSize: 20,
            fontWeight: 700,
            color: "var(--mobile-text)",
            letterSpacing: "0.005em",
            lineHeight: 1.15,
            fontFamily: "Arial, Helvetica, sans-serif",
          }}
        >
          Producer Prices
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
          Weekly weighted-average prices — producers &amp; importers
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

      {/* Product tab bar (scrollable) */}
      {productTabs.length > 0 && (
        <div style={{ paddingBottom: 12, overflowX: "auto" }}>
          <MobileTabBar
            tabs={productTabs}
            activeKey={data.selectedProduto}
            onChange={(key) => data.setProduto(key)}
            variant="underline"
            ariaLabel="Product selection"
          />
        </div>
      )}

      {/* Active filter chips */}
      <ActiveChips
        selectedRegioes={data.selectedRegioes}
        onOpenFilters={openDrawer}
        onRemoveRegiao={(r) => data.toggleRegiao(r)}
      />

      {/* Main content */}
      {data.loading ? (
        <div style={{ padding: "32px 16px" }}>
          <BarrelLoading bare />
        </div>
      ) : (
        <>
          {/* Hero chart card */}
          <div style={{ padding: "16px 16px 0" }}>
            <div
              style={{
                background: "var(--mobile-surface)",
                border: "1px solid var(--mobile-divider)",
                borderRadius: 16,
                overflow: "hidden",
              }}
            >
              {/* Chart header */}
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
                  Price by region
                </div>
                {data.serieLoading && (
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
                    Updating…
                  </div>
                )}
              </div>

              {/* Chart */}
              <div style={{ opacity: data.serieLoading ? 0.5 : 1, transition: "opacity 0.2s" }}>
                {mobileTraces.length > 0 ? (
                  <MobileChart
                    data={mobileTraces}
                    height={260}
                    layout={{
                      yaxis: {
                        title: { text: `R$ / ${data.unidade}` },
                        tickprefix: "R$ ",
                      },
                      xaxis: {
                        type: "date" as const,
                        tickformat: "%Y",
                        nticks: 5,
                      },
                      hovermode: "x unified",
                      showlegend: false,
                    }}
                  />
                ) : (
                  <div
                    style={{
                      height: 260,
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

              {/* 2-column legend */}
              {data.selectedRegioes.length > 0 && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, 1fr)",
                    gap: "4px 12px",
                    padding: "8px 14px 14px",
                  }}
                >
                  {data.selectedRegioes.map((r) => (
                    <div
                      key={r}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 12,
                        color: "var(--mobile-text-muted)",
                        fontWeight: 600,
                        minHeight: 22,
                        fontFamily: "Arial, Helvetica, sans-serif",
                      }}
                    >
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 2,
                          background: REGIAO_COLOR[r] ?? "#999",
                          flexShrink: 0,
                        }}
                      />
                      {r}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Per-region price ranking */}
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
                Latest price by region
              </h2>
              <span
                style={{
                  fontSize: 12,
                  color: "var(--mobile-text-muted)",
                  fontFamily: "Arial, Helvetica, sans-serif",
                }}
              >
                Ranked by price
              </span>
            </div>

            {data.regionStats.length > 0 ? (
              <div
                style={{
                  background: "var(--mobile-surface)",
                  border: "1px solid var(--mobile-divider)",
                  borderRadius: 16,
                  overflow: "hidden",
                  opacity: data.serieLoading ? 0.5 : 1,
                  transition: "opacity 0.2s",
                }}
              >
                {data.regionStats
                  .filter((s) => data.selectedRegioes.includes(s.regiao))
                  .map((stat, idx) => (
                    <RegionCard
                      key={stat.regiao}
                      regiao={stat.regiao}
                      preco={stat.latestPreco}
                      date={stat.latestDate}
                      unidade={data.unidade}
                      isTop={idx === 0}
                      sparkline={sparklineByRegiao[stat.regiao] ?? []}
                    />
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
        onClick={async () => {
          if (exportLoading || data.serieRows.length === 0) return;
          setExportLoading(true);
          try {
            await downloadGenericExcel({
              rows: data.serieRows as unknown as Record<string, unknown>[],
              filename: "ANP-Producer-Prices",
              title: `ANP — Producer and Importer Prices — ${data.selectedProduto}`,
              sheetName: "Prices",
              columns: [
                { key: "data_inicio", header: "Start" },
                { key: "data_fim",    header: "End" },
                { key: "produto",     header: "Product", width: 28 },
                { key: "regiao",      header: "Region",  width: 16 },
                { key: "preco",       header: "Price",   format: "0.0000" },
                { key: "unidade",     header: "Unit" },
              ],
            });
          } catch (e) {
            console.error("Mobile Excel export failed", e);
            // Fallback to CSV
            downloadCsv({
              rows: data.serieRows as unknown as Record<string, unknown>[],
              filename: "ANP-Producer-Prices",
            });
          } finally {
            setExportLoading(false);
          }
        }}
        disabled={exportLoading || data.loading || data.serieRows.length === 0}
        ariaLabel="Export data"
        bottom="calc(20px + var(--mobile-safe-bottom))"
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
        footerHint={
          drawerRegioes.length > 0
            ? `${drawerRegioes.length} region${drawerRegioes.length > 1 ? "s" : ""}`
            : undefined
        }
      >
        {/* Region multi-select */}
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
            <span>Region</span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--mobile-text-faint)",
                textTransform: "none",
                letterSpacing: 0,
              }}
            >
              {drawerRegioes.length === ALL_REGIOES.length
                ? "All"
                : `${drawerRegioes.length} of ${ALL_REGIOES.length}`}
            </span>
          </div>
          <CheckPills
            options={ALL_REGIOES}
            value={drawerRegioes}
            onChange={(v) => {
              // Keep min-1 in the drawer too
              if (v.length > 0) setDrawerRegioes(v);
            }}
            swatchMap={REGIAO_COLOR}
          />
        </div>

        {/* Period slider */}
        {data.allYears.length > 0 && (
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
              {periodBadge && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--mobile-text-faint)",
                    textTransform: "none",
                    letterSpacing: 0,
                  }}
                >
                  {periodBadge}
                </span>
              )}
            </div>
            <PeriodSlider
              years={data.allYears}
              value={data.yearRange}
              onChange={data.setYearRange}
            />
          </div>
        )}
      </FilterDrawer>
    </div>
  );
}
