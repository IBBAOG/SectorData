// ─────────────────────────────────────────────────────────────────────────────
// rpc.ts — Supabase RPC wrappers
//
// Convention:
//   • Each dashboard module has its own section below.
//   • To add a new module: create a new section, export typed wrappers for
//     each function that calls supabase.rpc("<fn_name>", params).
//   • Use `paginatedRpc()` for calls that may return more than 1 000 rows.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from "@supabase/supabase-js";

export type SalesMetricas = {
  total_registros: number;
  quantidade_total: number;
  anos_distintos: number;
};

export type SalesFilters = {
  data_inicio?: string | null;
  data_fim?: string | null;
  agentes?: string[] | null;
  regioes_dest?: string[] | null;
  ufs_dest?: string[] | null;
  mercados?: string[] | null;
  segmentos?: string[] | null;
};

function toListOrNull(v?: string[] | null): string[] | null {
  if (!v || v.length === 0) return null;
  return Array.from(v);
}

export function buildSalesParams(filters: SalesFilters) {
  return {
    p_data_inicio: filters.data_inicio ?? null,
    p_data_fim: filters.data_fim ?? null,
    p_agentes: toListOrNull(filters.agentes),
    p_regioes_dest: toListOrNull(filters.regioes_dest),
    p_ufs_dest: toListOrNull(filters.ufs_dest),
    p_mercados: toListOrNull(filters.mercados),
    p_segmentos: toListOrNull(filters.segmentos),
  };
}

export type MarketShareFilters = {
  data_inicio?: string | null;
  data_fim?: string | null;
  regioes?: string[] | null;
  ufs?: string[] | null;
  mercados?: string[] | null;
};


// ─── MODULE: Sales Dashboard (/src/app/(dashboard)/page.tsx) ─────────────────

export async function rpcGetOpcoesFiltros(
  supabase: SupabaseClient,
): Promise<Record<string, unknown>> {
  try {
    const { data, error } = await supabase.rpc("get_opcoes_filtros", {});
    if (error) throw error;
    return (data ?? {}) as Record<string, unknown>;
  } catch (e) {
    console.error("get_opcoes_filtros failed", e);
    return {};
  }
}

export async function rpcGetMetricas(
  supabase: SupabaseClient,
  filters: SalesFilters,
): Promise<SalesMetricas> {
  try {
    const params = buildSalesParams(filters);
    const { data, error } = await supabase.rpc("get_metricas", params);
    if (error) throw error;
    const d = (data ?? {}) as Partial<SalesMetricas>;
    return {
      total_registros: Number(d.total_registros ?? 0),
      quantidade_total: Number(d.quantidade_total ?? 0),
      anos_distintos: Number(d.anos_distintos ?? 0),
    };
  } catch (e) {
    console.error("get_metricas failed", e);
    return { total_registros: 0, quantidade_total: 0.0, anos_distintos: 0 };
  }
}

export async function rpcGetQtdPorAno(supabase: SupabaseClient, filters: SalesFilters) {
  try {
    const params = buildSalesParams(filters);
    const { data, error } = await supabase.rpc("get_qtd_por_ano", params);
    if (error) throw error;
    return (data ?? []) as Array<{ ano: string | number; quantidade: number }>;
  } catch (e) {
    console.error("get_qtd_por_ano failed", e);
    return [];
  }
}

export async function rpcGetQtdPorMes(supabase: SupabaseClient, filters: SalesFilters) {
  try {
    const params = buildSalesParams(filters);
    const { data, error } = await supabase.rpc("get_qtd_por_mes", params);
    if (error) throw error;
    return (data ?? []) as Array<{ mes: string; quantidade: number }>;
  } catch (e) {
    console.error("get_qtd_por_mes failed", e);
    return [];
  }
}

export async function rpcGetQtdPorRegiao(supabase: SupabaseClient, filters: SalesFilters) {
  try {
    const params = buildSalesParams(filters);
    const { data, error } = await supabase.rpc("get_qtd_por_regiao", params);
    if (error) throw error;
    return (data ?? []) as Array<{ regiao: string; quantidade: number }>;
  } catch (e) {
    console.error("get_qtd_por_regiao failed", e);
    return [];
  }
}

export async function rpcGetQtdPorUf(supabase: SupabaseClient, filters: SalesFilters) {
  try {
    const params = buildSalesParams(filters);
    const { data, error } = await supabase.rpc("get_qtd_por_uf", params);
    if (error) throw error;
    return (data ?? []) as Array<{ uf: string; quantidade: number }>;
  } catch (e) {
    console.error("get_qtd_por_uf failed", e);
    return [];
  }
}

export async function rpcGetQtdPorAgente(supabase: SupabaseClient, filters: SalesFilters) {
  try {
    const params = buildSalesParams(filters);
    const { data, error } = await supabase.rpc("get_qtd_por_agente", params);
    if (error) throw error;
    return (data ?? []) as Array<{ agente: string; quantidade: number }>;
  } catch (e) {
    console.error("get_qtd_por_agente failed", e);
    return [];
  }
}

export async function rpcGetQtdPorProduto(supabase: SupabaseClient, filters: SalesFilters) {
  try {
    const params = buildSalesParams(filters);
    const { data, error } = await supabase.rpc("get_qtd_por_produto", params);
    if (error) throw error;
    return (data ?? []) as Array<{ produto: string; quantidade: number }>;
  } catch (e) {
    console.error("get_qtd_por_produto failed", e);
    return [];
  }
}

// ─── MODULE: Market Share (/src/app/(dashboard)/market-share/page.tsx) ───────

export async function rpcGetMsOpcoesFiltros(supabase: SupabaseClient) {
  try {
    const { data, error } = await supabase.rpc("get_ms_opcoes_filtros", {});
    if (error) throw error;
    return (data ?? {}) as Record<string, unknown>;
  } catch (e) {
    console.error("get_ms_opcoes_filtros failed", e);
    return {};
  }
}

export type MsSerieRow = {
  date: string;
  nome_produto: string;
  segmento: string;
  classificacao: string;
  agente_regulado?: string;
  quantidade: number;
};

async function paginatedRpc(
  supabase: SupabaseClient,
  fnName: string,
  filters: MarketShareFilters,
): Promise<MsSerieRow[]> {
  const PAGE = 1000;
  let offset = 0;
  const allRows: MsSerieRow[] = [];

  const params = {
    p_data_inicio: filters.data_inicio ?? null,
    p_data_fim: filters.data_fim ?? null,
    p_regioes: toListOrNull(filters.regioes),
    p_ufs: toListOrNull(filters.ufs),
    p_mercados: toListOrNull(filters.mercados),
  };

  while (true) {
    const { data, error } = await supabase.rpc(fnName, params).range(offset, offset + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as MsSerieRow[];
    if (!rows.length) break;
    allRows.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  return allRows;
}

export async function rpcGetMsSerie(supabase: SupabaseClient, filters: MarketShareFilters) {
  return paginatedRpc(supabase, "get_ms_serie", filters);
}

export async function rpcGetMsSerieOthers(supabase: SupabaseClient, filters: MarketShareFilters) {
  return paginatedRpc(supabase, "get_ms_serie_others", filters);
}

/**
 * Filters accepted by `fetchVendasFiltered` (CSV export of /market-share +
 * /sales-volumes). Mirrors `MsExportCountFilters` 1:1 so the modal estimate
 * and the actual download share the exact same predicate.
 *
 * Column mapping (vendas table):
 *   dataInicio / dataFim → vendas.date
 *   regioes              → vendas.regiao_destinatario
 *   ufs                  → vendas.uf_destino
 *   mercados             → vendas.mercado_destinatario
 */
export type FetchVendasFilters = {
  dataInicio?: string | null;
  dataFim?: string | null;
  regioes?: string[] | null;
  ufs?: string[] | null;
  mercados?: string[] | null;
};

/**
 * Paginated SELECT * FROM vendas with the same filter predicate used by
 * `get_ms_export_count`. Used by the CSV export path on /market-share and
 * /sales-volumes so the rows downloaded match exactly the size estimate
 * shown in the export modal.
 */
export async function fetchVendasFiltered(
  supabase: SupabaseClient,
  filters: FetchVendasFilters,
): Promise<Record<string, unknown>[]> {
  const PAGE = 1000;
  let offset = 0;
  const allRows: Record<string, unknown>[] = [];

  const regioes  = toListOrNull(filters.regioes);
  const ufs      = toListOrNull(filters.ufs);
  const mercados = toListOrNull(filters.mercados);

  while (true) {
    let q = supabase.from("vendas").select("*");

    if (filters.dataInicio) q = q.gte("date", filters.dataInicio);
    if (filters.dataFim)    q = q.lte("date", filters.dataFim);
    if (regioes)            q = q.in("regiao_destinatario", regioes);
    if (ufs)                q = q.in("uf_destino", ufs);
    if (mercados)           q = q.in("mercado_destinatario", mercados);

    const { data, error } = await q.range(offset, offset + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as Record<string, unknown>[];
    if (!rows.length) break;
    allRows.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  return allRows;
}

/** Fast endpoint for Individual/Big-3 — pre-aggregated by classificacao, ~5 pages vs ~80 */
export async function rpcGetMsSerieFast(supabase: SupabaseClient, filters: MarketShareFilters) {
  return paginatedRpc(supabase, "get_ms_serie_fast", filters);
}

/** Fetch distinct agente_regulado names for the Others competitor dropdown (~50 rows) */
export async function rpcGetOthersPlayers(supabase: SupabaseClient): Promise<string[]> {
  try {
    const { data, error } = await supabase.rpc("get_others_players", {});
    if (error) throw error;
    return ((data ?? []) as { agente_regulado: string }[]).map(r => r.agente_regulado);
  } catch (e) {
    console.error("get_others_players failed", e);
    return [];
  }
}

// ─── MODULE: Sales Volumes (/src/app/(dashboard)/sales-volumes/page.tsx) ─────

export async function rpcGetSvOpcoesFiltros(supabase: SupabaseClient) {
  try {
    const { data, error } = await supabase.rpc("get_sv_opcoes_filtros", {});
    if (error) throw error;
    return (data ?? {}) as Record<string, unknown>;
  } catch (e) {
    console.error("get_sv_opcoes_filtros failed", e);
    return {};
  }
}

export async function rpcGetSvSerieFast(supabase: SupabaseClient, filters: MarketShareFilters) {
  return paginatedRpc(supabase, "get_sv_serie_fast", filters);
}

export async function rpcGetSvSerieOthers(supabase: SupabaseClient, filters: MarketShareFilters) {
  return paginatedRpc(supabase, "get_sv_serie_others", filters);
}

export async function rpcGetSvOthersPlayers(supabase: SupabaseClient): Promise<string[]> {
  try {
    const { data, error } = await supabase.rpc("get_sv_others_players", {});
    if (error) throw error;
    return ((data ?? []) as { agente_regulado: string }[]).map(r => r.agente_regulado);
  } catch (e) {
    console.error("get_sv_others_players failed", e);
    return [];
  }
}

// ─── MODULE: Navios Diesel (/src/app/(dashboard)/navios-diesel/page.tsx) ─────

export type NavioDieselRow = {
  id: number;
  collected_at: string;
  porto: string;
  status: string;
  navio: string;
  produto: string;
  quantidade: number;
  unidade: string;
  quantidade_convertida: number;
  eta: string | null;
  inicio_descarga: string | null;
  fim_descarga: string | null;
  origem: string | null;
  berco: string | null;
  imo: string | null;
  mmsi: string | null;
  flag: string | null;
  is_cabotagem: boolean;
};

export type PortoResumo = {
  porto: string;
  total_navios: number;
  total_quantidade: number;
  total_convertida: number;
};

export async function rpcGetNdUltimaColeta(
  supabase: SupabaseClient,
): Promise<{ ultima_coleta: string | null }> {
  try {
    const { data, error } = await supabase.rpc("get_nd_ultima_coleta", {});
    if (error) throw error;
    return (data ?? { ultima_coleta: null }) as { ultima_coleta: string | null };
  } catch (e) {
    console.error("get_nd_ultima_coleta failed", e);
    return { ultima_coleta: null };
  }
}

export async function rpcGetNdColetasDistintas(
  supabase: SupabaseClient,
): Promise<string[]> {
  try {
    const { data, error } = await supabase.rpc("get_nd_coletas_distintas", {});
    if (error) throw error;
    return (data ?? []) as string[];
  } catch (e) {
    console.error("get_nd_coletas_distintas failed", e);
    return [];
  }
}

export async function rpcGetNdNavios(
  supabase: SupabaseClient,
  collectedAt: string,
): Promise<NavioDieselRow[]> {
  try {
    const { data, error } = await supabase.rpc("get_nd_navios", {
      p_collected_at: collectedAt,
    });
    if (error) throw error;
    return (data ?? []) as NavioDieselRow[];
  } catch (e) {
    console.error("get_nd_navios failed", e);
    return [];
  }
}

export async function rpcGetNdResumoPortos(
  supabase: SupabaseClient,
  collectedAt: string,
): Promise<PortoResumo[]> {
  try {
    const { data, error } = await supabase.rpc("get_nd_resumo_portos", {
      p_collected_at: collectedAt,
    });
    if (error) throw error;
    return (data ?? []) as PortoResumo[];
  } catch (e) {
    console.error("get_nd_resumo_portos failed", e);
    return [];
  }
}

export type NdVolumeMensalDescargaRow = {
  month: string;              // "YYYY-MM"
  discharged_volume: number;
  pending_volume: number;
  indeterminate_volume: number; // último volume de portos com ERRO_COLETA
};

export async function rpcGetNdVolumeMensalDescarga(
  supabase: SupabaseClient,
  collectedAt: string,
): Promise<NdVolumeMensalDescargaRow[]> {
  try {
    const { data, error } = await supabase.rpc("get_nd_volume_mensal_descarga", {
      p_collected_at: collectedAt,
    });
    if (error) throw error;
    return (data ?? []) as NdVolumeMensalDescargaRow[];
  } catch (e) {
    console.error("get_nd_volume_mensal_descarga failed", e);
    return [];
  }
}

export type NdNavioDescarregadoRow = {
  navio: string;
  porto: string;
  /** "YYYY-MM-DD HH24:MI" in BRT — last snapshot where vessel was seen */
  last_seen: string;
  /** Last known volume in m³ */
  last_volume: number;
  /** "YYYY-MM" — estimated discharge month (ETA → unload start → unload end → last_seen) */
  discharge_month: string;
};

export async function rpcGetNdNaviosDescarregados(
  supabase: SupabaseClient,
  collectedAt: string,
): Promise<NdNavioDescarregadoRow[]> {
  try {
    const { data, error } = await supabase.rpc("get_nd_navios_descarregados", {
      p_collected_at: collectedAt,
    });
    if (error) throw error;
    return (data ?? []) as NdNavioDescarregadoRow[];
  } catch (e) {
    console.error("get_nd_navios_descarregados failed", e);
    return [];
  }
}

export type NdResumoMensalPortoRow = {
  porto: string;
  month: string;    // "YYYY-MM"
  vessels: number;
  volume: number;
};

export async function rpcGetNdResumoMensalPortos(
  supabase: SupabaseClient,
  collectedAt: string,
): Promise<NdResumoMensalPortoRow[]> {
  try {
    const { data, error } = await supabase.rpc("get_nd_resumo_mensal_portos", {
      p_collected_at: collectedAt,
    });
    if (error) throw error;
    return (data ?? []) as NdResumoMensalPortoRow[];
  } catch (e) {
    console.error("get_nd_resumo_mensal_portos failed", e);
    return [];
  }
}

// ─── MODULE: Navios Diesel — AIS tracking add-on ─────────────────────────────

export type AisPositionRow = {
  navio: string;
  imo: string | null;
  mmsi: string | null;
  ts: string | null;
  lat: number | null;
  lon: number | null;
  sog: number | null;
  cog: number | null;
  nav_status: string | null;
  inside_port: string | null;
};

export type PortArrivalRow = {
  imo: string | null;
  mmsi: string | null;
  vessel_name: string | null;
  port_slug: string;
  port_name: string | null;
  entered_at: string;
  exited_at: string | null;
  detected_at: string | null;
};

export type PortPolygonRow = {
  slug: string;
  name: string;
  /** GeoJSON Polygon geometry */
  polygon: {
    type: "Polygon";
    coordinates: number[][][];
  };
};

export async function rpcGetAisPositionsLatest(
  supabase: SupabaseClient,
  collectedAt: string,
): Promise<AisPositionRow[]> {
  try {
    const { data, error } = await supabase.rpc("get_ais_positions_latest", {
      p_collected_at: collectedAt,
    });
    if (error) throw error;
    return (data ?? []) as AisPositionRow[];
  } catch (e) {
    console.error("get_ais_positions_latest failed", e);
    return [];
  }
}

export async function rpcGetAisArrivalsOpen(
  supabase: SupabaseClient,
): Promise<PortArrivalRow[]> {
  try {
    const { data, error } = await supabase.rpc("get_ais_arrivals_open", {});
    if (error) throw error;
    return (data ?? []) as PortArrivalRow[];
  } catch (e) {
    console.error("get_ais_arrivals_open failed", e);
    return [];
  }
}

export async function rpcGetPortPolygons(
  supabase: SupabaseClient,
): Promise<PortPolygonRow[]> {
  try {
    const { data, error } = await supabase.rpc("get_port_polygons", {});
    if (error) throw error;
    return (data ?? []) as PortPolygonRow[];
  } catch (e) {
    console.error("get_port_polygons failed", e);
    return [];
  }
}

export async function rpcGetAisPositionsAllRecent(
  supabase: SupabaseClient,
  hours: number = 24,
): Promise<AisPositionRow[]> {
  try {
    const { data, error } = await supabase.rpc("get_ais_positions_all_recent", {
      p_hours: hours,
    });
    if (error) throw error;
    return (data ?? []) as AisPositionRow[];
  } catch (e) {
    console.error("get_ais_positions_all_recent failed", e);
    return [];
  }
}

// ─── MODULE: Navios Diesel — AIS Import Radar (discovery) ───────────────────

export type ImportCandidateSignals = {
  destination_br_port?: boolean;
  tanker?: boolean;
  size_product_range?: boolean;
  origin_product_hub?: boolean;
  loaded?: boolean;
};

export type ImportCandidateRow = {
  id: number;
  imo: string;
  mmsi: string | null;
  navio: string;
  flag: string | null;
  ship_type_code: number | null;
  ship_type: string | null;
  length_m: number | null;
  dwt: number | null;
  destination_raw: string | null;
  destination_slug: string | null;
  destination_port_name: string | null;
  eta: string | null;
  origin_port_name: string | null;
  origin_locode: string | null;
  origin_country: string | null;
  origin_is_product_hub: boolean | null;
  departure_ts: string | null;
  current_draught_m: number | null;
  max_draught_m: number | null;
  is_loaded: boolean | null;
  confidence_score: number | null;
  signals: ImportCandidateSignals | null;
  last_seen_lat: number | null;
  last_seen_lon: number | null;
  last_seen_ts: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  status: "active" | "in_lineup" | "arrived" | "dismissed";
  in_lineup_since: string | null;
};

export type ImportCandidateSummaryRow = {
  destination_slug: string;
  candidates: number;
  in_lineup: number;
  active_only: number;
  avg_confidence: number;
  total_dwt: number;
};

export type DiscoveryRunRow = {
  ran_at: string;
  listen_seconds: number | null;
  msgs_total: number | null;
  br_matches: number | null;
  unique_imos: number | null;
  cabotage_skipped: number | null;
  non_tanker_skipped: number | null;
  candidates_written: number | null;
  positions_written: number | null;
};

export async function rpcGetIcActive(
  supabase: SupabaseClient,
): Promise<ImportCandidateRow[]> {
  try {
    const { data, error } = await supabase.rpc("get_ic_active", {});
    if (error) throw error;
    return (data ?? []) as ImportCandidateRow[];
  } catch (e) {
    console.error("get_ic_active failed", e);
    return [];
  }
}

export async function rpcGetIcSummary(
  supabase: SupabaseClient,
): Promise<ImportCandidateSummaryRow[]> {
  try {
    const { data, error } = await supabase.rpc("get_ic_summary", {});
    if (error) throw error;
    return (data ?? []) as ImportCandidateSummaryRow[];
  } catch (e) {
    console.error("get_ic_summary failed", e);
    return [];
  }
}

export async function rpcGetIcLastRun(
  supabase: SupabaseClient,
): Promise<DiscoveryRunRow | null> {
  try {
    const { data, error } = await supabase.rpc("get_ic_last_run", {});
    if (error) throw error;
    return (data ?? null) as DiscoveryRunRow | null;
  } catch (e) {
    console.error("get_ic_last_run failed", e);
    return null;
  }
}

export async function rpcGetIcDistinctDates(
  supabase: SupabaseClient,
): Promise<string[]> {
  try {
    const { data, error } = await supabase.rpc("get_ic_distinct_dates", {});
    if (error) throw error;
    return (data ?? []) as string[];
  } catch (e) {
    console.error("get_ic_distinct_dates failed", e);
    return [];
  }
}

export async function rpcGetIcSnapshot(
  supabase: SupabaseClient,
  date: string,
): Promise<ImportCandidateRow[]> {
  try {
    const { data, error } = await supabase.rpc("get_ic_snapshot", { p_date: date });
    if (error) throw error;
    return (data ?? []) as ImportCandidateRow[];
  } catch (e) {
    console.error("get_ic_snapshot failed", e);
    return [];
  }
}

// ─── MODULE: Diesel & Gasoline Margins (/src/app/(dashboard)/diesel-gasoline-margins/page.tsx) ─

export type DgMarginsRow = {
  id: number;
  fuel_type: string;
  week: string;
  distribution_and_resale_margin: number;
  state_tax: number;
  federal_tax: number;
  biofuel_component: number;
  base_fuel: number;
  total: number;
};

export async function rpcGetDgMarginsData(
  supabase: SupabaseClient,
  fuelType?: string | null,
): Promise<DgMarginsRow[]> {
  try {
    const { data, error } = await supabase.rpc("get_dg_margins_data", {
      p_fuel_type: fuelType ?? null,
    });
    if (error) throw error;
    return (data ?? []) as DgMarginsRow[];
  } catch (e) {
    console.error("get_dg_margins_data failed", e);
    return [];
  }
}

export async function rpcGetDgMarginsFilters(
  supabase: SupabaseClient,
): Promise<{ fuel_types: string[]; weeks: string[] }> {
  try {
    const { data, error } = await supabase.rpc("get_dg_margins_filters", {});
    if (error) throw error;
    const d = (data ?? {}) as { fuel_types?: string[]; weeks?: string[] };
    return {
      fuel_types: d.fuel_types ?? [],
      weeks: d.weeks ?? [],
    };
  } catch (e) {
    console.error("get_dg_margins_filters failed", e);
    return { fuel_types: [], weeks: [] };
  }
}

// ─── MODULE: Price Bands (/src/app/(dashboard)/price-bands/page.tsx) ─────────

export type PriceBandsRow = {
  id: number;
  date: string;                          // "YYYY-MM-DD"
  product: string;                       // "Gasoline" | "Diesel"
  bba_import_parity: number | null;      // bba = calculated import parity
  bba_import_parity_w_subsidy: number | null; // Diesel only
  bba_export_parity: number | null;
  petrobras_price: number | null;
  petrobras_price_w_subsidy: number | null;   // reserved
};

export async function rpcGetPriceBandsData(
  supabase: SupabaseClient,
  product?: string
): Promise<PriceBandsRow[]> {
  const PAGE = 1000;
  let offset = 0;
  const allRows: PriceBandsRow[] = [];

  while (true) {
    const { data, error } = await supabase
      .rpc("get_price_bands_data", { p_product: product ?? null })
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.error("rpcGetPriceBandsData:", error);
      break;
    }
    const rows = (data ?? []) as PriceBandsRow[];
    if (!rows.length) break;
    allRows.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  return allRows;
}

// ─── MODULE: ANP Prices (/src/app/(dashboard)/anp-prices/) ─────────────────
//
// Consolidates 3 retired dashboards (/anp-precos-produtores,
// /anp-precos-distribuicao, /anp-lpc) into a single supply-chain price
// surveyor. Backend RPCs unify the 3 source tables with product/unit/region
// normalization and a Diesel S10→S500 fallback.

export type AnpPricesFiltros = {
  produtos: string[];        // ['Gasoline','Diesel','Ethanol','Biodiesel','LPG']
  granularidades: string[];  // ['brasil','regiao','uf','municipio']
  regioes: string[];         // title-case with hyphen ('Centro-Oeste')
  ufs: string[];             // 2-letter codes ('SP', 'RJ')
  municipios: string[];      // UPPERCASE ASCII names
  data_min: string | null;   // ISO 'YYYY-MM-DD'
  data_max: string | null;
};

export type AnpPricesSerieRow = {
  data: string;                                            // ISO 'YYYY-MM-DD'
  fonte: 'producer' | 'distribution' | 'retail';
  local: string;
  preco: number | null;
  unidade: string;                                         // 'R$/litro' | 'R$/13kg'
};

export async function rpcGetAnpPricesFiltros(
  supabase: SupabaseClient,
): Promise<AnpPricesFiltros> {
  try {
    const { data, error } = await supabase.rpc("get_anp_prices_filtros", {});
    if (error) throw error;
    const d = (data ?? {}) as Partial<AnpPricesFiltros>;
    return {
      produtos:       d.produtos       ?? [],
      granularidades: d.granularidades ?? [],
      regioes:        d.regioes        ?? [],
      ufs:            d.ufs            ?? [],
      municipios:     d.municipios     ?? [],
      data_min:       d.data_min       ?? null,
      data_max:       d.data_max       ?? null,
    };
  } catch (e) {
    console.error("get_anp_prices_filtros failed", e);
    return {
      produtos: [], granularidades: [], regioes: [], ufs: [], municipios: [],
      data_min: null, data_max: null,
    };
  }
}

export async function rpcGetAnpPricesSerie(
  supabase: SupabaseClient,
  params: {
    produto: string;
    granularidade?: string;
    locais?: string[] | null;
    dataInicio?: string | null;
    dataFim?: string | null;
  },
): Promise<AnpPricesSerieRow[]> {
  if (!params.produto) return [];
  const PAGE = 1000;
  let offset = 0;
  const allRows: AnpPricesSerieRow[] = [];
  const rpcParams = {
    p_produto:       params.produto,
    p_granularidade: params.granularidade ?? "brasil",
    p_locais:        toListOrNull(params.locais),
    p_data_inicio:   params.dataInicio ?? null,
    p_data_fim:      params.dataFim    ?? null,
  };
  while (true) {
    const { data, error } = await supabase
      .rpc("get_anp_prices_serie", rpcParams)
      .range(offset, offset + PAGE - 1);
    if (error) { console.error("get_anp_prices_serie failed", error); break; }
    const rows = (data ?? []) as AnpPricesSerieRow[];
    if (!rows.length) break;
    allRows.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return allRows;
}

export type AnpPricesExportCountFilters = {
  produtos?: string[] | null;
  granularidades?: string[] | null;
  locais?: string[] | null;
  dataInicio?: string | null;
  dataFim?: string | null;
};

export async function getAnpPricesExportCount(
  supabase: SupabaseClient,
  filters: AnpPricesExportCountFilters,
): Promise<number> {
  const { data, error } = await supabase.rpc("get_anp_prices_export_count", {
    p_produtos:       toListOrNull(filters.produtos),
    p_granularidades: toListOrNull(filters.granularidades),
    p_locais:         toListOrNull(filters.locais),
    p_data_inicio:    filters.dataInicio ?? null,
    p_data_fim:       filters.dataFim    ?? null,
  });
  if (error) {
    console.error("get_anp_prices_export_count failed", error);
    throw error;
  }
  return Number(data ?? 0);
}

// ─── MODULE: ANP GLP (/src/app/(dashboard)/anp-glp/page.tsx) ─────────────────

export type AnpGlpSerieRow = {
  ano: number;
  mes: number;
  distribuidora: string;
  categoria: string;
  vendas_kg: number | null;
};

export type AnpGlpFiltros = {
  distribuidoras: string[];
  categorias: string[];
  ano_min: number | null;
  ano_max: number | null;
};

export async function rpcGetAnpGlpSerie(
  supabase: SupabaseClient,
  params?: {
    distribuidoras?: string[] | null;
    categorias?: string[] | null;
    anoInicio?: number | null;
    anoFim?: number | null;
  },
): Promise<AnpGlpSerieRow[]> {
  const PAGE = 1000;
  let offset = 0;
  const allRows: AnpGlpSerieRow[] = [];
  const rpcParams = {
    p_distribuidoras: params?.distribuidoras ?? null,
    p_categorias:     params?.categorias     ?? null,
    p_ano_inicio:     params?.anoInicio      ?? null,
    p_ano_fim:        params?.anoFim         ?? null,
  };
  while (true) {
    const { data, error } = await supabase
      .rpc("get_anp_glp_serie", rpcParams)
      .range(offset, offset + PAGE - 1);
    if (error) { console.error("get_anp_glp_serie failed", error); break; }
    const rows = (data ?? []) as AnpGlpSerieRow[];
    if (!rows.length) break;
    allRows.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return allRows;
}

export async function rpcGetAnpGlpFiltros(
  supabase: SupabaseClient,
): Promise<AnpGlpFiltros> {
  try {
    const { data, error } = await supabase.rpc("get_anp_glp_filtros", {});
    if (error) throw error;
    const d = (data ?? {}) as Partial<AnpGlpFiltros>;
    return {
      distribuidoras: d.distribuidoras ?? [],
      categorias:     d.categorias     ?? [],
      ano_min:        d.ano_min        ?? null,
      ano_max:        d.ano_max        ?? null,
    };
  } catch (e) {
    console.error("get_anp_glp_filtros failed", e);
    return { distribuidoras: [], categorias: [], ano_min: null, ano_max: null };
  }
}

// ─── MODULE: ANP CDP (/src/app/(dashboard)/anp-cdp/page.tsx) ─────────────────

export type AnpCdpSeriePonto = {
  ano: number;
  mes: number;
  petroleo_bbl_dia: number;
  oleo_bbl_dia: number;
  gas_total_mm3_dia: number;
  agua_bbl_dia: number;
  tempo_prod_hs_mes: number;
  /** Number of distinct wells reported for this month (COUNT DISTINCT poco). */
  wells_count: number;
  /** Total row count for this month (COUNT(*) — matches ANP portal pagination). */
  records_count?: number;
  /** Number of distinct fields reported for this month (COUNT DISTINCT campo). */
  fields_count: number;
};

export type AnpCdpPocoMeta = {
  poco: string;
  campo: string;
  bacia: string;
  local: string;
  estado: string | null;
  operador: string | null;
  nome_poco_operador: string | null;
  num_contrato: string | null;
  instalacao_destino: string | null;
  tipo_instalacao: string | null;
  petroleo_total: number;
};

export type AnpCdpFiltros = {
  bacoes: string[];
  campos: string[];
  locais: string[];
  estados: string[];
  operadores: string[];
  instalacoes: string[];
  tipos_instalacao: string[];
  ano_min: number | null;
  ano_max: number | null;
};

export async function rpcGetAnpCdpPocoSerie(
  supabase: SupabaseClient,
  params?: {
    pocos?: string[] | null;
    campos?: string[] | null;
    bacoes?: string[] | null;
    locais?: string[] | null;
    estados?: string[] | null;
    operadores?: string[] | null;
    instalacoes?: string[] | null;
    tiposInstalacao?: string[] | null;
    anoInicio?: number | null;
    anoFim?: number | null;
  },
): Promise<AnpCdpSeriePonto[]> {
  const { data, error } = await supabase.rpc("get_anp_cdp_poco_serie", {
    p_pocos:            params?.pocos            ?? null,
    p_campos:           params?.campos           ?? null,
    p_bacoes:           params?.bacoes           ?? null,
    p_locais:           params?.locais           ?? null,
    p_estados:          params?.estados          ?? null,
    p_operadores:       params?.operadores       ?? null,
    p_instalacoes:      params?.instalacoes      ?? null,
    p_tipos_instalacao: params?.tiposInstalacao  ?? null,
    p_ano_inicio:       params?.anoInicio        ?? null,
    p_ano_fim:          params?.anoFim           ?? null,
  });
  if (error) { console.error("get_anp_cdp_poco_serie failed", error); return []; }
  return (data ?? []) as AnpCdpSeriePonto[];
}

export type AnpCdpPocoSimples = {
  poco: string;
  campo: string;
  bacia: string;
  local: string;
  estado: string | null;
  operador: string | null;
};

export async function rpcGetAnpCdpPocosJson(
  supabase: SupabaseClient,
): Promise<AnpCdpPocoSimples[]> {
  try {
    const { data, error } = await supabase.rpc("get_anp_cdp_pocos_json", {});
    if (error) throw error;
    return (data ?? []) as AnpCdpPocoSimples[];
  } catch (e) {
    console.error("get_anp_cdp_pocos_json failed", e);
    return [];
  }
}

export async function rpcGetAnpCdpFiltros(
  supabase: SupabaseClient,
): Promise<AnpCdpFiltros> {
  try {
    const { data, error } = await supabase.rpc("get_anp_cdp_filtros", {});
    if (error) throw error;
    const d = (data ?? {}) as Partial<AnpCdpFiltros>;
    return {
      bacoes:           d.bacoes           ?? [],
      campos:           d.campos           ?? [],
      locais:           d.locais           ?? [],
      estados:          d.estados          ?? [],
      operadores:       d.operadores       ?? [],
      instalacoes:      d.instalacoes      ?? [],
      tipos_instalacao: d.tipos_instalacao ?? [],
      ano_min:          d.ano_min          ?? null,
      ano_max:          d.ano_max          ?? null,
    };
  } catch (e) {
    console.error("get_anp_cdp_filtros failed", e);
    return {
      bacoes: [], campos: [], locais: [], estados: [], operadores: [],
      instalacoes: [], tipos_instalacao: [], ano_min: null, ano_max: null,
    };
  }
}

// ─── MODULE: ANP CDP — BSW by Well (/src/app/(dashboard)/anp-cdp-bsw/page.tsx)
//
// Scatter of BSW (water cut = agua_bbl_dia / (petroleo_bbl_dia + agua_bbl_dia))
// vs months-since-first-production, point per (poco × month). The RPC
// computes both the BSW ratio and the "months since first month with
// petroleo_bbl_dia > 0" server-side over the ~1.8M-row anp_cdp_producao
// table (server-side limit ~500k points). Reuses `get_anp_cdp_filtros` for
// the field list (no separate filtros RPC needed).

export type AnpCdpBswPoint = {
  poco: string;
  campo: string;
  mes_desde_t0: number; // months since first month with petroleo>0 for this well
  bsw: number;          // 0..1 (water cut)
  ano: number;
  mes: number;
};

export async function rpcGetAnpCdpBswScatter(
  supabase: SupabaseClient,
  campos: string[],
): Promise<AnpCdpBswPoint[]> {
  if (!campos || campos.length === 0) return [];
  try {
    const { data, error } = await supabase
      .rpc("get_anp_cdp_bsw_scatter", { p_campos: campos })
      .limit(500000); // bypass PostgREST default max_rows=1000 (server caps at 500k)
    if (error) throw error;
    return (data ?? []) as AnpCdpBswPoint[];
  } catch (e) {
    console.error("get_anp_cdp_bsw_scatter failed", e);
    return [];
  }
}

// Field-aggregate variant: one point per (campo × calendar month) — volume-weighted
// BSW averaged across all wells in the field, plotted against cumulative oil
// recovered as a fraction of the field's VOIP (Volume Original In Place,
// published yearly by ANP and stored in `anp_voip`). Used by the "Field
// average" view in /anp-cdp-bsw.
export type AnpCdpBswFieldPoint = {
  campo: string;
  pct_voip: number;            // cumulative_oil_bbl / voip_bbl, fraction 0..1
  bsw: number;                 // 0..1 (volume-weighted water cut across wells)
  n_pocos: number;             // number of wells contributing at this reference month
  volume_total: number;        // total liquid (oil + water) volume used as the weight
  cumulative_oil_bbl: number;  // cumulative oil recovered up to ref_ano/ref_mes (bbl)
  ref_ano: number;             // reference year (argmax of ano*12+mes among contributors)
  ref_mes: number;             // reference month (argmax of ano*12+mes among contributors)
};

export async function rpcGetAnpCdpBswFieldAggregate(
  supabase: SupabaseClient,
  campos: string[],
): Promise<AnpCdpBswFieldPoint[]> {
  if (!campos || campos.length === 0) return [];
  try {
    // RPC now returns RETURNS jsonb (single row, single column) to bypass
    // PostgREST default max_rows=1000 that was truncating large field selections.
    // The previous `.limit(200000)` workaround did not help because PostgREST
    // caps row count regardless of explicit limit on TABLE-returning RPCs.
    // With jsonb return, the entire array arrives as one row and supabase-js
    // automatically deserializes it into the expected array shape.
    const { data, error } = await supabase.rpc("get_anp_cdp_bsw_field_aggregate", {
      p_campos: campos,
    });
    if (error) throw error;
    return ((data as unknown) ?? []) as AnpCdpBswFieldPoint[];
  } catch (e) {
    console.error("get_anp_cdp_bsw_field_aggregate failed", e);
    return [];
  }
}

// Offshore-only field list for the /anp-cdp-bsw sidebar dropdown. Returns
// alphabetically ordered field names where `local IN ('PreSal','PosSal')`,
// i.e. excludes onshore/terra fields that aren't relevant for BSW analysis
// in this dashboard. Owner: worker_supabase (migration
// `20260508000004_anp_cdp_bsw_offshore.sql`).
export async function rpcGetAnpCdpBswCampos(
  supabase: SupabaseClient,
): Promise<string[]> {
  try {
    const { data, error } = await supabase.rpc("get_anp_cdp_bsw_campos");
    if (error) throw error;
    return (data ?? []) as string[];
  } catch (e) {
    console.error("get_anp_cdp_bsw_campos failed", e);
    return [];
  }
}

// ─── MODULE: ANP CDP — Depletion (/src/app/(dashboard)/anp-cdp-depletion/page.tsx)
//
// Uptime-normalized daily oil production (NP) per (poco × month) or per
// (campo × month), expressed in **kbpd** (thousand barrels per day). NP is
// the average daily flow the well would have delivered if it had run at
// 100% uptime during the calendar month, normalized by actual production
// days. Formulas (server-side):
//
//   Per well:   np_kbpd = (np_bbl_mes / (hs_op / 24)) / 1000
//   Per field:  np_kbpd = sum(np_poco_bbl_mes) × 24
//                       / (sum(hs_op_poco) × 1000)
//
// Field-aggregate variant adds % VOIP recovered (cumulative oil ÷ VOIP) and
// returns the data as RETURNS jsonb (single row, single column) to bypass
// PostgREST's default max_rows=1000 — same pattern as get_anp_cdp_bsw_field_aggregate.

export type AnpCdpDepletionPoint = {
  poco: string;
  campo: string;
  ano: number;
  mes: number;
  mes_desde_t0: number;
  np_kbpd: number;                // uptime-normalized daily oil production, kbpd
  pct_voip_poco: number | null;   // field-level VOIP fraction inherited per (campo, ano, mes); null only when the field has no VOIP record
};

export type AnpCdpDepletionFieldPoint = {
  campo: string;
  ano: number;
  mes: number;
  np_kbpd: number;                // field-aggregate uptime-normalized daily oil production, kbpd
  n_pocos: number;                // wells contributing to this calendar month
  pct_voip: number;               // cumulative_oil_bbl / voip_bbl, fraction 0..1
  cumulative_oil_bbl: number;     // cumulative oil up to (ano,mes), bbl
};

// Field list for the /anp-cdp-depletion sidebar dropdown. Returns
// alphabetically ordered field names available for the depletion analysis.
export async function rpcGetAnpCdpDepletionCampos(
  supabase: SupabaseClient,
): Promise<string[]> {
  try {
    const { data, error } = await supabase.rpc("get_anp_cdp_depletion_campos");
    if (error) throw error;
    return (data ?? []) as string[];
  } catch (e) {
    console.error("get_anp_cdp_depletion_campos failed", e);
    return [];
  }
}

// Per-well scatter — RETURNS TABLE with up to ~500k rows (server-side cap).
export async function rpcGetAnpCdpDepletionScatter(
  supabase: SupabaseClient,
  campos: string[],
): Promise<AnpCdpDepletionPoint[]> {
  if (!campos || campos.length === 0) return [];
  try {
    const { data, error } = await supabase
      .rpc("get_anp_cdp_depletion_scatter", { p_campos: campos })
      .limit(500000); // bypass PostgREST default max_rows=1000 (server caps at 500k)
    if (error) throw error;
    return (data ?? []) as AnpCdpDepletionPoint[];
  } catch (e) {
    console.error("get_anp_cdp_depletion_scatter failed", e);
    return [];
  }
}

// Field-aggregate — RETURNS jsonb (single row). Do NOT call .limit() here:
// it's a single-row jsonb response and limit() would cap it incorrectly.
export async function rpcGetAnpCdpDepletionFieldAggregate(
  supabase: SupabaseClient,
  campos: string[],
): Promise<AnpCdpDepletionFieldPoint[]> {
  if (!campos || campos.length === 0) return [];
  try {
    const { data, error } = await supabase.rpc("get_anp_cdp_depletion_field_aggregate", {
      p_campos: campos,
    });
    if (error) throw error;
    return ((data as unknown) ?? []) as AnpCdpDepletionFieldPoint[];
  } catch (e) {
    console.error("get_anp_cdp_depletion_field_aggregate failed", e);
    return [];
  }
}

// ─── MODULE: ANP CDP Diária (/src/app/(dashboard)/anp-cdp-diaria/page.tsx) ────
//
// Daily petroleum/gas production by `(data, campo, bacia)`. Sourced from the
// ANP Power BI feed via `scripts/extractors/anp_cdp_powerbi.py`, refreshed
// 3×/day by `etl_anp_cdp_diaria.yml`. Distinct from `/anp-cdp` (which is
// monthly per poço/campo from the CDP form).

export type AnpCdpDiariaFiltros = {
  campos: string[];
  bacias: string[];
  data_min: string | null;
  data_max: string | null;
};

export async function rpcGetAnpCdpDiariaFiltros(
  supabase: SupabaseClient,
): Promise<AnpCdpDiariaFiltros> {
  try {
    const { data, error } = await supabase.rpc("get_anp_cdp_diaria_filtros");
    if (error) throw error;
    const d = (data ?? {}) as Partial<AnpCdpDiariaFiltros>;
    return {
      campos:   d.campos   ?? [],
      bacias:   d.bacias   ?? [],
      data_min: d.data_min ?? null,
      data_max: d.data_max ?? null,
    };
  } catch (e) {
    console.error("get_anp_cdp_diaria_filtros failed", e);
    return { campos: [], bacias: [], data_min: null, data_max: null };
  }
}

export type AnpCdpDiariaPonto = {
  data: string;
  campo: string;
  bacia: string;
  petroleo_bbl_dia: number | null;
  gas_mm3_dia: number | null;
};

export async function rpcGetAnpCdpDiariaSerie(
  supabase: SupabaseClient,
  params?: {
    campos?: string[] | null;
    bacias?: string[] | null;
    dataInicio?: string | null;
    dataFim?: string | null;
  },
): Promise<AnpCdpDiariaPonto[]> {
  // Daily granularity × ~94 campos × ~8 bacias × ~365 days ≈ tens of thousands
  // of rows for full-history requests. Page through PostgREST 1000-row windows
  // to avoid silent truncation when no filters are set.
  const PAGE = 1000;
  let offset = 0;
  const allRows: AnpCdpDiariaPonto[] = [];
  const rpcParams = {
    p_campos:      params?.campos     ?? null,
    p_bacias:      params?.bacias     ?? null,
    p_data_inicio: params?.dataInicio ?? null,
    p_data_fim:    params?.dataFim    ?? null,
  };
  while (true) {
    const { data, error } = await supabase
      .rpc("get_anp_cdp_diaria_serie", rpcParams)
      .range(offset, offset + PAGE - 1);
    if (error) { console.error("get_anp_cdp_diaria_serie failed", error); break; }
    const rows = (data ?? []) as AnpCdpDiariaPonto[];
    if (!rows.length) break;
    allRows.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return allRows;
}

// ─── MODULE: ANP CDP Diária — Installation level (`anp_cdp_diaria_instalacao`) ─
//
// Page 5 of the ANP Power BI feed. Same daily cadence as the Field-level
// dataset, broken down one level deeper: produção by `(data, campo, instalacao)`.
// Migration: `20260508120001_anp_cdp_diaria_levels.sql`.

export type AnpCdpDiariaInstalacaoFiltros = {
  campos: string[];
  instalacoes: string[];
  data_min: string | null;
  data_max: string | null;
};

export async function rpcGetAnpCdpDiariaInstalacaoFiltros(
  supabase: SupabaseClient,
): Promise<AnpCdpDiariaInstalacaoFiltros> {
  try {
    const { data, error } = await supabase.rpc("get_anp_cdp_diaria_instalacao_filtros");
    if (error) throw error;
    const d = (data ?? {}) as Partial<AnpCdpDiariaInstalacaoFiltros>;
    return {
      campos:      d.campos      ?? [],
      instalacoes: d.instalacoes ?? [],
      data_min:    d.data_min    ?? null,
      data_max:    d.data_max    ?? null,
    };
  } catch (e) {
    console.error("get_anp_cdp_diaria_instalacao_filtros failed", e);
    return { campos: [], instalacoes: [], data_min: null, data_max: null };
  }
}

export type AnpCdpDiariaInstalacaoPonto = {
  data: string;
  campo: string;
  instalacao: string;
  petroleo_bbl_dia: number | null;
  gas_mm3_dia: number | null;
};

export async function rpcGetAnpCdpDiariaInstalacaoSerie(
  supabase: SupabaseClient,
  params?: {
    campos?: string[] | null;
    instalacoes?: string[] | null;
    dataInicio?: string | null;
    dataFim?: string | null;
  },
): Promise<AnpCdpDiariaInstalacaoPonto[]> {
  // Daily × ~94 campos × ~N instalacoes per campo × ~365 days — paginate.
  const PAGE = 1000;
  let offset = 0;
  const allRows: AnpCdpDiariaInstalacaoPonto[] = [];
  const rpcParams = {
    p_campos:      params?.campos      ?? null,
    p_instalacoes: params?.instalacoes ?? null,
    p_data_inicio: params?.dataInicio  ?? null,
    p_data_fim:    params?.dataFim     ?? null,
  };
  while (true) {
    const { data, error } = await supabase
      .rpc("get_anp_cdp_diaria_instalacao_serie", rpcParams)
      .range(offset, offset + PAGE - 1);
    if (error) { console.error("get_anp_cdp_diaria_instalacao_serie failed", error); break; }
    const rows = (data ?? []) as AnpCdpDiariaInstalacaoPonto[];
    if (!rows.length) break;
    allRows.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return allRows;
}

// ─── MODULE: ANP CDP Diária — Well level (`anp_cdp_diaria_poco`) ─────────────
//
// Page 6 of the ANP Power BI feed. Deepest granularity: `(data, campo, bacia, poco)`.
// Migration: `20260508120001_anp_cdp_diaria_levels.sql`.

export type AnpCdpDiariaPocoFiltros = {
  campos: string[];
  bacias: string[];
  pocos: string[];
  data_min: string | null;
  data_max: string | null;
};

export async function rpcGetAnpCdpDiariaPocoFiltros(
  supabase: SupabaseClient,
): Promise<AnpCdpDiariaPocoFiltros> {
  try {
    const { data, error } = await supabase.rpc("get_anp_cdp_diaria_poco_filtros");
    if (error) throw error;
    const d = (data ?? {}) as Partial<AnpCdpDiariaPocoFiltros>;
    return {
      campos:   d.campos   ?? [],
      bacias:   d.bacias   ?? [],
      pocos:    d.pocos    ?? [],
      data_min: d.data_min ?? null,
      data_max: d.data_max ?? null,
    };
  } catch (e) {
    console.error("get_anp_cdp_diaria_poco_filtros failed", e);
    return { campos: [], bacias: [], pocos: [], data_min: null, data_max: null };
  }
}

export type AnpCdpDiariaPocoPonto = {
  data: string;
  campo: string;
  bacia: string;
  poco: string;
  petroleo_bbl_dia: number | null;
  gas_mm3_dia: number | null;
};

export async function rpcGetAnpCdpDiariaPocoSerie(
  supabase: SupabaseClient,
  params?: {
    campos?: string[] | null;
    bacias?: string[] | null;
    pocos?: string[] | null;
    dataInicio?: string | null;
    dataFim?: string | null;
  },
): Promise<AnpCdpDiariaPocoPonto[]> {
  // Deepest level — many more rows per (campo, day). Paginate aggressively.
  const PAGE = 1000;
  let offset = 0;
  const allRows: AnpCdpDiariaPocoPonto[] = [];
  const rpcParams = {
    p_campos:      params?.campos     ?? null,
    p_bacias:      params?.bacias     ?? null,
    p_pocos:       params?.pocos      ?? null,
    p_data_inicio: params?.dataInicio ?? null,
    p_data_fim:    params?.dataFim    ?? null,
  };
  while (true) {
    const { data, error } = await supabase
      .rpc("get_anp_cdp_diaria_poco_serie", rpcParams)
      .range(offset, offset + PAGE - 1);
    if (error) { console.error("get_anp_cdp_diaria_poco_serie failed", error); break; }
    const rows = (data ?? []) as AnpCdpDiariaPocoPonto[];
    if (!rows.length) break;
    allRows.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return allRows;
}

// ─── MODULE: Export size calculator RPCs (Fase B) ────────────────────────────
//
// Each function below mirrors the filter signature of its "sister" serie RPC
// but returns only count(*)::bigint. Used by the ExportModal calculator to
// estimate XLSX/CSV file size before the user clicks download.
//
// Migration: supabase/migrations/20260507000003_export_count_rpcs.sql

export type MsExportCountFilters = {
  dataInicio?: string | null;
  dataFim?: string | null;
  regioes?: string[] | null;
  ufs?: string[] | null;
  mercados?: string[] | null;
};

/** Count for /market-share + /sales-volumes (vendas table). */
export async function getMsExportCount(
  supabase: SupabaseClient,
  filters: MsExportCountFilters,
): Promise<number> {
  const { data, error } = await supabase.rpc("get_ms_export_count", {
    p_data_inicio: filters.dataInicio ?? null,
    p_data_fim:    filters.dataFim    ?? null,
    p_regioes:     toListOrNull(filters.regioes),
    p_ufs:         toListOrNull(filters.ufs),
    p_mercados:    toListOrNull(filters.mercados),
  });
  if (error) {
    console.error("get_ms_export_count failed", error);
    throw error;
  }
  return Number(data ?? 0);
}

export type AnpCdpExportCountFilters = {
  pocos?: string[] | null;
  campos?: string[] | null;
  bacoes?: string[] | null;
  locais?: string[] | null;
  estados?: string[] | null;
  operadores?: string[] | null;
  instalacoes?: string[] | null;
  tiposInstalacao?: string[] | null;
  anoInicio?: number | null;
  anoFim?: number | null;
};

export async function getAnpCdpExportCount(
  supabase: SupabaseClient,
  filters: AnpCdpExportCountFilters,
): Promise<number> {
  const { data, error } = await supabase.rpc("get_anp_cdp_export_count", {
    p_pocos:            toListOrNull(filters.pocos),
    p_campos:           toListOrNull(filters.campos),
    p_bacoes:           toListOrNull(filters.bacoes),
    p_locais:           toListOrNull(filters.locais),
    p_estados:          toListOrNull(filters.estados),
    p_operadores:       toListOrNull(filters.operadores),
    p_instalacoes:      toListOrNull(filters.instalacoes),
    p_tipos_instalacao: toListOrNull(filters.tiposInstalacao),
    p_ano_inicio:       filters.anoInicio ?? null,
    p_ano_fim:          filters.anoFim    ?? null,
  });
  if (error) {
    console.error("get_anp_cdp_export_count failed", error);
    throw error;
  }
  return Number(data ?? 0);
}

/**
 * Raw row type for `anp_cdp_producao` — mirrors the table columns exactly
 * (do not invent fields). Used by the /anp-cdp export when the user picks
 * granularity = "raw" (default).
 *
 * Schema source-of-truth:
 *   - 20260504000007 (v3) — added poco, campo
 *   - 20260504000008 (v4) — added instalacao_destino, agua_bbl_dia
 *   - 20260504000009 (v5) — added estado, nome_poco_operador, operador,
 *                           num_contrato, oleo_bbl_dia, tipo_instalacao,
 *                           tempo_prod_hs_mes
 */
export type AnpCdpRawRow = {
  ano: number;
  mes: number;
  poco: string;
  campo: string;
  bacia: string;
  local: string;
  estado: string | null;
  operador: string | null;
  nome_poco_operador: string | null;
  num_contrato: string | null;
  instalacao_destino: string | null;
  tipo_instalacao: string | null;
  petroleo_bbl_dia: number | null;
  oleo_bbl_dia: number | null;
  gas_total_mm3_dia: number | null;
  agua_bbl_dia: number | null;
  tempo_prod_hs_mes: number | null;
};

/**
 * Paginated SELECT * FROM anp_cdp_producao with the same filter predicate as
 * `get_anp_cdp_export_count`. Used by the /anp-cdp export when the user picks
 * granularity = "raw" (default) so the rows downloaded match exactly the row
 * count shown in the export modal.
 *
 * RLS allows `authenticated` SELECT (see migration 20260504000013), so the
 * anon-key client running in the browser hits the same predicate path.
 */
export async function fetchAnpCdpRawFiltered(
  supabase: SupabaseClient,
  filters: AnpCdpExportCountFilters,
): Promise<AnpCdpRawRow[]> {
  const PAGE = 1000;
  let offset = 0;
  const allRows: AnpCdpRawRow[] = [];

  const pocos            = toListOrNull(filters.pocos);
  const campos           = toListOrNull(filters.campos);
  const bacoes           = toListOrNull(filters.bacoes);
  const locais           = toListOrNull(filters.locais);
  const estados          = toListOrNull(filters.estados);
  const operadores       = toListOrNull(filters.operadores);
  const instalacoes      = toListOrNull(filters.instalacoes);
  const tiposInstalacao  = toListOrNull(filters.tiposInstalacao);

  while (true) {
    let q = supabase
      .from("anp_cdp_producao")
      .select(
        "ano,mes,poco,campo,bacia,local,estado,operador,nome_poco_operador,num_contrato,instalacao_destino,tipo_instalacao,petroleo_bbl_dia,oleo_bbl_dia,gas_total_mm3_dia,agua_bbl_dia,tempo_prod_hs_mes",
      );

    if (pocos)            q = q.in("poco", pocos);
    if (campos)           q = q.in("campo", campos);
    if (bacoes)           q = q.in("bacia", bacoes);
    if (locais)           q = q.in("local", locais);
    if (estados)          q = q.in("estado", estados);
    if (operadores)       q = q.in("operador", operadores);
    if (instalacoes)      q = q.in("instalacao_destino", instalacoes);
    if (tiposInstalacao)  q = q.in("tipo_instalacao", tiposInstalacao);
    if (filters.anoInicio != null) q = q.gte("ano", filters.anoInicio);
    if (filters.anoFim    != null) q = q.lte("ano", filters.anoFim);

    const { data, error } = await q
      .order("ano",  { ascending: true })
      .order("mes",  { ascending: true })
      .order("poco", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;

    const rows = (data ?? []) as AnpCdpRawRow[];
    if (!rows.length) break;
    allRows.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  return allRows;
}

// ─── Tier 2 aggregated exports — /anp-cdp ───────────────────────────────────
//
// `get_anp_cdp_aggregated` is a dynamic SQL aggregator created by
// worker_supabase. The caller passes the same filter shape used for the
// export count + a `p_group_by text[]` whose values must be a strict subset
// of the union of dimension columns of the underlying table.
//
// The RPC returns one row per distinct combination of the requested
// dimensions, with NULLs in all other dimension columns and SUM/AVG of the
// metric columns. Filename + Excel column-set on the client must mirror the
// requested groupBy 1:1 — use the dedicated `downloadAnp*AggregatedExcel`
// helpers in exportExcel.ts which honour this contract.

// ── ANP CDP aggregated ───────────────────────────────────────────────────────

/** Same 10 filter params as `get_anp_cdp_export_count` / raw export. */
export type AnpCdpAggregatedFilters = AnpCdpExportCountFilters;

export type AnpCdpGroupBy =
  | "ano"
  | "mes"
  | "campo"
  | "bacia"
  | "operador"
  | "estado"
  | "local"
  | "instalacao_destino"
  | "tipo_instalacao";

export type AnpCdpAggregatedRow = {
  ano: number | null;
  mes: number | null;
  campo: string | null;
  bacia: string | null;
  operador: string | null;
  estado: string | null;
  local: string | null;
  instalacao_destino: string | null;
  tipo_instalacao: string | null;
  petroleo_bbl_dia: number;
  oleo_bbl_dia: number;
  gas_total_mm3_dia: number;
  agua_bbl_dia: number;
  tempo_prod_hs_mes: number;
};

export async function rpcGetAnpCdpAggregated(
  supabase: SupabaseClient,
  filters: AnpCdpAggregatedFilters,
  groupBy: AnpCdpGroupBy[],
): Promise<AnpCdpAggregatedRow[]> {
  // PostgREST applies a default `max-rows` ceiling (commonly 1000) to RPC
  // responses that return a SET / TABLE. Without pagination, "Por campo" with
  // 21 anos × 12 meses × ~50 campos (~12.6k combinações) gets silently
  // truncated. We page the same way fetchAnpCdpRawFiltered does, leveraging
  // supabase-js's `.range()` post-filter on `RETURNS TABLE` RPCs.
  const PAGE = 1000;
  let offset = 0;
  const allRows: AnpCdpAggregatedRow[] = [];

  const args = {
    p_pocos:            toListOrNull(filters.pocos),
    p_campos:           toListOrNull(filters.campos),
    p_bacoes:           toListOrNull(filters.bacoes),
    p_locais:           toListOrNull(filters.locais),
    p_estados:          toListOrNull(filters.estados),
    p_operadores:       toListOrNull(filters.operadores),
    p_instalacoes:      toListOrNull(filters.instalacoes),
    p_tipos_instalacao: toListOrNull(filters.tiposInstalacao),
    p_ano_inicio:       filters.anoInicio ?? null,
    p_ano_fim:          filters.anoFim    ?? null,
    p_group_by:         groupBy as unknown as string[],
  };

  while (true) {
    const { data, error } = await supabase
      .rpc("get_anp_cdp_aggregated", args)
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.error("get_anp_cdp_aggregated failed", error);
      throw error;
    }
    const rows = (data ?? []) as AnpCdpAggregatedRow[];
    if (!rows.length) break;
    allRows.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  return allRows;
}

// ─── MODULE: Admin Analytics (/admin-analytics) ──────────────────────────────
//
// Read-only Admin dashboard fed by the `app_events` table. All RPCs
// here are SECURITY DEFINER and check role='Admin' server-side; a Client
// hitting them gets `permission denied`. We surface that as empty data so
// the page is graceful when role is mid-load.
//
// `period_days` is always passed as integer; default 30 matches the SQL
// signature default. The RPC `track_event` (write side) lives in
// `src/lib/tracking.ts` because it is fire-and-forget.

export type AnalyticsKpis = {
  dau: number;
  wau: number;
  mau: number;
  total_users: number;
  active_users_period: number;
  // Phase A anonymous-access additions (migration 20260522000001):
  //   • unique_visitors_period      — distinct visitor_id rows with no user_id
  //   • unique_authenticated_period — distinct user_id rows with role <> 'Admin'
  // Both default to 0 if the migration has not been deployed yet, so the
  // analytics page can render gracefully against stage envs without the new
  // RPC fields.
  unique_visitors_period: number;
  unique_authenticated_period: number;
  exports_period: number;
  page_views_period: number;
  logins_period: number;
};

// Returned by get_analytics_anon_summary(period_days).
// Drives the "Anonymous Activity" section in /admin-analytics.
export type AnalyticsAnonSummaryRoute = {
  route: string;
  page_views: number;
};

export type AnalyticsAnonSummary = {
  unique_visitors: number;
  total_page_views: number;
  top_routes: AnalyticsAnonSummaryRoute[];
};

export type AnalyticsByDashboardRow = {
  route: string;
  page_views: number;
  unique_users: number;
  exports: number;
  bytes_total: number;
};

export type AnalyticsTopRoute = {
  route: string;
  views: number;
};

export type AnalyticsByUserRow = {
  user_id: string;
  full_name: string | null;
  role: string;
  last_login: string | null;
  page_views: number;
  exports: number;
  top_routes: AnalyticsTopRoute[];
};

export type AnalyticsTimelineEvent = {
  event_type: "login" | "page_view" | "export";
  route: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type AnalyticsHeatmapCell = {
  dow: number;   // 0=Sunday … 6=Saturday (matches Postgres extract(dow))
  hour: number;  // 0..23
  event_count: number;
};

export async function rpcGetAnalyticsKpis(
  supabase: SupabaseClient,
  periodDays = 30,
): Promise<AnalyticsKpis | null> {
  try {
    const { data, error } = await supabase.rpc("get_analytics_kpis", {
      period_days: periodDays,
    });
    if (error) throw error;
    if (!data) return null;
    const d = data as Partial<AnalyticsKpis>;
    return {
      dau: Number(d.dau ?? 0),
      wau: Number(d.wau ?? 0),
      mau: Number(d.mau ?? 0),
      total_users: Number(d.total_users ?? 0),
      active_users_period: Number(d.active_users_period ?? 0),
      unique_visitors_period: Number(d.unique_visitors_period ?? 0),
      unique_authenticated_period: Number(d.unique_authenticated_period ?? 0),
      exports_period: Number(d.exports_period ?? 0),
      page_views_period: Number(d.page_views_period ?? 0),
      logins_period: Number(d.logins_period ?? 0),
    };
  } catch (e) {
    console.warn("get_analytics_kpis failed", e);
    return null;
  }
}

// get_analytics_anon_summary(p_period_days) — anonymous-only telemetry.
// Used by the "Anonymous Activity" section in /admin-analytics. Admin-only
// (RAISE EXCEPTION on non-Admin callers); returns a single row whose
// `top_routes` field is the top 20 routes by anonymous page_view count.
export async function rpcGetAnalyticsAnonSummary(
  supabase: SupabaseClient,
  periodDays = 30,
): Promise<AnalyticsAnonSummary | null> {
  try {
    const { data, error } = await supabase.rpc("get_analytics_anon_summary", {
      p_period_days: periodDays,
    });
    if (error) throw error;
    // RPC returns a single-row result set: supabase-js delivers it as either an
    // array (one row) or a bare object depending on PostgREST shape. Normalize.
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      return { unique_visitors: 0, total_page_views: 0, top_routes: [] };
    }
    const r = row as Partial<AnalyticsAnonSummary>;
    return {
      unique_visitors: Number(r.unique_visitors ?? 0),
      total_page_views: Number(r.total_page_views ?? 0),
      top_routes: Array.isArray(r.top_routes)
        ? r.top_routes.map((t) => ({
            route: String(t.route ?? ""),
            page_views: Number(t.page_views ?? 0),
          }))
        : [],
    };
  } catch (e) {
    console.warn("get_analytics_anon_summary failed", e);
    return null;
  }
}

export async function rpcGetAnalyticsByDashboard(
  supabase: SupabaseClient,
  periodDays = 30,
): Promise<AnalyticsByDashboardRow[]> {
  try {
    const { data, error } = await supabase.rpc("get_analytics_by_dashboard", {
      period_days: periodDays,
    });
    if (error) throw error;
    return ((data ?? []) as AnalyticsByDashboardRow[]).map((r) => ({
      route: r.route,
      page_views: Number(r.page_views ?? 0),
      unique_users: Number(r.unique_users ?? 0),
      exports: Number(r.exports ?? 0),
      bytes_total: Number(r.bytes_total ?? 0),
    }));
  } catch (e) {
    console.warn("get_analytics_by_dashboard failed", e);
    return [];
  }
}

export async function rpcGetAnalyticsByUser(
  supabase: SupabaseClient,
  periodDays = 30,
  search: string | null = null,
): Promise<AnalyticsByUserRow[]> {
  try {
    const { data, error } = await supabase.rpc("get_analytics_by_user", {
      period_days: periodDays,
      p_search: search && search.trim() ? search.trim() : "",
    });
    if (error) throw error;
    return ((data ?? []) as AnalyticsByUserRow[]).map((r) => ({
      user_id: r.user_id,
      full_name: r.full_name ?? null,
      role: r.role ?? "Client",
      last_login: r.last_login ?? null,
      page_views: Number(r.page_views ?? 0),
      exports: Number(r.exports ?? 0),
      top_routes: Array.isArray(r.top_routes) ? r.top_routes : [],
    }));
  } catch (e) {
    console.warn("get_analytics_by_user failed", e);
    return [];
  }
}

export async function rpcGetAnalyticsUserTimeline(
  supabase: SupabaseClient,
  targetUserId: string,
  periodDays = 30,
): Promise<AnalyticsTimelineEvent[]> {
  try {
    const { data, error } = await supabase.rpc("get_analytics_user_timeline", {
      target_user_id: targetUserId,
      period_days: periodDays,
    });
    if (error) throw error;
    return ((data ?? []) as AnalyticsTimelineEvent[]).map((r) => ({
      event_type: r.event_type,
      route: r.route ?? null,
      payload: (r.payload ?? {}) as Record<string, unknown>,
      created_at: r.created_at,
    }));
  } catch (e) {
    console.warn("get_analytics_user_timeline failed", e);
    return [];
  }
}

export async function rpcGetAnalyticsHeatmap(
  supabase: SupabaseClient,
  periodDays = 30,
): Promise<AnalyticsHeatmapCell[]> {
  try {
    const { data, error } = await supabase.rpc("get_analytics_heatmap", {
      period_days: periodDays,
    });
    if (error) throw error;
    return ((data ?? []) as AnalyticsHeatmapCell[]).map((r) => ({
      dow: Number(r.dow ?? 0),
      hour: Number(r.hour ?? 0),
      event_count: Number(r.event_count ?? 0),
    }));
  } catch (e) {
    console.warn("get_analytics_heatmap failed", e);
    return [];
  }
}

// ============================================================
// MODULE: Subsidy Tracker (/src/app/(dashboard)/subsidy-tracker/page.tsx)
// ============================================================
//
// Tracks the federal diesel subsidy impact: ANP Reference price (regional
// average) vs. ANP Commercialization price (Reference - active subsidy),
// alongside BBA Import Parity (IPP) and Petrobras reference price.
//
// The RPC FULL OUTER JOINs `price_bands` (Diesel) with the daily regional
// average of `anp_subsidy_diesel_reference`, then applies the subsidy
// vigente from `anp_subsidy_history` to derive `anp_commercialization`.
// `regions` is a JSONB object with the 5 regional reference prices for the
// hover tooltip; it may be null when no ETL extraction exists for the day.

export type SubsidyTrackerRow = {
  date: string;                            // YYYY-MM-DD
  ipp: number | null;                      // BBA import parity, Diesel
  anp_reference: number | null;            // daily avg across 5 regions
  anp_commercialization: number | null;    // anp_reference - active_subsidy
  petrobras: number | null;                // Petrobras price, Diesel
  regions: Record<string, number> | null;  // { NORTE, NORDESTE, ... }
};

export async function rpcGetSubsidyTrackerDiesel(
  supabase: SupabaseClient,
): Promise<SubsidyTrackerRow[]> {
  const PAGE = 1000;
  let offset = 0;
  const allRows: SubsidyTrackerRow[] = [];

  while (true) {
    const { data, error } = await supabase
      .rpc("get_subsidy_tracker_diesel")
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.error("rpcGetSubsidyTrackerDiesel:", error);
      break;
    }
    const rows = (data ?? []) as SubsidyTrackerRow[];
    if (!rows.length) break;
    allRows.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  return allRows;
}

// ─── MODULE: News Hunter (/src/app/(dashboard)/news-hunter/page.tsx) ─────────

/**
 * Fetches the curated default keyword set used to populate `/news-hunter` for
 * anonymous visitors and as the first-login seed for authenticated users.
 *
 * Backed by RPC `get_default_news_keywords()` (SECURITY DEFINER, granted to
 * `anon` and `authenticated`) which reads from `news_hunter_default_keywords` —
 * the single source of truth for the default set. See migration
 * 20260522000001_anonymous_access.sql sections 9 + 10.
 *
 * Returns `[]` on any error so callers can fall through to their own fallback
 * (e.g. the hardcoded `FALLBACK_KEYWORDS` list in `NewsHunterContext`).
 */
export async function rpcGetDefaultNewsKeywords(
  supabase: SupabaseClient,
): Promise<string[]> {
  try {
    const { data, error } = await supabase.rpc("get_default_news_keywords");
    if (error) throw error;
    return (data ?? []) as string[];
  } catch (e) {
    console.error("get_default_news_keywords failed", e);
    return [];
  }
}

// ============================================================
// MODULE: Imports & Exports (/imports-exports)
// ============================================================
//
// Consolidates /anp-daie + /anp-desembaracos + /anp-painel-importacoes
// into a single unified dashboard covering Diesel, Gasoline, Crude Oil.
//
// 5 RPCs — all SECURITY INVOKER, STABLE, granted to anon + authenticated.
// Source: migration 20260525000010_imports_exports_enrichment.sql.
//
// Unit contract (never drift label from divisor):
//   Panel A (countries): RPC returns total_kg → UI divides by 1e6 → "kt"
//   Panel B (importers): RPC returns total_mil_m3 (server-side conversion) → "mil m³"
//   Exports stacked: server returns value already in mil m³ (metric=volume) or raw USD (metric=usd) → UI never divides

export type IEFiltrosResult = {
  ano_min: number;
  ano_max: number;
  produtos: string[];
};

export type IEPaisesStackedRow = {
  ano: number;
  mes: number;
  pais_origem: string;
  total_kg: number;
};

export type IEImportersStackedRow = {
  ano: number;
  mes: number;
  unified_importer: string;
  total_mil_m3: number;
};

export type IEYoyTableRow = {
  entity: string;
  last_12m: number;
  prev_12m: number;
  yoy_pct: number | null;
};

export type IEExportsPaisesStackedRow = {
  ano: number;
  mes: number;
  pais: string;
  value: number;
};

export type IEExportsYoyRow = {
  entity: string;
  last_12m: number;
  prev_12m: number;
  yoy_pct: number | null;
};

export type IEFobPriceRow = {
  ano: number;
  mes: number;
  total_volume_kg: number;
  total_volume_m3: number;
  total_fob_usd: number;
  fob_per_ton: number | null;
  fob_per_m3: number | null;
  fob_per_bbl: number | null;
};

/**
 * Returns the available year range and the 3 unified product names.
 * Result is stable — call once on mount.
 */
export async function rpcGetImportsExportsFiltros(
  supabase: SupabaseClient,
): Promise<IEFiltrosResult | null> {
  try {
    const { data, error } = await supabase.rpc("get_imports_exports_filtros");
    if (error) throw error;
    const rows = (data ?? []) as IEFiltrosResult[];
    return rows[0] ?? null;
  } catch (e) {
    console.error("get_imports_exports_filtros failed", e);
    return null;
  }
}

/**
 * Stacked bar data for Panel A — imports by origin country.
 * Server returns top-N countries by total kg; non-top rows are bucketed as
 * 'Others'. UI divides total_kg by 1e6 to get kilotons.
 */
export async function rpcGetImportsExportsPaisesStacked(
  supabase: SupabaseClient,
  unifiedProduct: string,
  anoInicio: number,
  anoFim: number,
  topN = 10,
): Promise<IEPaisesStackedRow[]> {
  try {
    const { data, error } = await supabase.rpc(
      "get_imports_exports_paises_stacked",
      {
        p_unified_product: unifiedProduct,
        p_ano_inicio: anoInicio,
        p_ano_fim: anoFim,
        p_top_n: topN,
      },
    );
    if (error) throw error;
    return ((data ?? []) as IEPaisesStackedRow[]).map((r) => ({
      ano: Number(r.ano),
      mes: Number(r.mes),
      pais_origem: String(r.pais_origem),
      total_kg: Number(r.total_kg ?? 0),
    }));
  } catch (e) {
    console.error("get_imports_exports_paises_stacked failed", e);
    return [];
  }
}

/**
 * Stacked bar data for Panel B — imports by importer group.
 * Quantity is already in mil m³ (server-side JOIN with ncm_densidade_kg_m3).
 * Returns 0 rows while cnpj='__legacy__' sentinel exists (pre-backfill state).
 * UI should show an informational empty state, not an error.
 */
export async function rpcGetImportsExportsImportersStacked(
  supabase: SupabaseClient,
  unifiedProduct: string,
  anoInicio: number,
  anoFim: number,
  topN = 10,
): Promise<IEImportersStackedRow[]> {
  try {
    const { data, error } = await supabase.rpc(
      "get_imports_exports_importers_stacked",
      {
        p_unified_product: unifiedProduct,
        p_ano_inicio: anoInicio,
        p_ano_fim: anoFim,
        p_top_n: topN,
      },
    );
    if (error) throw error;
    return ((data ?? []) as IEImportersStackedRow[]).map((r) => ({
      ano: Number(r.ano),
      mes: Number(r.mes),
      unified_importer: String(r.unified_importer),
      total_mil_m3: Number(r.total_mil_m3 ?? 0),
    }));
  } catch (e) {
    console.error("get_imports_exports_importers_stacked failed", e);
    return [];
  }
}

/**
 * YoY table for the "Last 12 months" section.
 * p_scope: 'paises' → units kt; 'importers' → units mil m³.
 * yoy_pct is null when prev_12m = 0 (no prior-year data).
 * Relative to (p_ano_fim, p_mes_fim) — use the max year in the period + Dec.
 */
export async function rpcGetImportsExportsYoyTable(
  supabase: SupabaseClient,
  scope: "paises" | "importers",
  unifiedProduct: string,
  anoFim: number,
  mesFim: number,
  topN = 10,
): Promise<IEYoyTableRow[]> {
  try {
    const { data, error } = await supabase.rpc(
      "get_imports_exports_yoy_table",
      {
        p_scope: scope,
        p_unified_product: unifiedProduct,
        p_ano_fim: anoFim,
        p_mes_fim: mesFim,
        p_top_n: topN,
      },
    );
    if (error) throw error;
    return ((data ?? []) as IEYoyTableRow[]).map((r) => ({
      entity: String(r.entity),
      last_12m: Number(r.last_12m ?? 0),
      prev_12m: Number(r.prev_12m ?? 0),
      yoy_pct: r.yoy_pct != null ? Number(r.yoy_pct) : null,
    }));
  } catch (e) {
    console.error("get_imports_exports_yoy_table failed", e);
    return [];
  }
}

/**
 * FOB import price series sourced from mdic_comex (flow='import').
 * Fetches one row per (ano, mes) for the given unified product.
 * fob_per_bbl / fob_per_m3 / fob_per_ton are NULL when volume = 0.
 * Density JOIN (ncm_densidade_kg_m3) is done server-side.
 */
export async function rpcGetImportsExportsFobPriceSerie(
  supabase: SupabaseClient,
  unifiedProduct: string,
  anoInicio: number,
  anoFim: number,
): Promise<IEFobPriceRow[]> {
  try {
    const { data, error } = await supabase.rpc(
      "get_imports_exports_fob_price_serie",
      {
        p_unified_product: unifiedProduct,
        p_ano_inicio: anoInicio,
        p_ano_fim: anoFim,
      },
    );
    if (error) throw error;
    return ((data ?? []) as IEFobPriceRow[]).map((r) => ({
      ano: Number(r.ano),
      mes: Number(r.mes),
      total_volume_kg: Number(r.total_volume_kg ?? 0),
      total_volume_m3: Number(r.total_volume_m3 ?? 0),
      total_fob_usd: Number(r.total_fob_usd ?? 0),
      fob_per_ton: r.fob_per_ton != null ? Number(r.fob_per_ton) : null,
      fob_per_m3: r.fob_per_m3 != null ? Number(r.fob_per_m3) : null,
      fob_per_bbl: r.fob_per_bbl != null ? Number(r.fob_per_bbl) : null,
    }));
  } catch (e) {
    console.error("get_imports_exports_fob_price_serie failed", e);
    return [];
  }
}

/**
 * Stacked area data for the Exports tab — by destination country.
 * Source: mdic_comex (migration 20260525000110_imports_exports_exports_by_country.sql).
 * When metric='volume', server returns value in mil m³ (kg / density / 1000) — DO NOT divide client-side.
 * When metric='usd', server returns raw FOB USD.
 */
export async function rpcGetImportsExportsExportsPaisesStacked(
  supabase: SupabaseClient,
  unifiedProduct: string,
  anoInicio: number,
  anoFim: number,
  metric: "volume" | "usd" = "volume",
  topN = 10,
): Promise<IEExportsPaisesStackedRow[]> {
  try {
    const { data, error } = await supabase.rpc(
      "get_imports_exports_exports_paises_stacked",
      {
        p_unified_product: unifiedProduct,
        p_ano_inicio: anoInicio,
        p_ano_fim: anoFim,
        p_metric: metric,
        p_top_n: topN,
      },
    );
    if (error) throw error;
    return ((data ?? []) as IEExportsPaisesStackedRow[]).map((r) => ({
      ano: Number(r.ano),
      mes: Number(r.mes),
      pais: String(r.pais),
      value: Number(r.value ?? 0),
    }));
  } catch (e) {
    console.error("get_imports_exports_exports_paises_stacked failed", e);
    return [];
  }
}

/**
 * YoY table for the Exports tab — last 12m vs prior 12m by destination country.
 * Source: mdic_comex (migration 20260525000110).
 * last_12m / prev_12m in mil m³ (metric=volume) or USD (metric=usd).
 * yoy_pct is null when prev_12m = 0.
 */
export async function rpcGetImportsExportsExportsYoyTable(
  supabase: SupabaseClient,
  unifiedProduct: string,
  anoFim: number,
  mesFim: number,
  metric: "volume" | "usd" = "volume",
  topN = 10,
): Promise<IEExportsYoyRow[]> {
  try {
    const { data, error } = await supabase.rpc(
      "get_imports_exports_exports_yoy_table",
      {
        p_unified_product: unifiedProduct,
        p_ano_fim: anoFim,
        p_mes_fim: mesFim,
        p_metric: metric,
        p_top_n: topN,
      },
    );
    if (error) throw error;
    return ((data ?? []) as IEExportsYoyRow[]).map((r) => ({
      entity: String(r.entity),
      last_12m: Number(r.last_12m ?? 0),
      prev_12m: Number(r.prev_12m ?? 0),
      yoy_pct: r.yoy_pct != null ? Number(r.yoy_pct) : null,
    }));
  } catch (e) {
    console.error("get_imports_exports_exports_yoy_table failed", e);
    return [];
  }
}

// ─── MODULE: Admin — Default News Keywords ────────────────────────────────────
//
// Admin-only RPCs for managing the `news_hunter_default_keywords` table.
// These keywords are used by anonymous visitors of the News Hunter dashboard
// (served via the public `get_default_news_keywords()` RPC) and as the seed
// for new authenticated users via `seed_my_news_hunter_keywords`.
//
// All three RPCs are SECURITY DEFINER and check `require_admin_mfa()` — only
// Admins with a verified MFA factor can mutate the default set.

export type DefaultNewsKeyword = {
  keyword: string;
  match_type: "substring" | "exact";
  created_at: string;
};

/**
 * Lists all default News Hunter keywords, ordered alphabetically (ASC).
 * Returns keyword, match_type, and created_at.
 * Admin-only (MFA-gated via require_admin_mfa() server-side).
 */
export async function rpcAdminListDefaultNewsKeywords(
  supabase: SupabaseClient,
): Promise<DefaultNewsKeyword[]> {
  const { data, error } = await supabase.rpc("admin_list_default_news_keywords");
  if (error) throw error;
  return (data ?? []) as DefaultNewsKeyword[];
}

/**
 * Adds a new keyword to the default News Hunter keyword set.
 * Idempotent — silently no-ops if the keyword already exists.
 * Admin-only (MFA-gated via require_admin_mfa() server-side).
 */
export async function rpcAdminAddDefaultNewsKeyword(
  supabase: SupabaseClient,
  keyword: string,
  matchType: "substring" | "exact" = "substring",
): Promise<boolean> {
  try {
    const { error } = await supabase.rpc("admin_add_default_news_keyword", {
      p_keyword: keyword,
      p_match_type: matchType,
    });
    if (error) throw error;
    return true;
  } catch (e) {
    console.error("admin_add_default_news_keyword failed", e);
    return false;
  }
}

/**
 * Sets match_type for an existing default News Hunter keyword.
 * Admin-only (MFA-gated via require_admin_mfa() server-side).
 */
export async function rpcAdminSetDefaultNewsKeywordMatchType(
  supabase: SupabaseClient,
  keyword: string,
  matchType: "substring" | "exact",
): Promise<boolean> {
  try {
    const { error } = await supabase.rpc(
      "admin_set_default_news_keyword_match_type",
      {
        p_keyword: keyword,
        p_match_type: matchType,
      },
    );
    if (error) throw error;
    return true;
  } catch (e) {
    console.error("admin_set_default_news_keyword_match_type failed", e);
    return false;
  }
}

/**
 * Removes a keyword from the default News Hunter keyword set.
 * Silently no-ops if the keyword does not exist.
 * Admin-only (MFA-gated via require_admin_mfa() server-side).
 */
export async function rpcAdminRemoveDefaultNewsKeyword(
  supabase: SupabaseClient,
  keyword: string,
): Promise<boolean> {
  try {
    const { error } = await supabase.rpc("admin_remove_default_news_keyword", {
      p_keyword: keyword,
    });
    if (error) throw error;
    return true;
  } catch (e) {
    console.error("admin_remove_default_news_keyword failed", e);
    return false;
  }
}

// ─── MODULE: Alerts (/alerts) ─────────────────────────────────────────────────
//
// User-facing subscription management. All wrappers here are callable by both
// anon and authenticated users EXCEPT list_my_subscriptions, list_my_recent_alerts
// and update_subscription_active which require a valid auth.uid() (RLS-gated).
//
// Admin-only RPCs (admin_list_subscribers, admin_force_unsubscribe, etc.) live
// in src/lib/alertsAdminRpc.ts (owned by worker_dash-admin).
//
// Anti-patterns to avoid:
//   - Never call these in a loop. subscribe_to_alerts takes TEXT[] — 1 call max.
//   - Never render confirmation_token or unsubscribe_token in the DOM.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  AlertSource,
  MySubscription,
  RecentAlertItem,
  SubscribeResult,
  ConfirmResult,
  ResendConfirmResult,
  UnsubscribeResult,
  UnsubscribeAllResult,
} from "../types/alerts";

/**
 * Returns the active alert source catalog (is_active=true only).
 * Callable by anon + authenticated. Strips detection_module (view-level).
 */
export async function rpcListAlertSources(
  supabase: SupabaseClient,
): Promise<AlertSource[]> {
  try {
    const { data, error } = await supabase.rpc("list_alert_sources");
    if (error) throw error;
    return (data as AlertSource[]) ?? [];
  } catch (e) {
    console.error("list_alert_sources failed", e);
    return [];
  }
}

/**
 * Atomic subscription upsert.
 * - If authenticated AND p_email matches auth.users.email: insta-confirm (is_confirmed=true).
 * - Otherwise: creates row with is_confirmed=false + triggers confirmation email via outbox.
 * Rate-limited server-side (10/IP/hour). Always send the full slug array — never loop.
 */
export async function rpcSubscribeToAlerts(
  supabase: SupabaseClient,
  email: string,
  sourceSlugs: string[],
): Promise<SubscribeResult> {
  try {
    const { data, error } = await supabase.rpc("subscribe_to_alerts", {
      p_email: email,
      p_source_slugs: sourceSlugs,
    });
    if (error) throw error;
    return (data as SubscribeResult) ?? { subscribed: 0, confirmation_sent: false };
  } catch (e) {
    console.error("subscribe_to_alerts failed", e);
    return { subscribed: 0, confirmation_sent: false, error: String(e) };
  }
}

/**
 * Confirms a subscription via the double opt-in token sent by email.
 * Sets is_confirmed=true, nulls confirmation_token.
 */
export async function rpcConfirmSubscription(
  supabase: SupabaseClient,
  token: string,
): Promise<ConfirmResult> {
  try {
    const { data, error } = await supabase.rpc("confirm_subscription", {
      p_token: token,
    });
    if (error) throw error;
    return (data as ConfirmResult) ?? { success: false, subscribed_count: 0 };
  } catch (e) {
    console.error("confirm_subscription failed", e);
    return { success: false, subscribed_count: 0, error: String(e) };
  }
}

/**
 * Re-sends the confirmation email. Rate-limited: max 1×/10min per email.
 * Returns retry_after_seconds when rate-limited.
 */
export async function rpcResendConfirmation(
  supabase: SupabaseClient,
  email: string,
  sourceSlugs: string[],
): Promise<ResendConfirmResult> {
  try {
    const { data, error } = await supabase.rpc("resend_confirmation", {
      p_email: email,
      p_source_slugs: sourceSlugs,
    });
    if (error) throw error;
    return (data as ResendConfirmResult) ?? { sent: false };
  } catch (e) {
    console.error("resend_confirmation failed", e);
    return { sent: false, error: String(e) };
  }
}

/**
 * Unsubscribes a single source via the unsubscribe_token from email footer.
 * Idempotent — repeated calls return success.
 */
export async function rpcUnsubscribe(
  supabase: SupabaseClient,
  token: string,
): Promise<UnsubscribeResult> {
  try {
    const { data, error } = await supabase.rpc("unsubscribe", {
      p_token: token,
    });
    if (error) throw error;
    return (data as UnsubscribeResult) ?? { success: false };
  } catch (e) {
    console.error("unsubscribe failed", e);
    return { success: false, error: String(e) };
  }
}

/**
 * Unsubscribes from ALL sources for the email associated with the token.
 * Used by the "Unsubscribe from all" link in email footer.
 */
export async function rpcUnsubscribeAll(
  supabase: SupabaseClient,
  token: string,
): Promise<UnsubscribeAllResult> {
  try {
    const { data, error } = await supabase.rpc("unsubscribe_all", {
      p_token: token,
    });
    if (error) throw error;
    return (data as UnsubscribeAllResult) ?? { success: false, count: 0 };
  } catch (e) {
    console.error("unsubscribe_all failed", e);
    return { success: false, count: 0, error: String(e) };
  }
}

/**
 * Returns the authenticated user's active subscriptions.
 * RLS-gated: user_id = auth.uid(). Returns [] for anon.
 */
export async function rpcListMySubscriptions(
  supabase: SupabaseClient,
): Promise<MySubscription[]> {
  try {
    const { data, error } = await supabase.rpc("list_my_subscriptions");
    if (error) throw error;
    return (data as MySubscription[]) ?? [];
  } catch (e) {
    console.error("list_my_subscriptions failed", e);
    return [];
  }
}

/**
 * Returns the last N alert events delivered to the authenticated user.
 * RLS-gated. Returns [] for anon.
 */
export async function rpcListMyRecentAlerts(
  supabase: SupabaseClient,
  limit = 20,
): Promise<RecentAlertItem[]> {
  try {
    const { data, error } = await supabase.rpc("list_my_recent_alerts", {
      p_limit: limit,
    });
    if (error) throw error;
    return (data as RecentAlertItem[]) ?? [];
  } catch (e) {
    console.error("list_my_recent_alerts failed", e);
    return [];
  }
}

/**
 * Pauses or resumes a single subscription (pause = is_active=false).
 * RLS-gated: user_id = auth.uid().
 */
export async function rpcUpdateSubscriptionActive(
  supabase: SupabaseClient,
  sourceSlug: string,
  isActive: boolean,
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("update_subscription_active", {
      p_source_slug: sourceSlug,
      p_is_active: isActive,
    });
    if (error) throw error;
    return (data as boolean) ?? false;
  } catch (e) {
    console.error("update_subscription_active failed", e);
    return false;
  }
}

// ─── MODULE: Home — Data Sources freshness ────────────────────────────────────
//
// Single aggregated RPC returning MAX(temporal_col) + count(*) for every
// ETL-fed table. Used by the /home DataSourcesTable live panel.
// SECURITY DEFINER — accessible to anon callers.
// Migration: supabase/migrations/20260526200000_data_sources_freshness.sql

export type DataSourceFreshnessRow = {
  source_key: string;
  last_update: string | null;
  row_count: number;
};

/**
 * Returns freshness metadata for every ETL-fed table in the platform.
 * Callable by anon and authenticated users.
 */
export async function rpcGetDataSourcesFreshness(
  supabase: SupabaseClient,
): Promise<DataSourceFreshnessRow[]> {
  const { data, error } = await supabase.rpc("get_data_sources_freshness");
  if (error) throw error;
  return (data ?? []) as DataSourceFreshnessRow[];
}
