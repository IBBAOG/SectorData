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
import { downloadGenericExcel } from "../../../lib/exportExcel";
import { downloadCsv } from "../../../lib/exportCsv";
import {
  rpcGetAnpPprodutoresSerie,
  rpcGetAnpPprodutoresFiltros,
  type AnpPprodutoresRow,
  type AnpPprodutoresFiltros,
} from "../../../lib/rpc";

// ── Constants ─────────────────────────────────────────────────────────────────

const REGIAO_COLOR: Record<string, string> = {
  "Norte":        "#009688",
  "Nordeste":     "#FF5722",
  "Centro-Oeste": "#9C27B0",
  "Sul":          "#3F51B5",
  "Sudeste":      "#F44336",
};
const ALL_REGIOES = Object.keys(REGIAO_COLOR);

// ── Chart helpers ──────────────────────────────────────────────────────────────

function buildChart(
  rows: AnpPprodutoresRow[],
  regioes: string[],
): { data: PlotData[]; layout: Partial<Layout> } {
  const filtered = rows.filter(r => regioes.includes(r.regiao));
  if (!filtered.length) return emptyPlot(360);

  const byRegiao: Record<string, AnpPprodutoresRow[]> = {};
  for (const r of filtered) (byRegiao[r.regiao] ??= []).push(r);

  const unidade = rows[0]?.unidade ?? "";

  const traces: PlotData[] = regioes
    .filter(r => byRegiao[r])
    .map(r => {
      const data = byRegiao[r].sort((a, b) => a.data_inicio.localeCompare(b.data_inicio));
      return {
        type: "scatter", mode: "lines",
        name: r,
        x: data.map(d => d.data_inicio),
        y: data.map(d => d.preco),
        line: { width: 2, color: REGIAO_COLOR[r] ?? "#999" },
        hovertemplate: `${r}: R$ %{y:.4f}<extra></extra>`,
      } as PlotData;
    });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 360,
      margin: { t: 10, b: 50, l: 80, r: 30 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: `R$ / ${unidade || "L"}` } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0 },
    },
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnpPrecosProdutoresPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-precos-produtores");
  const supabase = getSupabaseClient();

  const [loading, setLoading]           = useState(true);
  const [filtros, setFiltros]           = useState<AnpPprodutoresFiltros>({
    produtos: [], regioes: [], data_min: null, data_max: null,
  });
  const [serieRows, setSerieRows]       = useState<AnpPprodutoresRow[]>([]);
  const [allYears, setAllYears]         = useState<number[]>([]);
  const [yearRange, setYearRange]       = useState<[number, number]>([0, 0]);
  const [selectedProduto, setProduto]   = useState<string>("");
  const [selectedRegioes, setRegioes]   = useState<string[]>(ALL_REGIOES);
  const [excelLoading, setExcelLoading] = useState(false);

  // ── Initial load: filtros + first serie fetch in parallel ────────────────
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const f = await rpcGetAnpPprodutoresFiltros(supabase);
      if (cancelled) return;

      setFiltros(f);

      const yMin = f.data_min ? parseInt(f.data_min.slice(0, 4)) : new Date().getFullYear() - 10;
      const yMax = f.data_max ? parseInt(f.data_max.slice(0, 4)) : new Date().getFullYear();
      const years: number[] = [];
      for (let y = yMin; y <= yMax; y++) years.push(y);
      const startIdx = Math.max(0, years.findIndex(y => y >= yMax - 9));
      const fromYear = years[startIdx] ?? yMin;
      setAllYears(years);
      setYearRange([startIdx, years.length - 1]);

      const defaultProduto = f.produtos.includes("Gasolina A Comum")
        ? "Gasolina A Comum"
        : f.produtos[0] ?? "";
      setProduto(defaultProduto);

      // First paint with initial data — debounced refetch will fire after loading=false
      // but with identical params, so no UX impact (just a redundant network call).
      if (defaultProduto) {
        const rows = await rpcGetAnpPprodutoresSerie(supabase, {
          produto:    defaultProduto,
          dataInicio: `${fromYear}-01-01`,
          dataFim:    `${yMax}-12-31`,
        });
        if (!cancelled) setSerieRows(rows);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // ── Reactive serie fetch (debounced 400ms) ────────────────────────────────
  const { data: refetched, loading: serieLoading } = useDebouncedFetch(
    async () => {
      if (!supabase || loading || !selectedProduto) return null;
      const yMin = allYears[yearRange[0]];
      const yMax = allYears[yearRange[1]];
      return rpcGetAnpPprodutoresSerie(supabase, {
        produto:    selectedProduto,
        dataInicio: yMin ? `${yMin}-01-01` : null,
        dataFim:    yMax ? `${yMax}-12-31` : null,
      });
    },
    [supabase, loading, selectedProduto, yearRange[0], yearRange[1], allYears],
    { ms: 400, skipInitial: true },
  );

  useEffect(() => {
    if (refetched) setSerieRows(refetched);
  }, [refetched]);

  const chart = useMemo(
    () => buildChart(serieRows, selectedRegioes),
    [serieRows, selectedRegioes],
  );

  if (visLoading || !visible) return null;

  const toggleRegiao = (r: string) =>
    setRegioes(prev =>
      prev.includes(r)
        ? prev.length > 1 ? prev.filter(x => x !== r) : prev
        : [...prev, r]
    );

  const hasYears = allYears.length > 0;
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

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Produto</div>
                <select
                  className="form-select form-select-sm"
                  value={selectedProduto}
                  onChange={e => setProduto(e.target.value)}
                  style={{ fontFamily: "Arial", fontSize: 12 }}
                >
                  {filtros.produtos.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

              <MultiSelectFilter
                label="Região"
                items={ALL_REGIOES}
                selected={selectedRegioes}
                onToggle={toggleRegiao}
                onClear={selectedRegioes.length < ALL_REGIOES.length ? () => setRegioes(ALL_REGIOES) : undefined}
                swatch={(r) => REGIAO_COLOR[r]}
                idPrefix="reg"
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
                title="ANP — Preços Médios Ponderados Produtores e Importadores"
                sub="Preços semanais médios ponderados praticados por produtores e importadores, por região"
                period={hasYears && yMin != null && yMax != null ? [yMin, yMax] : null}
                rightSlot={
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
                            await downloadGenericExcel<AnpPprodutoresRow>({
                              rows: serieRows,
                              filename: "ANP-Precos-Produtores",
                              title: `ANP — Preços Produtores e Importadores — ${selectedProduto}`,
                              sheetName: "Preços",
                              columns: [
                                { key: "data_inicio", header: "Início" },
                                { key: "data_fim",    header: "Fim" },
                                { key: "produto",     header: "Produto", width: 28 },
                                { key: "regiao",      header: "Região",  width: 16 },
                                { key: "preco",       header: "Preço",   format: "0.0000" },
                                { key: "unidade",     header: "Unidade" },
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
                            filename: "ANP-Precos-Produtores",
                          });
                        },
                      },
                    ]}
                  />
                }
              />

              {loading ? (
                <BarrelLoading />
              ) : (
                <div className="row mb-2">
                  <div className="col-12">
                    <ChartSection
                      title={`Preço por Região — ${selectedProduto}`}
                      loading={serieLoading}
                      height={360}
                    >
                      <PlotlyChart
                        data={chart.data}
                        layout={chart.layout}
                        config={{ responsive: true, displayModeBar: false }}
                        style={{ width: "100%", height: 360 }}
                      />
                    </ChartSection>
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
