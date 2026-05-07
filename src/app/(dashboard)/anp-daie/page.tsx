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
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
import { useDebouncedFetch } from "../../../hooks/useDebouncedFetch";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot } from "../../../lib/plotlyDefaults";
import { m3ToMilM3, LABEL } from "../../../lib/units";
import { downloadGenericExcel } from "../../../lib/exportExcel";
import { downloadCsv } from "../../../lib/exportCsv";
import {
  rpcGetAnpDaieSerie,
  rpcGetAnpDaiFiltros,
  type AnpDaieRow,
  type AnpDaieFiltros,
} from "../../../lib/rpc";

// ── Constants ─────────────────────────────────────────────────────────────────

const PRODUTO_COLORS: Record<string, string> = {
  "PETRÓLEO":                    "#1a1a1a",
  "ÓLEO DIESEL":                 "#2196F3",
  "GASOLINA A":                  "#FF5000",
  "GLP":                         "#FF9800",
  "QUEROSENE DE AVIAÇÃO":        "#8BC34A",
  "NAFTA":                       "#9C27B0",
  "ÓLEO COMBUSTÍVEL":            "#795548",
  "COQUE":                       "#607D8B",
  "COMBUSTÍVEIS PARA AERONAVES": "#00BCD4",
  "COMBUSTÍVEIS PARA NAVIOS":    "#3F51B5",
  "GASOLINA DE AVIAÇÃO":         "#E91E63",
  "QUEROSENE ILUMINANTE":        "#009688",
};

const PALETTE = [
  "#1a1a1a","#2196F3","#FF5000","#FF9800","#8BC34A","#9C27B0",
  "#795548","#607D8B","#00BCD4","#3F51B5","#E91E63","#009688",
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildOperacaoChart(
  rows: AnpDaieRow[],
  operacao: string,
  produtos: string[],
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!operacao) return emptyPlot(280);
  const filtered = rows.filter(
    r => r.operacao === operacao && produtos.includes(r.produto),
  );
  if (!filtered.length) return emptyPlot(280);

  const byProduto: Record<string, AnpDaieRow[]> = {};
  for (const r of filtered) (byProduto[r.produto] ??= []).push(r);

  const traces: PlotData[] = produtos
    .filter(p => byProduto[p])
    .map((p, i) => {
      const data = byProduto[p].sort(
        (a, b) => a.ano !== b.ano ? a.ano - b.ano : a.mes - b.mes,
      );
      const color = PRODUTO_COLORS[p] ?? PALETTE[i % PALETTE.length];
      return {
        type: "scatter", mode: "lines",
        name: p,
        x: data.map(r => `${r.ano}-${String(r.mes).padStart(2, "0")}`),
        y: data.map(r => m3ToMilM3(r.volume_m3 ?? 0)),
        line: { width: 2, color },
        hovertemplate: `${p}: %{y:.2f} ${LABEL.MIL_M3}<extra></extra>`,
      } as PlotData;
    });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT, height: 280,
      margin: { t: 10, b: 50, l: 80, r: 30 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: `${LABEL.MIL_M3} / mês` } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0, font: { size: 10 } },
    },
  };
}

// Capitaliza só a primeira letra (resto lowercase). Suporta acento.
function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toLocaleUpperCase("pt-BR") + s.slice(1).toLocaleLowerCase("pt-BR");
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnpDaiePage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-daie");
  const supabase = getSupabaseClient();

  const [loading, setLoading]                 = useState(true);
  const [filtros, setFiltros]                 = useState<AnpDaieFiltros>({
    produtos: [], operacoes: [], ano_min: null, ano_max: null,
  });
  const [serieRows, setSerieRows]             = useState<AnpDaieRow[]>([]);
  const [allYears, setAllYears]               = useState<number[]>([]);
  const [yearRange, setYearRange]             = useState<[number, number]>([0, 0]);
  const [selectedProdutos, setSelectedProdutos] = useState<string[]>([]);
  const [excelLoading, setExcelLoading]       = useState(false);

  // ── Initial load: filtros + first serie fetch (last 10 years) ─────────────
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const f = await rpcGetAnpDaiFiltros(supabase);
      if (cancelled) return;
      setFiltros(f);
      setSelectedProdutos(f.produtos);

      const yMin = f.ano_min ?? new Date().getFullYear() - 10;
      const yMax = f.ano_max ?? new Date().getFullYear();
      const years: number[] = [];
      for (let y = yMin; y <= yMax; y++) years.push(y);
      const startIdx = Math.max(0, years.findIndex(y => y >= yMax - 9));
      const fromYear = years[startIdx] ?? yMin;
      setAllYears(years);
      setYearRange([startIdx, years.length - 1]);

      // Empty table guard: if no data, skip serie fetch
      if (!years.length || !f.produtos.length) {
        if (!cancelled) {
          setSerieRows([]);
          setLoading(false);
        }
        return;
      }

      const rows = await rpcGetAnpDaieSerie(supabase, {
        anoInicio: fromYear,
        anoFim:    yMax,
      });
      if (!cancelled) {
        setSerieRows(rows);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // ── Reactive serie fetch (debounced 400ms) — period changes only ─────────
  const { data: refetched, loading: serieLoading } = useDebouncedFetch(
    async () => {
      if (!supabase || loading) return null;
      const yMin = allYears[yearRange[0]];
      const yMax = allYears[yearRange[1]];
      return rpcGetAnpDaieSerie(supabase, {
        anoInicio: yMin ?? null,
        anoFim:    yMax ?? null,
      });
    },
    [supabase, loading, yearRange[0], yearRange[1], allYears],
    { ms: 400, skipInitial: true },
  );

  useEffect(() => {
    if (refetched) setSerieRows(refetched);
  }, [refetched]);

  // Detect Importação / Exportação operations defensively (alphabetic order
  // in pt-BR puts "Exportação" before "Importação", so don't trust [0]/[1])
  const operacoes = useMemo(() => filtros.operacoes ?? [], [filtros.operacoes]);
  const importOp = useMemo(
    () => operacoes.find(o => o.toLowerCase().includes("import")) ?? "",
    [operacoes],
  );
  const exportOp = useMemo(
    () => operacoes.find(o => o.toLowerCase().includes("export")) ?? "",
    [operacoes],
  );

  const importChart = useMemo(
    () => buildOperacaoChart(serieRows, importOp, selectedProdutos),
    [serieRows, importOp, selectedProdutos],
  );

  const exportChart = useMemo(
    () => buildOperacaoChart(serieRows, exportOp, selectedProdutos),
    [serieRows, exportOp, selectedProdutos],
  );

  if (visLoading || !visible) return null;

  const toggleProduto = (p: string) =>
    setSelectedProdutos(prev =>
      prev.includes(p)
        ? prev.length > 1 ? prev.filter(x => x !== p) : prev
        : [...prev, p]
    );

  const hasYears = allYears.length > 0;
  const hasData  = filtros.produtos.length > 0;
  const yMin = hasYears ? allYears[yearRange[0]] : null;
  const yMax = hasYears ? allYears[yearRange[1]] : null;

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

              {/* DAIE has its own swatch size (8x8 instead of 9x9) and capitalize labels.
                  We pass swatch+itemLabel to MultiSelectFilter; small swatch deviation
                  acceptable since the tighter sidebar uses 11px font. */}
              <MultiSelectFilter
                label="Produto"
                items={filtros.produtos}
                selected={selectedProdutos}
                onToggle={toggleProduto}
                onClear={selectedProdutos.length < filtros.produtos.length
                  ? () => setSelectedProdutos(filtros.produtos)
                  : undefined}
                swatch={(p) => {
                  const i = filtros.produtos.indexOf(p);
                  return PRODUTO_COLORS[p] ?? PALETTE[i % PALETTE.length];
                }}
                itemLabel={(p) => capitalize(p)}
                idPrefix="daie"
              />

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Período</div>
                {!loading && hasYears && (
                  <PeriodSlider years={allYears} value={yearRange} onChange={setYearRange} />
                )}
              </div>
            </div>
          </div>

          {/* ── Main content ──────────────────────────────────────────── */}
          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <DashboardHeader
                title="ANP — Dados Abertos Importações e Exportações"
                sub={`Volumes mensais de importações e exportações de derivados de petróleo (volume em ${LABEL.MIL_M3})`}
                period={hasYears && yMin != null && yMax != null ? [yMin, yMax] : null}
                rightSlot={hasData ? (
                  <ExportPanel
                    actions={[
                      {
                        kind: "excel",
                        label: "formatted data .xl",
                        busy: excelLoading,
                        loadingLabel: "Gerando Excel...",
                        disabled: loading || serieRows.length === 0 || excelLoading,
                        onClick: async () => {
                          setExcelLoading(true);
                          try {
                            await downloadGenericExcel<AnpDaieRow>({
                              rows: serieRows,
                              filename: "ANP-DAIE",
                              title: "ANP — Dados Abertos Importações e Exportações",
                              sheetName: "DAIE",
                              columns: [
                                { key: "ano",       header: "Ano" },
                                { key: "mes",       header: "Mês" },
                                { key: "produto",   header: "Produto", width: 32 },
                                { key: "operacao",  header: "Operação", width: 16 },
                                { key: "volume_m3", header: "Volume (m³)", format: "#,##0" },
                                { key: "valor_usd", header: "Valor (USD)", format: "#,##0.00" },
                              ],
                            });
                          } catch (e) {
                            console.error("Excel export failed", e);
                          } finally {
                            setExcelLoading(false);
                          }
                        },
                      },
                      {
                        kind: "csv",
                        label: "all data .csv",
                        disabled: loading || serieRows.length === 0,
                        onClick: () => {
                          downloadCsv({
                            rows: serieRows as unknown as Record<string, unknown>[],
                            filename: "ANP-DAIE",
                          });
                        },
                      },
                    ]}
                  />
                ) : null}
              />

              {loading ? (
                <BarrelLoading />
              ) : !hasData ? (
                <div className="d-flex justify-content-center align-items-center my-5"
                  style={{ minHeight: 240, color: "#888", fontFamily: "Arial", fontSize: 14 }}>
                  Sem dados disponíveis para este módulo no momento.
                </div>
              ) : (
                <>
                  <div className="row mb-2">
                    <div className="col-12">
                      <ChartSection
                        title={`${capitalize(importOp || "Importação")} (${LABEL.MIL_M3} / mês)`}
                        loading={serieLoading}
                        height={280}
                      >
                        <PlotlyChart
                          data={importChart.data}
                          layout={importChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 280 }}
                        />
                      </ChartSection>
                    </div>
                  </div>

                  <div className="row mb-2">
                    <div className="col-12">
                      <ChartSection
                        title={`${capitalize(exportOp || "Exportação")} (${LABEL.MIL_M3} / mês)`}
                        loading={serieLoading}
                        height={280}
                      >
                        <PlotlyChart
                          data={exportChart.data}
                          layout={exportChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 280 }}
                        />
                      </ChartSection>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
