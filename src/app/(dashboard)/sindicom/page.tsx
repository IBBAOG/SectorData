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
  rpcGetSindicomSerie,
  rpcGetSindicomFiltros,
  type SindicomSerieRow,
  type SindicomFiltros,
} from "../../../lib/rpc";

// ── Constants ─────────────────────────────────────────────────────────────────

const PRODUTO_COLORS: Record<string, string> = {
  "GASOLINA C COMUM":     "#FF5000",
  "GASOLINA C ADITIVADA": "#FF8C42",
  "ETANOL HIDRATADO":     "#8BC34A",
  "DIESEL B S10":         "#2196F3",
  "DIESEL B S500":        "#64B5F6",
  "GLP":                  "#FF9800",
  "GNV":                  "#9C27B0",
  "ÓLEO DIESEL A S10":    "#1565C0",
  "ÓLEO DIESEL A S500":   "#42A5F5",
};
const PALETTE = [
  "#FF5000", "#2196F3", "#8BC34A", "#FF9800", "#9C27B0",
  "#E53935", "#00ACC1", "#FF8C42", "#64B5F6", "#7CB342",
  "#FF7043", "#26C6DA", "#D4E157", "#AB47BC", "#EF5350",
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function rowDateKey(r: SindicomSerieRow) {
  return `${r.ano}-${String(r.mes).padStart(2, "0")}`;
}

function buildVolumeChart(
  rows: SindicomSerieRow[],
  produtos: string[],
  segmentos: string[],
): { data: PlotData[]; layout: Partial<Layout> } {
  const segSet = new Set(segmentos);
  const filtered = rows.filter(r =>
    produtos.includes(r.nome_produto) && segSet.has(r.segmento)
  );
  if (!filtered.length) return emptyPlot(320);

  // Aggregate by (produto, date_key) summing volume across empresas+segmentos
  const agg: Record<string, Record<string, number>> = {};
  for (const r of filtered) {
    if (!agg[r.nome_produto]) agg[r.nome_produto] = {};
    const k = rowDateKey(r);
    agg[r.nome_produto][k] = (agg[r.nome_produto][k] ?? 0) + (r.volume ?? 0);
  }

  const traces: PlotData[] = produtos
    .filter(p => agg[p])
    .map((p, i) => {
      const entries = Object.entries(agg[p]).sort(([a], [b]) => a.localeCompare(b));
      const color = PRODUTO_COLORS[p] ?? PALETTE[i % PALETTE.length];
      return {
        type: "scatter", mode: "lines",
        name: p,
        x: entries.map(([d]) => d + "-01"),
        y: entries.map(([, v]) => v),
        line: { width: 2, color },
        hovertemplate: `${p}: %{y:,.0f} m³<extra></extra>`,
      } as PlotData;
    });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 320,
      margin: { t: 10, b: 50, l: 90, r: 30 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: "Volume (m³)" } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0 },
    },
  };
}

function buildMarketShareChart(
  rows: SindicomSerieRow[],
  produto: string,
  segmentos: string[],
): { data: PlotData[]; layout: Partial<Layout> } {
  const segSet = new Set(segmentos);
  const filtered = rows.filter(r =>
    r.nome_produto === produto && segSet.has(r.segmento)
  );
  if (!filtered.length) return emptyPlot(400);

  // Sum by empresa
  const byEmpresa: Record<string, number> = {};
  for (const r of filtered) {
    byEmpresa[r.empresa] = (byEmpresa[r.empresa] ?? 0) + (r.volume ?? 0);
  }

  const sorted = Object.entries(byEmpresa)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 15);

  const total = sorted.reduce((s, [, v]) => s + v, 0);
  const topShare = sorted.length > 0 && total > 0 ? (sorted[0][1] / total) * 100 : 0;

  return {
    data: [{
      type: "bar",
      orientation: "h",
      x: sorted.map(([, v]) => total > 0 ? (v / total) * 100 : 0),
      y: sorted.map(([e]) => e),
      marker: { color: "#2196F3" },
      hovertemplate: "%{y}: %{x:.1f}%<extra></extra>",
      text: sorted.map(([, v]) => total > 0 ? `${((v / total) * 100).toFixed(1)}%` : ""),
      textposition: "outside",
    } as PlotData],
    layout: {
      ...COMMON_LAYOUT,
      height: 400,
      margin: { t: 10, b: 50, l: 180, r: 60 },
      xaxis: { ...AXIS_LINE, title: { text: "Participação (%)" }, range: [0, Math.min(100, topShare * 1.1 + 5)] },
      yaxis: { ...AXIS_LINE, autorange: "reversed" as const },
    },
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SindicomPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("sindicom");
  const supabase = getSupabaseClient();

  const [loading, setLoading]                   = useState(true);
  const [filtros, setFiltros]                   = useState<SindicomFiltros>({
    empresas: [], produtos: [], segmentos: [], ano_min: null, ano_max: null,
  });
  const [allRows, setAllRows]                   = useState<SindicomSerieRow[]>([]);
  const [allYears, setAllYears]                 = useState<number[]>([]);
  const [yearRange, setYearRange]               = useState<[number, number]>([0, 0]);
  const [selectedProdutos, setSelectedProdutos] = useState<string[]>([]);
  const [selectedSegmentos, setSelectedSegs]    = useState<string[]>([]);
  const [msProduto, setMsProduto]               = useState<string>("");
  const [excelLoading, setExcelLoading]         = useState(false);

  // ── Initial load: filtros + first serie fetch ────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const f = await rpcGetSindicomFiltros(supabase);
      if (cancelled) return;
      setFiltros(f);
      setSelectedProdutos(f.produtos);
      setSelectedSegs(f.segmentos);
      setMsProduto(f.produtos[0] ?? "");

      // Build years array. If table is empty (ano_min/max null), allYears stays []
      // and the period slider doesn't render — empty state messaging takes over.
      if (f.ano_min != null && f.ano_max != null) {
        const years: number[] = [];
        for (let y = f.ano_min; y <= f.ano_max; y++) years.push(y);
        const currentYear = new Date().getFullYear();
        const startIdx    = Math.max(0, years.findIndex(y => y >= currentYear - 5));
        const fromYear    = years[startIdx] ?? f.ano_min;
        const toYear      = f.ano_max;
        setAllYears(years);
        setYearRange([startIdx, years.length - 1]);

        const rows = await rpcGetSindicomSerie(supabase, {
          anoInicio: fromYear,
          anoFim:    toYear,
        });
        if (!cancelled) {
          setAllRows(rows);
        }
      }

      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // ── Reactive refetch (debounced 400ms) — period changes only ─────────────
  const { data: refetched, loading: serieLoading } = useDebouncedFetch(
    async () => {
      if (!supabase || loading || allYears.length === 0) return null;
      const yMin = allYears[yearRange[0]];
      const yMax = allYears[yearRange[1]];
      return rpcGetSindicomSerie(supabase, {
        anoInicio: yMin ?? null,
        anoFim:    yMax ?? null,
      });
    },
    [supabase, loading, yearRange[0], yearRange[1], allYears],
    { ms: 400, skipInitial: true },
  );

  useEffect(() => {
    if (refetched) setAllRows(refetched);
  }, [refetched]);

  const volChart = useMemo(
    () => buildVolumeChart(allRows, selectedProdutos, selectedSegmentos),
    [allRows, selectedProdutos, selectedSegmentos],
  );
  const msChart = useMemo(
    () => buildMarketShareChart(allRows, msProduto, selectedSegmentos),
    [allRows, msProduto, selectedSegmentos],
  );

  if (visLoading || !visible) return null;

  const toggleProduto = (p: string) =>
    setSelectedProdutos(prev =>
      prev.includes(p)
        ? prev.length > 1 ? prev.filter(x => x !== p) : prev
        : [...prev, p]
    );
  const toggleSegmento = (s: string) =>
    setSelectedSegs(prev =>
      prev.includes(s)
        ? prev.length > 1 ? prev.filter(x => x !== s) : prev
        : [...prev, s]
    );

  const hasYears = allYears.length > 0;
  const hasData  = filtros.produtos.length > 0;
  const yMin     = hasYears ? allYears[yearRange[0]] : null;
  const yMax     = hasYears ? allYears[yearRange[1]] : null;

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
                label="Produto"
                items={filtros.produtos}
                selected={selectedProdutos}
                onToggle={toggleProduto}
                onClear={filtros.produtos.length > 0 && selectedProdutos.length < filtros.produtos.length
                  ? () => setSelectedProdutos(filtros.produtos)
                  : undefined}
                swatch={(p) => {
                  const i = filtros.produtos.indexOf(p);
                  return PRODUTO_COLORS[p] ?? PALETTE[i % PALETTE.length];
                }}
                idPrefix="sind-p"
              />

              <MultiSelectFilter
                label="Segmento"
                items={filtros.segmentos}
                selected={selectedSegmentos}
                onToggle={toggleSegmento}
                onClear={filtros.segmentos.length > 0 && selectedSegmentos.length < filtros.segmentos.length
                  ? () => setSelectedSegs(filtros.segmentos)
                  : undefined}
                idPrefix="sind-s"
              />

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Período</div>
                {!loading && hasYears && (
                  <PeriodSlider years={allYears} value={yearRange} onChange={setYearRange} />
                )}
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Market Share — Produto</div>
                <select
                  className="form-select form-select-sm"
                  value={msProduto}
                  onChange={e => setMsProduto(e.target.value)}
                  disabled={filtros.produtos.length === 0}
                  style={{ fontFamily: "Arial", fontSize: 12 }}
                >
                  {filtros.produtos.length === 0 && <option value="">—</option>}
                  {filtros.produtos.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* ── Main content ──────────────────────────────────────────── */}
          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <DashboardHeader
                title="SINDICOM — Distribuição de Combustíveis por Empresa"
                sub="Volumes mensais de venda das distribuidoras associadas ao SINDICOM, por empresa, produto e segmento (mercado / consumidor)"
                period={hasYears && yMin != null && yMax != null ? [yMin, yMax] : null}
                rightSlot={hasData ? (
                  <ExportPanel
                    actions={[
                      {
                        kind: "excel",
                        label: "formatted data .xl",
                        busy: excelLoading,
                        loadingLabel: "Gerando Excel...",
                        disabled: loading || allRows.length === 0 || excelLoading,
                        onClick: async () => {
                          setExcelLoading(true);
                          try {
                            await downloadGenericExcel<SindicomSerieRow>({
                              rows: allRows,
                              filename: "SINDICOM",
                              title: "SINDICOM — Distribuição de Combustíveis por Empresa",
                              sheetName: "SINDICOM",
                              columns: [
                                { key: "ano",          header: "Ano" },
                                { key: "mes",          header: "Mês" },
                                { key: "empresa",      header: "Empresa", width: 24 },
                                { key: "nome_produto", header: "Produto", width: 22 },
                                { key: "segmento",     header: "Segmento", width: 18 },
                                { key: "volume",       header: "Volume (m³)", format: "#,##0" },
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
                        disabled: loading || allRows.length === 0,
                        onClick: () => {
                          downloadCsv({
                            rows: allRows as unknown as Record<string, unknown>[],
                            filename: "SINDICOM",
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
                <div className="chart-container" style={{ padding: "32px 24px", textAlign: "center" }}>
                  <div style={{ fontFamily: "Arial", fontSize: 14, color: "#555", marginBottom: 8 }}>
                    Aguardando dados — pipeline ainda não rodou.
                  </div>
                  <div style={{ fontFamily: "Arial", fontSize: 12, color: "#888" }}>
                    O scraper SINDICOM é bloqueado por Cloudflare quando rodado localmente. Dispare o workflow{" "}
                    <code style={{ fontSize: 11 }}>sindicom_sync.yml</code> via GitHub Actions{" "}
                    (<em>Actions → SINDICOM — Sync → Run workflow</em>) para popular a tabela.
                    Ver <code style={{ fontSize: 11 }}>docs/app/sindicom.md</code> para detalhes.
                  </div>
                </div>
              ) : (
                <>
                  <div className="row mb-2">
                    <div className="col-12">
                      <ChartSection
                        title="Volume Mensal por Produto (m³)"
                        loading={serieLoading}
                        height={320}
                      >
                        <PlotlyChart
                          data={volChart.data}
                          layout={volChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 320 }}
                        />
                      </ChartSection>
                    </div>
                  </div>

                  <div className="row mb-2">
                    <div className="col-12">
                      <ChartSection
                        title={`Market Share por Empresa — ${msProduto} (Top 15)`}
                        loading={serieLoading}
                        height={400}
                      >
                        <PlotlyChart
                          data={msChart.data}
                          layout={msChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 400 }}
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
