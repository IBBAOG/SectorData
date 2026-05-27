"use client";

// Desktop View — /production (≥769px).
//
// Layout (top → bottom):
//   • Header — title + subtitle + period badge + Export panel (right)
//   • Topbar filter row — Empresa dropdown · Period slider · Ambientes multi-select
//   • KPI cards (4-wide) — Brazil oil · Company oil · Company gas · Company YTD avg
//   • Charts row 1 — P1 (Brazil oil, stacked) · P2 (Company oil, stacked)
//   • Charts row 2 — P3 (Top fields, horizontal bar) · P4 (Installations table)
//   • YoY table — TOTAL + per-ambiente rows
//
// Binding sync rule (CLAUDE.md § Dual-view policy): meaningful changes to one
// View must land in the OTHER View in the same commit, OR the commit message
// must declare [desktop-only] with an explicit reason.

import { useMemo } from "react";
import type { Layout, PlotData } from "plotly.js";

import NavBar from "../../../../components/NavBar";
import PlotlyChart from "../../../../components/PlotlyChart";
import DashboardHeader from "../../../../components/dashboard/DashboardHeader";
import MultiSelectFilter from "../../../../components/dashboard/MultiSelectFilter";
import PeriodSlider from "../../../../components/dashboard/PeriodSlider";
import ChartSection from "../../../../components/dashboard/ChartSection";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import ExportPanel from "../../../../components/dashboard/ExportPanel";
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot } from "../../../../lib/plotlyDefaults";
import { bblDiaToKbpd } from "../../../../lib/units";

import {
  useProductionData,
  fmtNumber,
  fmtPct,
  fmtMonthLabel,
  AMBIENTES,
  AMBIENTE_COLOR,
  BRAND_ORANGE,
  TOP_FIELDS_OIL_COLOR,
  TOP_FIELDS_WATER_COLOR,
} from "../useProductionData";
import type {
  ProductionBrazilRow,
  ProductionCompanyRow,
  ProductionTopField,
} from "../../../../types/production";

// ─── Chart builders ───────────────────────────────────────────────────────────

/** Build a stacked-bar trace per ambiente, x = month label, y = oil in kbpd. */
function buildStackedOilBars(
  rows: (ProductionBrazilRow | ProductionCompanyRow)[],
  variant: "brazil" | "company",
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!rows.length) return emptyPlot(320, "No data for the selected period.");

  // Distinct sorted months (YYYY-MM-01).
  const monthSet = new Set<string>();
  for (const r of rows) {
    monthSet.add(
      `${String(r.ano).padStart(4, "0")}-${String(r.mes).padStart(2, "0")}-01`,
    );
  }
  const months = Array.from(monthSet).sort();

  // Pivot: { ambiente -> { monthKey -> oil_bbl_dia } }
  const pivot: Record<string, Record<string, number>> = {};
  for (const a of AMBIENTES) pivot[a] = {};
  for (const r of rows) {
    const key = `${String(r.ano).padStart(4, "0")}-${String(r.mes).padStart(2, "0")}-01`;
    if (!pivot[r.ambiente]) pivot[r.ambiente] = {};
    pivot[r.ambiente][key] = (pivot[r.ambiente][key] ?? 0) + r.oil_bbl_dia;
  }

  // Build one trace per ambiente. Company uses brand orange for PreSal accent;
  // Brazil uses neutral greyscale.
  const traces: PlotData[] = AMBIENTES.map((amb) => {
    const baseColor = variant === "company" && amb === "PreSal"
      ? BRAND_ORANGE
      : AMBIENTE_COLOR[amb] ?? "#aaaaaa";
    return {
      type: "bar",
      name: amb,
      x: months,
      y: months.map((m) => bblDiaToKbpd(pivot[amb]?.[m] ?? 0)),
      marker: { color: baseColor },
      hovertemplate: `${amb}: %{y:,.1f} kbpd<extra></extra>`,
    } as PlotData;
  });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 320,
      margin: { t: 10, b: 60, l: 60, r: 20 },
      barmode: "stack",
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: "kbpd" } },
      xaxis: {
        ...AXIS_LINE,
        type: "date",
        tickformat: "%b %Y",
      },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0 },
    },
  };
}

/** Build a horizontal stacked bar: top fields, oil + water in kbpd. */
function buildTopFieldsChart(
  fields: ProductionTopField[],
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!fields.length) return emptyPlot(360, "No field-level data for this month.");

  // Sort DESC by oil (server already does it, but be defensive).
  const sorted = [...fields].sort((a, b) => b.oil_bbl_dia - a.oil_bbl_dia);
  const names = sorted.map((f) => f.campo);
  const oil = sorted.map((f) => bblDiaToKbpd(f.oil_bbl_dia));
  const water = sorted.map((f) => bblDiaToKbpd(f.water_bbl_dia));

  return {
    data: [
      {
        type: "bar",
        orientation: "h",
        name: "Oil",
        x: oil,
        y: names,
        marker: { color: TOP_FIELDS_OIL_COLOR },
        hovertemplate: "Oil: %{x:,.1f} kbpd<extra>%{y}</extra>",
      } as PlotData,
      {
        type: "bar",
        orientation: "h",
        name: "Water",
        x: water,
        y: names,
        marker: { color: TOP_FIELDS_WATER_COLOR },
        hovertemplate: "Water: %{x:,.1f} kbpd<extra>%{y}</extra>",
      } as PlotData,
    ],
    layout: {
      ...COMMON_LAYOUT,
      height: 360,
      margin: { t: 10, b: 40, l: 140, r: 20 },
      barmode: "stack",
      yaxis: {
        ...AXIS_LINE,
        autorange: "reversed",
        automargin: true,
        tickfont: { size: 11 },
      },
      xaxis: { ...AXIS_LINE, title: { text: "kbpd" } },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0 },
    },
  };
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  unit,
  accent,
  delta,
}: {
  label: string;
  value: string;
  unit: string;
  accent?: boolean;
  delta?: { pct: number | null; label: string };
}): React.ReactElement {
  const deltaSign = delta?.pct == null ? null : delta.pct >= 0 ? "up" : "down";
  const deltaColor = deltaSign === "up" ? "#197a39" : deltaSign === "down" ? "#b3261e" : "#888";
  const deltaArrow = deltaSign === "up" ? "▲" : deltaSign === "down" ? "▼" : "";
  return (
    <div
      style={{
        border: "1px solid #e0e0e0",
        borderRadius: 8,
        padding: "14px 18px",
        background: "#ffffff",
        flex: "1 1 0",
        minWidth: 0,
        borderLeft: accent ? `4px solid ${BRAND_ORANGE}` : "4px solid transparent",
      }}
    >
      <div
        style={{
          fontFamily: "Arial",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.4px",
          color: "#888",
          fontWeight: 600,
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "Arial",
          fontSize: 24,
          fontWeight: 700,
          color: "#1a1a1a",
          lineHeight: 1.1,
        }}
      >
        {value}
        <span style={{ fontSize: 12, fontWeight: 500, color: "#888", marginLeft: 6 }}>
          {unit}
        </span>
      </div>
      {delta && delta.pct != null && (
        <div
          style={{
            marginTop: 6,
            fontFamily: "Arial",
            fontSize: 11,
            fontWeight: 600,
            color: deltaColor,
          }}
        >
          {deltaArrow} {fmtPct(delta.pct)} {delta.label}
        </div>
      )}
    </div>
  );
}

// ─── View ─────────────────────────────────────────────────────────────────────

export default function DesktopView(): React.ReactElement | null {
  const {
    visible, visLoading,
    bootstrapping,
    empresasList, empresa, setEmpresa,
    allMonths, dateRange, monthIdxRange, setMonthIdxRange,
    ambientes, toggleAmbiente, setAmbientes,
    referenceDate, setReferenceDate,
    brazilData, companyData, topFields, installations, yoyTable,
    brazilLoading, companyLoading, topFieldsLoading, installationsLoading, yoyLoading,
    kpi,
    excelLoading, csvLoading,
    handleExportExcel, handleExportCsv,
  } = useProductionData();

  // ── Chart memoisation ─────────────────────────────────────────────────────
  const brazilChart = useMemo(
    () => buildStackedOilBars(brazilData, "brazil"),
    [brazilData],
  );
  const companyChart = useMemo(
    () => buildStackedOilBars(companyData, "company"),
    [companyData],
  );
  const topFieldsChart = useMemo(
    () => buildTopFieldsChart(topFields),
    [topFields],
  );

  // ── Empresa dropdown options ──────────────────────────────────────────────
  const dropdownOptions = useMemo(() => {
    const list = empresasList.length ? empresasList : [{ empresa, n_campos: 0 }];
    // Make sure the current empresa is selectable even if not in the list yet.
    if (!list.find((e) => e.empresa === empresa)) {
      return [{ empresa, n_campos: 0 }, ...list];
    }
    return list;
  }, [empresasList, empresa]);

  // ── Period badge label ────────────────────────────────────────────────────
  const periodBadge: [string, string] | null =
    dateRange[0] && dateRange[1] ? [fmtMonthLabel(dateRange[0]), fmtMonthLabel(dateRange[1])] : null;

  // ── Reference month dropdown options (within current dateRange) ───────────
  const refMonthOptions = useMemo(() => {
    if (allMonths.length === 0) return [];
    const [i0, i1] = monthIdxRange;
    return allMonths.slice(i0, i1 + 1);
  }, [allMonths, monthIdxRange]);

  if (visLoading || !visible) return null;

  return (
    <div>
      <NavBar />
      <div className="container-fluid" style={{ padding: "20px 24px 80px" }}>
        <DashboardHeader
          title="Production"
          sub="Monthly oil & gas production from ANP CDP — company-attributable via field stakes"
          period={periodBadge}
          rightSlot={
            <ExportPanel
              actions={[
                {
                  kind: "excel",
                  label: "Excel",
                  busy: excelLoading,
                  disabled: excelLoading || csvLoading || bootstrapping,
                  loadingLabel: "Building workbook…",
                  onClick: handleExportExcel,
                },
                {
                  kind: "csv",
                  label: "CSV (zip)",
                  busy: csvLoading,
                  disabled: excelLoading || csvLoading || bootstrapping,
                  loadingLabel: "Building zip…",
                  onClick: handleExportCsv,
                },
              ]}
            />
          }
        />

        {bootstrapping ? (
          <div style={{ marginTop: 40 }}>
            <BarrelLoading />
            <div style={{ textAlign: "center", color: "#888", fontFamily: "Arial", fontSize: 13 }}>
              Loading production data…
            </div>
          </div>
        ) : (
          <>
            {/* ── Topbar filters ──────────────────────────────────────────── */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 24,
                alignItems: "flex-start",
                padding: "16px 0",
                borderBottom: "1px solid #f0f0f0",
                marginBottom: 20,
              }}
            >
              {/* Empresa */}
              <div style={{ minWidth: 220, flex: "0 0 220px" }}>
                <label
                  style={{
                    display: "block",
                    fontFamily: "Arial",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#1a1a1a",
                    textTransform: "uppercase",
                    letterSpacing: "0.4px",
                    marginBottom: 6,
                  }}
                >
                  Company
                </label>
                <select
                  value={empresa}
                  onChange={(e) => setEmpresa(e.target.value)}
                  style={{
                    width: "100%",
                    fontFamily: "Arial",
                    fontSize: 13,
                    padding: "8px 10px",
                    border: "1px solid #c5c5cb",
                    borderRadius: 6,
                    background: "#ffffff",
                  }}
                >
                  {dropdownOptions.map((opt) => (
                    <option key={opt.empresa} value={opt.empresa}>
                      {opt.empresa}{opt.n_campos > 0 ? ` (${opt.n_campos} fields)` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* Period */}
              <div style={{ flex: "1 1 360px", minWidth: 320 }}>
                <label
                  style={{
                    display: "block",
                    fontFamily: "Arial",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#1a1a1a",
                    textTransform: "uppercase",
                    letterSpacing: "0.4px",
                    marginBottom: 6,
                  }}
                >
                  Period
                </label>
                {allMonths.length > 0 && (
                  <PeriodSlider
                    dates={allMonths}
                    value={monthIdxRange}
                    onChange={setMonthIdxRange}
                    fmtLabel={(d) => fmtMonthLabel(d)}
                  />
                )}
              </div>

              {/* Ambiente */}
              <div style={{ minWidth: 180, flex: "0 0 180px" }}>
                <MultiSelectFilter
                  label="Environment"
                  items={AMBIENTES as unknown as string[]}
                  selected={ambientes}
                  onToggle={toggleAmbiente}
                  onClear={ambientes.length < AMBIENTES.length ? () => setAmbientes([...AMBIENTES]) : undefined}
                  idPrefix="prod-amb"
                  swatch={(item) => AMBIENTE_COLOR[item] ?? "#aaa"}
                />
              </div>

              {/* Reference month (for top fields / FPSOs / YoY) */}
              <div style={{ minWidth: 180, flex: "0 0 180px" }}>
                <label
                  style={{
                    display: "block",
                    fontFamily: "Arial",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#1a1a1a",
                    textTransform: "uppercase",
                    letterSpacing: "0.4px",
                    marginBottom: 6,
                  }}
                >
                  Reference month
                </label>
                <select
                  value={referenceDate}
                  onChange={(e) => setReferenceDate(e.target.value)}
                  style={{
                    width: "100%",
                    fontFamily: "Arial",
                    fontSize: 13,
                    padding: "8px 10px",
                    border: "1px solid #c5c5cb",
                    borderRadius: 6,
                    background: "#ffffff",
                  }}
                >
                  {refMonthOptions.map((m) => (
                    <option key={m} value={m}>{fmtMonthLabel(m)}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* ── KPI cards ──────────────────────────────────────────────── */}
            <div
              style={{
                display: "flex",
                gap: 14,
                marginBottom: 24,
                flexWrap: "wrap",
              }}
            >
              <KpiCard
                label="Brazil oil"
                value={fmtNumber(kpi.brazilOilKbpd, 0)}
                unit="kbpd"
              />
              <KpiCard
                accent
                label={`${empresa} oil`}
                value={fmtNumber(kpi.companyOilKbpd, 0)}
                unit="kbpd"
                delta={
                  kpi.companyMomPct != null
                    ? { pct: kpi.companyMomPct, label: "MoM" }
                    : undefined
                }
              />
              <KpiCard
                accent
                label={`${empresa} gas`}
                value={fmtNumber(kpi.companyGasMm3d, 1)}
                unit="Mm³/d"
              />
              <KpiCard
                accent
                label={`${empresa} YTD avg`}
                value={fmtNumber(kpi.companyYtdAvgKbpd, 0)}
                unit="kbpd"
                delta={
                  kpi.companyYoyPct != null
                    ? { pct: kpi.companyYoyPct, label: "YoY" }
                    : undefined
                }
              />
            </div>

            {/* ── Charts row 1 ────────────────────────────────────────────── */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 16,
                marginBottom: 16,
              }}
            >
              <ChartSection
                title="Brazil — Oil Production (kbpd)"
                loading={brazilLoading}
                height={320}
              >
                <PlotlyChart
                  data={brazilChart.data}
                  layout={brazilChart.layout}
                  style={{ width: "100%", height: 320 }}
                />
              </ChartSection>
              <ChartSection
                title={`${empresa} — Oil Production (kbpd, stake-weighted)`}
                loading={companyLoading}
                height={320}
              >
                <PlotlyChart
                  data={companyChart.data}
                  layout={companyChart.layout}
                  style={{ width: "100%", height: 320 }}
                />
              </ChartSection>
            </div>

            {/* ── Charts row 2 ────────────────────────────────────────────── */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 16,
                marginBottom: 16,
              }}
            >
              <ChartSection
                title={`Top ${empresa} Fields — ${fmtMonthLabel(referenceDate)} (kbpd)`}
                loading={topFieldsLoading}
                height={360}
              >
                <PlotlyChart
                  data={topFieldsChart.data}
                  layout={topFieldsChart.layout}
                  style={{ width: "100%", height: 360 }}
                />
              </ChartSection>
              <ChartSection
                title={`Installations (FPSO/UEP) — ${fmtMonthLabel(referenceDate)}`}
                loading={installationsLoading}
                height={360}
              >
                <div
                  style={{
                    maxHeight: 360,
                    overflowY: "auto",
                    fontFamily: "Arial",
                    fontSize: 12,
                  }}
                >
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead style={{ position: "sticky", top: 0, background: "#fafafa" }}>
                      <tr>
                        <th style={thStyle}>Installation</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>Oil (kbpd)</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>Gas (Mm³/d)</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>Hours rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {installations.slice(0, 12).map((inst) => (
                        <tr key={inst.instalacao}>
                          <td style={tdStyle}>{inst.instalacao}</td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>
                            {fmtNumber(bblDiaToKbpd(inst.oil_bbl_dia), 1)}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>
                            {fmtNumber(inst.gas_mm3_dia, 2)}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>
                            {(inst.hours_rate * 100).toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                      {installations.length === 0 && (
                        <tr>
                          <td
                            colSpan={4}
                            style={{ ...tdStyle, textAlign: "center", color: "#888", padding: 20 }}
                          >
                            No installations for this month.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </ChartSection>
            </div>

            {/* ── YoY table ─────────────────────────────────────────────── */}
            <ChartSection
              title={`${empresa} — YoY / MoM / YTD (${fmtMonthLabel(referenceDate)})`}
              loading={yoyLoading}
              height={180}
            >
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "Arial", fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Scope</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Current (kbpd)</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Δ MoM</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Δ YoY</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>YTD avg (kbpd)</th>
                  </tr>
                </thead>
                <tbody>
                  {yoyTable.map((row) => {
                    const isTotal = row.scope === "TOTAL";
                    return (
                      <tr
                        key={row.scope}
                        style={{
                          background: isTotal ? "#fafafa" : "transparent",
                          fontWeight: isTotal ? 700 : 400,
                        }}
                      >
                        <td style={tdStyle}>{row.scope}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {fmtNumber(row.current_kbpd, 0)}
                        </td>
                        <td
                          style={{
                            ...tdStyle,
                            textAlign: "right",
                            color: row.mom_pct != null && row.mom_pct >= 0 ? "#197a39" : "#b3261e",
                          }}
                        >
                          {fmtPct(row.mom_pct)}
                        </td>
                        <td
                          style={{
                            ...tdStyle,
                            textAlign: "right",
                            color: row.yoy_pct != null && row.yoy_pct >= 0 ? "#197a39" : "#b3261e",
                          }}
                        >
                          {fmtPct(row.yoy_pct)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {fmtNumber(row.ytd_avg_kbpd, 0)}
                        </td>
                      </tr>
                    );
                  })}
                  {yoyTable.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ ...tdStyle, textAlign: "center", color: "#888", padding: 20 }}>
                        No YoY data for this reference month.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </ChartSection>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Inline table styles ──────────────────────────────────────────────────────
const thStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderBottom: "1px solid #e0e0e0",
  fontWeight: 600,
  textAlign: "left",
  color: "#1a1a1a",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.4px",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderBottom: "1px solid #f0f0f0",
  color: "#1a1a1a",
};
