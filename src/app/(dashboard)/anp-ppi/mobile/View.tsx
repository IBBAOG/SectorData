"use client";

// Mobile view for /anp-ppi.
//
// Structure (top to bottom):
//   MobileTopBar — "ANP — PPI" + filter button
//   MobileTabBar — product tab bar (Diesel / Gasoline / Jet Fuel / LPG)
//   MobileChart  — national average line for the active product tab (brand
//                  orange, all other products dimmed for context)
//   MobileChart  — per-location lines for the active product (detail chart)
//   MobileDataCard list — latest price per location
//   ExportFAB    — floating export action
//   FilterDrawer — period slider + location (informational — location series
//                  follows detailProduto which is the active tab)
//
// Analysis preserved (identical to desktop):
//   • National average PPI time series by product
//   • Per-location PPI time series for selected product
//   • Period range filter
//   • Product tab drives both charts simultaneously
//   • Excel + CSV export of national average series
//
// Binding sync rule: meaningful changes here must land in desktop/View.tsx in
// the SAME commit, or declare [mobile-only] with an explicit reason.

import { useMemo, useState } from "react";
import type { PlotData } from "plotly.js";

import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import PeriodSlider from "../../../../components/dashboard/PeriodSlider";
import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import { downloadGenericExcel } from "../../../../lib/exportExcel";
import { downloadCsv } from "../../../../lib/exportCsv";
import type { AnpPpiSerieRow, AnpPpiLocaisRow } from "../../../../lib/rpc";

import {
  MobileTopBar,
  MobileTabBar,
  FilterDrawer,
  MobileChart,
  MobileDataCard,
  ExportFAB,
} from "../../../../components/dashboard/mobile";
import type { MobileTabBarTab } from "../../../../components/dashboard/mobile";

import {
  useAnpPpiData,
  PRODUTO_INFO,
  ALL_PRODUTOS,
} from "../useAnpPpiData";

// ── Chart helpers ─────────────────────────────────────────────────────────────

// Palette for per-location lines (matches desktop)
const LOCATION_PALETTE = [
  "#E53935","#1E88E5","#43A047","#FB8C00","#8E24AA",
  "#00ACC1","#D81B60","#6D4C41","#F4511E","#039BE5",
  "#7CB342","#FFB300","#546E7A","#AB47BC","#26A69A",
  "#EC407A",
];

function buildMobileMediaTraces(
  rows: AnpPpiSerieRow[],
  activeProduto: string,
  yearRange: [number, number],
  allYears: number[],
): PlotData[] {
  if (!allYears.length || !rows.length) return [];
  const yMin = allYears[yearRange[0]];
  const yMax = allYears[yearRange[1]];

  const filtered = rows.filter((r) => {
    if (!r.data_fim) return false;
    const year = parseInt(r.data_fim.slice(0, 4));
    return year >= yMin && year <= yMax;
  });

  const byProduto: Record<string, AnpPpiSerieRow[]> = {};
  for (const r of filtered) (byProduto[r.produto] ??= []).push(r);

  // Active product gets brand orange + full opacity; others get muted grey
  return ALL_PRODUTOS.filter((p) => byProduto[p]).map((p) => {
    const info = PRODUTO_INFO[p];
    const isActive = p === activeProduto;
    const data = byProduto[p].sort((a, b) => a.data_fim.localeCompare(b.data_fim));
    return {
      type: "scatter",
      mode: "lines",
      name: info?.label ?? p,
      x: data.map((r) => r.data_fim),
      y: data.map((r) => r.preco_medio),
      line: {
        width: isActive ? 2.5 : 1,
        color: isActive ? "#FF5000" : "rgba(180,180,180,0.5)",
      },
      hovertemplate: isActive
        ? `R$ %{y:.4f}<extra>${info?.label ?? p}</extra>`
        : `<extra></extra>`, // suppress hover for background lines
    } as PlotData;
  });
}

function buildMobileLocaisTraces(rows: AnpPpiLocaisRow[]): PlotData[] {
  if (!rows.length) return [];
  const byLocal: Record<string, AnpPpiLocaisRow[]> = {};
  for (const r of rows) (byLocal[r.local] ??= []).push(r);
  const locais = Object.keys(byLocal).sort();
  return locais.map((local, i) => {
    const data = byLocal[local].sort((a, b) => a.data_fim.localeCompare(b.data_fim));
    return {
      type: "scatter",
      mode: "lines",
      name: local,
      x: data.map((r) => r.data_fim),
      y: data.map((r) => r.preco),
      line: { width: 1.8, color: LOCATION_PALETTE[i % LOCATION_PALETTE.length] },
      hovertemplate: `R$ %{y:.4f}<extra>${local}</extra>`,
    } as PlotData;
  });
}

/** Returns the most recent price per location for MobileDataCard list. */
function latestByLocation(rows: AnpPpiLocaisRow[]): { local: string; preco: number | null; data_fim: string }[] {
  const map: Record<string, AnpPpiLocaisRow> = {};
  for (const r of rows) {
    if (!map[r.local] || r.data_fim > map[r.local].data_fim) {
      map[r.local] = r;
    }
  }
  return Object.values(map)
    .sort((a, b) => a.local.localeCompare(b.local))
    .map((r) => ({ local: r.local, preco: r.preco, data_fim: r.data_fim }));
}

// ── Filter icon ───────────────────────────────────────────────────────────────

const FilterIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true">
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="8" y1="12" x2="16" y2="12" />
    <line x1="11" y1="18" x2="13" y2="18" />
  </svg>
);

// ── Export action sheet ───────────────────────────────────────────────────────

function ExportSheet({
  open,
  onClose,
  onExcelClick,
  onCsvClick,
  excelBusy,
  disabled,
}: {
  open: boolean;
  onClose: () => void;
  onExcelClick: () => void;
  onCsvClick: () => void;
  excelBusy: boolean;
  disabled: boolean;
}): React.ReactElement {
  if (!open) return <></>;
  return (
    <>
      {/* Scrim */}
      <div
        aria-hidden="true"
        onClick={onClose}
        style={{
          position: "fixed", inset: 0,
          background: "var(--mobile-scrim)", zIndex: 45,
        }}
      />
      <div
        role="dialog"
        aria-label="Export options"
        style={{
          position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 50,
          maxWidth: 428, margin: "0 auto",
          background: "var(--mobile-sheet-bg)",
          borderTopLeftRadius: "var(--mobile-radius-xl)",
          borderTopRightRadius: "var(--mobile-radius-xl)",
          padding: "20px 16px calc(20px + var(--mobile-safe-bottom))",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        {/* Handle */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <span style={{ width: 36, height: 4, borderRadius: 2, background: "var(--mobile-sheet-handle)", display: "block" }} />
        </div>
        <h2 style={{ margin: "0 0 16px", fontSize: 17, fontWeight: 700, color: "var(--mobile-text)", textAlign: "center" }}>
          Export
        </h2>
        <button
          type="button"
          disabled={disabled || excelBusy}
          onClick={onExcelClick}
          style={{
            display: "flex", alignItems: "center", gap: 12,
            width: "100%", minHeight: 52,
            background: "var(--mobile-surface)", border: "1px solid var(--mobile-border)",
            borderRadius: "var(--mobile-radius-md)", padding: "0 16px",
            color: "var(--mobile-text)", fontFamily: "inherit",
            fontSize: 15, fontWeight: 600, cursor: disabled || excelBusy ? "default" : "pointer",
            opacity: disabled || excelBusy ? 0.55 : 1,
            marginBottom: 10,
          }}
        >
          <span style={{ fontSize: 20 }}>📊</span>
          <span>{excelBusy ? "Generating Excel..." : "Download Excel (.xlsx)"}</span>
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onCsvClick}
          style={{
            display: "flex", alignItems: "center", gap: 12,
            width: "100%", minHeight: 52,
            background: "var(--mobile-surface)", border: "1px solid var(--mobile-border)",
            borderRadius: "var(--mobile-radius-md)", padding: "0 16px",
            color: "var(--mobile-text)", fontFamily: "inherit",
            fontSize: 15, fontWeight: 600, cursor: disabled ? "default" : "pointer",
            opacity: disabled ? 0.55 : 1,
          }}
        >
          <span style={{ fontSize: 20 }}>📄</span>
          <span>Download CSV</span>
        </button>
      </div>
    </>
  );
}

// ── View ──────────────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-ppi");

  const {
    allSerie, locaisRows, allYears,
    loading, locaisLoading,
    excelLoading, setExcelLoading,
    filters, setFilters,
    yMin, yMax, hasYears,
  } = useAnpPpiData();

  const { yearRange, detailProduto } = filters;

  const [drawerOpen, setDrawerOpen]     = useState(false);
  const [exportOpen, setExportOpen]     = useState(false);
  // Pending yearRange inside the drawer (applied only on "Apply filters")
  const [pendingRange, setPendingRange] = useState<[number, number]>(yearRange);

  // Sync pending range when yearRange changes externally (initial load)
  useMemo(() => {
    setPendingRange(yearRange);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearRange[0], yearRange[1]]);

  // Product tabs — one per produto
  const tabs: MobileTabBarTab[] = useMemo(() => ALL_PRODUTOS.map((p) => ({
    key: p,
    label: PRODUTO_INFO[p].label,
  })), []);

  // National average traces (active product in orange, others dimmed)
  const mediaTraces = useMemo(
    () => buildMobileMediaTraces(allSerie, detailProduto, yearRange, allYears),
    [allSerie, detailProduto, yearRange, allYears],
  );

  // Per-location traces
  const locaisTraces = useMemo(
    () => buildMobileLocaisTraces(locaisRows),
    [locaisRows],
  );

  // Latest price cards
  const latestPrices = useMemo(() => latestByLocation(locaisRows), [locaisRows]);

  const activeInfo = PRODUTO_INFO[detailProduto];
  const periodLabel = hasYears && yMin != null && yMax != null
    ? `${yMin}–${yMax}`
    : "";

  if (visLoading || !visible) return <></>;

  const handleTabChange = (key: string) => {
    setFilters({ detailProduto: key });
  };

  const handleApplyFilters = () => {
    setFilters({ yearRange: pendingRange });
    setDrawerOpen(false);
  };

  const handleResetFilters = () => {
    if (allYears.length > 0) {
      const currentYear = new Date().getFullYear();
      const startIdx = Math.max(0, allYears.findIndex((y) => y >= currentYear - 9));
      const reset: [number, number] = [startIdx, allYears.length - 1];
      setPendingRange(reset);
    }
  };

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "var(--mobile-bg)",
        paddingBottom: "calc(80px + var(--mobile-safe-bottom))",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <MobileTopBar
        title="ANP — PPI"
        rightSlot={
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open filters"
            style={{
              width: 44, height: 44,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              background: "transparent", border: 0,
              color: "var(--mobile-text-muted)", cursor: "pointer",
              borderRadius: 12,
            }}
          >
            {FilterIcon}
          </button>
        }
      />

      {/* ── Product tab bar ──────────────────────────────────────────────── */}
      <div style={{ padding: "12px 0 8px" }}>
        <MobileTabBar
          tabs={tabs}
          activeKey={detailProduto}
          onChange={handleTabChange}
          variant="container"
          ariaLabel="Product"
        />
      </div>

      {/* Period badge */}
      {periodLabel && (
        <div style={{ padding: "0 16px 4px" }}>
          <span style={{
            display: "inline-block",
            padding: "3px 10px",
            background: "var(--mobile-surface)",
            border: "1px solid var(--mobile-border)",
            borderRadius: "var(--mobile-radius-full)",
            fontSize: 11, fontWeight: 600,
            color: "var(--mobile-text-muted)",
          }}>
            {periodLabel}
          </span>
        </div>
      )}

      {loading ? (
        <div style={{ padding: "32px 16px" }}>
          <BarrelLoading bare />
        </div>
      ) : (
        <>
          {/* ── National average chart ─────────────────────────────────── */}
          <div style={{ padding: "12px 0 0" }}>
            <div style={{ padding: "0 16px 6px" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--mobile-text)" }}>
                PPI — National Average
              </span>
              <span style={{ marginLeft: 8, fontSize: 11, color: "var(--mobile-text-muted)" }}>
                {activeInfo?.unidade ?? "R$/L"}
              </span>
            </div>
            <MobileChart
              data={mediaTraces}
              height={230}
              layout={{
                xaxis: { type: "date" as const },
                yaxis: { title: { text: "" } },
                showlegend: false,
                hovermode: "closest",
              }}
            />
          </div>

          {/* ── Per-location chart ────────────────────────────────────── */}
          <div style={{ padding: "16px 0 0" }}>
            <div style={{ padding: "0 16px 6px", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--mobile-text)" }}>
                By Location — {activeInfo?.label ?? detailProduto}
              </span>
              {locaisLoading && (
                <span style={{ fontSize: 11, color: "var(--mobile-text-muted)" }}>
                  updating…
                </span>
              )}
            </div>
            <MobileChart
              data={locaisTraces}
              height={220}
              layout={{
                xaxis: { type: "date" as const },
                showlegend: false,
                hovermode: "closest",
              }}
            />
          </div>

          {/* ── Latest price cards ───────────────────────────────────── */}
          {latestPrices.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ padding: "0 16px 8px" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--mobile-text)" }}>
                  Latest Prices — {activeInfo?.label ?? detailProduto}
                </span>
              </div>
              <div
                style={{
                  margin: "0 16px",
                  border: "1px solid var(--mobile-border)",
                  borderRadius: "var(--mobile-radius-lg)",
                  overflow: "hidden",
                }}
              >
                {latestPrices.map(({ local, preco, data_fim }) => (
                  <MobileDataCard
                    key={local}
                    title={local}
                    subtitle={data_fim ? `Week ending ${data_fim}` : ""}
                    variant="compact"
                    rightSlot={
                      <span style={{ fontSize: 14, fontWeight: 700, color: "var(--mobile-text)" }}>
                        {preco != null ? `R$ ${preco.toFixed(4)}` : "—"}
                      </span>
                    }
                    leftIcon={
                      <span
                        aria-hidden="true"
                        style={{
                          width: 10, height: 10,
                          borderRadius: "50%",
                          background: LOCATION_PALETTE[
                            latestPrices
                              .sort((a, b) => a.local.localeCompare(b.local))
                              .findIndex((lp) => lp.local === local) % LOCATION_PALETTE.length
                          ],
                          display: "inline-block",
                        }}
                      />
                    }
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Export FAB ────────────────────────────────────────────────────── */}
      <ExportFAB
        icon="download"
        label="Export"
        ariaLabel="Export data"
        disabled={loading || allSerie.length === 0}
        onClick={() => setExportOpen(true)}
        bottom="calc(16px + var(--mobile-safe-bottom))"
      />

      {/* ── Export action sheet ───────────────────────────────────────────── */}
      <ExportSheet
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        excelBusy={excelLoading}
        disabled={loading || allSerie.length === 0}
        onExcelClick={async () => {
          setExcelLoading(true);
          setExportOpen(false);
          try {
            await downloadGenericExcel<AnpPpiSerieRow>({
              rows: allSerie,
              filename: "ANP-PPI",
              title: "ANP — Import Parity Prices (National Average)",
              sheetName: "PPI Avg.",
              columns: [
                { key: "data_inicio", header: "Start" },
                { key: "data_fim",    header: "End" },
                { key: "produto",     header: "Product",    width: 22 },
                { key: "preco_medio", header: "Avg. Price", format: "0.0000" },
                { key: "unidade",     header: "Unit" },
              ],
            });
          } catch (e) {
            console.error("Excel export failed", e);
          } finally {
            setExcelLoading(false);
          }
        }}
        onCsvClick={() => {
          setExportOpen(false);
          downloadCsv({
            rows: allSerie as unknown as Record<string, unknown>[],
            filename: "ANP-PPI",
          });
        }}
      />

      {/* ── Filter drawer ─────────────────────────────────────────────────── */}
      <FilterDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Filters"
        onReset={handleResetFilters}
        onApply={handleApplyFilters}
        applyLabel="Apply filters"
        resetLabel="Reset"
      >
        {/* Period slider */}
        <div style={{ marginBottom: 24 }}>
          <div style={{
            fontSize: 13, fontWeight: 700,
            color: "var(--mobile-text)", marginBottom: 12,
          }}>
            Period
          </div>
          {!loading && hasYears ? (
            <PeriodSlider
              years={allYears}
              value={pendingRange}
              onChange={(v) => setPendingRange(v)}
            />
          ) : (
            <div style={{ fontSize: 12, color: "var(--mobile-text-muted)" }}>
              Loading…
            </div>
          )}
        </div>

        {/* Product context note */}
        <div style={{
          padding: "10px 14px",
          background: "var(--mobile-surface)",
          border: "1px solid var(--mobile-border)",
          borderRadius: "var(--mobile-radius-md)",
          fontSize: 12,
          color: "var(--mobile-text-muted)",
          lineHeight: 1.5,
        }}>
          Location chart follows the active product tab. Switch tabs above the
          chart to change the product detail view.
        </div>
      </FilterDrawer>
    </div>
  );
}
