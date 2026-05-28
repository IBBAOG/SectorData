"use client";

// ─── Mobile view for /subsidy-tracker (v2 — Onda 3 mobile reform) ─────────────
//
// Re-layout from the original 1034-LOC dual-agent-block view to:
//
//   1. Top sticky filter chips: Period (30D/90D/6M/1Y/All) +
//      Agent toggle (Importador / Produtor)
//   2. Hero multi-line chart for the active agent (4 traces, brand colours)
//      + color-key legend chips below
//   3. 11-column horizontal-scroll data table — first column (Date) sticky
//      Columns: Date | IPP | IPP adj. | Petrobras | Petrobras adj. |
//               Ref (Imp.) | Ref (Prod.) | Comm. (Imp.) | Comm. (Prod.) |
//               Reimb. (Imp.) | Reimb. (Prod.)
//
// [mobile-only] divergences vs. desktop (preserved from v1 + additions):
//   • Agent toggle chip selects which chart is shown (desktop shows both
//     side-by-side; mobile stacks but defaults to one at a time).
//   • Regional ANP Reference breakdown is NOT a hover tooltip here — touch
//     devices have no hover; the full table row exposes per-region detail.
//   • End-of-line value annotations dropped (overflow on narrow viewports).
//   • ExportFAB removed (§ 3.4 policy — export desktop-only).
//   • FilterDrawer with per-trace toggles kept for series visibility.
//
// Binding sync rule: any new filter / chart / KPI added here must also land
// in desktop/View.tsx in the same commit, or declare [mobile-only] with reason.

import { useCallback, useMemo, useState } from "react";
import type { Layout } from "plotly.js";

import {
  FilterDrawer,
  MobileChart,
  FunnelIcon,
} from "@/components/dashboard/mobile";
import BarrelLoading from "@/components/dashboard/BarrelLoading";
import PeriodSlider from "@/components/dashboard/PeriodSlider";
import { useModuleVisibilityGuard } from "@/hooks/useModuleVisibilityGuard";
import {
  useSubsidyTrackerData,
  fmtDateLabel,
  SERIES_IMPORTADOR,
  SERIES_PRODUTOR,
  type SeriesField,
  type SeriesDef,
  type SubsidyTrackerRow,
} from "../useSubsidyTrackerData";

// ─── Period chip helpers ──────────────────────────────────────────────────────

interface DateChip {
  label: string;
  /** Days to go back from the latest data point. null = full window. */
  days: number | null;
}

const DATE_CHIPS: DateChip[] = [
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
  { label: "6M",  days: 180 },
  { label: "1Y",  days: 365 },
  { label: "All", days: null },
];

function chipSliderRange(
  datas: string[],
  days: number | null,
): [number, number] {
  if (datas.length === 0) return [0, 0];
  const end = datas.length - 1;
  if (days == null) return [0, end];
  const latestDate = new Date(datas[end] + "T00:00:00Z");
  latestDate.setUTCDate(latestDate.getUTCDate() - days);
  const cutoff = latestDate.toISOString().slice(0, 10);
  const startIdx = Math.max(0, datas.findIndex((d) => d >= cutoff));
  return [startIdx, end];
}

function activeChipDays(
  datas: string[],
  sliderRange: [number, number],
): number | null | "none" {
  for (const chip of DATE_CHIPS) {
    const [s, e] = chipSliderRange(datas, chip.days);
    if (s === sliderRange[0] && e === sliderRange[1]) {
      return chip.days;
    }
  }
  return "none";
}

// ─── Agent types ──────────────────────────────────────────────────────────────

type AgentType = "importador" | "produtor";

// ─── Color-line glyph (solid or dashed) ──────────────────────────────────────

function ColorLine({
  color,
  dashed,
}: {
  color: string;
  dashed?: boolean;
}): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 18,
        height: 0,
        borderTop: `2px ${dashed ? "dashed" : "solid"} ${color}`,
        flexShrink: 0,
      }}
    />
  );
}

// ─── Mobile chart layout override ────────────────────────────────────────────

function mobileChartLayout(): Partial<Layout> {
  return {
    height: 280,
    showlegend: false,
    hovermode: "x unified",
    margin: { l: 44, r: 12, t: 8, b: 40 },
    xaxis: {
      type: "date",
      tickformat: "%b %d",
      hoverformat: "%b %d, %Y",
      nticks: 5,
      tickangle: 0,
      tickfont: { size: 10 },
    },
    yaxis: {
      title: { text: "BRL/L", font: { size: 10 } },
      tickformat: ".2f",
      nticks: 5,
      tickfont: { size: 10 },
    },
    // Remove desktop end-of-line annotations (overflow on narrow viewports)
    annotations: [],
  };
}

// ─── Mirror map: ANP series keys that must move in lockstep ──────────────────

const MIRROR_MAP: Partial<Record<SeriesField, SeriesField>> = {
  anp_reference_importador:         "anp_reference_produtor",
  anp_reference_produtor:           "anp_reference_importador",
  anp_commercialization_importador: "anp_commercialization_produtor",
  anp_commercialization_produtor:   "anp_commercialization_importador",
};

// ─── Filter-drawer toggle list ────────────────────────────────────────────────
// 6 unique concepts. ANP Reference / Commercialization get ONE toggle each
// (keyed on the importador field); MIRROR_MAP propagates to the produtor key.

interface FilterToggle {
  field: SeriesField;
  label: string;
  color: string;
  dash?: "solid" | "dash";
}

const FILTER_TOGGLES: FilterToggle[] = [
  { field: "ipp",                              label: "IPP",                   color: "#111111" },
  { field: "ipp_adjusted",                     label: "IPP (adjusted)",        color: "#111111", dash: "dash" },
  { field: "petrobras",                        label: "Petrobras",             color: "#0F766E" },
  { field: "petrobras_adjusted",               label: "Petrobras (adjusted)",  color: "#0F766E", dash: "dash" },
  { field: "anp_reference_importador",         label: "ANP Reference",         color: "#F59E0B" },
  { field: "anp_commercialization_importador", label: "ANP Commercialization", color: "#B91C1C" },
];

// ─── 11-column horizontal-scroll data table ───────────────────────────────────
//
// Columns: Date | IPP | IPP adj. | Petrobras | Petrobras adj. |
//          Ref (Imp.) | Ref (Prod.) | Comm. (Imp.) | Comm. (Prod.) |
//          Reimb. (Imp.) | Reimb. (Prod.)
//
// Reimbursement = Reference − Commercialization per agent.
// First column (Date) is sticky. Horizontal scroll for the rest.

interface TableRow {
  date: string;
  ipp: number | null;
  ipp_adjusted: number | null;
  petrobras: number | null;
  petrobras_adjusted: number | null;
  anp_reference_importador: number | null;
  anp_reference_produtor: number | null;
  anp_commercialization_importador: number | null;
  anp_commercialization_produtor: number | null;
  reimb_importador: number | null;
  reimb_produtor: number | null;
}

function buildTableRows(
  rows: SubsidyTrackerRow[],
  xMin: string | null,
  xMax: string | null,
): TableRow[] {
  const scoped = rows
    .filter((r) => (!xMin || r.date >= xMin) && (!xMax || r.date <= xMax))
    .sort((a, b) => b.date.localeCompare(a.date)); // newest first

  return scoped.map((r) => {
    const reimb_importador =
      r.anp_reference_importador != null && r.anp_commercialization_importador != null
        ? r.anp_reference_importador - r.anp_commercialization_importador
        : null;
    const reimb_produtor =
      r.anp_reference_produtor != null && r.anp_commercialization_produtor != null
        ? r.anp_reference_produtor - r.anp_commercialization_produtor
        : null;
    return {
      date: r.date,
      ipp: r.ipp,
      ipp_adjusted: r.ipp_adjusted,
      petrobras: r.petrobras,
      petrobras_adjusted: r.petrobras_adjusted,
      anp_reference_importador: r.anp_reference_importador,
      anp_reference_produtor: r.anp_reference_produtor,
      anp_commercialization_importador: r.anp_commercialization_importador,
      anp_commercialization_produtor: r.anp_commercialization_produtor,
      reimb_importador,
      reimb_produtor,
    };
  });
}

function fmt(v: number | null): string {
  return v != null && Number.isFinite(v) ? v.toFixed(2) : "—";
}

interface ColDef {
  header: string;
  key: keyof TableRow;
  color?: string;
}

const TABLE_COLS: ColDef[] = [
  { header: "IPP",            key: "ipp",                              color: "#111111" },
  { header: "IPP adj.",       key: "ipp_adjusted",                     color: "#111111" },
  { header: "Petrobras",      key: "petrobras",                        color: "#0F766E" },
  { header: "PB adj.",        key: "petrobras_adjusted",               color: "#0F766E" },
  { header: "Ref. (Imp.)",    key: "anp_reference_importador",         color: "#F59E0B" },
  { header: "Ref. (Prod.)",   key: "anp_reference_produtor",           color: "#F59E0B" },
  { header: "Comm. (Imp.)",   key: "anp_commercialization_importador", color: "#B91C1C" },
  { header: "Comm. (Prod.)",  key: "anp_commercialization_produtor",   color: "#B91C1C" },
  { header: "Reimb. (Imp.)",  key: "reimb_importador",                 color: "#6D28D9" },
  { header: "Reimb. (Prod.)", key: "reimb_produtor",                   color: "#6D28D9" },
];

const CELL_WIDTH = 84; // px per data column
const DATE_COL_WIDTH = 82; // px — sticky first column

function DataTable({
  tableRows,
}: {
  tableRows: TableRow[];
}): React.ReactElement {
  // Cap visible rows at 120 to keep render fast; table still scrolls vertically
  const visible = tableRows.slice(0, 120);

  return (
    <div
      style={{
        overflowX: "auto",
        overflowY: "auto",
        maxHeight: 340,
        WebkitOverflowScrolling: "touch",
        borderTop: "1px solid var(--mobile-divider)",
        borderBottom: "1px solid var(--mobile-divider)",
      }}
    >
      <table
        style={{
          borderCollapse: "collapse",
          fontSize: 11,
          fontFamily: "Arial, Helvetica, sans-serif",
          tableLayout: "fixed",
          width: DATE_COL_WIDTH + TABLE_COLS.length * CELL_WIDTH,
          minWidth: DATE_COL_WIDTH + TABLE_COLS.length * CELL_WIDTH,
        }}
      >
        <thead>
          <tr
            style={{
              background: "var(--mobile-surface)",
              borderBottom: "1px solid var(--mobile-divider)",
            }}
          >
            {/* Sticky date header */}
            <th
              style={{
                position: "sticky",
                left: 0,
                zIndex: 3,
                background: "var(--mobile-surface)",
                width: DATE_COL_WIDTH,
                minWidth: DATE_COL_WIDTH,
                padding: "6px 8px",
                textAlign: "left",
                fontWeight: 700,
                color: "var(--mobile-text)",
                borderRight: "1px solid var(--mobile-divider)",
                fontSize: 10,
              }}
            >
              Date
            </th>
            {TABLE_COLS.map((col) => (
              <th
                key={col.key}
                style={{
                  width: CELL_WIDTH,
                  minWidth: CELL_WIDTH,
                  padding: "6px 6px",
                  textAlign: "right",
                  fontWeight: 700,
                  color: col.color ?? "var(--mobile-text)",
                  fontSize: 10,
                  whiteSpace: "nowrap",
                }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? (
            <tr>
              <td
                colSpan={TABLE_COLS.length + 1}
                style={{
                  padding: "20px 8px",
                  textAlign: "center",
                  color: "var(--mobile-text-muted)",
                  fontSize: 12,
                }}
              >
                No data in selected period
              </td>
            </tr>
          ) : (
            visible.map((row, i) => (
              <tr
                key={row.date}
                style={{
                  background:
                    i % 2 === 0
                      ? "var(--mobile-surface)"
                      : "var(--mobile-bg)",
                  borderBottom: "1px solid var(--mobile-divider)",
                }}
              >
                {/* Sticky date cell */}
                <td
                  style={{
                    position: "sticky",
                    left: 0,
                    zIndex: 2,
                    background: i % 2 === 0
                      ? "var(--mobile-surface)"
                      : "var(--mobile-bg)",
                    width: DATE_COL_WIDTH,
                    minWidth: DATE_COL_WIDTH,
                    padding: "5px 8px",
                    fontWeight: 600,
                    color: "var(--mobile-text)",
                    borderRight: "1px solid var(--mobile-divider)",
                    fontSize: 11,
                    whiteSpace: "nowrap",
                  }}
                >
                  {fmtDateLabel(row.date)}
                </td>
                {TABLE_COLS.map((col) => (
                  <td
                    key={col.key}
                    style={{
                      padding: "5px 6px",
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                      color: "var(--mobile-text)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {fmt(row[col.key] as number | null)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Mobile View ──────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("subsidy-tracker");
  const {
    rows,
    loading,
    filters,
    setFilters,
    resetFilters,
    datas,
    xMin,
    xMax,
    chartImporter,
    chartProducer,
  } = useSubsidyTrackerData();

  const [drawerOpen, setDrawerOpen] = useState(false);
  // Agent toggle: which agent chart / series key is shown in the hero chart
  const [agent, setAgent] = useState<AgentType>("importador");

  // Active period chip
  const activeDays = useMemo(
    () => activeChipDays(datas, filters.sliderRange),
    [datas, filters.sliderRange],
  );

  const handleChip = useCallback(
    (days: number | null) => {
      setFilters({ sliderRange: chipSliderRange(datas, days) });
    },
    [datas, setFilters],
  );

  const toggleTrace = useCallback(
    (field: SeriesField) => {
      const newVal = !filters.traces[field];
      const mirror = MIRROR_MAP[field];
      setFilters({
        traces: {
          ...filters.traces,
          [field]: newVal,
          ...(mirror != null ? { [mirror]: newVal } : {}),
        },
      });
    },
    [filters.traces, setFilters],
  );

  const traceVisible = useCallback(
    (field: SeriesField): boolean => filters.traces[field] !== false,
    [filters.traces],
  );

  // Hero chart: pick based on active agent
  const heroChart = agent === "importador" ? chartImporter : chartProducer;
  const heroLayout = useMemo<Partial<Layout>>(
    () => ({ ...mobileChartLayout(), annotations: [] }),
    [],
  );

  // Series color-key for the active agent
  const activeSeries: SeriesDef[] =
    agent === "importador" ? SERIES_IMPORTADOR : SERIES_PRODUTOR;

  // 11-column table rows (all data, both agents, newest first)
  const tableRows = useMemo(
    () => buildTableRows(rows, xMin, xMax),
    [rows, xMin, xMax],
  );

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
        Diesel — ANP Reference &amp; Commercialization vs IPP &amp; Petrobras
        (BRL/L)
      </div>

      {/* ── Filter chip row: Period + Agent toggle ────────────────────────── */}
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
        {/* Period chips */}
        {DATE_CHIPS.map((chip) => {
          const isActive = activeDays === chip.days;
          return (
            <button
              key={chip.label}
              type="button"
              onClick={() => handleChip(chip.days)}
              style={{
                flexShrink: 0,
                padding: "6px 13px",
                borderRadius: 20,
                border: "1px solid",
                borderColor: isActive
                  ? "var(--mobile-accent)"
                  : "var(--mobile-divider)",
                background: isActive
                  ? "var(--mobile-accent)"
                  : "var(--mobile-surface)",
                color: isActive ? "#fff" : "var(--mobile-text-muted)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                minHeight: 36,
                fontFamily: "inherit",
                transition: "background 0.15s ease, color 0.15s ease",
              }}
            >
              {chip.label}
            </button>
          );
        })}

        {/* Divider pip */}
        <span
          aria-hidden="true"
          style={{
            width: 1,
            height: 20,
            background: "var(--mobile-divider)",
            flexShrink: 0,
            margin: "0 2px",
          }}
        />

        {/* Agent toggle: Importador / Produtor */}
        {(["importador", "produtor"] as AgentType[]).map((a) => {
          const isActive = agent === a;
          return (
            <button
              key={a}
              type="button"
              onClick={() => setAgent(a)}
              style={{
                flexShrink: 0,
                padding: "6px 13px",
                borderRadius: 20,
                border: "1px solid",
                borderColor: isActive
                  ? "var(--mobile-accent)"
                  : "var(--mobile-divider)",
                background: isActive
                  ? "var(--mobile-accent)"
                  : "var(--mobile-surface)",
                color: isActive ? "#fff" : "var(--mobile-text-muted)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                minHeight: 36,
                fontFamily: "inherit",
                textTransform: "capitalize",
                transition: "background 0.15s ease, color 0.15s ease",
              }}
            >
              {a.charAt(0).toUpperCase() + a.slice(1)}
            </button>
          );
        })}

        {/* Divider pip before filter button */}
        <span
          aria-hidden="true"
          style={{
            width: 1,
            height: 20,
            background: "var(--mobile-divider)",
            flexShrink: 0,
            margin: "0 2px",
          }}
        />

        {/* Filter button — opens FilterDrawer */}
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
          {/* ── Hero chart ───────────────────────────────────────────────────── */}
          <div
            style={{
              marginTop: 16,
              background: "var(--mobile-surface)",
              borderTop: "1px solid var(--mobile-divider)",
              borderBottom: "1px solid var(--mobile-divider)",
              padding: "0 8px 8px",
            }}
          >
            {/* Section header */}
            <div
              style={{
                padding: "10px 8px 2px",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.07em",
                textTransform: "uppercase",
                color: "var(--mobile-text-muted)",
              }}
            >
              {agent === "importador"
                ? "Importador Reference Prices"
                : "Produtor Reference Prices"}
            </div>

            <MobileChart
              data={heroChart.data}
              layout={heroLayout}
              height={280}
            />

            {/* Color-key legend — 4 traces, 2-col grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "4px 12px",
                padding: "4px 8px 0",
              }}
            >
              {activeSeries
                .filter((s) => traceVisible(s.field))
                .map((s) => (
                  <div
                    key={s.field}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 11,
                      color: "var(--mobile-text-muted)",
                      minHeight: 22,
                    }}
                  >
                    <ColorLine color={s.color} dashed={s.dash === "dash"} />
                    <span style={{ lineHeight: 1.2 }}>{s.label}</span>
                  </div>
                ))}
            </div>
          </div>

          {/* ── 11-column data table ─────────────────────────────────────────── */}
          <div style={{ marginTop: 20 }}>
            <div
              style={{
                padding: "0 16px 8px",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.07em",
                textTransform: "uppercase",
                color: "var(--mobile-text-muted)",
              }}
            >
              Data table — all series
              <span
                style={{
                  fontWeight: 400,
                  textTransform: "none",
                  letterSpacing: 0,
                  marginLeft: 6,
                }}
              >
                (BRL/L · scroll right →)
              </span>
            </div>
            <DataTable tableRows={tableRows} />
          </div>

          {/* ── Date range footer ─────────────────────────────────────────────── */}
          {xMin && xMax && (
            <div
              style={{
                padding: "10px 16px 0",
                fontSize: 12,
                color: "var(--mobile-text-muted)",
              }}
            >
              {fmtDateLabel(xMin)} – {fmtDateLabel(xMax)}
            </div>
          )}
        </>
      )}

      {/* ── Filter drawer ─────────────────────────────────────────────────────── */}
      <FilterDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Filters"
        onReset={() => {
          resetFilters();
        }}
        onApply={() => setDrawerOpen(false)}
        applyLabel="Apply"
      >
        {/* Period slider */}
        <div style={{ marginBottom: 20 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "var(--mobile-text)",
              marginBottom: 10,
              fontFamily: "Arial",
            }}
          >
            Period
          </div>
          {datas.length > 0 && (
            <PeriodSlider
              dates={datas}
              value={filters.sliderRange}
              onChange={(v) => setFilters({ sliderRange: v })}
              sliderId="subsidy-slider-mobile"
            />
          )}
          {xMin && xMax && (
            <div
              style={{
                marginTop: 8,
                fontSize: 12,
                color: "var(--mobile-text-muted)",
                fontFamily: "Arial",
              }}
            >
              {fmtDateLabel(xMin)} – {fmtDateLabel(xMax)}
            </div>
          )}
        </div>

        {/* Trace visibility toggles */}
        <div
          style={{
            paddingTop: 12,
            borderTop: "1px solid var(--mobile-divider)",
          }}
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
            Series (ANP toggles govern both agent charts)
          </div>
          {FILTER_TOGGLES.map((s) => {
            const on = filters.traces[s.field] !== false;
            return (
              <div
                key={s.field}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 0",
                  borderBottom: "1px solid var(--mobile-divider)",
                }}
              >
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <ColorLine
                    color={s.color}
                    dashed={s.dash === "dash"}
                  />
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: "var(--mobile-text)",
                      fontFamily: "Arial",
                    }}
                  >
                    {s.label}
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  onClick={() => toggleTrace(s.field)}
                  style={{
                    width: 48,
                    height: 28,
                    borderRadius: 14,
                    border: 0,
                    background: on
                      ? "var(--mobile-accent)"
                      : "var(--mobile-divider)",
                    position: "relative",
                    cursor: "pointer",
                    transition: "background 0.2s ease",
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: 3,
                      left: on ? 22 : 3,
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: "#fff",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
                      transition: "left 0.18s ease",
                    }}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </FilterDrawer>
    </div>
  );
}
