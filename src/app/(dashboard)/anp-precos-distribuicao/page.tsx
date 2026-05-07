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
import SegmentedToggle from "../../../components/dashboard/SegmentedToggle";
import SearchableMultiSelect from "../../../components/SearchableMultiSelect";
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
import { useDebouncedFetch } from "../../../hooks/useDebouncedFetch";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot } from "../../../lib/plotlyDefaults";
import { downloadAnpPdistExcel } from "../../../lib/exportExcel";
import { downloadCsv } from "../../../lib/exportCsv";
import {
  rpcGetAnpPdistFiltros,
  rpcGetAnpPdistSerie,
  getAnpPdistExportCount,
  type AnpPdistFiltros,
  type AnpPdistSerieRow,
  type AnpPdistExportCountFilters,
} from "../../../lib/rpc";

// ── Constants ─────────────────────────────────────────────────────────────────

const GRAN_OPTIONS = [
  { value: "brasil",    label: "Brasil" },
  { value: "uf",        label: "UF" },
  { value: "municipio", label: "Município" },
] as const;
type Granularidade = typeof GRAN_OPTIONS[number]["value"];

const MAX_LOCAIS_CHART = 5;

const PALETTE = [
  "#FF5000", "#2196F3", "#8BC34A", "#FF9800", "#9C27B0",
  "#E53935", "#00ACC1", "#FF8C42", "#64B5F6", "#7CB342",
];

const BRASIL_COLOR = "#FF5000";

// ── Chart helpers ──────────────────────────────────────────────────────────────

function buildChart(
  rows: AnpPdistSerieRow[],
  selectedLocais: string[],
  granularidade: Granularidade,
): { data: PlotData[]; layout: Partial<Layout> } {
  // For 'brasil', there's only "Brasil" — ignore selectedLocais filter.
  const filtered =
    granularidade === "brasil"
      ? rows
      : rows.filter(r => selectedLocais.includes(r.local));

  if (!filtered.length) return emptyPlot(360);

  const byLocal: Record<string, AnpPdistSerieRow[]> = {};
  for (const r of filtered) (byLocal[r.local] ??= []).push(r);

  const unidade = filtered[0]?.unidade ?? "";

  const locaisOrdered =
    granularidade === "brasil"
      ? Object.keys(byLocal)
      : selectedLocais.filter(l => byLocal[l]);

  const traces: PlotData[] = locaisOrdered.map((l, i) => {
    const data = byLocal[l].sort((a, b) => a.data_referencia.localeCompare(b.data_referencia));
    const color = granularidade === "brasil" ? BRASIL_COLOR : PALETTE[i % PALETTE.length];
    return {
      type: "scatter", mode: "lines",
      name: l,
      x: data.map(d => d.data_referencia),
      y: data.map(d => d.preco_medio),
      line: { width: 2, color },
      hovertemplate: `${l}: R$ %{y:.4f}<extra></extra>`,
    } as PlotData;
  });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 360,
      margin: { t: 10, b: 50, l: 80, r: 30 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: unidade ? unidade : "R$ / L" } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0 },
    },
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnpPrecosDistribuicaoPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-precos-distribuicao");
  const supabase = getSupabaseClient();

  const [loading, setLoading]       = useState(true);
  const [filtros, setFiltros]       = useState<AnpPdistFiltros>({
    produtos: [], granularidades: [], ufs: [], municipios: [],
    data_min: null, data_max: null,
  });
  const [serieRows, setSerieRows]   = useState<AnpPdistSerieRow[]>([]);
  const [allYears, setAllYears]     = useState<number[]>([]);
  const [yearRange, setYearRange]   = useState<[number, number]>([0, 0]);

  const [selectedProduto, setProduto]               = useState<string>("");
  const [selectedGran, setGran]                     = useState<Granularidade>("brasil");
  const [selectedLocais, setSelectedLocais]         = useState<string[]>([]);

  // ── Export modal state (Tier 2) ──────────────────────────────────────────
  const [exportOpen, setExportOpen]               = useState(false);
  const [excelLoading, setExcelLoading]           = useState(false);
  const [csvLoading, setCsvLoading]               = useState(false);
  const [exportProdutos, setExportProdutos]       = useState<string[]>([]);
  const [exportGranularidades, setExportGran]     = useState<string[]>([]);
  const [exportLocais, setExportLocais]           = useState<string[]>([]);
  const [exportRange, setExportRange]             = useState<[number, number]>([0, 0]);

  // ── Initial load ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const f = await rpcGetAnpPdistFiltros(supabase);
      if (cancelled) return;
      setFiltros(f);

      const yMin = f.data_min ? parseInt(f.data_min.slice(0, 4)) : new Date().getFullYear() - 5;
      const yMax = f.data_max ? parseInt(f.data_max.slice(0, 4)) : new Date().getFullYear();
      const years: number[] = [];
      for (let y = yMin; y <= yMax; y++) years.push(y);
      const startIdx = Math.max(0, years.findIndex(y => y >= yMax - 4));
      const fromYear = years[startIdx] ?? yMin;
      setAllYears(years);
      setYearRange([startIdx, Math.max(0, years.length - 1)]);

      const defaultProduto =
        f.produtos.find(p => p === "Gasolina Comum")
        ?? f.produtos[0]
        ?? "";
      setProduto(defaultProduto);

      const defaultGran: Granularidade =
        (f.granularidades.includes("brasil")
          ? "brasil"
          : (f.granularidades[0] as Granularidade | undefined)) ?? "brasil";
      setGran(defaultGran);

      // Initial fetch — only if we have a produto
      if (defaultProduto) {
        const rows = await rpcGetAnpPdistSerie(supabase, {
          produto:       defaultProduto,
          granularidade: defaultGran,
          dataInicio:    `${fromYear}-01-01`,
          dataFim:       `${yMax}-12-31`,
        });
        if (!cancelled) setSerieRows(rows);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // ── Available locais for current granularidade ───────────────────────────
  const availableLocais = useMemo<string[]>(() => {
    if (selectedGran === "brasil")    return [];
    if (selectedGran === "uf")        return filtros.ufs;
    if (selectedGran === "municipio") return filtros.municipios;
    return [];
  }, [selectedGran, filtros.ufs, filtros.municipios]);

  // ── When granularity changes, reset locais selection ─────────────────────
  useEffect(() => {
    if (selectedGran === "brasil") {
      setSelectedLocais([]);
      return;
    }
    // Default: pick first MAX_LOCAIS_CHART entries from the available pool
    const defaults = availableLocais.slice(0, MAX_LOCAIS_CHART);
    setSelectedLocais(defaults);
  }, [selectedGran, availableLocais]);

  // ── Reactive serie fetch (debounced 400ms) ───────────────────────────────
  const { data: refetched, loading: serieLoading } = useDebouncedFetch(
    async () => {
      if (!supabase || loading || !selectedProduto) return null;
      const yMin = allYears[yearRange[0]];
      const yMax = allYears[yearRange[1]];
      // For municipio, push selected locais to the server to bound payload.
      // For uf and brasil, pass NULL (server returns all UFs / Brasil).
      const locais =
        selectedGran === "municipio" && selectedLocais.length > 0
          ? selectedLocais
          : null;
      return rpcGetAnpPdistSerie(supabase, {
        produto:       selectedProduto,
        granularidade: selectedGran,
        locais,
        dataInicio:    yMin ? `${yMin}-01-01` : null,
        dataFim:       yMax ? `${yMax}-12-31` : null,
      });
    },
    [supabase, loading, selectedProduto, selectedGran, selectedLocais, yearRange[0], yearRange[1], allYears],
    { ms: 400, skipInitial: true },
  );

  useEffect(() => {
    if (refetched) setSerieRows(refetched);
  }, [refetched]);

  const chart = useMemo(
    () => buildChart(serieRows, selectedLocais, selectedGran),
    [serieRows, selectedLocais, selectedGran],
  );

  // ── Export modal helpers ─────────────────────────────────────────────────
  function openExportModal() {
    setExportProdutos(selectedProduto ? [selectedProduto] : filtros.produtos);
    setExportGran([selectedGran]);
    setExportLocais([]);
    setExportRange(yearRange);
    setExportOpen(true);
  }

  const exportFilters = useMemo<AnpPdistExportCountFilters>(() => {
    const yMinExp = allYears[exportRange[0]] ?? null;
    const yMaxExp = allYears[exportRange[1]] ?? null;
    return {
      produtos:        exportProdutos.length === 0 || exportProdutos.length === filtros.produtos.length
                         ? null
                         : exportProdutos,
      granularidades:  exportGranularidades.length === 0 ? null : exportGranularidades,
      locais:          exportLocais.length === 0 ? null : exportLocais,
      dataInicio:      yMinExp ? `${yMinExp}-01-01` : null,
      dataFim:         yMaxExp ? `${yMaxExp}-12-31` : null,
    };
  }, [exportProdutos, exportGranularidades, exportLocais, exportRange, allYears, filtros.produtos.length]);

  // ── Locais available for export (based on selected granularidades) ───────
  const exportAvailableLocais = useMemo<string[]>(() => {
    const wantsUf  = exportGranularidades.includes("uf");
    const wantsMun = exportGranularidades.includes("municipio");
    const list: string[] = [];
    if (wantsUf)  list.push(...filtros.ufs);
    if (wantsMun) list.push(...filtros.municipios);
    return list;
  }, [exportGranularidades, filtros.ufs, filtros.municipios]);

  if (visLoading || !visible) return null;

  // ── UI helpers ───────────────────────────────────────────────────────────
  const toggleLocal = (l: string) => {
    setSelectedLocais(prev => {
      if (prev.includes(l)) {
        return prev.filter(x => x !== l);
      }
      // Cap at MAX_LOCAIS_CHART for município UX (prevents chart overload)
      if (selectedGran === "municipio" && prev.length >= MAX_LOCAIS_CHART) {
        return prev;
      }
      return [...prev, l];
    });
  };

  const hasYears = allYears.length > 0;
  const yMin = hasYears ? allYears[yearRange[0]] : null;
  const yMax = hasYears ? allYears[yearRange[1]] : null;
  const localsCounter = selectedGran === "brasil" ? 0 : selectedLocais.length;

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
                  disabled={filtros.produtos.length === 0}
                >
                  {filtros.produtos.length === 0 && (
                    <option value="">— sem dados —</option>
                  )}
                  {filtros.produtos.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Granularidade</div>
                <SegmentedToggle<Granularidade>
                  options={[...GRAN_OPTIONS]}
                  value={selectedGran}
                  onChange={(v) => setGran(v)}
                  variant="full"
                />
              </div>

              {selectedGran !== "brasil" && (
                <MultiSelectFilter
                  label={selectedGran === "uf" ? "UF" : "Município"}
                  items={availableLocais}
                  selected={selectedLocais}
                  onToggle={toggleLocal}
                  onClear={
                    selectedLocais.length > 0
                      ? () => setSelectedLocais([])
                      : undefined
                  }
                  counterTotal={availableLocais.length}
                  idPrefix={`pdist-${selectedGran}`}
                />
              )}

              {selectedGran === "municipio" && (
                <div style={{ fontSize: 11, color: "#888", marginTop: -6, marginBottom: 12, paddingLeft: 2 }}>
                  Máx. {MAX_LOCAIS_CHART} municípios no gráfico ({localsCounter}/{MAX_LOCAIS_CHART}).
                </div>
              )}

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
                title="ANP — Preços de Distribuição de Combustíveis"
                sub="Preços médios praticados por distribuidoras (Brasil semanal, UF/Município mensal)"
                period={hasYears && yMin != null && yMax != null ? [yMin, yMax] : null}
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
                <div className="row mb-2">
                  <div className="col-12">
                    <ChartSection
                      title={
                        selectedProduto
                          ? `Preço Médio — ${selectedProduto} (${selectedGran === "brasil" ? "Brasil" : selectedGran === "uf" ? "por UF" : "por Município"})`
                          : "Preço Médio"
                      }
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

      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Exportar — ANP Preços Distribuição"
        datasetKey="anp-precos-distribuicao"
        currentFilters={exportFilters}
        countFetcher={async () => {
          if (!supabase) return 0;
          return getAnpPdistExportCount(supabase, exportFilters);
        }}
        excelBusy={excelLoading}
        csvBusy={csvLoading}
        loadingLabel={excelLoading ? "Gerando Excel..." : "Baixando CSV..."}
        onExportExcel={async () => {
          if (!supabase) return;
          setExcelLoading(true);
          try {
            // Fetch concrete rows for each (produto, granularidade) combination
            // selected in the modal, concatenate, and ship to Excel.
            const targets = pickExportTargets();
            const allRows: AnpPdistSerieRow[] = [];
            for (const t of targets) {
              const rows = await rpcGetAnpPdistSerie(supabase, {
                produto:       t.produto,
                granularidade: t.granularidade,
                locais:        exportLocais.length ? exportLocais : null,
                dataInicio:    exportFilters.dataInicio,
                dataFim:       exportFilters.dataFim,
              });
              allRows.push(...rows);
            }
            await downloadAnpPdistExcel(allRows);
            setExportOpen(false);
          } catch (e) {
            console.error("ANP PDist Excel export failed", e);
          } finally {
            setExcelLoading(false);
          }
        }}
        onExportCsv={async () => {
          if (!supabase) return;
          setCsvLoading(true);
          try {
            const targets = pickExportTargets();
            const allRows: AnpPdistSerieRow[] = [];
            for (const t of targets) {
              const rows = await rpcGetAnpPdistSerie(supabase, {
                produto:       t.produto,
                granularidade: t.granularidade,
                locais:        exportLocais.length ? exportLocais : null,
                dataInicio:    exportFilters.dataInicio,
                dataFim:       exportFilters.dataFim,
              });
              allRows.push(...rows);
            }
            const now = new Date();
            const dd = String(now.getDate()).padStart(2, "0");
            const mm = String(now.getMonth() + 1).padStart(2, "0");
            const yy = String(now.getFullYear()).slice(-2);
            downloadCsv({
              rows: allRows as unknown as Record<string, unknown>[],
              filename: `anp_precos_distribuicao_${dd}-${mm}-${yy}`,
            });
            setExportOpen(false);
          } catch (e) {
            console.error("ANP PDist CSV export failed", e);
          } finally {
            setCsvLoading(false);
          }
        }}
        filters={
          <div style={{ display: "flex", flexDirection: "column", gap: 14, fontFamily: "Arial" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>Período</div>
              {hasYears && (
                <PeriodSlider years={allYears} value={exportRange} onChange={setExportRange} />
              )}
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                Produtos <span style={{ color: "#888", fontWeight: 400 }}>({exportProdutos.length}/{filtros.produtos.length})</span>
              </div>
              <MultiSelectFilter
                label="Produtos"
                items={filtros.produtos}
                selected={exportProdutos}
                onToggle={(p) =>
                  setExportProdutos(prev =>
                    prev.includes(p)
                      ? prev.filter(x => x !== p)
                      : [...prev, p]
                  )
                }
                onClear={exportProdutos.length > 0 ? () => setExportProdutos([]) : undefined}
                idPrefix="pdist-export-produtos"
              />
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                Granularidades <span style={{ color: "#888", fontWeight: 400 }}>({exportGranularidades.length}/{filtros.granularidades.length})</span>
              </div>
              <MultiSelectFilter
                label="Granularidades"
                items={filtros.granularidades}
                selected={exportGranularidades}
                onToggle={(g) =>
                  setExportGran(prev =>
                    prev.includes(g)
                      ? prev.filter(x => x !== g)
                      : [...prev, g]
                  )
                }
                onClear={exportGranularidades.length > 0 ? () => setExportGran([]) : undefined}
                idPrefix="pdist-export-gran"
              />
            </div>

            {exportAvailableLocais.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                  Locais <span style={{ color: "#888", fontWeight: 400 }}>({exportLocais.length === 0 ? "todos" : `${exportLocais.length}/${exportAvailableLocais.length}`})</span>
                </div>
                <SearchableMultiSelect
                  options={exportAvailableLocais}
                  value={exportLocais}
                  onChange={setExportLocais}
                />
              </div>
            )}
          </div>
        }
      />
    </div>
  );

  // ── Inner helper ─────────────────────────────────────────────────────────
  function pickExportTargets(): Array<{ produto: string; granularidade: string }> {
    const produtos = exportProdutos.length === 0 ? filtros.produtos : exportProdutos;
    const grans    = exportGranularidades.length === 0 ? filtros.granularidades : exportGranularidades;
    const out: Array<{ produto: string; granularidade: string }> = [];
    for (const p of produtos) for (const g of grans) out.push({ produto: p, granularidade: g });
    return out;
  }
}
