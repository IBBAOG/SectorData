"use client";

// Mobile View — /production (≤768px).
//
// Layout (top → bottom):
//   MobileTopBar              — wordmark
//   StickyBreadcrumb          — "Production › <Empresa> › <Ref month>"
//   MobileTabBar              — Brazil · {Empresa} · Fields · FPSOs
//   Tab content               — one chart full-width + KPI cards / table per tab
//   YoY expandable section    — bottom, expands when tapped
//   ExportFAB                 — opens an action sheet to pick Excel or CSV
//   FilterDrawer              — empresa + period + ambientes + reference month
//
// Mobile is "same analysis, adapted clothing" — same hook, same metrics, same
// stake-weighting, presented one panel at a time so it's legible on a phone.
//
// Binding sync rule (CLAUDE.md § Dual-view policy): meaningful changes to one
// View must land in the OTHER View in the same commit, OR the commit message
// must declare [mobile-only] with an explicit reason.

import { useMemo, useState } from "react";
import type { PlotData } from "plotly.js";

import {
  MobileTopBar,
  FilterDrawer,
  MobileChart,
  MobileDataCard,
  ExportFAB,
  MobileTabBar,
  FilterIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "../../../../components/dashboard/mobile";
import StickyBreadcrumb from "../../../../components/dashboard/mobile/StickyBreadcrumb";
import MultiSelectFilter from "../../../../components/dashboard/MultiSelectFilter";
import PeriodSlider from "../../../../components/dashboard/PeriodSlider";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
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

type Tab = "brazil" | "company" | "fields" | "fpsos";

// ─── Mobile chart builders ───────────────────────────────────────────────────

function buildStackedSeries(
  rows: (ProductionBrazilRow | ProductionCompanyRow)[],
  variant: "brazil" | "company",
): PlotData[] {
  if (!rows.length) return [];
  const monthSet = new Set<string>();
  for (const r of rows) {
    monthSet.add(`${String(r.ano).padStart(4, "0")}-${String(r.mes).padStart(2, "0")}-01`);
  }
  const months = Array.from(monthSet).sort();

  const pivot: Record<string, Record<string, number>> = {};
  for (const a of AMBIENTES) pivot[a] = {};
  for (const r of rows) {
    const key = `${String(r.ano).padStart(4, "0")}-${String(r.mes).padStart(2, "0")}-01`;
    if (!pivot[r.ambiente]) pivot[r.ambiente] = {};
    pivot[r.ambiente][key] = (pivot[r.ambiente][key] ?? 0) + r.oil_bbl_dia;
  }

  return AMBIENTES.map((amb) => {
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
}

function buildTopFieldsHBars(fields: ProductionTopField[]): PlotData[] {
  if (!fields.length) return [];
  const sorted = [...fields].sort((a, b) => b.oil_bbl_dia - a.oil_bbl_dia);
  const names = sorted.map((f) => f.campo);
  const oil = sorted.map((f) => bblDiaToKbpd(f.oil_bbl_dia));
  const water = sorted.map((f) => bblDiaToKbpd(f.water_bbl_dia));
  return [
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
  ];
}

// ─── Small KPI tile (mobile) ──────────────────────────────────────────────────

function MobileKpi({
  label,
  value,
  unit,
  delta,
}: {
  label: string;
  value: string;
  unit: string;
  delta?: { pct: number | null; label: string };
}): React.ReactElement {
  const deltaColor = delta?.pct == null ? "#888" : delta.pct >= 0 ? "#197a39" : "#b3261e";
  const deltaArrow = delta?.pct == null ? "" : delta.pct >= 0 ? "▲" : "▼";
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        background: "var(--mobile-surface, #ffffff)",
        border: "1px solid var(--mobile-border, #e6e6ec)",
        flex: "1 1 0",
        minWidth: 130,
      }}
    >
      <div
        style={{
          fontFamily: "Arial",
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          color: "var(--mobile-text-muted, #6b6b73)",
          letterSpacing: "0.4px",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "Arial",
          fontSize: 18,
          fontWeight: 700,
          color: "var(--mobile-text, #1a1a1a)",
          lineHeight: 1.1,
        }}
      >
        {value}
        <span style={{ fontSize: 10, fontWeight: 500, color: "#888", marginLeft: 4 }}>{unit}</span>
      </div>
      {delta && delta.pct != null && (
        <div style={{ marginTop: 4, fontFamily: "Arial", fontSize: 10, fontWeight: 600, color: deltaColor }}>
          {deltaArrow} {fmtPct(delta.pct)} {delta.label}
        </div>
      )}
    </div>
  );
}

// ─── View ─────────────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement | null {
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

  const [tab, setTab] = useState<Tab>("brazil");
  const [filterOpen, setFilterOpen] = useState(false);
  const [yoyOpen, setYoyOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  const dropdownOptions = useMemo(() => {
    const list = empresasList.length ? empresasList : [{ empresa, n_campos: 0 }];
    if (!list.find((e) => e.empresa === empresa)) {
      return [{ empresa, n_campos: 0 }, ...list];
    }
    return list;
  }, [empresasList, empresa]);

  const refMonthOptions = useMemo(() => {
    if (allMonths.length === 0) return [];
    const [i0, i1] = monthIdxRange;
    return allMonths.slice(i0, i1 + 1);
  }, [allMonths, monthIdxRange]);

  // Mobile-tuned chart data per tab
  const brazilSeries = useMemo(() => buildStackedSeries(brazilData, "brazil"), [brazilData]);
  const companySeries = useMemo(() => buildStackedSeries(companyData, "company"), [companyData]);
  const topFieldsSeries = useMemo(() => buildTopFieldsHBars(topFields), [topFields]);

  if (visLoading || !visible) return null;

  if (bootstrapping) {
    return (
      <div style={{ paddingTop: 60 }}>
        <BarrelLoading />
        <div style={{ textAlign: "center", color: "#888", fontFamily: "Arial", fontSize: 13, marginTop: 12 }}>
          Loading production data…
        </div>
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: 120, background: "var(--mobile-surface-bg, #f5f5f7)", minHeight: "100vh" }}>
      <MobileTopBar
        title="Production"
        rightSlot={
          <button
            type="button"
            aria-label="Open filters"
            onClick={() => setFilterOpen(true)}
            style={{
              border: 0,
              background: "transparent",
              color: "var(--mobile-accent, #ff5000)",
              padding: 8,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontFamily: "Arial",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            <FilterIcon size={18} />
            Filters
          </button>
        }
      />

      <StickyBreadcrumb
        segments={[
          { label: "Production", onClick: undefined },
          { label: empresa, onClick: () => setFilterOpen(true) },
          { label: fmtMonthLabel(referenceDate), active: true },
        ]}
      />

      <div style={{ padding: "12px 12px 8px" }}>
        <MobileTabBar
          activeKey={tab}
          onChange={(k) => setTab(k as Tab)}
          variant="container"
          ariaLabel="Production view"
          tabs={[
            { key: "brazil",  label: "Brazil" },
            { key: "company", label: empresa.split(/\s+/)[0] },
            { key: "fields",  label: "Fields" },
            { key: "fpsos",   label: "FPSOs" },
          ]}
        />
      </div>

      <div style={{ padding: "8px 12px" }}>
        {/* ── Tab content ─────────────────────────────────────────────── */}
        {tab === "brazil" && (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <MobileKpi label="Brazil oil" value={fmtNumber(kpi.brazilOilKbpd, 0)} unit="kbpd" />
            </div>
            <div
              style={{
                background: "var(--mobile-surface, #ffffff)",
                border: "1px solid var(--mobile-border, #e6e6ec)",
                borderRadius: 12,
                padding: "10px 8px 4px",
                position: "relative",
                opacity: brazilLoading ? 0.6 : 1,
              }}
            >
              <div
                style={{
                  fontFamily: "Arial",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#1a1a1a",
                  marginBottom: 6,
                  padding: "0 6px",
                }}
              >
                Brazil — Oil (kbpd, stacked by environment)
              </div>
              {brazilSeries.length > 0 ? (
                <MobileChart
                  data={brazilSeries}
                  height={260}
                  layout={{
                    barmode: "stack",
                    xaxis: { type: "date", tickformat: "%b %y" },
                    yaxis: { title: { text: "kbpd" } },
                    showlegend: true,
                    legend: { orientation: "h", y: -0.25, x: 0 },
                  }}
                />
              ) : (
                <div style={{ padding: 28, textAlign: "center", color: "#888", fontFamily: "Arial", fontSize: 12 }}>
                  No data for the selected period.
                </div>
              )}
            </div>
          </>
        )}

        {tab === "company" && (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <MobileKpi
                label={`${empresa.split(/\s+/)[0]} oil`}
                value={fmtNumber(kpi.companyOilKbpd, 0)}
                unit="kbpd"
                delta={kpi.companyMomPct != null ? { pct: kpi.companyMomPct, label: "MoM" } : undefined}
              />
              <MobileKpi
                label="Gas"
                value={fmtNumber(kpi.companyGasMm3d, 1)}
                unit="Mm³/d"
              />
              <MobileKpi
                label="YTD avg"
                value={fmtNumber(kpi.companyYtdAvgKbpd, 0)}
                unit="kbpd"
                delta={kpi.companyYoyPct != null ? { pct: kpi.companyYoyPct, label: "YoY" } : undefined}
              />
            </div>
            <div
              style={{
                background: "var(--mobile-surface, #ffffff)",
                border: "1px solid var(--mobile-border, #e6e6ec)",
                borderRadius: 12,
                padding: "10px 8px 4px",
                opacity: companyLoading ? 0.6 : 1,
              }}
            >
              <div
                style={{
                  fontFamily: "Arial",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#1a1a1a",
                  marginBottom: 6,
                  padding: "0 6px",
                }}
              >
                {empresa} — Oil (kbpd, stake-weighted, stacked by environment)
              </div>
              {companySeries.length > 0 ? (
                <MobileChart
                  data={companySeries}
                  height={260}
                  layout={{
                    barmode: "stack",
                    xaxis: { type: "date", tickformat: "%b %y" },
                    yaxis: { title: { text: "kbpd" } },
                    showlegend: true,
                    legend: { orientation: "h", y: -0.25, x: 0 },
                  }}
                />
              ) : (
                <div style={{ padding: 28, textAlign: "center", color: "#888", fontFamily: "Arial", fontSize: 12 }}>
                  No data for the selected period.
                </div>
              )}
            </div>
          </>
        )}

        {tab === "fields" && (
          <>
            <div style={{ marginBottom: 8, fontFamily: "Arial", fontSize: 12, color: "#888" }}>
              {empresa} · top fields · {fmtMonthLabel(referenceDate)}
            </div>
            <div
              style={{
                background: "var(--mobile-surface, #ffffff)",
                border: "1px solid var(--mobile-border, #e6e6ec)",
                borderRadius: 12,
                padding: "10px 8px",
                opacity: topFieldsLoading ? 0.6 : 1,
              }}
            >
              {topFieldsSeries.length > 0 ? (
                <MobileChart
                  data={topFieldsSeries}
                  height={Math.max(220, topFields.length * 28)}
                  layout={{
                    barmode: "stack",
                    margin: { l: 110, r: 8, t: 8, b: 36 },
                    yaxis: { automargin: true, tickfont: { size: 10 } },
                    xaxis: { title: { text: "kbpd" } },
                    showlegend: true,
                    legend: { orientation: "h", y: -0.15, x: 0 },
                  }}
                />
              ) : (
                <div style={{ padding: 28, textAlign: "center", color: "#888", fontFamily: "Arial", fontSize: 12 }}>
                  No field-level data for this month.
                </div>
              )}
            </div>
          </>
        )}

        {tab === "fpsos" && (
          <>
            <div style={{ marginBottom: 8, fontFamily: "Arial", fontSize: 12, color: "#888" }}>
              {empresa} · installations · {fmtMonthLabel(referenceDate)}
            </div>
            <div
              style={{
                background: "var(--mobile-surface, #ffffff)",
                border: "1px solid var(--mobile-border, #e6e6ec)",
                borderRadius: 12,
                overflow: "hidden",
                opacity: installationsLoading ? 0.6 : 1,
              }}
            >
              {installations.slice(0, 25).map((inst) => (
                <MobileDataCard
                  key={inst.instalacao}
                  variant="compact"
                  title={inst.instalacao}
                  subtitle={`Hours rate ${(inst.hours_rate * 100).toFixed(0)}%`}
                  rightSlot={
                    <div style={{ textAlign: "right", fontFamily: "Arial" }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1a1a" }}>
                        {fmtNumber(bblDiaToKbpd(inst.oil_bbl_dia), 1)}
                        <span style={{ fontSize: 10, color: "#888", marginLeft: 4 }}>kbpd</span>
                      </div>
                      <div style={{ fontSize: 11, color: "#888" }}>
                        {fmtNumber(inst.gas_mm3_dia, 1)} Mm³/d
                      </div>
                    </div>
                  }
                />
              ))}
              {installations.length === 0 && (
                <div style={{ padding: 28, textAlign: "center", color: "#888", fontFamily: "Arial", fontSize: 12 }}>
                  No installations for this month.
                </div>
              )}
            </div>
          </>
        )}

        {/* ── YoY expandable section ──────────────────────────────────── */}
        <button
          type="button"
          onClick={() => setYoyOpen((v) => !v)}
          style={{
            marginTop: 16,
            width: "100%",
            background: "var(--mobile-surface, #ffffff)",
            border: "1px solid var(--mobile-border, #e6e6ec)",
            borderRadius: 12,
            padding: "12px 16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            cursor: "pointer",
            fontFamily: "Arial",
            fontSize: 13,
            fontWeight: 600,
            color: "#1a1a1a",
          }}
        >
          <span>YoY / MoM / YTD breakdown</span>
          {yoyOpen ? <ChevronUpIcon size={18} /> : <ChevronDownIcon size={18} />}
        </button>
        {yoyOpen && (
          <div
            style={{
              marginTop: 8,
              background: "var(--mobile-surface, #ffffff)",
              border: "1px solid var(--mobile-border, #e6e6ec)",
              borderRadius: 12,
              padding: "12px",
              opacity: yoyLoading ? 0.6 : 1,
            }}
          >
            {yoyTable.map((row) => {
              const isTotal = row.scope === "TOTAL";
              return (
                <div
                  key={row.scope}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    padding: "8px 0",
                    borderBottom: "1px solid #f0f0f0",
                    fontFamily: "Arial",
                    fontWeight: isTotal ? 700 : 400,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, color: "#1a1a1a" }}>{row.scope}</div>
                    <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                      MoM <span style={{ color: row.mom_pct != null && row.mom_pct >= 0 ? "#197a39" : "#b3261e" }}>{fmtPct(row.mom_pct)}</span>
                      {"  ·  "}
                      YoY <span style={{ color: row.yoy_pct != null && row.yoy_pct >= 0 ? "#197a39" : "#b3261e" }}>{fmtPct(row.yoy_pct)}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{fmtNumber(row.current_kbpd, 0)}</div>
                    <div style={{ fontSize: 10, color: "#888" }}>kbpd · YTD {fmtNumber(row.ytd_avg_kbpd, 0)}</div>
                  </div>
                </div>
              );
            })}
            {yoyTable.length === 0 && (
              <div style={{ padding: 16, textAlign: "center", color: "#888", fontFamily: "Arial", fontSize: 12 }}>
                No YoY data for this reference month.
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Filter drawer ────────────────────────────────────────────────── */}
      <FilterDrawer
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Filters"
        applyLabel="Done"
        onApply={() => setFilterOpen(false)}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <div className="sidebar-filter-label" style={{ fontFamily: "Arial", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
              Company
            </div>
            <select
              value={empresa}
              onChange={(e) => setEmpresa(e.target.value)}
              style={{
                width: "100%",
                fontFamily: "Arial",
                fontSize: 14,
                padding: "10px 12px",
                border: "1px solid #c5c5cb",
                borderRadius: 8,
                background: "#ffffff",
                minHeight: 44,
              }}
            >
              {dropdownOptions.map((opt) => (
                <option key={opt.empresa} value={opt.empresa}>
                  {opt.empresa}{opt.n_campos > 0 ? ` (${opt.n_campos})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="sidebar-filter-label" style={{ fontFamily: "Arial", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
              Period
            </div>
            {allMonths.length > 0 && (
              <PeriodSlider
                dates={allMonths}
                value={monthIdxRange}
                onChange={setMonthIdxRange}
                fmtLabel={(d) => fmtMonthLabel(d)}
              />
            )}
          </div>

          <div>
            <div className="sidebar-filter-label" style={{ fontFamily: "Arial", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
              Reference month
            </div>
            <select
              value={referenceDate}
              onChange={(e) => setReferenceDate(e.target.value)}
              style={{
                width: "100%",
                fontFamily: "Arial",
                fontSize: 14,
                padding: "10px 12px",
                border: "1px solid #c5c5cb",
                borderRadius: 8,
                background: "#ffffff",
                minHeight: 44,
              }}
            >
              {refMonthOptions.map((m) => (
                <option key={m} value={m}>{fmtMonthLabel(m)}</option>
              ))}
            </select>
          </div>

          <MultiSelectFilter
            label="Environment"
            items={AMBIENTES as unknown as string[]}
            selected={ambientes}
            onToggle={toggleAmbiente}
            onClear={ambientes.length < AMBIENTES.length ? () => setAmbientes([...AMBIENTES]) : undefined}
            idPrefix="prod-amb-m"
            swatch={(item) => AMBIENTE_COLOR[item] ?? "#aaa"}
          />
        </div>
      </FilterDrawer>

      {/* ── Export FAB + tiny action sheet ──────────────────────────────── */}
      <ExportFAB
        onClick={() => setExportMenuOpen((v) => !v)}
        disabled={excelLoading || csvLoading}
        ariaLabel="Export production data"
      />
      {exportMenuOpen && (
        <div
          style={{
            position: "fixed",
            zIndex: 36,
            right: "max(16px, calc((100vw - 428px) / 2 + 16px))",
            bottom: "calc(72px + var(--mobile-safe-bottom) + 80px)",
            background: "#ffffff",
            border: "1px solid #e6e6ec",
            borderRadius: 12,
            boxShadow: "0 8px 24px rgba(0,0,0,0.16)",
            overflow: "hidden",
            minWidth: 200,
          }}
        >
          <button
            type="button"
            onClick={async () => {
              setExportMenuOpen(false);
              await handleExportExcel();
            }}
            disabled={excelLoading}
            style={menuBtnStyle}
          >
            {excelLoading ? "Building…" : "Excel (.xlsx)"}
          </button>
          <button
            type="button"
            onClick={async () => {
              setExportMenuOpen(false);
              await handleExportCsv();
            }}
            disabled={csvLoading}
            style={{ ...menuBtnStyle, borderTop: "1px solid #f0f0f0" }}
          >
            {csvLoading ? "Building…" : "CSV (.zip)"}
          </button>
        </div>
      )}
    </div>
  );
}

const menuBtnStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "12px 16px",
  background: "transparent",
  border: 0,
  fontFamily: "Arial",
  fontSize: 14,
  color: "#1a1a1a",
  cursor: "pointer",
  minHeight: 44,
};
