"use client";

// ─── Desktop view for /stock-guide ────────────────────────────────────────────
//
// Equities-research comps table + per-company sensitivity drill-down.
//
//   1. DashboardHeader (brand orange, Arial — STANDARD dashboard identity, NOT
//      the Market Watch trading-terminal theme) + ExportPanel (Excel + CSV) in
//      rightSlot + a manual "Refresh quotes" control.
//   2. Wide comps table — STICKY Company column + sticky header, overflow-x:auto,
//      a 2-LEVEL grouped header (EV/EBITDA, P/E, FCFE Yield, Div Yield, EBITDA,
//      Volumes each spanning two sub-cols labelled config.y1_label/y2_label).
//      Recommendation chip (OP=green, MP=amber, UP=red); Upside coloured by sign.
//      Live cells render '—' while quotesLoading. Row click → selectTicker.
//   3. Footnotes: assumptions note + volume-unit note + "Currently restricted: …".
//   4. Sensitivity panel — labelled 2D matrix for the selected company.
//
// All data, derivations, live quotes and export live in useStockGuideData.
// This View only handles layout, NavBar, header, chrome and the matrix render.
//
// Binding sync rule: any new filter / column / KPI added here must also land in
// mobile/View.tsx in the same commit, or declare [desktop-only] with reason.

import NavBar from "../../../../components/NavBar";
import DashboardHeader from "../../../../components/dashboard/DashboardHeader";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import ExportPanel from "../../../../components/dashboard/ExportPanel";
import DataErrorBoundary from "../../../../components/dashboard/DataErrorBoundary";
import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import {
  useStockGuideData,
  fmtNum,
  fmtPct,
  fmtSignedPct,
  fmtMn,
  recommendationLabel,
  recommendationColors,
  VOLUME_UNIT_NOTE,
} from "../useStockGuideData";
import type {
  StockGuideComputedRow,
  SensitivityGrid,
  StockGuideRecommendation,
} from "@/types/stockGuide";

const BRAND_ORANGE = "#ff5000";

// ─── Recommendation chip ──────────────────────────────────────────────────────

function RecommendationChip({
  code,
}: {
  code: StockGuideRecommendation | null;
}): React.ReactElement {
  if (!code) return <span style={{ color: "#9ca3af" }}>—</span>;
  const { bg, fg } = recommendationColors(code);
  return (
    <span
      title={recommendationLabel(code)}
      style={{
        display: "inline-block",
        padding: "2px 9px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.04em",
        background: bg,
        color: fg,
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      {code}
    </span>
  );
}

// ─── Comps table ──────────────────────────────────────────────────────────────

// Comps table header is a solid near-black band with white text, matching the
// source Itaú BBA comps sheet. Applied across both header levels + the sticky
// Company corner cell.
const HEADER_BG = "#0a0a0a";
const HEADER_FG = "#f5f5f5";

const TH_BASE: React.CSSProperties = {
  fontFamily: "Arial, Helvetica, sans-serif",
  fontSize: 11,
  fontWeight: 700,
  color: HEADER_FG,
  background: HEADER_BG,
  padding: "7px 10px",
  whiteSpace: "nowrap",
  borderBottom: "1px solid rgba(255,255,255,0.18)",
};

const TD_BASE: React.CSSProperties = {
  fontFamily: "Arial, Helvetica, sans-serif",
  fontSize: 12.5,
  color: "#1a1a1a",
  padding: "8px 12px",
  whiteSpace: "nowrap",
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
  fontFeatureSettings: '"tnum" 1, "lnum" 1',
  borderBottom: "1px solid #efefef",
};

const STICKY_COL_WIDTH = 176;

// Vertical rule that separates each metric group (EV/EBITDA | P/E | …). Slightly
// stronger than the inner #efefef row rules so the eye reads the groups as units.
const GROUP_RULE = "1px solid #dcdcdc";
// Same group separator, but tuned to read on the black header band — a faint
// light rule instead of the dark #dcdcdc (which would vanish on black).
const GROUP_RULE_HEADER = "1px solid rgba(255,255,255,0.22)";

// Right-edge shadow on the sticky Company column — makes it read as floating
// above the horizontally-scrolled body. Kept subtle (matches dropdown depth).
const STICKY_SHADOW = "6px 0 8px -6px rgba(0,0,0,0.16)";

interface PairGroup {
  label: string;
  /** Keys into the computed row for the [Y1, Y2] pair. */
  y1: keyof StockGuideComputedRow;
  y2: keyof StockGuideComputedRow;
  /** Renderer for a single value of this group. */
  fmt: (v: number | null) => string;
  /**
   * True for the 4 price-sensitive multiples (EV/EBITDA, P/E, FCFE Yield,
   * Div Yield) — derived live from the Yahoo price, so they render "—" while
   * quotes load. EBITDA / Volumes are direct data → never gated on the quote.
   */
  live?: boolean;
}

const PAIR_GROUPS: PairGroup[] = [
  { label: "EV/EBITDA",  y1: "evEbitdaY1",  y2: "evEbitdaY2",  fmt: (v) => fmtNum(v, 1), live: true },
  { label: "P/E",        y1: "peY1",        y2: "peY2",        fmt: (v) => fmtNum(v, 1), live: true },
  { label: "FCFE Yield", y1: "fcfeYieldY1", y2: "fcfeYieldY2", fmt: (v) => fmtPct(v, 1), live: true },
  { label: "Div Yield",  y1: "divYieldY1",  y2: "divYieldY2",  fmt: (v) => fmtPct(v, 1), live: true },
  { label: "EBITDA",     y1: "ebitda_y1",   y2: "ebitda_y2",   fmt: (v) => fmtMn(v) },
  { label: "Volumes",    y1: "volumes_y1",  y2: "volumes_y2",  fmt: (v) => fmtMn(v) },
];

// Single (non-paired) leading columns, after the sticky Company column.
const SINGLE_COLS = ["Ticker", "Last update", "TP", "Recomm.", "Upside", "Market cap (BRL mn)"];

function CompsTable({
  rows,
  y1Label,
  y2Label,
  selectedTicker,
  onSelect,
  quotesLoading,
}: {
  rows: StockGuideComputedRow[];
  y1Label: string;
  y2Label: string;
  selectedTicker: string | null;
  onSelect: (ticker: string) => void;
  quotesLoading: boolean;
}): React.ReactElement {
  return (
    <div
      className="sg-comps-wrap"
      style={{
        overflowX: "auto",
        border: "1px solid #e6e6e6",
        borderRadius: 10,
        background: "#fff",
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
      }}
    >
      {/* Hover affordance — overrides the inline zebra background on non-selected
          rows only. Scoped to this table via the .sg-comps-wrap wrapper. */}
      <style>{`
        .sg-comps-wrap tbody tr:not([data-sel="1"]):hover > td {
          background: #f3f6fb !important;
        }
      `}</style>
      <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%" }}>
        <thead>
          {/* ── Level 1: group headers ─────────────────────────────────────── */}
          <tr>
            <th
              rowSpan={2}
              style={{
                ...TH_BASE,
                position: "sticky",
                left: 0,
                zIndex: 4,
                textAlign: "left",
                width: STICKY_COL_WIDTH,
                minWidth: STICKY_COL_WIDTH,
                borderRight: "1px solid rgba(255,255,255,0.18)",
                background: HEADER_BG,
                color: HEADER_FG,
                boxShadow: STICKY_SHADOW,
                letterSpacing: "0.02em",
                textTransform: "uppercase",
              }}
            >
              Company
            </th>
            {SINGLE_COLS.map((c) => (
              <th
                key={c}
                rowSpan={2}
                style={{
                  ...TH_BASE,
                  textAlign: c === "Ticker" ? "left" : "right",
                  verticalAlign: "bottom",
                  color: HEADER_FG,
                }}
              >
                {c}
              </th>
            ))}
            {PAIR_GROUPS.map((g) => (
              <th
                key={g.label}
                colSpan={2}
                style={{
                  ...TH_BASE,
                  textAlign: "center",
                  borderLeft: GROUP_RULE_HEADER,
                  color: HEADER_FG,
                  letterSpacing: "0.02em",
                }}
              >
                {g.label}
              </th>
            ))}
          </tr>
          {/* ── Level 2: Y1 / Y2 sub-headers under each group ──────────────── */}
          <tr>
            {PAIR_GROUPS.map((g) => [
              <th
                key={`${g.label}-y1`}
                style={{
                  ...TH_BASE,
                  fontWeight: 600,
                  fontSize: 10,
                  color: "rgba(245,245,245,0.62)",
                  textAlign: "right",
                  borderLeft: GROUP_RULE_HEADER,
                }}
              >
                {y1Label}
              </th>,
              <th
                key={`${g.label}-y2`}
                style={{
                  ...TH_BASE,
                  fontWeight: 600,
                  fontSize: 10,
                  color: "rgba(245,245,245,0.62)",
                  textAlign: "right",
                }}
              >
                {y2Label}
              </th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={1 + SINGLE_COLS.length + PAIR_GROUPS.length * 2}
                style={{
                  ...TD_BASE,
                  textAlign: "center",
                  color: "#9ca3af",
                  padding: "28px 10px",
                }}
              >
                No companies to display.
              </td>
            </tr>
          ) : (
            rows.map((r, i) => {
              const isSel = r.ticker === selectedTicker;
              const rowBg = isSel ? "rgba(255,80,0,0.06)" : i % 2 === 0 ? "#fff" : "#fbfbfb";
              const upsideColor =
                r.upsidePct == null
                  ? "#1a1a1a"
                  : r.upsidePct > 0
                    ? "#15803d"
                    : r.upsidePct < 0
                      ? "#b91c1c"
                      : "#6b7280";
              return (
                <tr
                  key={r.ticker}
                  data-sel={isSel ? "1" : "0"}
                  onClick={() => onSelect(r.ticker)}
                  style={{ cursor: "pointer", background: rowBg }}
                >
                  {/* Sticky Company cell */}
                  <td
                    style={{
                      ...TD_BASE,
                      position: "sticky",
                      left: 0,
                      zIndex: 2,
                      textAlign: "left",
                      fontWeight: 700,
                      color: "#111827",
                      width: STICKY_COL_WIDTH,
                      minWidth: STICKY_COL_WIDTH,
                      background: rowBg,
                      borderRight: "1px solid #e0e0e0",
                      borderLeft: isSel ? `3px solid ${BRAND_ORANGE}` : "3px solid transparent",
                      boxShadow: STICKY_SHADOW,
                    }}
                  >
                    {r.company_name}
                  </td>
                  <td style={{ ...TD_BASE, textAlign: "left", color: "#6b7280", fontWeight: 600 }}>
                    {r.ticker}
                  </td>
                  <td style={{ ...TD_BASE, color: "#9ca3af" }}>{r.last_update ?? "—"}</td>
                  <td style={TD_BASE}>{fmtNum(r.target_price, 2)}</td>
                  <td style={{ ...TD_BASE, textAlign: "right" }}>
                    <RecommendationChip code={r.recommendation} />
                  </td>
                  <td style={{ ...TD_BASE, color: upsideColor, fontWeight: 700 }}>
                    {quotesLoading && r.upsidePct == null ? "—" : fmtSignedPct(r.upsidePct)}
                  </td>
                  <td style={TD_BASE}>
                    {quotesLoading && r.marketCapBrlMn == null ? "—" : fmtMn(r.marketCapBrlMn)}
                  </td>
                  {PAIR_GROUPS.map((g) => {
                    // Live-derived multiples show "—" while quotes load (they
                    // depend on the live price); direct-data groups never gate.
                    const gate = g.live === true && quotesLoading;
                    const v1 = r[g.y1] as number | null;
                    const v2 = r[g.y2] as number | null;
                    return [
                      <td
                        key={`${g.label}-y1`}
                        style={{ ...TD_BASE, borderLeft: GROUP_RULE }}
                      >
                        {gate && v1 == null ? "—" : g.fmt(v1)}
                      </td>,
                      <td key={`${g.label}-y2`} style={TD_BASE}>
                        {gate && v2 == null ? "—" : g.fmt(v2)}
                      </td>,
                    ];
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Sensitivity matrix ────────────────────────────────────────────────────────

/** Small 3×3 grid glyph for the sensitivity empty-state. */
function GridGlyph(): React.ReactElement {
  return (
    <svg
      width={34}
      height={34}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#cbcbcb"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x={3} y={3} width={18} height={18} rx={2.5} />
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </svg>
  );
}

function SensitivityPanel({
  grid,
  loading,
  companyName,
}: {
  grid: SensitivityGrid | null;
  loading: boolean;
  companyName: string | null;
}): React.ReactElement {
  if (loading) {
    return (
      <div style={{ padding: "32px 0" }}>
        <BarrelLoading />
      </div>
    );
  }

  if (!grid || grid.row_labels.length === 0 || grid.col_labels.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
          padding: "36px 16px",
          textAlign: "center",
          color: "#9ca3af",
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 13,
          border: "1px dashed #d8d8d8",
          borderRadius: 12,
          background: "#fafafa",
        }}
      >
        <GridGlyph />
        <div>
          No sensitivity table has been published for{" "}
          <strong style={{ color: "#6b7280" }}>{companyName ?? "this company"}</strong> yet.
        </div>
      </div>
    );
  }

  const nCols = grid.col_labels.length;
  const nRows = grid.row_labels.length;
  const valueLabel = grid.value_label || "Value";

  // Cell styling for the matrix body. Light grid lines on all sides so it reads
  // as a true 2-way table rather than a list.
  const cellBase: React.CSSProperties = {
    ...TD_BASE,
    padding: "8px 14px",
    borderRight: "1px solid #ededed",
    borderBottom: "1px solid #ededed",
    color: "#1f2937",
    minWidth: 64,
  };

  return (
    <div
      style={{
        overflowX: "auto",
        border: "1px solid #e0e0e0",
        borderRadius: 12,
        background: "#fff",
        display: "inline-block",
        maxWidth: "100%",
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
      }}
    >
      <table
        style={{
          borderCollapse: "collapse",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <thead>
          <tr>
            {/* Top-left corner = the value being tabulated. Spans the rotated
                row-axis column + the row-label column, and both header rows. */}
            <th
              colSpan={2}
              rowSpan={2}
              style={{
                ...TH_BASE,
                textAlign: "left",
                verticalAlign: "bottom",
                background: HEADER_BG,
                color: HEADER_FG,
                borderRight: "1px solid rgba(255,255,255,0.18)",
                borderBottom: "1px solid rgba(255,255,255,0.18)",
                fontSize: 11,
                letterSpacing: "0.02em",
                whiteSpace: "normal",
                maxWidth: 150,
              }}
            >
              {valueLabel}
            </th>
            {/* col_axis_title centered above all column headers. */}
            <th
              colSpan={nCols}
              style={{
                ...TH_BASE,
                textAlign: "center",
                color: BRAND_ORANGE,
                background: HEADER_BG,
                borderBottom: "1px solid rgba(255,255,255,0.18)",
                letterSpacing: "0.03em",
                textTransform: "uppercase",
                fontSize: 10.5,
              }}
            >
              {grid.col_axis_title}
            </th>
          </tr>
          <tr>
            {grid.col_labels.map((c, ci) => (
              <th
                key={ci}
                style={{
                  ...TH_BASE,
                  textAlign: "right",
                  background: HEADER_BG,
                  borderRight: "1px solid rgba(255,255,255,0.12)",
                  borderBottom: "1px solid rgba(255,255,255,0.18)",
                  color: HEADER_FG,
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
              {/* Rotated row-axis title — written once, spanning every data row,
                  the classic vertical caption of a 2-way sensitivity table. */}
              {ri === 0 && (
                <th
                  rowSpan={nRows}
                  style={{
                    ...TH_BASE,
                    width: 30,
                    minWidth: 30,
                    padding: "6px 2px",
                    background: "#fbf3ef",
                    borderRight: "1px solid #ededed",
                    borderBottom: "1px solid #e0e0e0",
                    color: BRAND_ORANGE,
                    letterSpacing: "0.03em",
                    textTransform: "uppercase",
                    fontSize: 10.5,
                    whiteSpace: "nowrap",
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      transform: "rotate(180deg)",
                      writingMode: "vertical-rl",
                    }}
                  >
                    {grid.row_axis_title}
                  </span>
                </th>
              )}
              <th
                scope="row"
                style={{
                  ...TD_BASE,
                  textAlign: "right",
                  fontWeight: 700,
                  color: "#374151",
                  background: ri % 2 === 0 ? "#f5f5f5" : "#f1f1f1",
                  borderRight: "1px solid #d6d6d6",
                  borderBottom: "1px solid #ededed",
                  padding: "8px 14px",
                }}
              >
                {rl}
              </th>
              {grid.col_labels.map((_, ci) => (
                <td
                  key={ci}
                  style={{ ...cellBase, background: ri % 2 === 0 ? "#fff" : "#fbfbfb" }}
                >
                  {fmtNum(grid.cells[ri]?.[ci] ?? null, 2)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Refresh-quotes button ─────────────────────────────────────────────────────

function RefreshQuotesButton({
  onClick,
  loading,
}: {
  onClick: () => void;
  loading: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      className="btn btn-outline-secondary btn-sm"
      onClick={onClick}
      disabled={loading}
      style={{ fontFamily: "Arial", whiteSpace: "nowrap" }}
      title="Re-fetch live prices (one batched request)"
    >
      {loading ? "Refreshing…" : "↻ Refresh quotes"}
    </button>
  );
}

// ─── View ──────────────────────────────────────────────────────────────────────

export default function DesktopView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("stock-guide");
  const {
    rows,
    loading: rpcLoading,
    error: rpcError,
    refetch,
    config,
    computedRows,
    restrictedNames,
    quotesLoading,
    refreshQuotes,
    selectedTicker,
    selectedGrid,
    selectedGridLoading,
    selectTicker,
    exportExcel,
    exportCsv,
    excelLoading,
    csvLoading,
  } = useStockGuideData();

  const initialLoading = rpcLoading && rows.length === 0 && rpcError == null;

  const selectedCompanyName =
    computedRows.find((r) => r.ticker === selectedTicker)?.company_name ?? null;

  if (visLoading || !visible) return <></>;

  return (
    <div>
      <NavBar />

      <div className="container-fluid g-0 p-4">
        <DashboardHeader
          title="Stock Guide"
          sub="Equities research — coverage comps table and per-company sensitivity"
          lang="en"
          rightSlot={
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <RefreshQuotesButton onClick={refreshQuotes} loading={quotesLoading} />
              <ExportPanel
                actions={[
                  {
                    kind: "excel",
                    label: "Excel",
                    onClick: exportExcel,
                    busy: excelLoading,
                    disabled: excelLoading || computedRows.length === 0,
                    loadingLabel: "Generating Excel…",
                  },
                  {
                    kind: "csv",
                    label: "CSV",
                    onClick: exportCsv,
                    busy: csvLoading,
                    disabled: csvLoading || computedRows.length === 0,
                    loadingLabel: "Generating CSV…",
                  },
                ]}
              />
            </div>
          }
        />

        <DataErrorBoundary error={rpcError} loading={rpcLoading} retry={refetch}>
          {initialLoading ? (
            <BarrelLoading />
          ) : (
            <>
              {/* ── Comps table ─────────────────────────────────────────────── */}
              <CompsTable
                rows={computedRows}
                y1Label={config.y1_label}
                y2Label={config.y2_label}
                selectedTicker={selectedTicker}
                onSelect={selectTicker}
                quotesLoading={quotesLoading}
              />

              {/* ── Footnotes ───────────────────────────────────────────────── */}
              <div
                style={{
                  marginTop: 12,
                  paddingTop: 10,
                  borderTop: "1px solid #f0f0f0",
                  fontFamily: "Arial, Helvetica, sans-serif",
                  fontSize: 11,
                  color: "#9095a0",
                  lineHeight: 1.65,
                }}
              >
                {config.assumptions_note && (
                  <div>
                    <strong style={{ color: "#6b7280" }}>Assumptions:</strong>{" "}
                    {config.assumptions_note}
                  </div>
                )}
                <div>{VOLUME_UNIT_NOTE}</div>
                <div>
                  Market cap, upside, EV/EBITDA, P/E, FCFE Yield and Div Yield are
                  computed live from the latest available price (BRL) and the
                  research fundamentals (net debt, EBITDA, net income, FCFE,
                  dividends). EBITDA, volumes and the target price are research inputs.
                </div>
                {restrictedNames.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    <strong style={{ color: "#6b7280" }}>Currently restricted:</strong>{" "}
                    {restrictedNames.join(", ")}.
                  </div>
                )}
              </div>

              {/* ── Sensitivity panel ───────────────────────────────────────── */}
              <div style={{ marginTop: 32 }}>
                <div className="section-title">
                  Sensitivity
                  {selectedCompanyName && (
                    <span style={{ color: "#1a1a1a", fontWeight: 600 }}>
                      {" "}— {selectedCompanyName}
                    </span>
                  )}
                </div>
                <hr className="section-hr" style={{ borderTopColor: "#e0e0e0", margin: "4px 0 10px" }} />
                <div
                  style={{
                    fontFamily: "Arial, Helvetica, sans-serif",
                    fontSize: 11.5,
                    color: "#9ca3af",
                    marginBottom: 12,
                  }}
                >
                  Click a company row above to load its sensitivity grid.
                </div>
                <SensitivityPanel
                  grid={selectedGrid}
                  loading={selectedGridLoading}
                  companyName={selectedCompanyName}
                />
              </div>
            </>
          )}
        </DataErrorBoundary>
      </div>
    </div>
  );
}
