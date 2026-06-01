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

const TH_BASE: React.CSSProperties = {
  fontFamily: "Arial, Helvetica, sans-serif",
  fontSize: 11,
  fontWeight: 700,
  color: "#374151",
  background: "#f5f5f5",
  padding: "7px 10px",
  whiteSpace: "nowrap",
  borderBottom: "1px solid #e0e0e0",
};

const TD_BASE: React.CSSProperties = {
  fontFamily: "Arial, Helvetica, sans-serif",
  fontSize: 12.5,
  color: "#1a1a1a",
  padding: "8px 10px",
  whiteSpace: "nowrap",
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
  borderBottom: "1px solid #efefef",
};

const STICKY_COL_WIDTH = 168;

interface PairGroup {
  label: string;
  /** Keys into the computed row for the [Y1, Y2] pair. */
  y1: keyof StockGuideComputedRow;
  y2: keyof StockGuideComputedRow;
  /** Renderer for a single value of this group. */
  fmt: (v: number | null) => string;
}

const PAIR_GROUPS: PairGroup[] = [
  { label: "EV/EBITDA",  y1: "ev_ebitda_y1",  y2: "ev_ebitda_y2",  fmt: (v) => fmtNum(v, 1) },
  { label: "P/E",        y1: "pe_y1",         y2: "pe_y2",         fmt: (v) => fmtNum(v, 1) },
  { label: "FCFE Yield", y1: "fcfe_yield_y1", y2: "fcfe_yield_y2", fmt: (v) => fmtPct(v, 1) },
  { label: "Div Yield",  y1: "div_yield_y1",  y2: "div_yield_y2",  fmt: (v) => fmtPct(v, 1) },
  { label: "EBITDA",     y1: "ebitda_y1",     y2: "ebitda_y2",     fmt: (v) => fmtMn(v) },
  { label: "Volumes",    y1: "volumes_y1",    y2: "volumes_y2",    fmt: (v) => fmtMn(v) },
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
      style={{
        overflowX: "auto",
        border: "1px solid #e6e6e6",
        borderRadius: 10,
        background: "#fff",
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
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
                borderRight: "1px solid #e0e0e0",
                background: "#f0f0f0",
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
                  borderLeft: "1px solid #e8e8e8",
                  color: "#111",
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
                  color: "#6b7280",
                  textAlign: "right",
                  borderLeft: "1px solid #e8e8e8",
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
                  color: "#6b7280",
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
                      fontWeight: 600,
                      width: STICKY_COL_WIDTH,
                      minWidth: STICKY_COL_WIDTH,
                      background: rowBg,
                      borderRight: "1px solid #e6e6e6",
                      borderLeft: isSel ? `3px solid ${BRAND_ORANGE}` : "3px solid transparent",
                    }}
                  >
                    {r.company_name}
                  </td>
                  <td style={{ ...TD_BASE, textAlign: "left", color: "#6b7280", fontWeight: 600 }}>
                    {r.ticker}
                  </td>
                  <td style={{ ...TD_BASE, color: "#6b7280" }}>{r.last_update ?? "—"}</td>
                  <td style={TD_BASE}>{fmtNum(r.target_price, 2)}</td>
                  <td style={{ ...TD_BASE, textAlign: "right" }}>
                    <RecommendationChip code={r.recommendation} />
                  </td>
                  <td style={{ ...TD_BASE, color: upsideColor, fontWeight: 600 }}>
                    {quotesLoading && r.upsidePct == null ? "—" : fmtSignedPct(r.upsidePct)}
                  </td>
                  <td style={TD_BASE}>
                    {quotesLoading && r.marketCapBrlMn == null ? "—" : fmtMn(r.marketCapBrlMn)}
                  </td>
                  {PAIR_GROUPS.map((g) => [
                    <td
                      key={`${g.label}-y1`}
                      style={{ ...TD_BASE, borderLeft: "1px solid #f0f0f0" }}
                    >
                      {g.fmt(r[g.y1] as number | null)}
                    </td>,
                    <td key={`${g.label}-y2`} style={TD_BASE}>
                      {g.fmt(r[g.y2] as number | null)}
                    </td>,
                  ])}
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
          padding: "28px 16px",
          textAlign: "center",
          color: "#9ca3af",
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 13,
          border: "1px dashed #e0e0e0",
          borderRadius: 10,
          background: "#fafafa",
        }}
      >
        No sensitivity table has been published for{" "}
        <strong>{companyName ?? "this company"}</strong> yet.
      </div>
    );
  }

  return (
    <div
      style={{
        overflowX: "auto",
        border: "1px solid #e6e6e6",
        borderRadius: 10,
        background: "#fff",
        display: "inline-block",
        maxWidth: "100%",
      }}
    >
      <table style={{ borderCollapse: "collapse", fontFamily: "Arial, Helvetica, sans-serif" }}>
        <thead>
          <tr>
            {/* Top-left = value label */}
            <th
              style={{
                ...TH_BASE,
                textAlign: "left",
                background: "#f0f0f0",
                color: "#111",
                position: "sticky",
                left: 0,
                zIndex: 2,
              }}
            >
              {grid.value_label || "Value"}
            </th>
            {/* col_axis_title spans all col_labels */}
            <th
              colSpan={grid.col_labels.length}
              style={{ ...TH_BASE, textAlign: "center", color: BRAND_ORANGE }}
            >
              {grid.col_axis_title}
            </th>
          </tr>
          <tr>
            {/* row_axis_title sits above the row-label column */}
            <th
              style={{
                ...TH_BASE,
                textAlign: "left",
                color: BRAND_ORANGE,
                position: "sticky",
                left: 0,
                zIndex: 2,
                background: "#f5f5f5",
              }}
            >
              {grid.row_axis_title}
            </th>
            {grid.col_labels.map((c, ci) => (
              <th key={ci} style={{ ...TH_BASE, textAlign: "right" }}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.row_labels.map((rl, ri) => (
            <tr key={ri} style={{ background: ri % 2 === 0 ? "#fff" : "#fbfbfb" }}>
              <th
                scope="row"
                style={{
                  ...TD_BASE,
                  textAlign: "left",
                  fontWeight: 700,
                  color: "#374151",
                  background: "#f5f5f5",
                  position: "sticky",
                  left: 0,
                  zIndex: 1,
                  borderRight: "1px solid #e6e6e6",
                }}
              >
                {rl}
              </th>
              {grid.col_labels.map((_, ci) => (
                <td key={ci} style={TD_BASE}>
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
                  fontFamily: "Arial, Helvetica, sans-serif",
                  fontSize: 11.5,
                  color: "#6b7280",
                  lineHeight: 1.6,
                }}
              >
                {config.assumptions_note && (
                  <div>
                    <strong style={{ color: "#374151" }}>Assumptions:</strong>{" "}
                    {config.assumptions_note}
                  </div>
                )}
                <div>{VOLUME_UNIT_NOTE}</div>
                <div>
                  Market cap and upside are computed live from the latest available
                  price (BRL). Multiples and targets are research inputs.
                </div>
                {restrictedNames.length > 0 && (
                  <div style={{ marginTop: 4, color: "#9ca3af" }}>
                    <strong style={{ color: "#6b7280" }}>Currently restricted:</strong>{" "}
                    {restrictedNames.join(", ")}.
                  </div>
                )}
              </div>

              {/* ── Sensitivity panel ───────────────────────────────────────── */}
              <div style={{ marginTop: 28 }}>
                <div
                  style={{
                    fontFamily: "Arial, Helvetica, sans-serif",
                    fontSize: 15,
                    fontWeight: 700,
                    color: "#1a1a1a",
                    marginBottom: 4,
                  }}
                >
                  Sensitivity
                  {selectedCompanyName && (
                    <span style={{ color: BRAND_ORANGE }}> — {selectedCompanyName}</span>
                  )}
                </div>
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
