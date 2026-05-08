"use client";

import { useEffect, useMemo, useState } from "react";
import type { Layout, PlotData } from "plotly.js";

import NavBar from "../../../components/NavBar";
import PlotlyChart from "../../../components/PlotlyChart";
import DashboardHeader from "../../../components/dashboard/DashboardHeader";
import MultiSelectFilter from "../../../components/dashboard/MultiSelectFilter";
import PeriodSlider from "../../../components/dashboard/PeriodSlider";
import ChartSection from "../../../components/dashboard/ChartSection";
import BarrelLoading from "../../../components/dashboard/BarrelLoading";
import ExportPanel from "../../../components/dashboard/ExportPanel";
import ExportModal from "../../../components/dashboard/ExportModal";
import SearchableMultiSelect from "../../../components/SearchableMultiSelect";
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
import { useDebouncedFetch } from "../../../hooks/useDebouncedFetch";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot } from "../../../lib/plotlyDefaults";
import { downloadGenericExcel } from "../../../lib/exportExcel";
import { downloadCsv } from "../../../lib/exportCsv";
import {
  rpcGetAnpCdpDiariaFiltros,
  rpcGetAnpCdpDiariaSerie,
  type AnpCdpDiariaFiltros,
  type AnpCdpDiariaPonto,
} from "../../../lib/rpc";

// ── Constants ─────────────────────────────────────────────────────────────────

const PALETTE = [
  "#FF5000", "#2196F3", "#8BC34A", "#FF9800", "#9C27B0",
  "#E53935", "#00ACC1", "#FF8C42", "#64B5F6", "#7CB342",
];

const TOP_N_CAMPOS = 10;

type Metric = "petroleo_bbl_dia" | "gas_mm3_dia";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Pick the top N campos by mean of `metric` over the filtered rows.
 * If the user explicitly selected campos, those win regardless of rank.
 */
function pickTopCampos(
  rows: AnpCdpDiariaPonto[],
  metric: Metric,
  n: number,
): string[] {
  const sums: Record<string, { sum: number; cnt: number }> = {};
  for (const r of rows) {
    const v = r[metric];
    if (v == null) continue;
    if (!sums[r.campo]) sums[r.campo] = { sum: 0, cnt: 0 };
    sums[r.campo].sum += v;
    sums[r.campo].cnt += 1;
  }
  return Object.entries(sums)
    .map(([k, v]) => [k, v.cnt > 0 ? v.sum / v.cnt : 0] as [string, number])
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

function buildSerieChart(
  rows: AnpCdpDiariaPonto[],
  metric: Metric,
  campos: string[],
  unitLabel: string,
  height: number,
): { data: PlotData[]; layout: Partial<Layout> } {
  const filtered = rows.filter(r => campos.includes(r.campo) && r[metric] != null);
  if (!filtered.length) return emptyPlot(height);

  // Aggregate by (campo, data) — sum across bacias when same campo lives in
  // multiple basins on the same day. Source data is already at campo-level
  // per day, but defensively reduce in case.
  const agg: Record<string, Record<string, number>> = {};
  for (const r of filtered) {
    if (!agg[r.campo]) agg[r.campo] = {};
    const v = r[metric] ?? 0;
    agg[r.campo][r.data] = (agg[r.campo][r.data] ?? 0) + v;
  }

  const traces: PlotData[] = campos
    .filter(c => agg[c])
    .map((c, i) => {
      const entries = Object.entries(agg[c]).sort(([a], [b]) => a.localeCompare(b));
      return {
        type: "scatter", mode: "lines",
        name: c,
        x: entries.map(([d]) => d),
        y: entries.map(([, v]) => v),
        line: { width: 1.5, color: PALETTE[i % PALETTE.length] },
        hovertemplate: `${c}: %{y:,.1f} ${unitLabel}<extra></extra>`,
      } as PlotData;
    });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height,
      margin: { t: 10, b: 50, l: 80, r: 30 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: unitLabel } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0 },
    },
  };
}

function fmtNumber(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnpCdpDiariaPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-cdp-diaria");
  const supabase = getSupabaseClient();

  const [loading, setLoading]       = useState(true);
  const [filtros, setFiltros]       = useState<AnpCdpDiariaFiltros>({
    campos: [], bacias: [], data_min: null, data_max: null,
  });
  const [serieRows, setSerieRows]   = useState<AnpCdpDiariaPonto[]>([]);
  const [allDates, setAllDates]     = useState<string[]>([]);
  const [dateRange, setDateRange]   = useState<[number, number]>([0, 0]);
  const [selectedCampos, setSelectedCampos]   = useState<string[]>([]);
  const [selectedBacias, setSelectedBacias]   = useState<string[]>([]);

  // ── Export modal state (Tier 2) ──────────────────────────────────────────
  const [exportOpen, setExportOpen]               = useState(false);
  const [excelLoading, setExcelLoading]           = useState(false);
  const [csvLoading, setCsvLoading]               = useState(false);
  const [exportCampos, setExportCampos]           = useState<string[]>([]);
  const [exportBacias, setExportBacias]           = useState<string[]>([]);
  const [exportRange, setExportRange]             = useState<[number, number]>([0, 0]);

  // ── Build a daily date list between data_min/data_max for the slider ─────
  function buildDateRange(min: string, max: string): string[] {
    const out: string[] = [];
    const start = new Date(min + "T00:00:00Z");
    const end   = new Date(max + "T00:00:00Z");
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
    for (
      let d = new Date(start);
      d <= end;
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }

  // ── Initial load ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      try {
        const f = await rpcGetAnpCdpDiariaFiltros(supabase);
        if (cancelled) return;
        setFiltros(f);

        const dMin = f.data_min;
        const dMax = f.data_max;
        const dates = (dMin && dMax) ? buildDateRange(dMin, dMax) : [];
        setAllDates(dates);
        const lastIdx = Math.max(0, dates.length - 1);
        setDateRange([0, lastIdx]);

        // Initial fetch — full range, all campos/bacias
        const rows = await rpcGetAnpCdpDiariaSerie(supabase, {
          dataInicio: dMin ?? null,
          dataFim:    dMax ?? null,
        });
        if (!cancelled) setSerieRows(rows);
      } catch (e) {
        console.error("ANP CDP Diária initial load failed", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // ── Reactive serie fetch (debounced 400ms) — period/bacia changes ────────
  const { data: refetched, loading: serieLoading } = useDebouncedFetch(
    async () => {
      if (!supabase || loading) return null;
      const dStart = allDates[dateRange[0]] ?? null;
      const dEnd   = allDates[dateRange[1]] ?? null;
      const bacias = selectedBacias.length > 0 && selectedBacias.length < filtros.bacias.length
        ? selectedBacias
        : null;
      // Note: campos filter is intentionally NOT pushed to RPC here — we
      // always fetch all campos within the period+bacia window, then pick
      // Top N (or the user's explicit selection) client-side. This keeps
      // the chart legend stable as the user toggles individual campos.
      return rpcGetAnpCdpDiariaSerie(supabase, {
        bacias,
        dataInicio: dStart,
        dataFim:    dEnd,
      });
    },
    [supabase, loading, dateRange[0], dateRange[1], allDates, selectedBacias, filtros.bacias.length],
    { ms: 400, skipInitial: true },
  );

  useEffect(() => {
    if (refetched) setSerieRows(refetched);
  }, [refetched]);

  // ── Default Top N campos (per metric) when user has no explicit selection ─
  const defaultPetroleoCampos = useMemo(
    () => pickTopCampos(serieRows, "petroleo_bbl_dia", TOP_N_CAMPOS),
    [serieRows],
  );
  const defaultGasCampos = useMemo(
    () => pickTopCampos(serieRows, "gas_mm3_dia", TOP_N_CAMPOS),
    [serieRows],
  );

  // If user has selected campos, those override the Top N defaults for both charts.
  const camposPetroleoChart = selectedCampos.length > 0 ? selectedCampos : defaultPetroleoCampos;
  const camposGasChart      = selectedCampos.length > 0 ? selectedCampos : defaultGasCampos;

  const petroleoChart = useMemo(
    () => buildSerieChart(serieRows, "petroleo_bbl_dia", camposPetroleoChart, "bbl/dia", 320),
    [serieRows, camposPetroleoChart],
  );
  const gasChart = useMemo(
    () => buildSerieChart(serieRows, "gas_mm3_dia", camposGasChart, "Mm³/dia", 320),
    [serieRows, camposGasChart],
  );

  // ── Recent rows for table (last 30 days, sorted desc) ────────────────────
  const tableRows = useMemo(() => {
    return [...serieRows]
      .sort((a, b) => b.data.localeCompare(a.data) || b.campo.localeCompare(a.campo))
      .slice(0, 500);
  }, [serieRows]);

  // ── Export modal helpers ─────────────────────────────────────────────────
  function openExportModal() {
    setExportCampos([]);
    setExportBacias([]);
    setExportRange(dateRange);
    setExportOpen(true);
  }

  // TODO(perf): if exports become a bottleneck, replace this row-count
  // heuristic with a dedicated `get_anp_cdp_diaria_export_count` RPC
  // (mirrors what `/anp-cdp` and `/anp-lpc` do via the count_rpcs migration).
  async function estimateExportRows(): Promise<number> {
    if (!supabase) return 0;
    const dStart = allDates[exportRange[0]] ?? null;
    const dEnd   = allDates[exportRange[1]] ?? null;
    const camposParam = exportCampos.length > 0 ? exportCampos : null;
    const baciasParam = exportBacias.length > 0 ? exportBacias : null;
    try {
      const rows = await rpcGetAnpCdpDiariaSerie(supabase, {
        campos:     camposParam,
        bacias:     baciasParam,
        dataInicio: dStart,
        dataFim:    dEnd,
      });
      return rows.length;
    } catch (e) {
      console.error("anp-cdp-diaria export count failed", e);
      return 0;
    }
  }

  const exportFilters = useMemo(() => {
    const dStart = allDates[exportRange[0]] ?? null;
    const dEnd   = allDates[exportRange[1]] ?? null;
    return {
      campos:     exportCampos.length > 0 ? exportCampos : null,
      bacias:     exportBacias.length > 0 ? exportBacias : null,
      dataInicio: dStart,
      dataFim:    dEnd,
    };
  }, [exportCampos, exportBacias, exportRange, allDates]);

  if (visLoading || !visible) return null;

  // ── UI helpers ───────────────────────────────────────────────────────────
  const toggleBacia = (b: string) =>
    setSelectedBacias(prev =>
      prev.includes(b) ? prev.filter(x => x !== b) : [...prev, b]
    );

  const hasDates = allDates.length > 0;
  const dStart   = hasDates ? allDates[dateRange[0]] : null;
  const dEnd     = hasDates ? allDates[dateRange[1]] : null;
  const periodBadge: [string, string] | null =
    hasDates && dStart && dEnd ? [dStart, dEnd] : null;

  return (
    <div>
      <NavBar />
      <div className="container-fluid g-0">
        <div className="row g-0">

          {/* ── Sidebar ───────────────────────────────────────────────── */}
          <div className="col-xxl-2 col-md-3 p-0">
            <div id="sidebar">
              <div style={{ textAlign: "center" }}>
                <div style={{
                  width: "100%", maxWidth: 300, height: 60,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  border: "2px dashed #ccc", color: "#aaa", fontSize: 18,
                  fontWeight: 700, letterSpacing: 3, marginBottom: 16, borderRadius: 6,
                }}>TBD</div>
              </div>
              <hr style={{ borderTop: "1px solid #f0f0f0", marginBottom: 14 }} />

              <div className="sidebar-section-label">Filtros</div>

              <MultiSelectFilter
                label={`Bacia (${selectedBacias.length || filtros.bacias.length}/${filtros.bacias.length})`}
                items={filtros.bacias}
                selected={selectedBacias}
                onToggle={toggleBacia}
                onClear={selectedBacias.length > 0 ? () => setSelectedBacias([]) : undefined}
                idPrefix="cdpd-bacia"
                emptyMeansAll
                counterTotal={filtros.bacias.length}
              />

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">
                  Campo{" "}
                  <span style={{ color: "#888", fontWeight: 400 }}>
                    ({selectedCampos.length}/{filtros.campos.length})
                  </span>
                </div>
                <SearchableMultiSelect
                  options={filtros.campos}
                  value={selectedCampos}
                  onChange={setSelectedCampos}
                />
                {selectedCampos.length === 0 && (
                  <div style={{ fontSize: 11, color: "#888", marginTop: 6, paddingLeft: 2 }}>
                    Sem seleção: gráficos mostram Top {TOP_N_CAMPOS} por média no período.
                  </div>
                )}
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Período</div>
                {!loading && hasDates && (
                  <PeriodSlider dates={allDates} value={dateRange} onChange={setDateRange} />
                )}
              </div>
            </div>
          </div>

          {/* ── Main content ──────────────────────────────────────────── */}
          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <DashboardHeader
                title="ANP CDP — Produção Diária por Campo"
                sub="Petróleo e gás natural por campo, atualizado 3×/dia (fonte: Power BI ANP)"
                period={periodBadge}
                rightSlot={
                  <ExportPanel
                    actions={[
                      {
                        kind: "excel",
                        label: "Excel",
                        disabled: loading || excelLoading || csvLoading,
                        onClick: openExportModal,
                      },
                      {
                        kind: "csv",
                        label: "CSV",
                        disabled: loading || excelLoading || csvLoading,
                        onClick: openExportModal,
                      },
                    ]}
                  />
                }
              />

              {loading ? (
                <BarrelLoading />
              ) : (
                <>
                  <div className="row mb-2">
                    <div className="col-12">
                      <ChartSection
                        title={
                          selectedCampos.length > 0
                            ? `Petróleo (bbl/dia) — ${selectedCampos.length} campo(s) selecionado(s)`
                            : `Petróleo (bbl/dia) — Top ${TOP_N_CAMPOS} por média no período`
                        }
                        loading={serieLoading}
                        height={320}
                      >
                        <PlotlyChart
                          data={petroleoChart.data}
                          layout={petroleoChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 320 }}
                        />
                      </ChartSection>
                    </div>
                  </div>

                  <div className="row mb-2">
                    <div className="col-12">
                      <ChartSection
                        title={
                          selectedCampos.length > 0
                            ? `Gás (Mm³/dia) — ${selectedCampos.length} campo(s) selecionado(s)`
                            : `Gás (Mm³/dia) — Top ${TOP_N_CAMPOS} por média no período`
                        }
                        loading={serieLoading}
                        height={320}
                      >
                        <PlotlyChart
                          data={gasChart.data}
                          layout={gasChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 320 }}
                        />
                      </ChartSection>
                    </div>
                  </div>

                  <div className="row mb-2">
                    <div className="col-12">
                      <ChartSection
                        title={`Produção por Campo — registros mais recentes (${tableRows.length.toLocaleString("pt-BR")} de ${serieRows.length.toLocaleString("pt-BR")})`}
                        loading={serieLoading}
                      >
                        <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto", border: "1px solid #eee", borderRadius: 6 }}>
                          <table className="table table-sm" style={{ fontFamily: "Arial", fontSize: 12, marginBottom: 0 }}>
                            <thead style={{ position: "sticky", top: 0, background: "#fff", zIndex: 1, borderBottom: "2px solid #1a1a1a" }}>
                              <tr>
                                <th style={{ padding: "8px 12px", textAlign: "left" }}>Data</th>
                                <th style={{ padding: "8px 12px", textAlign: "left" }}>Bacia</th>
                                <th style={{ padding: "8px 12px", textAlign: "left" }}>Campo</th>
                                <th style={{ padding: "8px 12px", textAlign: "right" }}>Petróleo (bbl/dia)</th>
                                <th style={{ padding: "8px 12px", textAlign: "right" }}>Gás (Mm³/dia)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {tableRows.map((r, i) => (
                                <tr key={`${r.data}-${r.campo}-${r.bacia}-${i}`}>
                                  <td style={{ padding: "6px 12px" }}>{r.data}</td>
                                  <td style={{ padding: "6px 12px" }}>{r.bacia}</td>
                                  <td style={{ padding: "6px 12px" }}>{r.campo}</td>
                                  <td style={{ padding: "6px 12px", textAlign: "right" }}>{fmtNumber(r.petroleo_bbl_dia, 1)}</td>
                                  <td style={{ padding: "6px 12px", textAlign: "right" }}>{fmtNumber(r.gas_mm3_dia, 3)}</td>
                                </tr>
                              ))}
                              {tableRows.length === 0 && (
                                <tr>
                                  <td colSpan={5} style={{ padding: "16px 12px", color: "#888", textAlign: "center" }}>
                                    Sem dados para os filtros atuais.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </ChartSection>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

        </div>
      </div>

      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Exportar — ANP CDP Diária"
        datasetKey="anp_cdp_diaria"
        currentFilters={exportFilters}
        countFetcher={estimateExportRows}
        excelBusy={excelLoading}
        csvBusy={csvLoading}
        loadingLabel={excelLoading ? "Gerando Excel..." : "Baixando CSV..."}
        onExportExcel={async () => {
          if (!supabase) return;
          setExcelLoading(true);
          try {
            const rows = await rpcGetAnpCdpDiariaSerie(supabase, {
              campos:     exportFilters.campos,
              bacias:     exportFilters.bacias,
              dataInicio: exportFilters.dataInicio,
              dataFim:    exportFilters.dataFim,
            });
            await downloadGenericExcel<AnpCdpDiariaPonto>({
              rows,
              filename: "ANP-CDP-Diaria",
              title:    "ANP — Produção Diária por Campo",
              sheetName: "Produção Diária",
              columns: [
                { key: "data",             header: "Data" },
                { key: "bacia",            header: "Bacia",            width: 24 },
                { key: "campo",            header: "Campo",            width: 30 },
                { key: "petroleo_bbl_dia", header: "Petróleo (bbl/dia)", format: "#,##0.0",  align: "right" },
                { key: "gas_mm3_dia",      header: "Gás (Mm³/dia)",      format: "#,##0.000", align: "right" },
              ],
            });
            setExportOpen(false);
          } catch (e) {
            console.error("ANP CDP Diária Excel export failed", e);
          } finally {
            setExcelLoading(false);
          }
        }}
        onExportCsv={async () => {
          if (!supabase) return;
          setCsvLoading(true);
          try {
            const rows = await rpcGetAnpCdpDiariaSerie(supabase, {
              campos:     exportFilters.campos,
              bacias:     exportFilters.bacias,
              dataInicio: exportFilters.dataInicio,
              dataFim:    exportFilters.dataFim,
            });
            const now = new Date();
            const dd = String(now.getDate()).padStart(2, "0");
            const mm = String(now.getMonth() + 1).padStart(2, "0");
            const yy = String(now.getFullYear()).slice(-2);
            downloadCsv({
              rows: rows as unknown as Record<string, unknown>[],
              filename: `anp_cdp_diaria_${dd}-${mm}-${yy}`,
            });
            setExportOpen(false);
          } catch (e) {
            console.error("ANP CDP Diária CSV export failed", e);
          } finally {
            setCsvLoading(false);
          }
        }}
        filters={
          <div style={{ display: "flex", flexDirection: "column", gap: 14, fontFamily: "Arial" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>Período</div>
              {hasDates && (
                <PeriodSlider dates={allDates} value={exportRange} onChange={setExportRange} />
              )}
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                Bacias <span style={{ color: "#888", fontWeight: 400 }}>({exportBacias.length === 0 ? filtros.bacias.length : exportBacias.length}/{filtros.bacias.length})</span>
              </div>
              <MultiSelectFilter
                label="Bacias"
                items={filtros.bacias}
                selected={exportBacias}
                onToggle={(b) =>
                  setExportBacias(prev =>
                    prev.includes(b) ? prev.filter(x => x !== b) : [...prev, b]
                  )
                }
                onClear={exportBacias.length > 0 ? () => setExportBacias([]) : undefined}
                idPrefix="cdpd-export-bacia"
              />
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                Campos <span style={{ color: "#888", fontWeight: 400 }}>({exportCampos.length === 0 ? filtros.campos.length : exportCampos.length}/{filtros.campos.length})</span>
              </div>
              <SearchableMultiSelect
                options={filtros.campos}
                value={exportCampos}
                onChange={setExportCampos}
              />
            </div>
          </div>
        }
      />
    </div>
  );
}
