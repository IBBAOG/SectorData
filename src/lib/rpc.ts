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

export async function fetchAllVendas(
  supabase: SupabaseClient,
): Promise<Record<string, unknown>[]> {
  const PAGE = 1000;
  let offset = 0;
  const allRows: Record<string, unknown>[] = [];

  while (true) {
    const { data, error } = await supabase
      .from("vendas")
      .select("*")
      .range(offset, offset + PAGE - 1);
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
  bba_import_parity: number | null;      // IBBA for Gasoline, BBA for Diesel
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

