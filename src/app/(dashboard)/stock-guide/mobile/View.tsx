"use client";

// ─── Mobile view for /stock-guide ─────────────────────────────────────────────
//
// Same single brain (useStockGuideData), mobile-first presentation, NO export
// (§ mobile reform — export is desktop-only).
//
//   1. Subtitle + sector filter chip row (opens FilterDrawer).
//   2. Comps as MobileDataCards: Company + Ticker + Recomm chip header; TP,
//      live Market cap, Upside KPIs; compact horizontal-scroll mini-table for
//      the Y1/Y2 multiple pairs. Tap → sensitivity grid in a BottomSheet.
//   3. Restricted + assumptions footnote card.
//
// [mobile-only] divergences vs. desktop:
//   • Comps render as cards, not one wide sticky table (the desktop table is
//     unusable on a phone). The Y1/Y2 multiples live in a per-card mini-table.
//   • Sensitivity opens in a BottomSheet on tap rather than a panel below.
//   • No ExportPanel / Refresh-quotes button in the header (quotes still fetch
//     once on load via the shared hook; manual refresh is a desktop affordance).
//
// Binding sync rule: any new filter / KPI / column added here must also land in
// desktop/View.tsx in the same commit, or declare [mobile-only] with reason.

import { useState } from "react";

import {
  BottomSheet,
  FilterDrawer,
  FunnelIcon,
} from "@/components/dashboard/mobile";
import BarrelLoading from "@/components/dashboard/BarrelLoading";
import { useModuleVisibilityGuard } from "@/hooks/useModuleVisibilityGuard";
import {
  useStockGuideData,
  fmtNum,
  fmtPct,
  fmtSignedPct,
  fmtMn,
  recommendationColors,
  VOLUME_UNIT_NOTE,
} from "../useStockGuideData";
import type {
  StockGuideComputedRow,
  StockGuideSector,
  StockGuideRecommendation,
  SensitivityGrid,
} from "@/types/stockGuide";

const SECTOR_LABEL: Record<StockGuideSector, string> = {
  oil_gas: "Oil & Gas",
  fuel_distribution: "Fuel Distribution",
};

// ─── Recommendation chip (mobile) ─────────────────────────────────────────────

function RecChip({ code }: { code: StockGuideRecommendation | null }): React.ReactElement | null {
  if (!code) return null;
  const { bg, fg } = recommendationColors(code);
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.04em",
        background: bg,
        color: fg,
      }}
    >
      {code}
    </span>
  );
}

// ─── KPI block ─────────────────────────────────────────────────────────────────

function Kpi({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}): React.ReactElement {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--mobile-text-muted)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 15,
          fontWeight: 700,
          color: color ?? "var(--mobile-text)",
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ─── Y1/Y2 mini-table (per card) ──────────────────────────────────────────────

interface MiniRow {
  label: string;
  y1: number | null;
  y2: number | null;
  fmt: (v: number | null) => string;
  /** True for the 4 live-derived multiples → render "—" while quotes load. */
  live?: boolean;
}

function MiniMultiples({
  row,
  y1Label,
  y2Label,
  quotesLoading,
}: {
  row: StockGuideComputedRow;
  y1Label: string;
  y2Label: string;
  quotesLoading: boolean;
}): React.ReactElement {
  const miniRows: MiniRow[] = [
    { label: "EV/EBITDA",  y1: row.evEbitdaY1,  y2: row.evEbitdaY2,  fmt: (v) => fmtNum(v, 1), live: true },
    { label: "P/E",        y1: row.peY1,        y2: row.peY2,        fmt: (v) => fmtNum(v, 1), live: true },
    { label: "FCFE Yield", y1: row.fcfeYieldY1, y2: row.fcfeYieldY2, fmt: (v) => fmtPct(v, 1), live: true },
    { label: "Div Yield",  y1: row.divYieldY1,  y2: row.divYieldY2,  fmt: (v) => fmtPct(v, 1), live: true },
    { label: "EBITDA",     y1: row.ebitda_y1,   y2: row.ebitda_y2,   fmt: (v) => fmtMn(v) },
    { label: "Volumes",    y1: row.volumes_y1,  y2: row.volumes_y2,  fmt: (v) => fmtMn(v) },
  ];
  return (
    <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", marginTop: 10 }}>
      <table
        style={{
          borderCollapse: "collapse",
          fontSize: 11,
          fontFamily: "Arial, Helvetica, sans-serif",
          minWidth: "100%",
        }}
      >
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "3px 8px 3px 0", color: "#f5f5f5", fontWeight: 700, fontSize: 10, background: "#0a0a0a", borderTopLeftRadius: 4, borderBottomLeftRadius: 4 }} />
            {miniRows.map((m, mi) => (
              <th
                key={m.label}
                style={{
                  textAlign: "right",
                  padding: "3px 8px",
                  color: "#f5f5f5",
                  fontWeight: 700,
                  fontSize: 10,
                  whiteSpace: "nowrap",
                  background: "#0a0a0a",
                  borderTopRightRadius: mi === miniRows.length - 1 ? 4 : undefined,
                  borderBottomRightRadius: mi === miniRows.length - 1 ? 4 : undefined,
                }}
              >
                {m.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {([y1Label, y2Label] as const).map((yl, idx) => (
            <tr key={yl}>
              <td
                style={{
                  textAlign: "left",
                  padding: "3px 8px 3px 0",
                  fontWeight: 700,
                  color: "var(--mobile-text)",
                  whiteSpace: "nowrap",
                }}
              >
                {yl}
              </td>
              {miniRows.map((m) => {
                const v = idx === 0 ? m.y1 : m.y2;
                // Live-derived multiples show "—" while quotes load.
                const gate = m.live === true && quotesLoading;
                return (
                  <td
                    key={m.label}
                    style={{
                      textAlign: "right",
                      padding: "3px 8px",
                      fontVariantNumeric: "tabular-nums",
                      color: "var(--mobile-text)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {gate && v == null ? "—" : m.fmt(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Comps card ────────────────────────────────────────────────────────────────

function CompsCard({
  row,
  y1Label,
  y2Label,
  quotesLoading,
  selected,
  onTap,
}: {
  row: StockGuideComputedRow;
  y1Label: string;
  y2Label: string;
  quotesLoading: boolean;
  selected: boolean;
  onTap: () => void;
}): React.ReactElement {
  const upsideColor =
    row.upsidePct == null
      ? "var(--mobile-text)"
      : row.upsidePct > 0
        ? "#15803d"
        : row.upsidePct < 0
          ? "#b91c1c"
          : "var(--mobile-text-muted)";
  return (
    <div
      className="sg-comps-card"
      onClick={onTap}
      style={{
        background: selected ? "var(--mobile-accent-fill)" : "var(--mobile-surface)",
        borderBottom: "1px solid var(--mobile-divider)",
        borderLeft: selected
          ? "3px solid var(--mobile-accent)"
          : "3px solid transparent",
        padding: "14px 16px",
        cursor: "pointer",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      {/* Header: company + ticker + recomm chip */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: "var(--mobile-text)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {row.company_name}
          </div>
          <div style={{ fontSize: 12, color: "var(--mobile-text-muted)", fontWeight: 600 }}>
            {row.ticker}
          </div>
        </div>
        <RecChip code={row.recommendation} />
      </div>

      {/* KPIs: TP · Market cap · Upside */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 10,
          marginTop: 12,
        }}
      >
        <Kpi label="Target" value={fmtNum(row.target_price, 2)} />
        <Kpi
          label="Mkt cap (mn)"
          value={quotesLoading && row.marketCapBrlMn == null ? "—" : fmtMn(row.marketCapBrlMn)}
        />
        <Kpi
          label="Upside"
          value={quotesLoading && row.upsidePct == null ? "—" : fmtSignedPct(row.upsidePct)}
          color={upsideColor}
        />
      </div>

      {/* Y1/Y2 multiples mini-table */}
      <MiniMultiples row={row} y1Label={y1Label} y2Label={y2Label} quotesLoading={quotesLoading} />

      <div style={{ marginTop: 8, fontSize: 11, color: "var(--mobile-accent)", fontWeight: 600 }}>
        Tap for sensitivity →
      </div>
    </div>
  );
}

// ─── Sensitivity matrix (inside the BottomSheet) ──────────────────────────────

function MobileSensitivity({
  grid,
  loading,
}: {
  grid: SensitivityGrid | null;
  loading: boolean;
}): React.ReactElement {
  if (loading) {
    return (
      <div style={{ padding: "32px 0" }}>
        <BarrelLoading bare />
      </div>
    );
  }
  if (!grid || grid.row_labels.length === 0 || grid.col_labels.length === 0) {
    return (
      <div
        style={{
          padding: "24px 8px",
          textAlign: "center",
          color: "var(--mobile-text-muted)",
          fontSize: 13,
        }}
      >
        No sensitivity table has been published yet.
      </div>
    );
  }
  return (
    <div>
      {/* Column-axis caption above the header row */}
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "var(--mobile-accent)",
          marginBottom: 8,
          textAlign: "center",
        }}
      >
        {grid.col_axis_title}
      </div>
      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        <table
          style={{
            borderCollapse: "collapse",
            fontSize: 11.5,
            fontFamily: "Arial, Helvetica, sans-serif",
            margin: "0 auto",
            border: "1px solid var(--mobile-border)",
            borderRadius: "var(--mobile-radius-md, 12px)",
            overflow: "hidden",
          }}
        >
          <thead>
            <tr>
              {/* Top-left corner = value label */}
              <th
                style={{
                  textAlign: "left",
                  padding: "7px 11px",
                  background: "var(--mobile-surface-elevated)",
                  color: "var(--mobile-text)",
                  fontWeight: 700,
                  fontSize: 10,
                  whiteSpace: "nowrap",
                  borderRight: "1px solid var(--mobile-border)",
                  borderBottom: "1px solid var(--mobile-border)",
                }}
              >
                {grid.value_label || "Value"}
              </th>
              {grid.col_labels.map((c, ci) => (
                <th
                  key={ci}
                  style={{
                    textAlign: "right",
                    padding: "7px 11px",
                    color: "var(--mobile-text-muted)",
                    fontWeight: 700,
                    fontSize: 10,
                    whiteSpace: "nowrap",
                    background: "var(--mobile-surface-elevated)",
                    borderRight: "1px solid var(--mobile-divider)",
                    borderBottom: "1px solid var(--mobile-border)",
                  }}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.row_labels.map((rl, ri) => (
              <tr key={ri}>
                <th
                  scope="row"
                  style={{
                    textAlign: "right",
                    padding: "7px 11px",
                    fontWeight: 700,
                    color: "var(--mobile-text)",
                    whiteSpace: "nowrap",
                    background: "var(--mobile-surface-elevated)",
                    borderRight: "1px solid var(--mobile-border)",
                    borderBottom: "1px solid var(--mobile-divider)",
                  }}
                >
                  {rl}
                </th>
                {grid.col_labels.map((_, ci) => (
                  <td
                    key={ci}
                    style={{
                      textAlign: "right",
                      padding: "7px 11px",
                      fontVariantNumeric: "tabular-nums",
                      color: "var(--mobile-text)",
                      background: ri % 2 === 0 ? "var(--mobile-surface)" : "var(--mobile-surface-elevated)",
                      borderRight: "1px solid var(--mobile-divider)",
                      borderBottom: "1px solid var(--mobile-divider)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {fmtNum(grid.cells[ri]?.[ci] ?? null, 2)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: "var(--mobile-text-muted)", textAlign: "center" }}>
        Rows: <strong style={{ color: "var(--mobile-text)" }}>{grid.row_axis_title}</strong>
      </div>
    </div>
  );
}

// ─── View ──────────────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("stock-guide");
  const {
    loading,
    config,
    computedRows,
    sectorsPresent,
    restrictedNames,
    filters,
    setFilters,
    quotesLoading,
    selectedTicker,
    selectedGrid,
    selectedGridLoading,
    selectTicker,
  } = useStockGuideData();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const selectedCompanyName =
    computedRows.find((r) => r.ticker === selectedTicker)?.company_name ?? null;

  function handleTap(ticker: string) {
    selectTicker(ticker);
    setSheetOpen(true);
  }

  if (visLoading || !visible) return <></>;

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "var(--mobile-bg)",
        paddingBottom: "calc(24px + var(--mobile-safe-bottom))",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      {/* ── Subtitle ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          padding: "10px 16px 0",
          fontSize: 12,
          color: "var(--mobile-text-muted)",
          lineHeight: 1.3,
        }}
      >
        Equities research — coverage comps and per-company sensitivity.
      </div>

      {/* ── Filter chip row: sector ──────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "12px 16px 0",
          overflowX: "auto",
          scrollbarWidth: "none",
          alignItems: "center",
          flexWrap: "nowrap",
        }}
      >
        <button
          type="button"
          onClick={() => setFilters({ sectorFilter: null })}
          style={chipStyle(filters.sectorFilter == null)}
        >
          All
        </button>
        {sectorsPresent.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilters({ sectorFilter: s })}
            style={chipStyle(filters.sectorFilter === s)}
          >
            {SECTOR_LABEL[s]}
          </button>
        ))}

        <span
          aria-hidden="true"
          style={{ width: 1, height: 20, background: "var(--mobile-divider)", flexShrink: 0, margin: "0 2px" }}
        />

        <button
          type="button"
          aria-label="Open filters"
          onClick={() => setDrawerOpen(true)}
          style={{
            flexShrink: 0,
            width: 36,
            height: 36,
            borderRadius: 20,
            border: "1px solid var(--mobile-divider)",
            background: "var(--mobile-surface)",
            color: "var(--mobile-text-muted)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <FunnelIcon size={18} />
        </button>
      </div>

      {loading ? (
        <div style={{ padding: "40px 0" }}>
          <BarrelLoading bare />
        </div>
      ) : (
        <>
          {/* ── Comps cards ──────────────────────────────────────────────────── */}
          <style>{`
            .sg-comps-card { transition: background 0.12s ease; }
            .sg-comps-card:active { background: var(--mobile-row-press) !important; }
          `}</style>
          <div style={{ marginTop: 16, borderTop: "1px solid var(--mobile-divider)" }}>
            {computedRows.length === 0 ? (
              <div
                style={{
                  padding: "32px 16px",
                  textAlign: "center",
                  color: "var(--mobile-text-muted)",
                  fontSize: 13,
                }}
              >
                No companies to display.
              </div>
            ) : (
              computedRows.map((row) => (
                <CompsCard
                  key={row.ticker}
                  row={row}
                  y1Label={config.y1_label}
                  y2Label={config.y2_label}
                  quotesLoading={quotesLoading}
                  selected={row.ticker === selectedTicker}
                  onTap={() => handleTap(row.ticker)}
                />
              ))
            )}
          </div>

          {/* ── Footnote card ────────────────────────────────────────────────── */}
          <div
            style={{
              margin: "16px",
              padding: "14px 16px",
              background: "var(--mobile-surface)",
              border: "1px solid var(--mobile-divider)",
              borderRadius: "var(--mobile-radius-lg, 12px)",
              fontSize: 11.5,
              color: "var(--mobile-text-muted)",
              lineHeight: 1.6,
            }}
          >
            {config.assumptions_note && (
              <div style={{ marginBottom: 4 }}>
                <strong style={{ color: "var(--mobile-text)" }}>Assumptions:</strong>{" "}
                {config.assumptions_note}
              </div>
            )}
            <div>{VOLUME_UNIT_NOTE}</div>
            <div style={{ marginTop: 4 }}>
              Market cap, upside, EV/EBITDA, P/E, FCFE Yield and Div Yield are
              computed live from the latest available price (BRL) and the research
              fundamentals.
            </div>
            {restrictedNames.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <strong style={{ color: "var(--mobile-text)" }}>Currently restricted:</strong>{" "}
                {restrictedNames.join(", ")}.
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Sensitivity BottomSheet ──────────────────────────────────────────── */}
      <BottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={selectedCompanyName ? `Sensitivity — ${selectedCompanyName}` : "Sensitivity"}
      >
        <MobileSensitivity grid={selectedGrid} loading={selectedGridLoading} />
      </BottomSheet>

      {/* ── Filter drawer (sector) ───────────────────────────────────────────── */}
      <FilterDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Filters"
        onReset={() => setFilters({ sectorFilter: null })}
        onApply={() => setDrawerOpen(false)}
        applyLabel="Apply"
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "var(--mobile-text)",
            marginBottom: 12,
            fontFamily: "Arial",
          }}
        >
          Sector
        </div>
        {([null, ...sectorsPresent] as (StockGuideSector | null)[]).map((s) => {
          const on = filters.sectorFilter === s;
          const label = s == null ? "All sectors" : SECTOR_LABEL[s];
          return (
            <button
              key={s ?? "all"}
              type="button"
              onClick={() => setFilters({ sectorFilter: s })}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
                padding: "12px 0",
                borderBottom: "1px solid var(--mobile-divider)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                fontSize: 15,
                fontWeight: 600,
                color: on ? "var(--mobile-accent)" : "var(--mobile-text)",
                fontFamily: "Arial",
              }}
            >
              {label}
              {on && <span aria-hidden="true">✓</span>}
            </button>
          );
        })}
      </FilterDrawer>
    </div>
  );
}

// ─── Chip style helper ─────────────────────────────────────────────────────────

function chipStyle(active: boolean): React.CSSProperties {
  return {
    flexShrink: 0,
    padding: "6px 13px",
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
    whiteSpace: "nowrap",
    transition: "background 0.15s ease, color 0.15s ease",
  };
}
