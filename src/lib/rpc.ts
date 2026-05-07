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

// ─── MODULE: MDIC Comex (/src/app/(dashboard)/mdic-comex/page.tsx) ───────────

export type MdicComexSerieRow = {
  ano: number;
  mes: number;
  flow: string;
  ncm_codigo: string;
  ncm_nome: string | null;
  volume_kg: number | null;
  valor_fob_usd: number | null;
};

export type MdicComexTopPaisRow = {
  pais: string;
  ncm_codigo: string;
  volume_kg: number | null;
  valor_fob_usd: number | null;
};

export type MdicComexFiltros = {
  anos: number[];
  ncms: { ncm_codigo: string; ncm_nome: string }[];
};

export async function rpcGetMdicComexSerie(
  supabase: SupabaseClient,
  params?: {
    flow?: string | null;
    ncms?: string[] | null;
    anoInicio?: number | null;
    anoFim?: number | null;
  },
): Promise<MdicComexSerieRow[]> {
  const PAGE = 1000;
  let offset = 0;
  const allRows: MdicComexSerieRow[] = [];
  const rpcParams = {
    p_flow:       params?.flow      ?? null,
    p_ncms:       params?.ncms      ?? null,
    p_ano_inicio: params?.anoInicio ?? null,
    p_ano_fim:    params?.anoFim    ?? null,
  };
  while (true) {
    const { data, error } = await supabase
      .rpc("get_mdic_comex_serie", rpcParams)
      .range(offset, offset + PAGE - 1);
    if (error) { console.error("get_mdic_comex_serie failed", error); break; }
    const rows = (data ?? []) as MdicComexSerieRow[];
    if (!rows.length) break;
    allRows.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return allRows;
}

export async function rpcGetMdicComexTopPaises(
  supabase: SupabaseClient,
  flow: string | null,
  ncmCodigo: string | null,
  anoInicio: number | null,
  anoFim: number | null,
  limit = 15,
): Promise<MdicComexTopPaisRow[]> {
  try {
    const { data, error } = await supabase.rpc("get_mdic_comex_top_paises", {
      p_flow:        flow,
      p_ncm_codigo:  ncmCodigo,
      p_ano_inicio:  anoInicio,
      p_ano_fim:     anoFim,
      p_limit:       limit,
    });
    if (error) throw error;
    return (data ?? []) as MdicComexTopPaisRow[];
  } catch (e) {
    console.error("get_mdic_comex_top_paises failed", e);
    return [];
  }
}

export async function rpcGetMdicComexFiltros(
  supabase: SupabaseClient,
): Promise<MdicComexFiltros> {
  try {
    const { data, error } = await supabase.rpc("get_mdic_comex_filtros", {});
    if (error) throw error;
    const d = (data ?? {}) as Partial<MdicComexFiltros>;
    return { anos: d.anos ?? [], ncms: d.ncms ?? [] };
  } catch (e) {
    console.error("get_mdic_comex_filtros failed", e);
    return { anos: [], ncms: [] };
  }
}

// ─── MODULE: ANP PPI (/src/app/(dashboard)/anp-ppi/page.tsx) ─────────────────

export type AnpPpiSerieRow = {
  data_inicio: string;   // "YYYY-MM-DD"
  data_fim: string;
  produto: string;
  preco_medio: number | null;
  unidade: string | null;
};

export type AnpPpiLocaisRow = {
  data_inicio: string;
  data_fim: string;
  local: string;
  preco: number | null;
  variacao_pct: number | null;
};

export type AnpPpiFiltros = {
  produtos: string[];
  locais: string[];
  data_min: string | null;
  data_max: string | null;
};

export async function rpcGetAnpPpiMediaSerie(
  supabase: SupabaseClient,
  params?: { dataInicio?: string | null; dataFim?: string | null },
): Promise<AnpPpiSerieRow[]> {
  const PAGE = 1000;
  let offset = 0;
  const allRows: AnpPpiSerieRow[] = [];
  const rpcParams = {
    p_data_inicio: params?.dataInicio ?? null,
    p_data_fim:    params?.dataFim    ?? null,
  };
  while (true) {
    const { data, error } = await supabase
      .rpc("get_anp_ppi_media_serie", rpcParams)
      .range(offset, offset + PAGE - 1);
    if (error) { console.error("get_anp_ppi_media_serie failed", error); break; }
    const rows = (data ?? []) as AnpPpiSerieRow[];
    if (!rows.length) break;
    allRows.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return allRows;
}

export async function rpcGetAnpPpiLocaisSerie(
  supabase: SupabaseClient,
  produto: string,
  params?: { dataInicio?: string | null; dataFim?: string | null },
): Promise<AnpPpiLocaisRow[]> {
  const PAGE = 1000;
  let offset = 0;
  const allRows: AnpPpiLocaisRow[] = [];
  const rpcParams = {
    p_produto:     produto,
    p_data_inicio: params?.dataInicio ?? null,
    p_data_fim:    params?.dataFim    ?? null,
  };
  while (true) {
    const { data, error } = await supabase
      .rpc("get_anp_ppi_locais_serie", rpcParams)
      .range(offset, offset + PAGE - 1);
    if (error) { console.error("get_anp_ppi_locais_serie failed", error); break; }
    const rows = (data ?? []) as AnpPpiLocaisRow[];
    if (!rows.length) break;
    allRows.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return allRows;
}

export async function rpcGetAnpPpiFiltros(
  supabase: SupabaseClient,
): Promise<AnpPpiFiltros> {
  try {
    const { data, error } = await supabase.rpc("get_anp_ppi_filtros", {});
    if (error) throw error;
    const d = (data ?? {}) as Partial<AnpPpiFiltros>;
    return {
      produtos:  d.produtos  ?? [],
      locais:    d.locais    ?? [],
      data_min:  d.data_min  ?? null,
      data_max:  d.data_max  ?? null,
    };
  } catch (e) {
    console.error("get_anp_ppi_filtros failed", e);
    return { produtos: [], locais: [], data_min: null, data_max: null };
  }
}

// ─── MODULE: ANP Preços Produtores (/src/app/(dashboard)/anp-precos-produtores/page.tsx) ─

export type AnpPprodutoresRow = {
  data_inicio: string;
  data_fim: string;
  produto: string;
  unidade: string | null;
  regiao: string;
  preco: number | null;
};

export type AnpPprodutoresFiltros = {
  produtos: string[];
  regioes: string[];
  data_min: string | null;
  data_max: string | null;
};

export async function rpcGetAnpPprodutoresSerie(
  supabase: SupabaseClient,
  params?: {
    produto?: string | null;
    regioes?: string[] | null;
    dataInicio?: string | null;
    dataFim?: string | null;
  },
): Promise<AnpPprodutoresRow[]> {
  const PAGE = 1000;
  let offset = 0;
  const allRows: AnpPprodutoresRow[] = [];
  const rpcParams = {
    p_produto:     params?.produto     ?? null,
    p_regioes:     params?.regioes     ?? null,
    p_data_inicio: params?.dataInicio  ?? null,
    p_data_fim:    params?.dataFim     ?? null,
  };
  while (true) {
    const { data, error } = await supabase
      .rpc("get_anp_precos_produtores_serie", rpcParams)
      .range(offset, offset + PAGE - 1);
    if (error) { console.error("get_anp_precos_produtores_serie failed", error); break; }
    const rows = (data ?? []) as AnpPprodutoresRow[];
    if (!rows.length) break;
    allRows.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return allRows;
}

export async function rpcGetAnpPprodutoresFiltros(
  supabase: SupabaseClient,
): Promise<AnpPprodutoresFiltros> {
  try {
    const { data, error } = await supabase.rpc("get_anp_precos_produtores_filtros", {});
    if (error) throw error;
    const d = (data ?? {}) as Partial<AnpPprodutoresFiltros>;
    return {
      produtos:  d.produtos  ?? [],
      regioes:   d.regioes   ?? [],
      data_min:  d.data_min  ?? null,
      data_max:  d.data_max  ?? null,
    };
  } catch (e) {
    console.error("get_anp_precos_produtores_filtros failed", e);
    return { produtos: [], regioes: [], data_min: null, data_max: null };
  }
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

// ─── MODULE: ANP Dados Abertos IE (/src/app/(dashboard)/anp-daie/page.tsx) ────

export type AnpDaieRow = {
  ano: number;
  mes: number;
  produto: string;
  operacao: string;
  volume_m3: number | null;
  valor_usd: number | null;
};

export type AnpDaieFiltros = {
  produtos: string[];
  operacoes: string[];
  ano_min: number | null;
  ano_max: number | null;
};

export async function rpcGetAnpDaieSerie(
  supabase: SupabaseClient,
  params?: {
    operacoes?: string[] | null;
    produtos?: string[] | null;
    anoInicio?: number | null;
    anoFim?: number | null;
  },
): Promise<AnpDaieRow[]> {
  const PAGE = 1000;
  let offset = 0;
  const allRows: AnpDaieRow[] = [];
  const rpcParams = {
    p_operacoes:  params?.operacoes  ?? null,
    p_produtos:   params?.produtos   ?? null,
    p_ano_inicio: params?.anoInicio  ?? null,
    p_ano_fim:    params?.anoFim     ?? null,
  };
  while (true) {
    const { data, error } = await supabase
      .rpc("get_anp_daie_serie", rpcParams)
      .range(offset, offset + PAGE - 1);
    if (error) { console.error("get_anp_daie_serie failed", error); break; }
    const rows = (data ?? []) as AnpDaieRow[];
    if (!rows.length) break;
    allRows.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return allRows;
}

export async function rpcGetAnpDaiFiltros(
  supabase: SupabaseClient,
): Promise<AnpDaieFiltros> {
  try {
    const { data, error } = await supabase.rpc("get_anp_daie_filtros", {});
    if (error) throw error;
    const d = (data ?? {}) as Partial<AnpDaieFiltros>;
    return {
      produtos:  d.produtos  ?? [],
      operacoes: d.operacoes ?? [],
      ano_min:   d.ano_min   ?? null,
      ano_max:   d.ano_max   ?? null,
    };
  } catch (e) {
    console.error("get_anp_daie_filtros failed", e);
    return { produtos: [], operacoes: [], ano_min: null, ano_max: null };
  }
}

// ─── MODULE: ANP Desembaraços (/src/app/(dashboard)/anp-desembaracos/page.tsx) ─

export type AnpDesembaracosRow = {
  ano: number;
  mes: number;
  ncm_codigo: string;
  ncm_nome: string | null;
  pais_origem: string;
  quantidade_kg: number | null;
};

export type AnpDesembaracosTopPaisRow = {
  pais_origem: string;
  total_kg: number | null;
};

export type AnpDesembaracosFiltros = {
  ncms: { ncm_codigo: string; ncm_nome: string }[];
  paises: string[];
  ano_min: number | null;
  ano_max: number | null;
};

export async function rpcGetAnpDesembaracosSerie(
  supabase: SupabaseClient,
  params?: {
    ncms?: string[] | null;
    paises?: string[] | null;
    anoInicio?: number | null;
    anoFim?: number | null;
  },
): Promise<AnpDesembaracosRow[]> {
  const PAGE = 1000;
  let offset = 0;
  const allRows: AnpDesembaracosRow[] = [];
  const rpcParams = {
    p_ncms:       params?.ncms      ?? null,
    p_paises:     params?.paises    ?? null,
    p_ano_inicio: params?.anoInicio ?? null,
    p_ano_fim:    params?.anoFim    ?? null,
  };
  while (true) {
    const { data, error } = await supabase
      .rpc("get_anp_desembaracos_serie", rpcParams)
      .range(offset, offset + PAGE - 1);
    if (error) { console.error("get_anp_desembaracos_serie failed", error); break; }
    const rows = (data ?? []) as AnpDesembaracosRow[];
    if (!rows.length) break;
    allRows.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return allRows;
}

export async function rpcGetAnpDesembaracosTopPaises(
  supabase: SupabaseClient,
  ncmCodigo: string,
  anoInicio: number | null,
  anoFim: number | null,
  limit = 15,
): Promise<AnpDesembaracosTopPaisRow[]> {
  try {
    const { data, error } = await supabase.rpc("get_anp_desembaracos_top_paises", {
      p_ncm_codigo: ncmCodigo,
      p_ano_inicio: anoInicio,
      p_ano_fim:    anoFim,
      p_limit:      limit,
    });
    if (error) throw error;
    return (data ?? []) as AnpDesembaracosTopPaisRow[];
  } catch (e) {
    console.error("get_anp_desembaracos_top_paises failed", e);
    return [];
  }
}

export async function rpcGetAnpDesembaracosFiltros(
  supabase: SupabaseClient,
): Promise<AnpDesembaracosFiltros> {
  try {
    const { data, error } = await supabase.rpc("get_anp_desembaracos_filtros", {});
    if (error) throw error;
    const d = (data ?? {}) as Partial<AnpDesembaracosFiltros>;
    return {
      ncms:    d.ncms    ?? [],
      paises:  d.paises  ?? [],
      ano_min: d.ano_min ?? null,
      ano_max: d.ano_max ?? null,
    };
  } catch (e) {
    console.error("get_anp_desembaracos_filtros failed", e);
    return { ncms: [], paises: [], ano_min: null, ano_max: null };
  }
}

// ─── MODULE: ANP Painel Importações (/src/app/(dashboard)/anp-painel-importacoes/page.tsx) ─

export type AnpPainelImpSerieRow = {
  ano: number;
  mes: number;
  nome_produto: string;
  volume_m3: number | null;
};

export type AnpPainelImpTopDistRow = {
  distribuidor: string;
  total_m3: number | null;
};

export type AnpPainelImpFiltros = {
  produtos: string[];
  ufs: string[];
  distribuidores: string[];
  ano_min: number | null;
  ano_max: number | null;
};

export async function rpcGetAnpPainelImpSerie(
  supabase: SupabaseClient,
  params?: {
    produtos?: string[] | null;
    ufs?: string[] | null;
    anoInicio?: number | null;
    anoFim?: number | null;
  },
): Promise<AnpPainelImpSerieRow[]> {
  const PAGE = 1000;
  let offset = 0;
  const allRows: AnpPainelImpSerieRow[] = [];
  const rpcParams = {
    p_produtos:   params?.produtos   ?? null,
    p_ufs:        params?.ufs        ?? null,
    p_ano_inicio: params?.anoInicio  ?? null,
    p_ano_fim:    params?.anoFim     ?? null,
  };
  while (true) {
    const { data, error } = await supabase
      .rpc("get_anp_painel_imp_serie", rpcParams)
      .range(offset, offset + PAGE - 1);
    if (error) { console.error("get_anp_painel_imp_serie failed", error); break; }
    const rows = (data ?? []) as AnpPainelImpSerieRow[];
    if (!rows.length) break;
    allRows.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return allRows;
}

export async function rpcGetAnpPainelImpTopDist(
  supabase: SupabaseClient,
  produto: string,
  anoInicio: number | null,
  anoFim: number | null,
  limit = 15,
): Promise<AnpPainelImpTopDistRow[]> {
  try {
    const { data, error } = await supabase.rpc("get_anp_painel_imp_top_dist", {
      p_produto:    produto,
      p_ano_inicio: anoInicio,
      p_ano_fim:    anoFim,
      p_limit:      limit,
    });
    if (error) throw error;
    return (data ?? []) as AnpPainelImpTopDistRow[];
  } catch (e) {
    console.error("get_anp_painel_imp_top_dist failed", e);
    return [];
  }
}

export async function rpcGetAnpPainelImpFiltros(
  supabase: SupabaseClient,
): Promise<AnpPainelImpFiltros> {
  try {
    const { data, error } = await supabase.rpc("get_anp_painel_imp_filtros", {});
    if (error) throw error;
    const d = (data ?? {}) as Partial<AnpPainelImpFiltros>;
    return {
      produtos:       d.produtos       ?? [],
      ufs:            d.ufs            ?? [],
      distribuidores: d.distribuidores ?? [],
      ano_min:        d.ano_min        ?? null,
      ano_max:        d.ano_max        ?? null,
    };
  } catch (e) {
    console.error("get_anp_painel_imp_filtros failed", e);
    return { produtos: [], ufs: [], distribuidores: [], ano_min: null, ano_max: null };
  }
}

// ─── MODULE: ANP LPC (/src/app/(dashboard)/anp-lpc/page.tsx) ─────────────────

export type AnpLpcNacionalRow = {
  data_fim: string;          // "YYYY-MM-DD" (week end date)
  produto: string;
  preco_medio_venda: number | null;
  total_postos: number | null;
};

export type AnpLpcSerieRow = {
  data_fim: string;
  produto: string;
  estado: string;
  preco_medio_venda: number | null;
  preco_medio_compra: number | null;
  n_postos: number | null;
};

export type AnpLpcFiltros = {
  produtos: string[];
  estados: string[];
  data_min: string | null;
  data_max: string | null;
};

export async function rpcGetAnpLpcNacional(
  supabase: SupabaseClient,
  params?: {
    produtos?: string[] | null;
    dataInicio?: string | null;
    dataFim?: string | null;
  },
): Promise<AnpLpcNacionalRow[]> {
  const PAGE = 1000;
  let offset = 0;
  const allRows: AnpLpcNacionalRow[] = [];
  const rpcParams = {
    p_produtos:    params?.produtos   ?? null,
    p_data_inicio: params?.dataInicio ?? null,
    p_data_fim:    params?.dataFim    ?? null,
  };
  while (true) {
    const { data, error } = await supabase
      .rpc("get_anp_lpc_nacional", rpcParams)
      .range(offset, offset + PAGE - 1);
    if (error) { console.error("get_anp_lpc_nacional failed", error); break; }
    const rows = (data ?? []) as AnpLpcNacionalRow[];
    if (!rows.length) break;
    allRows.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return allRows;
}

export async function rpcGetAnpLpcSerie(
  supabase: SupabaseClient,
  params?: {
    produtos?: string[] | null;
    estados?: string[] | null;
    dataInicio?: string | null;
    dataFim?: string | null;
  },
): Promise<AnpLpcSerieRow[]> {
  const PAGE = 1000;
  let offset = 0;
  const allRows: AnpLpcSerieRow[] = [];
  const rpcParams = {
    p_produtos:    params?.produtos   ?? null,
    p_estados:     params?.estados    ?? null,
    p_data_inicio: params?.dataInicio ?? null,
    p_data_fim:    params?.dataFim    ?? null,
  };
  while (true) {
    const { data, error } = await supabase
      .rpc("get_anp_lpc_serie", rpcParams)
      .range(offset, offset + PAGE - 1);
    if (error) { console.error("get_anp_lpc_serie failed", error); break; }
    const rows = (data ?? []) as AnpLpcSerieRow[];
    if (!rows.length) break;
    allRows.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return allRows;
}

export async function rpcGetAnpLpcFiltros(
  supabase: SupabaseClient,
): Promise<AnpLpcFiltros> {
  try {
    const { data, error } = await supabase.rpc("get_anp_lpc_filtros", {});
    if (error) throw error;
    const d = (data ?? {}) as Partial<AnpLpcFiltros>;
    return {
      produtos:  d.produtos  ?? [],
      estados:   d.estados   ?? [],
      data_min:  d.data_min  ?? null,
      data_max:  d.data_max  ?? null,
    };
  } catch (e) {
    console.error("get_anp_lpc_filtros failed", e);
    return { produtos: [], estados: [], data_min: null, data_max: null };
  }
}

// ─── MODULE: ANP Preços Distribuição (/src/app/(dashboard)/anp-precos-distribuicao/page.tsx) ─

export type AnpPdistSerieRow = {
  data_referencia: string;     // "YYYY-MM-DD"
  local: string;               // "Brasil" | UF | nome do município
  preco_medio: number | null;
  preco_minimo: number | null;
  preco_maximo: number | null;
  unidade: string | null;
};

export type AnpPdistFiltros = {
  produtos: string[];
  granularidades: string[];    // 'brasil' | 'uf' | 'municipio'
  ufs: string[];
  municipios: string[];
  data_min: string | null;
  data_max: string | null;
};

export async function rpcGetAnpPdistFiltros(
  supabase: SupabaseClient,
): Promise<AnpPdistFiltros> {
  try {
    const { data, error } = await supabase.rpc("get_anp_precos_distribuicao_filtros", {});
    if (error) throw error;
    const d = (data ?? {}) as Partial<AnpPdistFiltros>;
    return {
      produtos:        d.produtos        ?? [],
      granularidades:  d.granularidades  ?? [],
      ufs:             d.ufs             ?? [],
      municipios:      d.municipios      ?? [],
      data_min:        d.data_min        ?? null,
      data_max:        d.data_max        ?? null,
    };
  } catch (e) {
    console.error("get_anp_precos_distribuicao_filtros failed", e);
    return { produtos: [], granularidades: [], ufs: [], municipios: [], data_min: null, data_max: null };
  }
}

export async function rpcGetAnpPdistSerie(
  supabase: SupabaseClient,
  params: {
    produto: string;
    granularidade: string;
    locais?: string[] | null;
    dataInicio?: string | null;
    dataFim?: string | null;
  },
): Promise<AnpPdistSerieRow[]> {
  if (!params.produto || !params.granularidade) return [];
  const PAGE = 1000;
  let offset = 0;
  const allRows: AnpPdistSerieRow[] = [];
  const rpcParams = {
    p_produto:       params.produto,
    p_granularidade: params.granularidade,
    p_locais:        toListOrNull(params.locais),
    p_data_inicio:   params.dataInicio ?? null,
    p_data_fim:      params.dataFim    ?? null,
  };
  while (true) {
    const { data, error } = await supabase
      .rpc("get_anp_precos_distribuicao_serie", rpcParams)
      .range(offset, offset + PAGE - 1);
    if (error) { console.error("get_anp_precos_distribuicao_serie failed", error); break; }
    const rows = (data ?? []) as AnpPdistSerieRow[];
    if (!rows.length) break;
    allRows.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return allRows;
}

export type AnpPdistExportCountFilters = {
  produtos?: string[] | null;
  granularidades?: string[] | null;
  locais?: string[] | null;
  dataInicio?: string | null;
  dataFim?: string | null;
};

export async function getAnpPdistExportCount(
  supabase: SupabaseClient,
  filters: AnpPdistExportCountFilters,
): Promise<number> {
  const { data, error } = await supabase.rpc("get_anp_precos_distribuicao_export_count", {
    p_produtos:        toListOrNull(filters.produtos),
    p_granularidades:  toListOrNull(filters.granularidades),
    p_locais:          toListOrNull(filters.locais),
    p_data_inicio:     filters.dataInicio ?? null,
    p_data_fim:        filters.dataFim    ?? null,
  });
  if (error) {
    console.error("get_anp_precos_distribuicao_export_count failed", error);
    throw error;
  }
  return Number(data ?? 0);
}

// ─── MODULE: SINDICOM (/src/app/(dashboard)/sindicom/page.tsx) ────────────────

export type SindicomSerieRow = {
  ano: number;
  mes: number;
  empresa: string;
  nome_produto: string;
  segmento: string;
  volume: number | null;
};

export type SindicomFiltros = {
  empresas: string[];
  produtos: string[];
  segmentos: string[];
  ano_min: number | null;
  ano_max: number | null;
};

export async function rpcGetSindicomSerie(
  supabase: SupabaseClient,
  params?: {
    empresas?: string[] | null;
    produtos?: string[] | null;
    segmentos?: string[] | null;
    anoInicio?: number | null;
    anoFim?: number | null;
  },
): Promise<SindicomSerieRow[]> {
  const PAGE = 1000;
  let offset = 0;
  const allRows: SindicomSerieRow[] = [];
  const rpcParams = {
    p_empresas:   params?.empresas   ?? null,
    p_produtos:   params?.produtos   ?? null,
    p_segmentos:  params?.segmentos  ?? null,
    p_ano_inicio: params?.anoInicio  ?? null,
    p_ano_fim:    params?.anoFim     ?? null,
  };
  while (true) {
    const { data, error } = await supabase
      .rpc("get_sindicom_serie", rpcParams)
      .range(offset, offset + PAGE - 1);
    if (error) { console.error("get_sindicom_serie failed", error); break; }
    const rows = (data ?? []) as SindicomSerieRow[];
    if (!rows.length) break;
    allRows.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return allRows;
}

export async function rpcGetSindicomFiltros(
  supabase: SupabaseClient,
): Promise<SindicomFiltros> {
  try {
    const { data, error } = await supabase.rpc("get_sindicom_filtros", {});
    if (error) throw error;
    const d = (data ?? {}) as Partial<SindicomFiltros>;
    return {
      empresas:  d.empresas  ?? [],
      produtos:  d.produtos  ?? [],
      segmentos: d.segmentos ?? [],
      ano_min:   d.ano_min   ?? null,
      ano_max:   d.ano_max   ?? null,
    };
  } catch (e) {
    console.error("get_sindicom_filtros failed", e);
    return { empresas: [], produtos: [], segmentos: [], ano_min: null, ano_max: null };
  }
}

// ─── MODULE: ANP CDP (/src/app/(dashboard)/anp-cdp/page.tsx) ─────────────────

export type AnpCdpSeriePonto = {
  ano: number;
  mes: number;
  petroleo_bbl_dia: number;
  oleo_bbl_dia: number;
  condensado_bbl_dia: number;
  gas_total_mm3_dia: number;
  gas_natural_assoc_mm3_dia: number;
  gas_natural_n_assoc_mm3_dia: number;
  gas_royalties: number;
  agua_bbl_dia: number;
  tempo_prod_hs_mes: number;
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

export type MdicComexExportCountFilters = {
  flow?: string | null;
  ncms?: string[] | null;
  anoInicio?: number | null;
  anoFim?: number | null;
};

export async function getMdicComexExportCount(
  supabase: SupabaseClient,
  filters: MdicComexExportCountFilters,
): Promise<number> {
  const { data, error } = await supabase.rpc("get_mdic_comex_export_count", {
    p_flow:       filters.flow      ?? null,
    p_ncms:       toListOrNull(filters.ncms),
    p_ano_inicio: filters.anoInicio ?? null,
    p_ano_fim:    filters.anoFim    ?? null,
  });
  if (error) {
    console.error("get_mdic_comex_export_count failed", error);
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
 *                           num_contrato, oleo_bbl_dia, condensado_bbl_dia,
 *                           gas_natural_assoc_mm3_dia,
 *                           gas_natural_n_assoc_mm3_dia, gas_royalties,
 *                           tipo_instalacao, tempo_prod_hs_mes
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
  condensado_bbl_dia: number | null;
  gas_total_mm3_dia: number | null;
  gas_natural_assoc_mm3_dia: number | null;
  gas_natural_n_assoc_mm3_dia: number | null;
  gas_royalties: number | null;
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
        "ano,mes,poco,campo,bacia,local,estado,operador,nome_poco_operador,num_contrato,instalacao_destino,tipo_instalacao,petroleo_bbl_dia,oleo_bbl_dia,condensado_bbl_dia,gas_total_mm3_dia,gas_natural_assoc_mm3_dia,gas_natural_n_assoc_mm3_dia,gas_royalties,agua_bbl_dia,tempo_prod_hs_mes",
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

// ─── Tier 2 aggregated exports — /anp-cdp + /mdic-comex ─────────────────────
//
// Both `get_anp_cdp_aggregated` and `get_mdic_comex_aggregated` are dynamic
// SQL aggregators created in a parallel migration by worker_supabase. The
// caller passes the same filter shape used for the export count + a
// `p_group_by text[]` whose values must be a strict subset of the union of
// dimension columns of the underlying table.
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
  condensado_bbl_dia: number;
  gas_total_mm3_dia: number;
  gas_natural_assoc_mm3_dia: number;
  gas_natural_n_assoc_mm3_dia: number;
  gas_royalties: number;
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

// ── MDIC Comex aggregated ────────────────────────────────────────────────────
//
// NOTE: the underlying `mdic_comex` table (migration 20260504000012) has
// columns: ano, mes, flow, ncm_codigo, ncm_nome, pais, volume_kg,
// valor_fob_usd. There is **no `uf` column** in the table, so the contract's
// `ufs` filter and `"uf"` group-by are intentionally omitted here.

export type MdicComexAggregatedFilters = MdicComexExportCountFilters & {
  paises?: string[] | null;
};

export type MdicComexGroupBy =
  | "ano"
  | "mes"
  | "flow"
  | "ncm_codigo"
  | "ncm_nome"
  | "pais";

export type MdicComexAggregatedRow = {
  ano: number | null;
  mes: number | null;
  flow: string | null;
  ncm_codigo: string | null;
  ncm_nome: string | null;
  pais: string | null;
  volume_kg: number;
  valor_fob_usd: number;
};

export async function rpcGetMdicComexAggregated(
  supabase: SupabaseClient,
  filters: MdicComexAggregatedFilters,
  groupBy: MdicComexGroupBy[],
): Promise<MdicComexAggregatedRow[]> {
  // Same PostgREST `max-rows` truncation hazard as get_anp_cdp_aggregated.
  // With ~250 NCMs × 200 países × 12 meses × ano range, full-cardinality
  // group-bys easily exceed 1000 rows — page identically.
  const PAGE = 1000;
  let offset = 0;
  const allRows: MdicComexAggregatedRow[] = [];

  const args = {
    p_flow:       filters.flow      ?? null,
    p_ncms:       toListOrNull(filters.ncms),
    p_paises:     toListOrNull(filters.paises),
    p_ano_inicio: filters.anoInicio ?? null,
    p_ano_fim:    filters.anoFim    ?? null,
    p_group_by:   groupBy as unknown as string[],
  };

  while (true) {
    const { data, error } = await supabase
      .rpc("get_mdic_comex_aggregated", args)
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.error("get_mdic_comex_aggregated failed", error);
      throw error;
    }
    const rows = (data ?? []) as MdicComexAggregatedRow[];
    if (!rows.length) break;
    allRows.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  return allRows;
}

// ── MDIC Comex raw rows (PostgREST) ──────────────────────────────────────────
//
// Default export path for /mdic-comex granularity = "raw". Mirrors columns of
// `mdic_comex` 1:1 (do not invent fields). Same filter shape as
// `get_mdic_comex_export_count` plus `paises` (since the table has it).

export type MdicComexRawRow = {
  ano: number;
  mes: number;
  flow: string;
  ncm_codigo: string;
  ncm_nome: string | null;
  pais: string;
  volume_kg: number | null;
  valor_fob_usd: number | null;
};

export async function fetchMdicComexRawFiltered(
  supabase: SupabaseClient,
  filters: MdicComexAggregatedFilters,
): Promise<MdicComexRawRow[]> {
  const PAGE = 1000;
  let offset = 0;
  const allRows: MdicComexRawRow[] = [];

  const ncms   = toListOrNull(filters.ncms);
  const paises = toListOrNull(filters.paises);

  while (true) {
    let q = supabase
      .from("mdic_comex")
      .select("ano,mes,flow,ncm_codigo,ncm_nome,pais,volume_kg,valor_fob_usd");

    if (filters.flow)            q = q.eq("flow", filters.flow);
    if (ncms)                    q = q.in("ncm_codigo", ncms);
    if (paises)                  q = q.in("pais", paises);
    if (filters.anoInicio != null) q = q.gte("ano", filters.anoInicio);
    if (filters.anoFim    != null) q = q.lte("ano", filters.anoFim);

    const { data, error } = await q
      .order("ano",        { ascending: true })
      .order("mes",        { ascending: true })
      .order("flow",       { ascending: true })
      .order("ncm_codigo", { ascending: true })
      .order("pais",       { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;

    const rows = (data ?? []) as MdicComexRawRow[];
    if (!rows.length) break;
    allRows.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  return allRows;
}

export type AnpLpcExportCountFilters = {
  produtos?: string[] | null;
  estados?: string[] | null;
  dataInicio?: string | null;
  dataFim?: string | null;
};

export async function getAnpLpcExportCount(
  supabase: SupabaseClient,
  filters: AnpLpcExportCountFilters,
): Promise<number> {
  const { data, error } = await supabase.rpc("get_anp_lpc_export_count", {
    p_produtos:    toListOrNull(filters.produtos),
    p_estados:     toListOrNull(filters.estados),
    p_data_inicio: filters.dataInicio ?? null,
    p_data_fim:    filters.dataFim    ?? null,
  });
  if (error) {
    console.error("get_anp_lpc_export_count failed", error);
    throw error;
  }
  return Number(data ?? 0);
}
