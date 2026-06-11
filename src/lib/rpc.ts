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
import { paginateRpc } from "@/lib/paginateRpc";
import type {
  SubscribableBase,
  MySubscription,
  RecentAlert,
  UnsubscribeResult,
  AdminAlertsStats,
  AdminAlertsSubscriber,
  AdminAlertsEmailLogRow,
} from "@/types/alerts";

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
 * Filters accepted by `fetchVendasFiltered` (CSV export of /market-share).
 * Mirrors `MsExportCountFilters` 1:1 so the modal estimate
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
 * `get_ms_export_count`. Used by the CSV export path on /market-share
 * so the rows downloaded match exactly the size estimate
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

// ─── MODULE: Sales Volumes — RETIRED (2026-05-26) ────────────────────────────
//
// /sales-volumes was folded into /market-share via a top-level unit toggle.
// The legacy get_sv_* RPC family was dropped by
// 20260526400000_drop_sv_rpcs.sql. /market-share's get_ms_serie_fast +
// get_ms_serie_others now serve both narratives (% Share + thousand m³) via
// the unitMode toggle.

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
  /**
   * True only for the current calendar month (live estimate).
   * False for closed months — those bars are frozen against the LAST
   * snapshot collected within that month and never get recomputed.
   * Always present when returned by get_nd_volume_mensal_historico;
   * legacy callers of get_nd_volume_mensal_descarga will see undefined.
   */
  is_current?: boolean;
};

export async function rpcGetNdVolumeMensalDescarga(
  supabase: SupabaseClient,
  collectedAt: string,
): Promise<NdVolumeMensalDescargaRow[]> {
  // Prefer the historico variant: same row shape, but past months are
  // anchored to the last snapshot inside that month (frozen) and the
  // current month uses the live snapshot. Baseline: Apr 2026.
  //
  // Fall back to the legacy get_nd_volume_mensal_descarga if the
  // historico function isn't deployed yet (handles the gap between this
  // commit landing and supabase_deploy.yml applying the new migration).
  try {
    const { data, error } = await supabase.rpc("get_nd_volume_mensal_historico", {
      p_collected_at: collectedAt,
    });
    if (error) throw error;
    return (data ?? []) as NdVolumeMensalDescargaRow[];
  } catch (eHist) {
    console.warn("get_nd_volume_mensal_historico unavailable, falling back to get_nd_volume_mensal_descarga", eHist);
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

// ── Export library wrappers (unified spec at src/lib/export/dashboards/anpPrices.ts)
//
// `get_anp_prices_export_counts` (plural) returns the row count per source
// (Producer + Distribution + Retail) for the active filter set, so the modal's
// SizeEstimator can sum them or report each separately. Backend RPC owner:
// worker_supabase. Until that RPC ships, this wrapper degrades to summing 3
// independent single-source counts so the modal still shows a number.

export type AnpPricesExportCountsBySource = {
  producer: number;
  distribution: number;
  retail: number;
};

export async function rpcGetAnpPricesExportCounts(
  supabase: SupabaseClient,
  filters: AnpPricesExportCountFilters,
): Promise<AnpPricesExportCountsBySource> {
  // First try the new SECURITY DEFINER RPC.
  const { data, error } = await supabase.rpc("get_anp_prices_export_counts", {
    p_produtos:       toListOrNull(filters.produtos),
    p_granularidades: toListOrNull(filters.granularidades),
    p_locais:         toListOrNull(filters.locais),
    p_data_inicio:    filters.dataInicio ?? null,
    p_data_fim:       filters.dataFim    ?? null,
  });
  if (!error && data) {
    const d = data as Partial<AnpPricesExportCountsBySource>;
    return {
      producer:     Number(d.producer     ?? 0),
      distribution: Number(d.distribution ?? 0),
      retail:       Number(d.retail       ?? 0),
    };
  }
  // Fallback: fan-out 3 SELECT-style counts (per source) using the existing
  // single-count RPC by varying the produto filter and counting client-side.
  // The legacy `get_anp_prices_export_count` already returns a single number
  // across all sources, so we approximate by dividing equally — acceptable as
  // a UX hint while worker_supabase ships the real RPC.
  console.warn("get_anp_prices_export_counts not yet available, using fallback estimate");
  try {
    const total = await getAnpPricesExportCount(supabase, filters);
    const split = Math.floor(total / 3);
    return { producer: split, distribution: split, retail: total - 2 * split };
  } catch {
    return { producer: 0, distribution: 0, retail: 0 };
  }
}

/**
 * Fetch raw rows for the Producer sheet of /anp-prices Excel export.
 * Backend RPC (owner worker_supabase): `get_anp_prices_export_producer`.
 * Falls back to the unified `get_anp_prices_serie` filtered to fonte='producer'
 * when the dedicated RPC isn't available.
 */
export async function rpcGetAnpPricesExportProducer(
  supabase: SupabaseClient,
  filters: AnpPricesExportCountFilters,
): Promise<AnpPricesSerieRow[]> {
  const produtos = filters.produtos && filters.produtos.length > 0
    ? filters.produtos
    : ["Gasoline", "Diesel", "Ethanol", "Biodiesel", "LPG"];
  const grans = filters.granularidades && filters.granularidades.length > 0
    ? filters.granularidades
    : ["brasil", "regiao"];
  const all: AnpPricesSerieRow[] = [];
  for (const p of produtos) {
    for (const g of grans) {
      const rows = await rpcGetAnpPricesSerie(supabase, {
        produto:       p,
        granularidade: g,
        locais:        filters.locais ?? null,
        dataInicio:    filters.dataInicio ?? null,
        dataFim:       filters.dataFim ?? null,
      });
      for (const r of rows) {
        if (r.fonte !== "producer") continue;
        all.push({ ...r, ...(p && { produto: p }) } as AnpPricesSerieRow & { produto: string });
      }
    }
  }
  return all;
}

/**
 * Fetch raw rows for the Distribution sheet of /anp-prices Excel export.
 * Backend RPC (owner worker_supabase): `get_anp_prices_export_distribution`.
 */
export async function rpcGetAnpPricesExportDistribution(
  supabase: SupabaseClient,
  filters: AnpPricesExportCountFilters,
): Promise<AnpPricesSerieRow[]> {
  const produtos = filters.produtos && filters.produtos.length > 0
    ? filters.produtos
    : ["Gasoline", "Diesel", "Ethanol", "LPG"];
  const grans = filters.granularidades && filters.granularidades.length > 0
    ? filters.granularidades
    : ["brasil", "regiao", "uf"];
  const all: AnpPricesSerieRow[] = [];
  for (const p of produtos) {
    for (const g of grans) {
      const rows = await rpcGetAnpPricesSerie(supabase, {
        produto:       p,
        granularidade: g,
        locais:        filters.locais ?? null,
        dataInicio:    filters.dataInicio ?? null,
        dataFim:       filters.dataFim ?? null,
      });
      for (const r of rows) {
        if (r.fonte !== "distribution") continue;
        all.push({ ...r, ...(p && { produto: p }) } as AnpPricesSerieRow & { produto: string });
      }
    }
  }
  return all;
}

/**
 * Fetch raw rows for the Retail (LPC) sheet of /anp-prices Excel export.
 * Backend RPC (owner worker_supabase): `get_anp_prices_export_retail`.
 */
export async function rpcGetAnpPricesExportRetail(
  supabase: SupabaseClient,
  filters: AnpPricesExportCountFilters,
): Promise<AnpPricesSerieRow[]> {
  const produtos = filters.produtos && filters.produtos.length > 0
    ? filters.produtos
    : ["Gasoline", "Diesel", "Ethanol", "LPG"];
  const grans = filters.granularidades && filters.granularidades.length > 0
    ? filters.granularidades
    : ["brasil", "regiao", "uf", "municipio"];
  const all: AnpPricesSerieRow[] = [];
  for (const p of produtos) {
    for (const g of grans) {
      const rows = await rpcGetAnpPricesSerie(supabase, {
        produto:       p,
        granularidade: g,
        locais:        filters.locais ?? null,
        dataInicio:    filters.dataInicio ?? null,
        dataFim:       filters.dataFim ?? null,
      });
      for (const r of rows) {
        if (r.fonte !== "retail") continue;
        all.push({ ...r, ...(p && { produto: p }) } as AnpPricesSerieRow & { produto: string });
      }
    }
  }
  return all;
}

/**
 * Async-options loader for the Product multi-select in the export modal.
 * Returns the 5 unified product names. Wrapped in a Promise so the modal can
 * treat it uniformly with future RPC-backed loaders.
 */
export async function loadAnpPricesProductOptions(): Promise<
  { value: string; label: string }[]
> {
  return [
    { value: "Gasoline",  label: "Gasoline"  },
    { value: "Diesel",    label: "Diesel"    },
    { value: "Ethanol",   label: "Ethanol"   },
    { value: "Biodiesel", label: "Biodiesel" },
    { value: "LPG",       label: "LPG"       },
  ];
}

/**
 * Async-options loader for the UF multi-select in the export modal. Reads
 * from the universe RPC so additions/removals on the backend are picked up
 * automatically.
 */
export function makeAnpPricesUfOptionsLoader(supabase: SupabaseClient) {
  return async function loadAnpPricesUfOptions() {
    const f = await rpcGetAnpPricesFiltros(supabase);
    return f.ufs.map((uf) => ({ value: uf, label: uf }));
  };
}

/**
 * Async-options loader for the Region multi-select in the export modal.
 */
export function makeAnpPricesRegionOptionsLoader(supabase: SupabaseClient) {
  return async function loadAnpPricesRegionOptions() {
    const f = await rpcGetAnpPricesFiltros(supabase);
    return f.regioes.map((r) => ({ value: r, label: r }));
  };
}

// ─── MODULE: ANP GLP — LPG Market Share (get_anp_glp_ms_*) ───────────────────
//
// Phase-2 RPC surface for the rebuilt /anp-glp dashboard (LPG Market Share),
// a faithful clone of /market-share over the anp_glp table. These wrappers
// mirror the rpcGetMs* family so useAnpGlpData can reuse the
// useMarketShareData hook shape. The returned column NAMES are identical to
// MsSerieRow (date / nome_produto / segmento / classificacao /
// [agente_regulado] / quantidade) — see
// supabase/migrations/20260605000000_anp_glp_market_share_rpcs.sql.
//
// Domain mapping (decided by CTO):
//   classificacao  → distribuidora (LPG player)
//   nome_produto   → categoria (P13 / Outros - GLP / Outros - Especiais)
//   segmento       → constant 'GLP'
//   quantidade     → vendas_kg RAW (client divides by 1e6 → thousand tons)

/** Filters accepted by the LPG market-share series RPCs (no geo dimension). */
export type AnpGlpMsFilters = {
  distribuidoras?: string[] | null;
  categorias?: string[] | null;
  anoInicio?: number | null;
  anoFim?: number | null;
};

/** Options for the LPG market-share filters (distributors / categories / year bounds). */
export type AnpGlpMsFiltros = {
  distribuidoras: string[];
  categorias: string[];
  ano_min: number | null;
  ano_max: number | null;
};

/** Analogue of rpcGetMsOpcoesFiltros — distributors, categories, year bounds. */
export async function rpcGetAnpGlpMsFiltros(
  supabase: SupabaseClient,
): Promise<AnpGlpMsFiltros> {
  try {
    const { data, error } = await supabase.rpc("get_anp_glp_ms_filtros", {});
    if (error) throw error;
    const d = (data ?? {}) as Partial<AnpGlpMsFiltros>;
    return {
      distribuidoras: d.distribuidoras ?? [],
      categorias:     d.categorias     ?? [],
      ano_min:        d.ano_min        ?? null,
      ano_max:        d.ano_max        ?? null,
    };
  } catch (e) {
    console.error("get_anp_glp_ms_filtros failed", e);
    return { distribuidoras: [], categorias: [], ano_min: null, ano_max: null };
  }
}

/** Analogue of rpcGetMsSerieFast — monthly LPG series by (date, distribuidora, categoria). */
export async function rpcGetAnpGlpMsSerieFast(
  supabase: SupabaseClient,
  filters: AnpGlpMsFilters,
): Promise<MsSerieRow[]> {
  const PAGE = 1000;
  let offset = 0;
  const allRows: MsSerieRow[] = [];
  const params = {
    p_distribuidoras: toListOrNull(filters.distribuidoras),
    p_categorias:     toListOrNull(filters.categorias),
    p_ano_inicio:     filters.anoInicio ?? null,
    p_ano_fim:        filters.anoFim    ?? null,
  };
  while (true) {
    const { data, error } = await supabase
      .rpc("get_anp_glp_ms_serie_fast", params)
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as MsSerieRow[];
    if (!rows.length) break;
    allRows.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return allRows;
}

/** Analogue of rpcGetMsSerieOthers — distributors OUTSIDE the excluded (top-N) set. */
export async function rpcGetAnpGlpMsSerieOthers(
  supabase: SupabaseClient,
  filters: AnpGlpMsFilters & { excluirDistribuidoras?: string[] | null },
): Promise<MsSerieRow[]> {
  const PAGE = 1000;
  let offset = 0;
  const allRows: MsSerieRow[] = [];
  const params = {
    p_distribuidoras:         toListOrNull(filters.distribuidoras),
    p_categorias:             toListOrNull(filters.categorias),
    p_ano_inicio:             filters.anoInicio ?? null,
    p_ano_fim:                filters.anoFim    ?? null,
    p_excluir_distribuidoras: toListOrNull(filters.excluirDistribuidoras),
  };
  while (true) {
    const { data, error } = await supabase
      .rpc("get_anp_glp_ms_serie_others", params)
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as MsSerieRow[];
    if (!rows.length) break;
    allRows.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return allRows;
}

/** Analogue of rpcGetOthersPlayers — full distributor list ranked by LPG volume DESC. */
export async function rpcGetAnpGlpMsOthersPlayers(
  supabase: SupabaseClient,
): Promise<{ distribuidora: string; total_kg: number }[]> {
  try {
    const { data, error } = await supabase.rpc("get_anp_glp_ms_others_players", {});
    if (error) throw error;
    return ((data ?? []) as { distribuidora: string; total_kg: number }[]);
  } catch (e) {
    console.error("get_anp_glp_ms_others_players failed", e);
    return [];
  }
}

/** Analogue of getMsExportCount — LPG export size calculator. */
export async function getAnpGlpMsExportCount(
  supabase: SupabaseClient,
  filters: AnpGlpMsFilters,
): Promise<number> {
  const { data, error } = await supabase.rpc("get_anp_glp_ms_export_count", {
    p_distribuidoras: toListOrNull(filters.distribuidoras),
    p_categorias:     toListOrNull(filters.categorias),
    p_ano_inicio:     filters.anoInicio ?? null,
    p_ano_fim:        filters.anoFim    ?? null,
  });
  if (error) {
    console.error("get_anp_glp_ms_export_count failed", error);
    throw error;
  }
  return Number(data ?? 0);
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

// canonical-aware variant for /well-by-well drill-down — passes
// `p_expand_canonical: true` so the server expands every input campo via
// `canonical_field_name()` (Round 4 grouping; migration 20260530000000).
// Existing /anp-cdp-bsw call sites continue to use the strict variant above.
export async function rpcGetAnpCdpBswScatterCanonical(
  supabase: SupabaseClient,
  campos: string[],
): Promise<AnpCdpBswPoint[]> {
  if (!campos || campos.length === 0) return [];
  try {
    const { data, error } = await supabase
      .rpc("get_anp_cdp_bsw_scatter", {
        p_campos: campos,
        p_expand_canonical: true,
      })
      .limit(500000);
    if (error) throw error;
    return (data ?? []) as AnpCdpBswPoint[];
  } catch (e) {
    console.error("get_anp_cdp_bsw_scatter (canonical) failed", e);
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

// canonical-aware variant for /well-by-well drill-down — see comment above on
// `rpcGetAnpCdpBswScatterCanonical`.
export async function rpcGetAnpCdpBswFieldAggregateCanonical(
  supabase: SupabaseClient,
  campos: string[],
): Promise<AnpCdpBswFieldPoint[]> {
  if (!campos || campos.length === 0) return [];
  try {
    const { data, error } = await supabase.rpc("get_anp_cdp_bsw_field_aggregate", {
      p_campos: campos,
      p_expand_canonical: true,
    });
    if (error) throw error;
    return ((data as unknown) ?? []) as AnpCdpBswFieldPoint[];
  } catch (e) {
    console.error("get_anp_cdp_bsw_field_aggregate (canonical) failed", e);
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

// canonical-aware variant for /well-by-well drill-down — see comment above on
// `rpcGetAnpCdpBswScatterCanonical`.
export async function rpcGetAnpCdpDepletionScatterCanonical(
  supabase: SupabaseClient,
  campos: string[],
): Promise<AnpCdpDepletionPoint[]> {
  if (!campos || campos.length === 0) return [];
  try {
    const { data, error } = await supabase
      .rpc("get_anp_cdp_depletion_scatter", {
        p_campos: campos,
        p_expand_canonical: true,
      })
      .limit(500000);
    if (error) throw error;
    return (data ?? []) as AnpCdpDepletionPoint[];
  } catch (e) {
    console.error("get_anp_cdp_depletion_scatter (canonical) failed", e);
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

// canonical-aware variant for /well-by-well drill-down — see comment above on
// `rpcGetAnpCdpBswScatterCanonical`.
export async function rpcGetAnpCdpDepletionFieldAggregateCanonical(
  supabase: SupabaseClient,
  campos: string[],
): Promise<AnpCdpDepletionFieldPoint[]> {
  if (!campos || campos.length === 0) return [];
  try {
    const { data, error } = await supabase.rpc("get_anp_cdp_depletion_field_aggregate", {
      p_campos: campos,
      p_expand_canonical: true,
    });
    if (error) throw error;
    return ((data as unknown) ?? []) as AnpCdpDepletionFieldPoint[];
  } catch (e) {
    console.error("get_anp_cdp_depletion_field_aggregate (canonical) failed", e);
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
  data_min: string | null;
  data_max: string | null;
};

export async function rpcGetAnpCdpDiariaFiltros(
  supabase: SupabaseClient,
): Promise<AnpCdpDiariaFiltros> {
  // Backend RPC still returns `bacias[]` (and accepts `p_bacias`), but the
  // frontend no longer exposes a Basin filter — we drop the field from the
  // typed response to keep callers narrow.
  try {
    const { data, error } = await supabase.rpc("get_anp_cdp_diaria_filtros");
    if (error) throw error;
    const d = (data ?? {}) as Partial<AnpCdpDiariaFiltros>;
    return {
      campos:   d.campos   ?? [],
      data_min: d.data_min ?? null,
      data_max: d.data_max ?? null,
    };
  } catch (e) {
    console.error("get_anp_cdp_diaria_filtros failed", e);
    return { campos: [], data_min: null, data_max: null };
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
    dataInicio?: string | null;
    dataFim?: string | null;
  },
): Promise<AnpCdpDiariaPonto[]> {
  // Daily granularity × ~94 campos × ~8 bacias × ~365 days ≈ tens of thousands
  // of rows for full-history requests. Page through PostgREST 1000-row windows
  // to avoid silent truncation when no filters are set.
  // `p_bacias` is intentionally pinned to NULL — the Basin filter was removed
  // from the UI; the backend signature still accepts the param.
  const PAGE = 1000;
  let offset = 0;
  const allRows: AnpCdpDiariaPonto[] = [];
  const rpcParams = {
    p_campos:      params?.campos     ?? null,
    p_bacias:      null,
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
  pocos: string[];
  data_min: string | null;
  data_max: string | null;
};

export async function rpcGetAnpCdpDiariaPocoFiltros(
  supabase: SupabaseClient,
): Promise<AnpCdpDiariaPocoFiltros> {
  // Backend RPC still returns `bacias[]`, but the Basin filter was removed
  // from the UI; we drop the field from the typed response.
  try {
    const { data, error } = await supabase.rpc("get_anp_cdp_diaria_poco_filtros");
    if (error) throw error;
    const d = (data ?? {}) as Partial<AnpCdpDiariaPocoFiltros>;
    return {
      campos:   d.campos   ?? [],
      pocos:    d.pocos    ?? [],
      data_min: d.data_min ?? null,
      data_max: d.data_max ?? null,
    };
  } catch (e) {
    console.error("get_anp_cdp_diaria_poco_filtros failed", e);
    return { campos: [], pocos: [], data_min: null, data_max: null };
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
    pocos?: string[] | null;
    dataInicio?: string | null;
    dataFim?: string | null;
  },
): Promise<AnpCdpDiariaPocoPonto[]> {
  // Deepest level — many more rows per (campo, day). Paginate aggressively.
  // `p_bacias` is intentionally pinned to NULL — the Basin filter was removed
  // from the UI; the backend signature still accepts the param.
  const PAGE = 1000;
  let offset = 0;
  const allRows: AnpCdpDiariaPocoPonto[] = [];
  const rpcParams = {
    p_campos:      params?.campos     ?? null,
    p_bacias:      null,
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

// ─── MODULE: ANP CDP Diária — Company level (stake-weighted net) ─────────────
//
// Daily NET production for an operator (company), computed as
// field daily production × the company's EFFECTIVE stake (stake_pct/100) in
// that field. Joins the Power BI daily feed (`anp_cdp_diaria`) with the
// admin-curated `field_stakes` table. Backed by migration 20260609000000:
//   • get_anp_cdp_diaria_empresas()              → selector population
//   • get_anp_cdp_diaria_empresa_serie(p_empresa, p_data_inicio, p_data_fim)
//   • get_anp_cdp_diaria_empresa_campos(p_empresa) → stake coverage
// All three are SECURITY DEFINER + anon-safe.
//
// Since migration 20260618000000 `stake_pct` is a per-month BLENDED effective
// stake (production-weighted blend of the field's contract tranches, sourced
// from mv_production_monthly with carry-forward for months the monthly CDP
// hasn't published yet) — e.g. BÚZIOS ≈ 88.9 instead of the raw 100% ToR row.
// It VARIES BY MONTH for blended fields, so frontend labels/series keys must
// never embed the per-row stake (see latestStakeByCampo in
// useAnpCdpDiariaData.ts). Blended fields emit exactly 1 row per (data,
// campo); only the no-blend fallback may still emit per-stake-group rows.
//
// ⚠️ numeric columns (`stake_pct`, `*_net`) arrive as STRINGS from supabase-js;
// the wrappers coerce them via Number() so callers always get clean numbers.

/** One company in the selector. `petroleo_bbl_dia` etc. not present here. */
export type AnpCdpDiariaEmpresa = {
  empresa: string;
  n_campos_com_dado: number;  // fields with daily data
  n_campos_stake: number;     // total fields the company holds a stake in
};

export async function rpcGetAnpCdpDiariaEmpresas(
  supabase: SupabaseClient,
): Promise<AnpCdpDiariaEmpresa[]> {
  try {
    const { data, error } = await supabase.rpc("get_anp_cdp_diaria_empresas");
    if (error) throw error;
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      empresa:           String(r.empresa ?? ""),
      n_campos_com_dado: Number(r.n_campos_com_dado ?? 0),
      n_campos_stake:    Number(r.n_campos_stake ?? 0),
    }));
  } catch (e) {
    console.error("get_anp_cdp_diaria_empresas failed", e);
    return [];
  }
}

/**
 * One row per (data, campo) for the chosen company. `petroleo_bbl_dia` /
 * `gas_mm3_dia` are the field's GROSS daily production; `*_net` are already
 * multiplied by the company's stake. `stake_pct` is the EFFECTIVE blended
 * stake for the row's month (contract-tranche blend, 20260618000000) — it may
 * differ across months for the same field.
 */
export type AnpCdpDiariaEmpresaSeriePonto = {
  data: string;
  campo: string;
  bacia: string | null;
  stake_pct: number;
  petroleo_bbl_dia: number | null;      // gross (kept for reference)
  gas_mm3_dia: number | null;           // gross (kept for reference)
  petroleo_bbl_dia_net: number | null;  // gross × stake/100
  gas_mm3_dia_net: number | null;       // gross × stake/100
};

export async function rpcGetAnpCdpDiariaEmpresaSerie(
  supabase: SupabaseClient,
  empresa: string,
  params?: {
    dataInicio?: string | null;
    dataFim?: string | null;
  },
): Promise<AnpCdpDiariaEmpresaSeriePonto[]> {
  // INNER JOIN on the SQL side — only fields with daily data come back. A
  // single company spans a handful of fields × ~daily cadence, so this is
  // small; no pagination needed, but page defensively anyway.
  const PAGE = 1000;
  let offset = 0;
  const allRows: AnpCdpDiariaEmpresaSeriePonto[] = [];
  const rpcParams = {
    p_empresa:     empresa,
    p_data_inicio: params?.dataInicio ?? null,
    p_data_fim:    params?.dataFim    ?? null,
  };
  const toNum = (v: unknown): number | null => {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  while (true) {
    const { data, error } = await supabase
      .rpc("get_anp_cdp_diaria_empresa_serie", rpcParams)
      .range(offset, offset + PAGE - 1);
    if (error) { console.error("get_anp_cdp_diaria_empresa_serie failed", error); break; }
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    if (!rows.length) break;
    for (const r of rows) {
      allRows.push({
        data:                 String(r.data ?? ""),
        campo:                String(r.campo ?? ""),
        bacia:                r.bacia == null ? null : String(r.bacia),
        stake_pct:            Number(r.stake_pct ?? 0),
        petroleo_bbl_dia:     toNum(r.petroleo_bbl_dia),
        gas_mm3_dia:          toNum(r.gas_mm3_dia),
        petroleo_bbl_dia_net: toNum(r.petroleo_bbl_dia_net),
        gas_mm3_dia_net:      toNum(r.gas_mm3_dia_net),
      });
    }
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return allRows;
}

/**
 * Stake coverage for the chosen company. `has_daily_data=false` fields are
 * the ones in the company's portfolio that are NOT yet in the daily feed
 * (e.g. Wahoo for PRIO, onshore Petrobras fields, FPSOs without daily reporting).
 * `stake_pct` is the field's LATEST available monthly blend (raw stake when no
 * blend exists) — consistent with the serie labels (20260618000000).
 */
export type AnpCdpDiariaEmpresaCampo = {
  campo: string;
  stake_pct: number;
  has_daily_data: boolean;
};

export async function rpcGetAnpCdpDiariaEmpresaCampos(
  supabase: SupabaseClient,
  empresa: string,
): Promise<AnpCdpDiariaEmpresaCampo[]> {
  try {
    const { data, error } = await supabase.rpc("get_anp_cdp_diaria_empresa_campos", {
      p_empresa: empresa,
    });
    if (error) throw error;
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      campo:          String(r.campo ?? ""),
      stake_pct:      Number(r.stake_pct ?? 0),
      has_daily_data: Boolean(r.has_daily_data),
    }));
  } catch (e) {
    console.error("get_anp_cdp_diaria_empresa_campos failed", e);
    return [];
  }
}

/**
 * Count helper for /anp-cdp-diaria export modal.
 *
 * Wraps `get_anp_cdp_diaria_export_count(p_nivel, p_filtros)` shipped by
 * worker_supabase for the unified export library. Returns count(*) for the
 * chosen nível ("campo" | "instalacao" | "poco") + the filter payload.
 *
 * Filter payload (jsonb) is forwarded as-is to the SQL function. Convention:
 *   { data_inicio, data_fim, campos, instalacoes, pocos }
 * Any key the SQL function does not recognize is silently ignored, so callers
 * can pass extra UI-state without breaking the RPC.
 */
export async function rpcGetAnpCdpDiariaExportCount(
  nivel: string,
  filtros: Record<string, unknown>,
): Promise<number> {
  const { getSupabaseClient } = await import("./supabaseClient");
  const supabase = getSupabaseClient();
  if (!supabase) return 0;
  try {
    const { data, error } = await supabase.rpc("get_anp_cdp_diaria_export_count", {
      p_nivel:   nivel,
      p_filtros: filtros,
    });
    if (error) {
      console.error("get_anp_cdp_diaria_export_count failed", error);
      return 0;
    }
    return Number(data ?? 0);
  } catch (e) {
    console.error("get_anp_cdp_diaria_export_count failed", e);
    return 0;
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

/** Count for /market-share (vendas table). */
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

// ─── /anp-cdp — unified export library wrappers ──────────────────────────────
//
// Thin wrappers that align the legacy ANP CDP export RPCs with the naming
// scheme of the unified export library (`src/lib/export/`). The legacy
// functions above (`getAnpCdpExportCount`, `fetchAnpCdpRawFiltered`,
// `rpcGetAnpCdpAggregated`) keep their original signatures so the dashboard
// hook continues to compile during the cleanup phase. New consumers (the
// `anpCdpExport` ExportSpec) MUST import the wrappers below.

/**
 * Row count for the Raw export under the given filters. Powers the size
 * estimator in the unified ExportModal (Tier 2).
 *
 * Server-side RPC: `get_anp_cdp_export_count` (returns `bigint`,
 * SECURITY DEFINER, see migration `20260507000003_export_count_rpcs.sql`).
 */
export async function rpcGetAnpCdpExportCount(
  supabase: SupabaseClient,
  filters: AnpCdpExportCountFilters,
): Promise<number> {
  return getAnpCdpExportCount(supabase, filters);
}

/**
 * Raw export rows — 1 row per (poço × mês), 17 columns matching the
 * `anp_cdp_producao` table schema exactly. Used by the "Raw" mode in the
 * unified ExportModal.
 *
 * NOTE: a server-side `get_anp_cdp_raw_export` RPC was named in the export
 * library contract but does NOT currently exist in the database. This wrapper
 * falls back to the paginated `anp_cdp_producao` SELECT path (already proven
 * by `fetchAnpCdpRawFiltered`). When/if worker_supabase ships the dedicated
 * RPC, swap the body here without touching consumers.
 */
export async function rpcGetAnpCdpRawExport(
  supabase: SupabaseClient,
  filters: AnpCdpExportCountFilters,
): Promise<AnpCdpRawRow[]> {
  return fetchAnpCdpRawFiltered(supabase, filters);
}

/**
 * Aggregated export rows — 1 row per distinct combination of the requested
 * `groupBy` dimensions, with NULLs in non-requested dimension columns and
 * SUM of the 5 metric columns. Used by the "Aggregated" mode in the unified
 * ExportModal.
 *
 * Server-side RPC: `get_anp_cdp_aggregated` (paginated, see
 * `rpcGetAnpCdpAggregated`).
 */
export async function rpcGetAnpCdpAggregatedExport(
  supabase: SupabaseClient,
  filters: AnpCdpExportCountFilters,
  groupBy: AnpCdpGroupBy[],
): Promise<AnpCdpAggregatedRow[]> {
  return rpcGetAnpCdpAggregated(supabase, filters, groupBy);
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

// Hourly bucket aggregation of page_view events for the "Views over time"
// section of /admin-analytics. RPC returns one row per non-empty hour over
// the requested window; the UI passes a `bar` trace through Plotly to
// communicate discrete hourly buckets (rather than a continuous line).
//
// Admin-only server-side (RAISE EXCEPTION on non-Admin callers). Same
// try/catch contract as the other Admin Analytics wrappers — non-Admin or
// missing RPC degrades silently to []. The page renders an empty state.
export type AnalyticsViewsByHourPoint = {
  // ISO string of a BRT wall-clock hour bucket. Migration 20260602200000
  // returns `timestamp without time zone` (no TZ suffix); the RPC wrapper
  // appends "Z" so JS treats it as literal UTC. Plotly's UTC tickformatter
  // then renders the BRT hour as-is. See /admin-analytics page.tsx for
  // the full timezone reasoning, or §10 of docs/app/admin-analytics.md.
  hour_bucket: string;
  event_count: number;
};

export async function rpcGetAdminAnalyticsViewsByHour(
  supabase: SupabaseClient,
  periodDays = 30,
): Promise<AnalyticsViewsByHourPoint[]> {
  try {
    const { data, error } = await supabase.rpc(
      "get_admin_analytics_views_by_hour",
      { p_period_days: periodDays },
    );
    if (error) throw error;
    return ((data ?? []) as AnalyticsViewsByHourPoint[]).map((r) => {
      // Server returns a BRT wall-clock `timestamp` without TZ suffix
      // (migration 20260602200000). To make JS parse it as literal UTC —
      // matching Plotly's default UTC tickformatter — we append "Z".
      // The double interpretation cancels: server BRT wall clock + JS UTC
      // parse + Plotly UTC render = display BRT wall clock as-is.
      const raw = String(r.hour_bucket ?? "");
      const isoUtc = raw && !raw.endsWith("Z") && !/[+-]\d\d:?\d\d$/.test(raw)
        ? `${raw}Z`
        : raw;
      return {
        hour_bucket: isoUtc,
        event_count: Number(r.event_count ?? 0),
      };
    });
  } catch (e) {
    console.warn("get_admin_analytics_views_by_hour failed", e);
    return [];
  }
}

// ============================================================
// MODULE: Subsidy Tracker (/src/app/(dashboard)/subsidy-tracker/page.tsx)
// ============================================================
//
// Tracks the federal diesel subsidy impact across two ANP agent types
// (`importador`, `produtor`). For each agent the RPC returns:
//   - anp_reference_<agent>        — daily regional average of the scraped
//                                    reference price (`anp_subsidy_diesel_reference`)
//   - anp_commercialization_<agent>— period-fixed commercialization price
//                                    scraped from the ANP HTML page
//                                    (`anp_subsidy_commercialization`),
//                                    averaged across the 5 regions
//   - regions_<agent>              — { NORTE, NORDESTE, ... } reference
//                                    breakdown for the hover tooltip
//
// Adjustments (server-side, via `compute_subsidy_reimbursement(date, agent)`):
//   - ipp_adjusted        = ipp − reimbursement_importador  (cap 1.52 from 2026-04-07)
//   - petrobras_adjusted  = petrobras + reimbursement_produtor (cap 1.12 from 2026-04-07)
//
// Cap-aware reimbursements (returned directly by the RPC — do NOT recompute client-side):
//   - reimb_importador    = compute_subsidy_reimbursement(date, 'importador')
//                           = AVG over 5 regions of MIN(MAX(ref − comm, 0), cap)
//                           cap: 0.32 before 2026-04-07; 1.52 from 2026-04-07.
//                           NULL outside the subsidy period.
//   - reimb_produtor      = compute_subsidy_reimbursement(date, 'produtor')
//                           cap: 0.32 before 2026-04-07; 1.12 from 2026-04-07.
//                           NULL outside the subsidy period.
//
// ⚠️  The frontend MUST NOT recompute reimbursements as `ref − comm`.
//     That formula skips the per-region cap and inflates values above the ceiling
//     (e.g., `ref − comm` may yield 1.56 when the cap is 1.52).
//
// Caps are managed in `anp_subsidy_caps` (PK `(vigente_desde, tipo_agente)`).
// The legacy `anp_subsidy_history` table was DROPPED by the 2026-05-27 reform.
// See `supabase/migrations/20260527200000_subsidy_reform.sql`.

export type SubsidyTrackerRow = {
  date: string;                                        // YYYY-MM-DD
  ipp: number | null;                                  // BBA import parity, Diesel (raw)
  ipp_adjusted: number | null;                         // ipp − reimbursement_importador (server-side)
  petrobras: number | null;                            // Petrobras price, Diesel (raw)
  petrobras_adjusted: number | null;                   // petrobras + reimbursement_produtor (server-side)
  anp_reference_importador: number | null;             // daily avg across 5 regions (importador)
  anp_reference_produtor: number | null;               // daily avg across 5 regions (produtor)
  anp_commercialization_importador: number | null;     // period-fixed avg (importador) — scraped from HTML
  anp_commercialization_produtor: number | null;       // period-fixed avg (produtor)   — scraped from HTML
  regions_importador: Record<string, number> | null;   // { NORTE, NORDESTE, ... } reference (importador)
  regions_produtor: Record<string, number> | null;     // { NORTE, NORDESTE, ... } reference (produtor)
  reimb_importador: number | null;                     // cap-aware reimbursement (importador) — NULL outside subsidy period
  reimb_produtor: number | null;                       // cap-aware reimbursement (produtor)   — NULL outside subsidy period
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
// All RPCs — SECURITY DEFINER, STABLE, granted to anon + authenticated.
// Sources:
//   • migration 20260525000010 (base set)
//   • migration 20260525000110 (exports by destination country)
//   • migration 20260526300000 (unit price by country)
//   • migration 20260526800000 (monthly granularity: p_mes_inicio + p_mes_fim
//     added to all 7 RPCs except the 2 YoY tables, which already accept mesFim).
//     Single-month views are supported by passing equal start and end bounds.
//
// Unit contract (never drift label from divisor):
//   Panel A (countries): RPC returns total_m3 (m³) → UI divides by 1000 → "thousand m³"
//   Panel B (importers): RPC returns total_mil_m3 (server-side conversion) → "mil m³"
//   Exports stacked: server returns value already in mil m³ (metric=volume) or raw USD (metric=usd) → UI never divides

export type IEFiltrosResult = {
  ano_min: number;
  mes_min: number;
  ano_max: number;
  mes_max: number;
  produtos: string[];
};

export type IEPaisesStackedRow = {
  ano: number;
  mes: number;
  pais_origem: string;
  // Imports volume in m³ (cubic metres). Server applies per-NCM density
  // (migration 20260608500000 renamed total_kg → total_m3). UI divides by
  // 1000 to display thousand m³.
  total_m3: number;
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
 * Server returns top-N countries by total volume; non-top rows are bucketed as
 * 'Others'. Since migration 20260608500000 the server converts kg → m³ via
 * per-NCM density and returns `total_m3` (cubic metres). UI divides total_m3
 * by 1000 to get thousand m³.
 *
 * Monthly granularity (migration 20260526800000): bounds are inclusive on
 * both ends — single-month view supported by passing equal start and end.
 */
export async function rpcGetImportsExportsPaisesStacked(
  supabase: SupabaseClient,
  unifiedProduct: string,
  anoInicio: number,
  mesInicio: number,
  anoFim: number,
  mesFim: number,
  topN = 10,
): Promise<IEPaisesStackedRow[]> {
  try {
    const { data, error } = await supabase.rpc(
      "get_imports_exports_paises_stacked",
      {
        p_unified_product: unifiedProduct,
        p_ano_inicio: anoInicio,
        p_mes_inicio: mesInicio,
        p_ano_fim: anoFim,
        p_mes_fim: mesFim,
        p_top_n: topN,
      },
    );
    if (error) throw error;
    return ((data ?? []) as IEPaisesStackedRow[]).map((r) => ({
      ano: Number(r.ano),
      mes: Number(r.mes),
      pais_origem: String(r.pais_origem),
      total_m3: Number(r.total_m3 ?? 0),
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
  mesInicio: number,
  anoFim: number,
  mesFim: number,
  topN = 10,
): Promise<IEImportersStackedRow[]> {
  try {
    const { data, error } = await supabase.rpc(
      "get_imports_exports_importers_stacked",
      {
        p_unified_product: unifiedProduct,
        p_ano_inicio: anoInicio,
        p_mes_inicio: mesInicio,
        p_ano_fim: anoFim,
        p_mes_fim: mesFim,
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
 * Stacked area data for the Exports tab — by destination country.
 * Source: mdic_comex (migration 20260525000110_imports_exports_exports_by_country.sql).
 * When metric='volume', server returns value in mil m³ (kg / density / 1000) — DO NOT divide client-side.
 * When metric='usd', server returns raw FOB USD.
 */
export async function rpcGetImportsExportsExportsPaisesStacked(
  supabase: SupabaseClient,
  unifiedProduct: string,
  anoInicio: number,
  mesInicio: number,
  anoFim: number,
  mesFim: number,
  metric: "volume" | "usd" = "volume",
  topN = 10,
): Promise<IEExportsPaisesStackedRow[]> {
  try {
    const { data, error } = await supabase.rpc(
      "get_imports_exports_exports_paises_stacked",
      {
        p_unified_product: unifiedProduct,
        p_ano_inicio: anoInicio,
        p_mes_inicio: mesInicio,
        p_ano_fim: anoFim,
        p_mes_fim: mesFim,
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

// ─── Imports & Exports — Unit price by country ───────────────────────────────

/**
 * Row returned by the two unit-price-by-country RPCs.
 * usd_per_m3 is NULL for (pais, month) combos where volume = 0.
 * vol_m3 is the monthly aggregated volume (m³) for the country — used as the
 * weight denominator when computing a volume-weighted-average USD/m3 for
 * collapsed groups client-side (e.g. the "Others" row of the price summary).
 * UI should map usd_per_m3 NULL → null in Plotly y-array (y=null + connectgaps).
 */
export type IEUnitPriceRow = {
  ano: number;
  mes: number;
  pais: string;
  usd_per_m3: number | null;
  vol_m3: number;
};

/**
 * Monthly USD/m³ by import-origin country.
 * Source: mdic_comex (flow='import'), top-N countries by volume in period.
 *
 * "Gulf of Mexico ≈ United States (proxy)": ANP registers cargo origin as
 * the country of the loading port; US Gulf Coast cargoes appear as
 * pais = 'Estados Unidos'. See sub-PRD § "Unit Price panels — gotchas".
 *
 * Security: SECURITY DEFINER on the RPC (pegadinha #18 in CLAUDE.md).
 */
export async function rpcGetImportsExportsImportsUnitPrice(
  supabase: SupabaseClient,
  unifiedProduct: string,
  anoInicio: number,
  mesInicio: number,
  anoFim: number,
  mesFim: number,
  topN = 8,
): Promise<IEUnitPriceRow[]> {
  try {
    const { data, error } = await supabase.rpc(
      "get_imports_exports_imports_unit_price",
      {
        p_unified_product: unifiedProduct,
        p_ano_inicio: anoInicio,
        p_mes_inicio: mesInicio,
        p_ano_fim: anoFim,
        p_mes_fim: mesFim,
        p_top_n: topN,
      },
    );
    if (error) throw error;
    return ((data ?? []) as IEUnitPriceRow[]).map((r) => ({
      ano: Number(r.ano),
      mes: Number(r.mes),
      pais: String(r.pais),
      usd_per_m3: r.usd_per_m3 != null ? Number(r.usd_per_m3) : null,
      vol_m3: Number(r.vol_m3 ?? 0),
    }));
  } catch (e) {
    console.error("get_imports_exports_imports_unit_price failed", e);
    return [];
  }
}

/**
 * Monthly USD/m³ by export-destination country.
 * Source: mdic_comex (flow='export'), top-N countries by volume in period.
 * Security: SECURITY DEFINER on the RPC (pegadinha #18 in CLAUDE.md).
 */
export async function rpcGetImportsExportsExportsUnitPrice(
  supabase: SupabaseClient,
  unifiedProduct: string,
  anoInicio: number,
  mesInicio: number,
  anoFim: number,
  mesFim: number,
  topN = 8,
): Promise<IEUnitPriceRow[]> {
  try {
    const { data, error } = await supabase.rpc(
      "get_imports_exports_exports_unit_price",
      {
        p_unified_product: unifiedProduct,
        p_ano_inicio: anoInicio,
        p_mes_inicio: mesInicio,
        p_ano_fim: anoFim,
        p_mes_fim: mesFim,
        p_top_n: topN,
      },
    );
    if (error) throw error;
    return ((data ?? []) as IEUnitPriceRow[]).map((r) => ({
      ano: Number(r.ano),
      mes: Number(r.mes),
      pais: String(r.pais),
      usd_per_m3: r.usd_per_m3 != null ? Number(r.usd_per_m3) : null,
      vol_m3: Number(r.vol_m3 ?? 0),
    }));
  } catch (e) {
    console.error("get_imports_exports_exports_unit_price failed", e);
    return [];
  }
}

// ─── Imports & Exports — Unified export library RPCs ─────────────────────────
//
// These wrappers feed `src/lib/export/dashboards/importsExports.ts`. The 3
// RPCs they call are shipped by worker_supabase as part of the export library
// migration wave (see docs/app/export-library-contract.md § "Backend RPCs").
//
// All 3 RPCs:
//   • LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
//   • Granted to anon + authenticated (Pegadinha #18)
//   • Accept a single jsonb param `p_filtros` (mirrors the modal filter state)
//
// Filter contract (p_filtros JSON keys, all optional except `produtos`):
//   • ano_inicio int, mes_inicio int, ano_fim int, mes_fim int — period bounds
//   • produtos text[] — unified products ('Diesel','Gasoline','Crude Oil')
//   • paises text[] | null — origin (imports) or destination (exports) filter

/**
 * Raw rows for the "Imports" sheet of the unified export.
 * One row per (ano, mes, pais_origem, importador, cnpj, ncm_codigo).
 * Joins anp_desembaracos with mdic_comex (valor_usd) and ncm_densidade_kg_m3
 * (volume_m3 + unit_price_usd_ton) — all done server-side.
 */
export async function rpcGetImportsExportsRawImports(
  supabase: SupabaseClient,
  filtros: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  try {
    const { data, error } = await supabase.rpc(
      "get_imports_exports_raw_imports",
      { p_filtros: filtros },
    );
    if (error) throw error;
    return (data ?? []) as Record<string, unknown>[];
  } catch (e) {
    console.error("get_imports_exports_raw_imports failed", e);
    return [];
  }
}

/**
 * Raw rows for the "Exports" sheet of the unified export.
 * One row per (ano, mes, pais_destino, ncm_codigo).
 * Sourced from mdic_comex (flow='export'). MDIC does not carry importer
 * identity, so the Exports sheet has no importador / cnpj / uf_cnpj columns.
 */
export async function rpcGetImportsExportsRawExports(
  supabase: SupabaseClient,
  filtros: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  try {
    const { data, error } = await supabase.rpc(
      "get_imports_exports_raw_exports",
      { p_filtros: filtros },
    );
    if (error) throw error;
    return (data ?? []) as Record<string, unknown>[];
  } catch (e) {
    console.error("get_imports_exports_raw_exports failed", e);
    return [];
  }
}

/**
 * Row counts for the size estimator. Returns 2 rows: imports + exports.
 * Shape: [{ flow: 'imports' | 'exports', n: number }, ...].
 * The export spec's countRpc sums the rows that match the active Flow toggle.
 */
export async function rpcGetImportsExportsExportCount(
  supabase: SupabaseClient,
  filtros: Record<string, unknown>,
): Promise<{ flow: string; n: number }[]> {
  try {
    const { data, error } = await supabase.rpc(
      "get_imports_exports_export_count",
      { p_filtros: filtros },
    );
    if (error) throw error;
    return ((data ?? []) as { flow?: string; n?: number }[]).map((r) => ({
      flow: String(r.flow ?? ""),
      n: Number(r.n ?? 0),
    }));
  } catch (e) {
    console.error("get_imports_exports_export_count failed", e);
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

// ─── MODULE: Admin — Field Stakes ─────────────────────────────────────────────
//
// Admin-only RPCs for managing per-field working-interest data in the
// `field_stakes` table. Each row maps (campo, empresa) → stake_pct; sum per
// campo must equal 100 (enforced by admin_upsert_field_stakes).
//
// Read RPCs (get_*) are SECURITY DEFINER and granted to Admin only.
// Write RPCs (admin_*) additionally check the caller's role server-side.
//
// Source-of-truth migration: `supabase/migrations/20260527600000_field_stakes.sql`
// (owned by worker_supabase). Consumed by /well-by-well dashboard (Fase 2;
// route renamed from /production in Round 4, 2026-05-28).

import type {
  FieldStakeOverview,
  FieldStake,
  FieldStakeEmpresa,
  FieldStakeInput,
} from "../types/fieldStakes";

/**
 * Returns one row per known oil field, with the count of registered
 * stakeholders, the running sum of percentages, completeness flag and a
 * flag indicating whether anp_cdp_producao has matching rows for the campo.
 *
 * Admin-only — backed by SECURITY DEFINER RPC `get_field_stakes_overview`.
 *
 * Postgres `numeric` serializes to string over JSON via PostgREST; we coerce
 * `soma_pct` to a JS number here so downstream `.toFixed()` calls in the UI
 * don't blow up.
 */
export async function rpcGetFieldStakesOverview(
  supabase: SupabaseClient,
): Promise<FieldStakeOverview[]> {
  const { data, error } = await supabase.rpc("get_field_stakes_overview");
  if (error) throw error;
  const rows = (data ?? []) as Array<Omit<FieldStakeOverview, "soma_pct"> & { soma_pct: number | string }>;
  return rows.map((r) => ({
    ...r,
    soma_pct: typeof r.soma_pct === "string" ? Number(r.soma_pct) : r.soma_pct,
  }));
}

/**
 * Lists every (empresa, stake_pct) row registered for a single campo,
 * ordered by stake_pct DESC.
 *
 * Admin-only — backed by SECURITY DEFINER RPC `get_field_stakes`.
 *
 * Coerces `stake_pct` from string to number (numeric → JSON serialization).
 */
export async function rpcGetFieldStakes(
  supabase: SupabaseClient,
  campo: string,
): Promise<FieldStake[]> {
  const { data, error } = await supabase.rpc("get_field_stakes", {
    p_campo: campo,
  });
  if (error) throw error;
  const rows = (data ?? []) as Array<Omit<FieldStake, "stake_pct"> & { stake_pct: number | string }>;
  return rows.map((r) => ({
    ...r,
    stake_pct: typeof r.stake_pct === "string" ? Number(r.stake_pct) : r.stake_pct,
  }));
}

/**
 * Returns the distinct companies known across all fields, with the number of
 * fields in which they hold a stake. Drives the autocomplete `<datalist>` in
 * the editor pane.
 *
 * Admin-only — backed by SECURITY DEFINER RPC `get_field_stakes_empresas`.
 */
export async function rpcGetFieldStakesEmpresas(
  supabase: SupabaseClient,
): Promise<FieldStakeEmpresa[]> {
  const { data, error } = await supabase.rpc("get_field_stakes_empresas");
  if (error) throw error;
  return (data ?? []) as FieldStakeEmpresa[];
}

/**
 * Replace-all upsert: deletes every existing row for `campo` and inserts the
 * provided stakes atomically. Server-side validates that the sum of
 * `stake_pct` equals 100 (within float tolerance) and raises a postgres
 * exception otherwise — the message is surfaced verbatim in the UI banner.
 *
 * Admin-only — backed by SECURITY DEFINER RPC `admin_upsert_field_stakes`.
 *
 * Note: supabase-js serializes the JS array directly as JSONB when the RPC
 * parameter is declared `jsonb`; no manual JSON.stringify is required.
 */
export async function rpcAdminUpsertFieldStakes(
  supabase: SupabaseClient,
  campo: string,
  stakes: FieldStakeInput[],
): Promise<void> {
  const { error } = await supabase.rpc("admin_upsert_field_stakes", {
    p_campo: campo,
    p_stakes: stakes,
  });
  if (error) throw error;
}

/**
 * Removes every stake row associated with `campo`. Used by the "Delete all"
 * action in the editor's footer (gated by a confirm modal in the UI).
 *
 * Admin-only — backed by SECURITY DEFINER RPC `admin_delete_field_stakes`.
 */
export async function rpcAdminDeleteFieldStakes(
  supabase: SupabaseClient,
  campo: string,
): Promise<void> {
  const { error } = await supabase.rpc("admin_delete_field_stakes", {
    p_campo: campo,
  });
  if (error) throw error;
}

// ─── MODULE: Brazil Production Summary (/src/app/(dashboard)/well-by-well/) ──
//
// Executive monthly oil & gas production summary. Replicates the structure of
// the Well-by-Well PDF: Brazil aggregate (3 ambientes), Company aggregate
// stake-weighted, Top fields by company, Installation table, YoY/MoM/YTD
// table.
//
// All 5 RPCs are SECURITY DEFINER (grants: anon + authenticated), they JOIN
// `anp_cdp_producao` × `field_stakes` server-side and silently filter out
// campos whose stakes don't SUM to 100 (the admin-curated incomplete set lives
// in `field_stakes_lacunas` for Eduardo to backfill via the admin UI).
//
// Empresa list comes from `get_field_stakes_empresas()` (Fase 1 RPC) — never
// hardcode company names; new companies in `field_stakes` appear automatically.
//
// Round 4 (2026-05-28): the dashboard route migrated `/production` →
// `/well-by-well` (with 301 redirect) and the field-level RPCs became
// canonical-aware server-side. `get_production_top_fields` now groups by
// `canonical_field_name(p.campo)` and the returned `campo` is the canonical
// label. `get_production_field_timeseries` expects `p_campo` to be the
// canonical label and expands the WHERE clause to all variants under it (so
// Búzios drills sum Búzios + AnC_Búzios + Búzios_ECO). Frontend wrapper
// signatures DID NOT change — server handles everything; the wrappers below
// just pass strings through.
//
// Source-of-truth migration: `supabase/migrations/20260528000000_production_rpcs.sql`
// (Round 1, owned by worker_supabase) +
// `supabase/migrations/20260528300000_well_by_well_round4.sql` (Round 4 —
// route rename in module_visibility + field_canonical_names + canonical-aware
// RPC bodies, owned by worker_supabase).
// ──────────────────────────────────────────────────────────────────────────────

import type {
  ProductionBrazilRow,
  ProductionCompanyRow,
  ProductionTopField,
  ProductionInstallation,
  ProductionYoYRow,
  ProductionFieldTimeseriesRow,
  ProductionInstallationTimeseriesRow,
  WellByWellHeaderRow,
} from "../types/production";

/**
 * Brazil-wide monthly production by ambiente — NOT stake-weighted.
 * Returns ~3 rows per calendar month (one per ambiente) for the period.
 */
export async function rpcGetProductionBrazilAggregate(
  supabase: SupabaseClient,
  dateStart: string,                     // 'YYYY-MM-DD'
  dateEnd: string,                       // 'YYYY-MM-DD'
  ambientes?: string[] | null,
): Promise<ProductionBrazilRow[]> {
  const { data, error } = await supabase.rpc("get_production_brazil_aggregate", {
    p_date_start: dateStart,
    p_date_end:   dateEnd,
    p_ambientes:  toListOrNull(ambientes),
  });
  if (error) {
    console.error("get_production_brazil_aggregate failed", error);
    return [];
  }
  // Postgres `numeric` arrives over the wire as JS number via PostgREST jsonb;
  // coerce defensively to avoid implicit string concatenation downstream.
  const rows = (data ?? []) as Array<
    Omit<ProductionBrazilRow, "oil_bbl_dia" | "gas_mm3_dia" | "water_bbl_dia" | "hours_rate"> & {
      oil_bbl_dia:   number | string;
      gas_mm3_dia:   number | string;
      water_bbl_dia: number | string;
      hours_rate:    number | string;
    }
  >;
  return rows.map((r) => ({
    ano:           Number(r.ano),
    mes:           Number(r.mes),
    ambiente:      r.ambiente,
    oil_bbl_dia:   Number(r.oil_bbl_dia ?? 0),
    gas_mm3_dia:   Number(r.gas_mm3_dia ?? 0),
    water_bbl_dia: Number(r.water_bbl_dia ?? 0),
    hours_rate:    Number(r.hours_rate ?? 0),
  }));
}

/**
 * Company monthly production by ambiente — stake-weighted.
 * Only includes campos where SUM(stake_pct) = 100 across all empresas (silent
 * filter; incomplete fields appear in `field_stakes_lacunas` for Eduardo).
 */
export async function rpcGetProductionCompanyAggregate(
  supabase: SupabaseClient,
  empresa: string,
  dateStart: string,
  dateEnd: string,
  ambientes?: string[] | null,
): Promise<ProductionCompanyRow[]> {
  const { data, error } = await supabase.rpc("get_production_company_aggregate", {
    p_empresa:    empresa,
    p_date_start: dateStart,
    p_date_end:   dateEnd,
    p_ambientes:  toListOrNull(ambientes),
  });
  if (error) {
    console.error("get_production_company_aggregate failed", error);
    return [];
  }
  const rows = (data ?? []) as Array<
    Omit<ProductionCompanyRow, "oil_bbl_dia" | "gas_mm3_dia" | "water_bbl_dia"> & {
      oil_bbl_dia:   number | string;
      gas_mm3_dia:   number | string;
      water_bbl_dia: number | string;
    }
  >;
  return rows.map((r) => ({
    ano:           Number(r.ano),
    mes:           Number(r.mes),
    ambiente:      r.ambiente,
    oil_bbl_dia:   Number(r.oil_bbl_dia ?? 0),
    gas_mm3_dia:   Number(r.gas_mm3_dia ?? 0),
    water_bbl_dia: Number(r.water_bbl_dia ?? 0),
  }));
}

/**
 * Top-N producing fields for one company in one calendar month.
 * Used by the "Top Fields" horizontal bar (oil + water stacked).
 *
 * Round 4 (2026-05-28): the server groups by `canonical_field_name(p.campo)`
 * server-side, so the returned `campo` is the canonical label (e.g. "Búzios"
 * collapses Búzios + AnC_Búzios + Búzios_ECO into one row). The wrapper
 * signature is unchanged; the canonical label flows back into
 * `rpcGetProductionFieldTimeseries` on drill-in to fetch the consolidated
 * timeseries.
 */
export async function rpcGetProductionTopFields(
  supabase: SupabaseClient,
  empresa: string,
  date: string,                          // 'YYYY-MM-DD' — any day in the target month
  topN: number = 10,
): Promise<ProductionTopField[]> {
  const { data, error } = await supabase.rpc("get_production_top_fields", {
    p_empresa: empresa,
    p_date:    date,
    p_top_n:   topN,
  });
  if (error) {
    console.error("get_production_top_fields failed", error);
    return [];
  }
  const rows = (data ?? []) as Array<
    Omit<ProductionTopField, "oil_bbl_dia" | "water_bbl_dia" | "hours_rate" | "stake_pct"> & {
      oil_bbl_dia:   number | string;
      water_bbl_dia: number | string;
      hours_rate:    number | string;
      stake_pct:     number | string;
    }
  >;
  return rows.map((r) => ({
    campo:         r.campo,
    oil_bbl_dia:   Number(r.oil_bbl_dia ?? 0),
    water_bbl_dia: Number(r.water_bbl_dia ?? 0),
    hours_rate:    Number(r.hours_rate ?? 0),
    stake_pct:     Number(r.stake_pct ?? 0),
  }));
}

/**
 * Installation-level production for one company in one calendar month.
 * Returned ordered by oil_bbl_dia DESC server-side.
 */
export async function rpcGetProductionByInstallation(
  supabase: SupabaseClient,
  empresa: string,
  date: string,
): Promise<ProductionInstallation[]> {
  const { data, error } = await supabase.rpc("get_production_by_installation", {
    p_empresa: empresa,
    p_date:    date,
  });
  if (error) {
    console.error("get_production_by_installation failed", error);
    return [];
  }
  const rows = (data ?? []) as Array<
    Omit<ProductionInstallation, "oil_bbl_dia" | "gas_mm3_dia" | "hours_rate"> & {
      oil_bbl_dia: number | string;
      gas_mm3_dia: number | string;
      hours_rate:  number | string;
    }
  >;
  return rows.map((r) => ({
    instalacao:  r.instalacao,
    oil_bbl_dia: Number(r.oil_bbl_dia ?? 0),
    gas_mm3_dia: Number(r.gas_mm3_dia ?? 0),
    hours_rate:  Number(r.hours_rate ?? 0),
  }));
}

/**
 * YoY/MoM/YTD breakdown for one company at one reference month.
 * Returns 1 TOTAL row + up to 3 per-ambiente rows.
 *
 * Server already computes deltas in kbpd; the UI just renders.
 */
export async function rpcGetProductionYoyTable(
  supabase: SupabaseClient,
  empresa: string,
  date: string,
): Promise<ProductionYoYRow[]> {
  const { data, error } = await supabase.rpc("get_production_yoy_table", {
    p_empresa: empresa,
    p_date:    date,
  });
  if (error) {
    console.error("get_production_yoy_table failed", error);
    return [];
  }
  const rows = (data ?? []) as Array<
    Omit<ProductionYoYRow, "current_kbpd" | "prev_month_kbpd" | "prev_year_kbpd" | "ytd_avg_kbpd" | "mom_pct" | "yoy_pct"> & {
      current_kbpd:     number | string;
      prev_month_kbpd:  number | string | null;
      prev_year_kbpd:   number | string | null;
      ytd_avg_kbpd:     number | string | null;
      mom_pct:          number | string | null;
      yoy_pct:          number | string | null;
    }
  >;
  return rows.map((r) => ({
    scope:           r.scope,
    current_kbpd:    Number(r.current_kbpd ?? 0),
    prev_month_kbpd: r.prev_month_kbpd == null ? null : Number(r.prev_month_kbpd),
    prev_year_kbpd:  r.prev_year_kbpd  == null ? null : Number(r.prev_year_kbpd),
    ytd_avg_kbpd:    r.ytd_avg_kbpd    == null ? null : Number(r.ytd_avg_kbpd),
    mom_pct:         r.mom_pct         == null ? null : Number(r.mom_pct),
    yoy_pct:         r.yoy_pct         == null ? null : Number(r.yoy_pct),
  }));
}

/**
 * Stake-weighted monthly timeseries for ONE field × ONE company across the
 * given date range. Powers the Field drill-down panel (Round 2, 2026-05-27;
 * canonical-aware since Round 4, 2026-05-28).
 *
 * Returns one row per (year, month) — typically 13 months for the default
 * lookback. The server applies the same stake filter (`SUM(stake_pct) = 100`)
 * as the rest of the Production RPCs, so campos in `field_stakes_lacunas`
 * return zero rows.
 *
 * Round 4 semantics: `campo` is now interpreted as a **canonical field name**.
 * The server expands the WHERE clause to every variant that maps to this
 * canonical (via `field_canonical_names`), so drilling "Búzios" sums Búzios,
 * AnC_Búzios and Búzios_ECO stake-weighted. The wrapper signature is
 * unchanged; pass the value returned by `rpcGetProductionTopFields`.
 *
 * Source-of-truth migrations:
 *   `supabase/migrations/20260528100000_production_round2.sql` (Round 2).
 *   `supabase/migrations/20260528300000_well_by_well_round4.sql` (Round 4 —
 *     canonical expansion).
 */
export async function rpcGetProductionFieldTimeseries(
  supabase: SupabaseClient,
  campo: string,
  empresa: string,
  dateStart: string,                     // 'YYYY-MM-DD'
  dateEnd: string,                       // 'YYYY-MM-DD'
): Promise<ProductionFieldTimeseriesRow[]> {
  const { data, error } = await supabase.rpc("get_production_field_timeseries", {
    p_campo:      campo,
    p_empresa:    empresa,
    p_date_start: dateStart,
    p_date_end:   dateEnd,
  });
  if (error) {
    console.error("get_production_field_timeseries failed", error);
    throw new Error(`get_production_field_timeseries: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{
    ano:           number | string;
    mes:           number | string;
    oil_bbl_dia:   number | string;
    gas_mm3_dia:   number | string;
    water_bbl_dia: number | string;
    hours_rate:    number | string;
  }>;
  return rows.map((r) => ({
    ano:           Number(r.ano),
    mes:           Number(r.mes),
    oil_bbl_dia:   Number(r.oil_bbl_dia ?? 0),
    gas_mm3_dia:   Number(r.gas_mm3_dia ?? 0),
    water_bbl_dia: Number(r.water_bbl_dia ?? 0),
    hours_rate:    Number(r.hours_rate ?? 0),
  }));
}

/**
 * Stake-weighted monthly timeseries for ONE installation (FPSO/UEP/land plant)
 * × ONE company across the given date range. Powers the Installation drill-down
 * panel (Round 3, 2026-05-27).
 *
 * Returns one row per (year, month) — typically 13 months for the default
 * lookback. The server applies the same stake filter (`SUM(stake_pct) = 100`)
 * as the rest of the Production RPCs, so installations whose constituent
 * campos are in `field_stakes_lacunas` return zero rows.
 *
 * Row shape is identical to `get_production_field_timeseries` (see
 * `ProductionInstallationTimeseriesRow`, aliased to
 * `ProductionFieldTimeseriesRow`).
 *
 * Source-of-truth migration:
 *   `supabase/migrations/20260528200000_production_installation_timeseries.sql`
 *   (owned by worker_supabase, Round 3 of Fase 2).
 */
export async function rpcGetProductionInstallationTimeseries(
  supabase: SupabaseClient,
  instalacao: string,
  empresa: string,
  dateStart: string,                     // 'YYYY-MM-DD'
  dateEnd: string,                       // 'YYYY-MM-DD'
): Promise<ProductionInstallationTimeseriesRow[]> {
  const { data, error } = await supabase.rpc("get_production_installation_timeseries", {
    p_instalacao: instalacao,
    p_empresa:    empresa,
    p_date_start: dateStart,
    p_date_end:   dateEnd,
  });
  if (error) {
    console.error("get_production_installation_timeseries failed", error);
    throw new Error(`get_production_installation_timeseries: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{
    ano:           number | string;
    mes:           number | string;
    oil_bbl_dia:   number | string;
    gas_mm3_dia:   number | string;
    water_bbl_dia: number | string;
    hours_rate:    number | string;
  }>;
  return rows.map((r) => ({
    ano:           Number(r.ano),
    mes:           Number(r.mes),
    oil_bbl_dia:   Number(r.oil_bbl_dia ?? 0),
    gas_mm3_dia:   Number(r.gas_mm3_dia ?? 0),
    water_bbl_dia: Number(r.water_bbl_dia ?? 0),
    hours_rate:    Number(r.hours_rate ?? 0),
  }));
}

/**
 * PDF-style Well-by-Well header table (Round 8, 2026-05-27).
 *
 * Returns one row per renderable line of the report's page-2 header table:
 *   • "Brazil" section: oil (kbpd) + gas (kboed) totals + main fields
 *   • "{Empresa}" section: stake-weighted oil (kbpd) + main fields
 *
 * Server-side aggregation; the UI just renders. See `WellByWellHeaderRow`
 * for row-shape contract. Rows arrive pre-ordered via `display_order` but
 * the component re-sorts defensively in case the DB ever reorders.
 *
 * Source-of-truth migration (slot 20260528500000):
 *   `supabase/migrations/20260528500000_well_by_well_header.sql`
 *   (owned by worker_supabase, Round 8 of Fase 2).
 */
export async function rpcGetWellByWellHeader(
  supabase: SupabaseClient,
  empresa: string,
  year: number,
  month: number,
): Promise<WellByWellHeaderRow[]> {
  const { data, error } = await supabase.rpc("get_well_by_well_header", {
    p_empresa: empresa,
    p_year:    year,
    p_month:   month,
  });
  if (error) {
    console.error("get_well_by_well_header failed", error);
    throw new Error(`get_well_by_well_header: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{
    display_order:   number | string;
    section:         string;
    category:        string;
    subcategory:     string | null;
    is_total:        boolean | string | number;
    current_val:     number | string | null;
    prev_month_val:  number | string | null;
    mom_pct:         number | string | null;
    prev_year_val:   number | string | null;
    yoy_pct:         number | string | null;
    ytd_avg:         number | string | null;
  }>;
  return rows.map((r) => ({
    display_order:  Number(r.display_order ?? 0),
    section:        r.section,
    category:       r.category,
    subcategory:    r.subcategory ?? null,
    is_total:       r.is_total === true || r.is_total === "true" || r.is_total === 1,
    current_val:    r.current_val    == null ? null : Number(r.current_val),
    prev_month_val: r.prev_month_val == null ? null : Number(r.prev_month_val),
    mom_pct:        r.mom_pct        == null ? null : Number(r.mom_pct),
    prev_year_val:  r.prev_year_val  == null ? null : Number(r.prev_year_val),
    yoy_pct:        r.yoy_pct        == null ? null : Number(r.yoy_pct),
    ytd_avg:        r.ytd_avg        == null ? null : Number(r.ytd_avg),
  }));
}

// ─── Brazil-wide (100% WI) RPCs — Round 9, 2026-05-27 ─────────────────────────
//
// When the user picks the "Brasil" pill on /well-by-well, the dashboard
// renders Brazil-wide totals (no stake weighting). The Brazil aggregate
// already exists (`get_production_brazil_aggregate`); these four wrappers
// cover the remaining panels (top fields, installations, two timeseries for
// drill-downs) at 100% working interest. Source-of-truth migration:
//   supabase/migrations/20260528600000_well_by_well_brazil_rpcs.sql
//   (owned by worker_supabase, Round 9 of Fase 2).
//
// Return shapes intentionally reuse the empresa types so the View / hook can
// branch on the active pill without duplicating dataclasses. The semantic
// difference is that:
//   - `stake_pct` is irrelevant for Brazil and always returned as 100 (or NULL
//     coerced to 0 — the UI drops the column when in Brazil mode).
//   - All values are SUM() over campos with no stake filter, so they include
//     fields that field_stakes_lacunas would otherwise exclude for empresa
//     views. That's intentional: Brasil view = the country's production, full
//     stop.

/**
 * Top-N producing fields nationwide (Brazil-wide, 100% WI) in one calendar
 * month. Used by the "Top Fields" horizontal bar in Brasil view.
 *
 * Returned `campo` follows the same canonical grouping as
 * `get_production_top_fields` (Round 4) — variants of the same field are
 * rolled up server-side via `canonical_field_name()`. `stake_pct` is returned
 * as 100 for every row (informational only — the Brasil-mode chart doesn't
 * surface it; consumers can ignore the column).
 */
export async function rpcGetProductionBrazilTopFields(
  supabase: SupabaseClient,
  date: string,                          // 'YYYY-MM-DD' — any day in the target month
  topN: number = 10,
): Promise<ProductionTopField[]> {
  const { data, error } = await supabase.rpc("get_production_brazil_top_fields", {
    p_date:  date,
    p_top_n: topN,
  });
  if (error) {
    console.error("get_production_brazil_top_fields failed", error);
    return [];
  }
  const rows = (data ?? []) as Array<
    Omit<ProductionTopField, "oil_bbl_dia" | "water_bbl_dia" | "hours_rate" | "stake_pct"> & {
      oil_bbl_dia:   number | string;
      water_bbl_dia: number | string;
      hours_rate:    number | string;
      stake_pct:     number | string | null;
    }
  >;
  return rows.map((r) => ({
    campo:         r.campo,
    oil_bbl_dia:   Number(r.oil_bbl_dia ?? 0),
    water_bbl_dia: Number(r.water_bbl_dia ?? 0),
    hours_rate:    Number(r.hours_rate ?? 0),
    stake_pct:     Number(r.stake_pct ?? 100),
  }));
}

/**
 * Installation-level production nationwide (Brazil-wide, 100% WI) in one
 * calendar month. Returned ordered by oil_bbl_dia DESC server-side.
 */
export async function rpcGetProductionBrazilInstallation(
  supabase: SupabaseClient,
  date: string,
): Promise<ProductionInstallation[]> {
  const { data, error } = await supabase.rpc("get_production_brazil_installation", {
    p_date: date,
  });
  if (error) {
    console.error("get_production_brazil_installation failed", error);
    return [];
  }
  const rows = (data ?? []) as Array<
    Omit<ProductionInstallation, "oil_bbl_dia" | "gas_mm3_dia" | "hours_rate"> & {
      oil_bbl_dia: number | string;
      gas_mm3_dia: number | string;
      hours_rate:  number | string;
    }
  >;
  return rows.map((r) => ({
    instalacao:  r.instalacao,
    oil_bbl_dia: Number(r.oil_bbl_dia ?? 0),
    gas_mm3_dia: Number(r.gas_mm3_dia ?? 0),
    hours_rate:  Number(r.hours_rate ?? 0),
  }));
}

/**
 * Brazil-wide (100% WI) monthly oil/gas/water/uptime timeseries for ONE
 * canonical field across the given date range. Used by the field drill-down
 * when the dashboard is in Brasil view.
 *
 * Row shape is identical to `get_production_field_timeseries` so the chart
 * builder is shared at the call site. Canonical expansion matches Round 4
 * semantics: the server JOINs against `field_canonical_names` and sums every
 * variant under the given canonical (so drilling "Búzios" in Brasil view sums
 * Búzios + AnC_Búzios + Búzios_ECO at 100% WI).
 */
export async function rpcGetProductionBrazilFieldTimeseries(
  supabase: SupabaseClient,
  campo: string,
  dateStart: string,                     // 'YYYY-MM-DD'
  dateEnd: string,                       // 'YYYY-MM-DD'
): Promise<ProductionFieldTimeseriesRow[]> {
  const { data, error } = await supabase.rpc("get_production_brazil_field_timeseries", {
    p_campo:      campo,
    p_date_start: dateStart,
    p_date_end:   dateEnd,
  });
  if (error) {
    console.error("get_production_brazil_field_timeseries failed", error);
    throw new Error(`get_production_brazil_field_timeseries: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{
    ano:           number | string;
    mes:           number | string;
    oil_bbl_dia:   number | string;
    gas_mm3_dia:   number | string;
    water_bbl_dia: number | string;
    hours_rate:    number | string;
  }>;
  return rows.map((r) => ({
    ano:           Number(r.ano),
    mes:           Number(r.mes),
    oil_bbl_dia:   Number(r.oil_bbl_dia ?? 0),
    gas_mm3_dia:   Number(r.gas_mm3_dia ?? 0),
    water_bbl_dia: Number(r.water_bbl_dia ?? 0),
    hours_rate:    Number(r.hours_rate ?? 0),
  }));
}

/**
 * Brazil-wide (100% WI) monthly oil/gas/water/uptime timeseries for ONE
 * installation (FPSO/UEP/land plant) across the given date range. Used by
 * the installation drill-down when the dashboard is in Brasil view.
 *
 * Row shape is identical to `get_production_installation_timeseries` (and
 * to the field timeseries shape) — the chart builder is shared.
 */
export async function rpcGetProductionBrazilInstallationTimeseries(
  supabase: SupabaseClient,
  instalacao: string,
  dateStart: string,                     // 'YYYY-MM-DD'
  dateEnd: string,                       // 'YYYY-MM-DD'
): Promise<ProductionInstallationTimeseriesRow[]> {
  const { data, error } = await supabase.rpc("get_production_brazil_installation_timeseries", {
    p_instalacao: instalacao,
    p_date_start: dateStart,
    p_date_end:   dateEnd,
  });
  if (error) {
    console.error("get_production_brazil_installation_timeseries failed", error);
    throw new Error(`get_production_brazil_installation_timeseries: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{
    ano:           number | string;
    mes:           number | string;
    oil_bbl_dia:   number | string;
    gas_mm3_dia:   number | string;
    water_bbl_dia: number | string;
    hours_rate:    number | string;
  }>;
  return rows.map((r) => ({
    ano:           Number(r.ano),
    mes:           Number(r.mes),
    oil_bbl_dia:   Number(r.oil_bbl_dia ?? 0),
    gas_mm3_dia:   Number(r.gas_mm3_dia ?? 0),
    water_bbl_dia: Number(r.water_bbl_dia ?? 0),
    hours_rate:    Number(r.hours_rate ?? 0),
  }));
}

// ─── Unified export — well-level full history ─────────────────────────────────
//
// Backing the /well-by-well export tab of the unified export library (Tier 2,
// 5 sheets, filterSource "none"). Each call returns 1 row per (ano, mes,
// campo, poço) over the full history — these RPCs intentionally ignore the
// dashboard's Period / Reference Month filters because the export contract
// says "always full history". For company sheets, values are stake-weighted
// server-side and include `stake_pct` (the working interest the company
// holds in the field at that row's reference period); the Brasil sheet does
// not include `stake_pct` (everything is 100% WI).
//
// Source-of-truth migration (shipped in parallel by worker_supabase):
//   supabase/migrations/* — `get_production_brazil_well_full_history()` and
//   `get_production_well_full_history(p_empresa text)`.
//
// Both RPCs are SECURITY DEFINER (Pegadinha #18). If they ever fail at the
// network layer the wrappers log + return `[]` — the modal SizeEstimator and
// the workbook builder both degrade to "0 rows" rather than crashing.

/**
 * Row shape for the well-level export. Mirrors the columns declared in the
 * ExportSpec at `src/lib/export/dashboards/wellByWell.ts`. The `stake_pct`
 * field is only meaningful on company rows; the Brasil RPC returns null
 * (or omits the column) and the typed wrapper coerces to 100 for safety.
 */
export interface ProductionWellFullHistoryRow {
  ano: number;
  mes: number;
  bacia: string | null;
  estado: string | null;
  ambiente: string | null;
  campo: string | null;
  poco: string | null;
  operador: string | null;
  instalacao: string | null;
  oil_bbl_dia: number;
  gas_mm3_dia: number;
  water_bbl_dia: number;
  uptime_hs_mes: number;
  stake_pct: number;
}

/**
 * Stake-weighted full history at well level for one company, paginated.
 * Returns one row per (ano, mes, campo, poço); values are scaled by the
 * company's stake in the field for that period. Used by the four company
 * sheets of the /well-by-well unified export.
 *
 * Pagination: the underlying RPC takes `p_offset` + `p_limit` to bypass
 * PostgREST's default `max-rows=1000` truncation. Callers loop until a
 * chunk shorter than `limit` arrives. See `fetchAllPagesCompany` in
 * `src/lib/export/dashboards/wellByWell.ts`.
 */
export async function rpcGetProductionWellFullHistory(
  supabase: SupabaseClient,
  empresa: string,
  offset: number = 0,
  limit: number = 5000,
): Promise<ProductionWellFullHistoryRow[]> {
  const { data, error } = await supabase.rpc("get_production_well_full_history", {
    p_empresa: empresa,
    p_offset: offset,
    p_limit: limit,
  });
  if (error) {
    console.error("get_production_well_full_history failed", error);
    return [];
  }
  const rows = (data ?? []) as Array<{
    ano:            number | string;
    mes:            number | string;
    bacia:          string | null;
    estado:         string | null;
    ambiente:       string | null;
    campo:          string | null;
    poco:           string | null;
    operador:       string | null;
    instalacao:     string | null;
    oil_bbl_dia:    number | string | null;
    gas_mm3_dia:    number | string | null;
    water_bbl_dia:  number | string | null;
    uptime_hs_mes:  number | string | null;
    stake_pct:      number | string | null;
  }>;
  return rows.map((r) => ({
    ano:           Number(r.ano),
    mes:           Number(r.mes),
    bacia:         r.bacia ?? null,
    estado:        r.estado ?? null,
    ambiente:      r.ambiente ?? null,
    campo:         r.campo ?? null,
    poco:          r.poco ?? null,
    operador:      r.operador ?? null,
    instalacao:    r.instalacao ?? null,
    oil_bbl_dia:   Number(r.oil_bbl_dia ?? 0),
    gas_mm3_dia:   Number(r.gas_mm3_dia ?? 0),
    water_bbl_dia: Number(r.water_bbl_dia ?? 0),
    uptime_hs_mes: Number(r.uptime_hs_mes ?? 0),
    stake_pct:     Number(r.stake_pct ?? 0),
  }));
}

/**
 * Brazil-wide (100% WI) full history at well level, paginated. Returns one
 * row per (ano, mes, campo, poço) without stake math. Used by the Brasil
 * sheet of the /well-by-well unified export. `stake_pct` always coerces to
 * 100.
 *
 * Pagination: same scheme as `rpcGetProductionWellFullHistory` — `p_offset`
 * + `p_limit` to bypass PostgREST `max-rows=1000` truncation. Callers loop
 * until a chunk shorter than `limit` arrives. See `fetchAllPagesBrasil` in
 * `src/lib/export/dashboards/wellByWell.ts`.
 */
export async function rpcGetProductionBrazilWellFullHistory(
  supabase: SupabaseClient,
  offset: number = 0,
  limit: number = 5000,
): Promise<ProductionWellFullHistoryRow[]> {
  const { data, error } = await supabase.rpc(
    "get_production_brazil_well_full_history",
    { p_offset: offset, p_limit: limit },
  );
  if (error) {
    console.error("get_production_brazil_well_full_history failed", error);
    return [];
  }
  const rows = (data ?? []) as Array<{
    ano:            number | string;
    mes:            number | string;
    bacia:          string | null;
    estado:         string | null;
    ambiente:       string | null;
    campo:          string | null;
    poco:           string | null;
    operador:       string | null;
    instalacao:     string | null;
    oil_bbl_dia:    number | string | null;
    gas_mm3_dia:    number | string | null;
    water_bbl_dia:  number | string | null;
    uptime_hs_mes:  number | string | null;
    stake_pct:      number | string | null;
  }>;
  return rows.map((r) => ({
    ano:           Number(r.ano),
    mes:           Number(r.mes),
    bacia:         r.bacia ?? null,
    estado:        r.estado ?? null,
    ambiente:      r.ambiente ?? null,
    campo:         r.campo ?? null,
    poco:          r.poco ?? null,
    operador:      r.operador ?? null,
    instalacao:    r.instalacao ?? null,
    oil_bbl_dia:   Number(r.oil_bbl_dia ?? 0),
    gas_mm3_dia:   Number(r.gas_mm3_dia ?? 0),
    water_bbl_dia: Number(r.water_bbl_dia ?? 0),
    uptime_hs_mes: Number(r.uptime_hs_mes ?? 0),
    stake_pct:     Number(r.stake_pct ?? 100),
  }));
}

/**
 * Lightweight count of stake-weighted well rows for one company. Used by the
 * `/well-by-well` export modal's size estimator instead of pulling the full
 * dataset just to read `.length` (which was both slow and truncated to 1000
 * by PostgREST). Returns 0 on RPC error so the estimator degrades gracefully.
 */
export async function rpcGetProductionWellCount(
  supabase: SupabaseClient,
  empresa: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("get_production_well_count", {
    p_empresa: empresa,
  });
  if (error) {
    console.error("get_production_well_count failed", error);
    return 0;
  }
  return Number(data) || 0;
}

/**
 * Lightweight count of Brazil-wide (100% WI) well rows. Companion to
 * `rpcGetProductionWellCount`; used by the same size estimator for the
 * Brasil sheet.
 */
export async function rpcGetProductionBrazilWellCount(
  supabase: SupabaseClient,
): Promise<number> {
  const { data, error } = await supabase.rpc(
    "get_production_brazil_well_count",
    {},
  );
  if (error) {
    console.error("get_production_brazil_well_count failed", error);
    return 0;
  }
  return Number(data) || 0;
}

// ─── MODULE: Stock Guide (/src/app/(dashboard)/stock-guide/) ─────────────────
//
// Equities-research comps table + per-company freeform 2D sensitivity grid.
// Public reads are hide-aware (hidden companies' financials never leave the
// server for a non-admin); admin reads/writes are guarded by `is_admin()`
// server-side and additionally GRANTed to `authenticated` only.
//
// SINGLE WRITER of this section is the Stock Guide dashboard owner — the
// /admin-panel pass only CONSUMES the admin wrappers below (no further rpc.ts
// edits for this feature).
//
// Numeric coercion: Postgres `numeric` serializes to a STRING over PostgREST.
// Every numeric field is coerced to `number | null` via `toNumOrNull` so the
// UI's `.toFixed()` / arithmetic don't blow up or silently string-concatenate.
//
// JSONB params (sensitivity grid, comps upsert payload, config) are passed as
// plain JS objects — supabase-js serializes them as JSONB automatically; no
// manual JSON.stringify.
//
// Source-of-truth migration: `supabase/migrations/20260603200000_stock_guide.sql`
// (owner: worker_supabase).
// ──────────────────────────────────────────────────────────────────────────────

import type {
  StockGuideCompany,
  StockGuideAdminCompany,
  SensitivityGrid,
  StockGuideConfig,
  StockGuideDriver,
  SensitivityAxis,
  SensitivityTable,
  SensitivityTableAdmin,
  SensitivityGridBlock,
  SensitivityGridAxis,
  SensitivityGridOutput,
  ScenarioGridPoint,
} from "../types/stockGuide";

/** Coerce a PostgREST numeric (string | number | null | undefined) → number | null. */
function toNumOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Maps a raw comps row (from either `get_stock_guide_comps` or
 * `admin_get_stock_guide_companies`) into a typed `StockGuideCompany`, coercing
 * all numeric fields. `display_order` falls back to 0; everything else nullable.
 */
function mapStockGuideCompany(r: Record<string, unknown>): StockGuideCompany {
  return {
    ticker: String(r.ticker),
    company_name: String(r.company_name ?? ""),
    is_visible: Boolean(r.is_visible),
    display_order: Number(r.display_order ?? 0),
    sector: (r.sector as StockGuideCompany["sector"]) ?? null,
    volume_unit: (r.volume_unit as StockGuideCompany["volume_unit"]) ?? null,
    yahoo_symbol: r.yahoo_symbol != null ? String(r.yahoo_symbol) : null,
    shares_outstanding: toNumOrNull(r.shares_outstanding),
    last_update: r.last_update != null ? String(r.last_update) : null,
    target_price: toNumOrNull(r.target_price),
    recommendation:
      (r.recommendation as StockGuideCompany["recommendation"]) ?? null,
    net_debt_y1: toNumOrNull(r.net_debt_y1),
    net_debt_y2: toNumOrNull(r.net_debt_y2),
    ebitda_y1: toNumOrNull(r.ebitda_y1),
    ebitda_y2: toNumOrNull(r.ebitda_y2),
    net_income_y1: toNumOrNull(r.net_income_y1),
    net_income_y2: toNumOrNull(r.net_income_y2),
    net_income_ex_y1: toNumOrNull(r.net_income_ex_y1),
    net_income_ex_y2: toNumOrNull(r.net_income_ex_y2),
    npv_tax_credit_y1: toNumOrNull(r.npv_tax_credit_y1),
    npv_tax_credit_y2: toNumOrNull(r.npv_tax_credit_y2),
    fcfe_y1: toNumOrNull(r.fcfe_y1),
    fcfe_y2: toNumOrNull(r.fcfe_y2),
    dividends_y1: toNumOrNull(r.dividends_y1),
    dividends_y2: toNumOrNull(r.dividends_y2),
    volumes_y1: toNumOrNull(r.volumes_y1),
    volumes_y2: toNumOrNull(r.volumes_y2),
  };
}

/**
 * Normalizes the raw JSONB grid from `get_stock_guide_sensitivity` /
 * `admin_get_stock_guide_sensitivity` into a `SensitivityGrid`, coercing every
 * cell to `number | null`. Returns null when the payload is empty `{}` (hidden
 * company seen by non-admin, or no grid defined yet) or structurally invalid.
 */
function mapSensitivityGrid(raw: unknown): SensitivityGrid | null {
  if (raw == null || typeof raw !== "object") return null;
  const g = raw as Record<string, unknown>;
  const rowLabels = Array.isArray(g.row_labels) ? (g.row_labels as unknown[]) : [];
  const colLabels = Array.isArray(g.col_labels) ? (g.col_labels as unknown[]) : [];
  // Empty grid (no axes defined) → treat as "no sensitivity" so the UI shows
  // its empty state rather than an axis-less 0×0 matrix.
  if (rowLabels.length === 0 && colLabels.length === 0) return null;
  const rawCells = Array.isArray(g.cells) ? (g.cells as unknown[]) : [];
  const cells: (number | null)[][] = rawCells.map((row) =>
    Array.isArray(row) ? (row as unknown[]).map((c) => toNumOrNull(c)) : [],
  );
  return {
    row_axis_title: String(g.row_axis_title ?? ""),
    col_axis_title: String(g.col_axis_title ?? ""),
    value_label: String(g.value_label ?? ""),
    row_labels: rowLabels.map((l) => String(l)),
    col_labels: colLabels.map((l) => String(l)),
    cells,
  };
}

// ── Public reads (GRANT anon, authenticated) ──────────────────────────────────

/**
 * Hide-aware comps for every company in `display_order`. Visible rows carry
 * full comps + `shares_outstanding` + `yahoo_symbol`; hidden rows seen by a
 * non-admin carry ONLY ticker / company_name / is_visible / display_order
 * (everything else NULL — including yahoo_symbol, so the browser cannot fetch a
 * restricted company's price). Admins receive every field through the same call.
 *
 * Backed by SECURITY DEFINER RPC `get_stock_guide_comps`.
 */
export async function rpcGetStockGuideComps(
  supabase: SupabaseClient,
): Promise<StockGuideCompany[]> {
  const { data, error } = await supabase.rpc("get_stock_guide_comps");
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  return rows.map(mapStockGuideCompany);
}

/**
 * Freeform 2D sensitivity grid for one ticker, returned only when that company
 * is visible OR the caller is_admin (else the RPC yields `{}` → null here).
 * Cells coerced to `number | null`.
 *
 * Backed by SECURITY DEFINER RPC `get_stock_guide_sensitivity`.
 */
export async function rpcGetStockGuideSensitivity(
  supabase: SupabaseClient,
  ticker: string,
): Promise<SensitivityGrid | null> {
  const { data, error } = await supabase.rpc("get_stock_guide_sensitivity", {
    p_ticker: ticker,
  });
  if (error) throw error;
  return mapSensitivityGrid(data);
}

/**
 * Global singleton config: forward-year labels + assumptions note. Always one
 * row.
 *
 * Backed by SECURITY DEFINER RPC `get_stock_guide_config`.
 */
export async function rpcGetStockGuideConfig(
  supabase: SupabaseClient,
): Promise<StockGuideConfig> {
  const { data, error } = await supabase.rpc("get_stock_guide_config");
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as
    | Record<string, unknown>
    | undefined;
  return {
    y1_label: String(row?.y1_label ?? "Y1"),
    y2_label: String(row?.y2_label ?? "Y2"),
    assumptions_note: String(row?.assumptions_note ?? ""),
  };
}

// ── Admin reads (GRANT authenticated; is_admin()-guarded server-side) ─────────

/**
 * Full company list INCLUDING hidden companies' financials + audit columns
 * (`updated_at`, `updated_by`). For the admin editor list only — never call
 * from a non-admin surface (the RPC raises `forbidden` (42501) for non-admins).
 *
 * Backed by SECURITY DEFINER RPC `admin_get_stock_guide_companies`.
 */
export async function rpcAdminGetStockGuideCompanies(
  supabase: SupabaseClient,
): Promise<StockGuideAdminCompany[]> {
  const { data, error } = await supabase.rpc("admin_get_stock_guide_companies");
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  return rows.map((r) => ({
    ...mapStockGuideCompany(r),
    updated_at: r.updated_at != null ? String(r.updated_at) : null,
    updated_by: r.updated_by != null ? String(r.updated_by) : null,
  }));
}

/**
 * Sensitivity grid for one ticker regardless of visibility (admin editor).
 * Returns null when no grid is defined yet.
 *
 * Backed by SECURITY DEFINER RPC `admin_get_stock_guide_sensitivity`.
 */
export async function rpcAdminGetStockGuideSensitivity(
  supabase: SupabaseClient,
  ticker: string,
): Promise<SensitivityGrid | null> {
  const { data, error } = await supabase.rpc("admin_get_stock_guide_sensitivity", {
    p_ticker: ticker,
  });
  if (error) throw error;
  return mapSensitivityGrid(data);
}

// ── Admin writes (GRANT authenticated; is_admin()-guarded server-side) ────────

/**
 * Per-company upsert (`ON CONFLICT (ticker) DO UPDATE`). `data` is a plain JS
 * object whose keys mirror the comps columns: company_name, yahoo_symbol,
 * sector, volume_unit, shares_outstanding, last_update, target_price,
 * recommendation, display_order, and the FUNDAMENTALS — `net_debt_y1/y2`
 * (forward per year), `ebitda_y1/y2`, `net_income_y1/y2`, optional per-year
 * `npv_tax_credit_y1` / `npv_tax_credit_y2` (BRL mn — the SOLE tax-credit
 * mechanism: when EITHER > 0 the comps table renders an extra "{Company} ex-tax
 * credit" companion row whose per-year market-cap basis is the live market cap
 * MINUS that year's NPV; both empty = no companion row), optional per-year
 * `net_income_ex_y1` / `net_income_ex_y2` (ADJUSTED net income BRL mn used as the
 * EX-TAX-CREDIT row's P/E denominator + displayed Net Income when filled; empty =
 * the companion uses the reported `net_income_yN`; the normal row always uses
 * reported), `fcfe_y1/y2`, `dividends_y1/y2`,
 * `volumes_y1/y2`. The 4 price-sensitive multiples (EV/EBITDA, P/E, FCFE Yield,
 * Div Yield) are NOT stored — they are derived live in the dashboard from the
 * Yahoo price + these inputs. Never send `is_visible` (separate toggle RPC).
 * Passed as JSONB; the server coerces numerics and sets `updated_by = auth.uid()`.
 *
 * Backed by SECURITY DEFINER RPC `admin_upsert_stock_guide_company`.
 */
export async function rpcAdminUpsertStockGuideCompany(
  supabase: SupabaseClient,
  ticker: string,
  data: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.rpc("admin_upsert_stock_guide_company", {
    p_ticker: ticker,
    p_data: data,
  });
  if (error) throw error;
}

/**
 * Whole-grid replace for one company. `grid` is a plain JS object of shape
 * `{ row_axis_title, col_axis_title, value_label, row_labels[], col_labels[],
 * cells[][] }`, passed as JSONB. The server validates dimensions
 * (`cells.length === row_labels.length`, each row length === col_labels.length)
 * before writing and raises on mismatch.
 *
 * Backed by SECURITY DEFINER RPC `admin_upsert_stock_guide_sensitivity`.
 */
export async function rpcAdminUpsertStockGuideSensitivity(
  supabase: SupabaseClient,
  ticker: string,
  grid: SensitivityGrid,
): Promise<void> {
  const { error } = await supabase.rpc("admin_upsert_stock_guide_sensitivity", {
    p_ticker: ticker,
    p_grid: grid,
  });
  if (error) throw error;
}

/**
 * Hide/show toggle for one company. Returns the updated row (mapped); callers
 * doing optimistic UI can ignore the return and roll back on throw.
 *
 * Backed by SECURITY DEFINER RPC `admin_set_stock_guide_visibility`.
 */
export async function rpcAdminSetStockGuideVisibility(
  supabase: SupabaseClient,
  ticker: string,
  isVisible: boolean,
): Promise<StockGuideAdminCompany | null> {
  const { data, error } = await supabase.rpc("admin_set_stock_guide_visibility", {
    p_ticker: ticker,
    p_is_visible: isVisible,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return {
    ...mapStockGuideCompany(row),
    updated_at: row.updated_at != null ? String(row.updated_at) : null,
    updated_by: row.updated_by != null ? String(row.updated_by) : null,
  };
}

/**
 * Updates the global singleton config (forward-year labels + assumptions note).
 *
 * Backed by SECURITY DEFINER RPC `admin_upsert_stock_guide_config`.
 */
export async function rpcAdminUpsertStockGuideConfig(
  supabase: SupabaseClient,
  y1Label: string,
  y2Label: string,
  assumptionsNote: string,
): Promise<void> {
  const { error } = await supabase.rpc("admin_upsert_stock_guide_config", {
    p_y1: y1Label,
    p_y2: y2Label,
    p_note: assumptionsNote,
  });
  if (error) throw error;
}

/**
 * Deletes one company (its sensitivity grid cascades via the FK ON DELETE
 * CASCADE). Used by the editor's Delete action behind a confirm modal.
 *
 * Backed by SECURITY DEFINER RPC `admin_delete_stock_guide_company`.
 */
export async function rpcAdminDeleteStockGuideCompany(
  supabase: SupabaseClient,
  ticker: string,
): Promise<void> {
  const { error } = await supabase.rpc("admin_delete_stock_guide_company", {
    p_ticker: ticker,
  });
  if (error) throw error;
}

// ─── Stock Guide — redesigned sensitivity model (drivers + first-class tables) ─
//
// New READ-side wrappers for the redesigned model (migration
// 20260606000000_stock_guide_sensitivity_model.sql, commit 0e1947c6). These
// REPLACE the per-company single-grid wrappers above (which stay defined but
// unused until the cleanup pass).
//
// Numeric coercion: jsonb numbers come back as JS numbers over PostgREST, but to
// be safe against numeric-as-string we recursively coerce every cell of the
// `definition` matrices (and `current_value` / `scenarios`) via `toNumOrNull`.
// JSONB params are passed as plain JS objects (no manual JSON.stringify).

/** Recursively coerce a jsonb matrix value into `(number | null)[][]`. */
function coerceMatrix(raw: unknown): (number | null)[][] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) =>
    Array.isArray(row) ? (row as unknown[]).map((c) => toNumOrNull(c)) : [],
  );
}

/** Coerce a jsonb axis into a typed `SensitivityAxis` (numbers normalized). */
function mapSensitivityAxis(raw: unknown): SensitivityAxis {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kind =
    a.kind === "company" || a.kind === "driver" || a.kind === "year"
      ? (a.kind as SensitivityAxis["kind"])
      : "company";
  const axis: SensitivityAxis = { kind };
  if (a.driver_id != null) {
    const did = toNumOrNull(a.driver_id);
    if (did != null) axis.driver_id = did;
  }
  if (Array.isArray(a.scenarios)) {
    axis.scenarios = (a.scenarios as unknown[])
      .map((s) => toNumOrNull(s))
      .filter((n): n is number => n != null);
  }
  if (Array.isArray(a.companies)) {
    axis.companies = (a.companies as unknown[]).map((c) => String(c));
  }
  if (Array.isArray(a.years)) {
    axis.years = (a.years as unknown[]).map((y) => String(y));
  }
  return axis;
}

const GRID_OUTPUT_MODES = [
  "absolute",
  "yield",
  "pe",
  "ev_ebitda",
  "upside",
] as const;

/**
 * Coerce the SCENARIO-GRID `definition.grid` jsonb into a typed
 * `SensitivityGridBlock`. Returns null when absent / malformed. The block is
 * axis + output METADATA only (no numerics, no company keys) — stored verbatim
 * by the upsert RPC.
 *
 * `axes` must be a 1..3-entry array of `{driver_id?, driver_key?, label, unit,
 * tmin?, tmax?, tstep?}`:
 *   • an axis is meaningful when it has a positive `driver_id` OR a non-empty
 *     `driver_key`; `label`/`unit` are coerced to strings; `tmin`/`tmax`/`tstep`
 *     coerced to numbers (dropped when absent);
 *   • a duplicate binding (same driver_id, or same driver_key) keeps only its
 *     FIRST occurrence;
 *   • more than 3 valid axes → the excess is dropped (keep the first 3);
 *   • zero valid axes → null (the table then falls back to the static matrix).
 *
 * `outputs` is a 1..12-entry array of `{key, mode, label}` (mode ∈ the
 * value-mode enum). A LEGACY single-output block (`output:"target_price"` and no
 * `outputs`) maps to `[{key:'target_price', mode:'upside', label:'Target price'}]`.
 */
function mapGridBlock(raw: unknown): SensitivityGridBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Record<string, unknown>;
  if (!Array.isArray(g.axes)) return null;
  const axes: SensitivityGridAxis[] = [];
  const seenIds = new Set<number>();
  const seenKeys = new Set<string>();
  for (const item of g.axes as unknown[]) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    const driverId = toNumOrNull(a.driver_id);
    const driverKey = a.driver_key != null ? String(a.driver_key).trim() : "";
    // An axis is only meaningful if it binds a driver (by id or by catalog key).
    if ((driverId == null || driverId <= 0) && !driverKey) continue;
    if (driverId != null && driverId > 0) {
      if (seenIds.has(driverId)) continue; // duplicate id → keep the first
      seenIds.add(driverId);
    }
    if (driverKey) {
      if (seenKeys.has(driverKey)) continue; // duplicate key → keep the first
      seenKeys.add(driverKey);
    }
    const axis: SensitivityGridAxis = {
      label: String(a.label ?? ""),
      unit: String(a.unit ?? ""),
    };
    if (driverId != null && driverId > 0) axis.driver_id = driverId;
    if (driverKey) axis.driver_key = driverKey;
    const tmin = toNumOrNull(a.tmin);
    const tmax = toNumOrNull(a.tmax);
    const tstep = toNumOrNull(a.tstep);
    if (tmin != null) axis.tmin = tmin;
    if (tmax != null) axis.tmax = tmax;
    if (tstep != null) axis.tstep = tstep;
    axes.push(axis);
    if (axes.length === 3) break; // cap at 3 axes (x, y, z)
  }
  if (axes.length === 0) return null;

  // Outputs: prefer the multi-output array; fall back to the legacy single `output`.
  const outputs: SensitivityGridOutput[] = [];
  const seenOut = new Set<string>();
  if (Array.isArray(g.outputs)) {
    for (const item of g.outputs as unknown[]) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const key = o.key != null ? String(o.key).trim() : "";
      if (!key || seenOut.has(key)) continue;
      const mode = GRID_OUTPUT_MODES.includes(
        o.mode as (typeof GRID_OUTPUT_MODES)[number],
      )
        ? (o.mode as SensitivityGridOutput["mode"])
        : "upside";
      seenOut.add(key);
      outputs.push({ key, mode, label: String(o.label ?? key) });
      if (outputs.length === 12) break;
    }
  }
  if (outputs.length === 0) {
    const legacyKey = String(g.output ?? "target_price").trim() || "target_price";
    outputs.push({ key: legacyKey, mode: "upside", label: "Target price" });
  }
  return { axes, outputs };
}

const SENSITIVITY_VALUE_MODES = [
  "absolute",
  "yield",
  "pe",
  "ev_ebitda",
  "upside",
] as const;

/** Map one raw sensitivity-table row into a typed `SensitivityTable`. */
function mapSensitivityTable(r: Record<string, unknown>): SensitivityTable {
  const def = (r.definition && typeof r.definition === "object"
    ? r.definition
    : {}) as Record<string, unknown>;
  const mode = SENSITIVITY_VALUE_MODES.includes(
    r.value_mode as (typeof SENSITIVITY_VALUE_MODES)[number],
  )
    ? (r.value_mode as SensitivityTable["value_mode"])
    : "absolute";
  const out: SensitivityTable = {
    id: Number(r.id),
    title: String(r.title ?? ""),
    value_mode: mode,
    metric_label: String(r.metric_label ?? ""),
    unit: String(r.unit ?? ""),
    companies: Array.isArray(r.companies)
      ? (r.companies as unknown[]).map((c) => String(c))
      : [],
    definition: {
      row_axis: mapSensitivityAxis(def.row_axis),
      col_axis: mapSensitivityAxis(def.col_axis),
      cells: coerceMatrix(def.cells),
    },
    display_order: Number(r.display_order ?? 0),
  };
  if (Array.isArray(def.cells_secondary)) {
    out.definition.cells_secondary = coerceMatrix(def.cells_secondary);
  }
  // SCENARIO-GRID block (presence marks the table a multilinear interpolation
  // mesh). Axis + output metadata only — stored verbatim by the upsert RPC.
  const grid = mapGridBlock(def.grid);
  if (grid) out.definition.grid = grid;
  // CONSOLIDATED-PANEL tags (2026-06-11): a single-row static table can be merged
  // into an always-visible block on the dashboard. Pass `panel` through ONLY when
  // it is one of the two known keys (anything else is ignored → the table falls to
  // the generic fallback), and `row_label` through only when it is a non-empty
  // string. The dashboard owns the single-row / company-axis guard.
  if (def.panel === "brent" || def.panel === "margin") {
    out.definition.panel = def.panel;
  }
  if (typeof def.row_label === "string" && def.row_label.trim() !== "") {
    out.definition.row_label = def.row_label;
  }
  return out;
}

// ── Public reads (GRANT anon, authenticated) ──────────────────────────────────

/**
 * Central driver registry (macro/assumption variables — Brent, USD/BRL, …).
 * Not company-sensitive, so returned in full to everyone. `current_value`
 * coerced to `number | null`.
 *
 * Backed by SECURITY DEFINER RPC `get_stock_guide_drivers`.
 */
export async function rpcGetStockGuideDrivers(
  supabase: SupabaseClient,
): Promise<StockGuideDriver[]> {
  const { data, error } = await supabase.rpc("get_stock_guide_drivers");
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name ?? ""),
    unit: String(r.unit ?? ""),
    current_value: toNumOrNull(r.current_value),
    // Dynamic-driver binding to a market-data catalog key (null/'' = static).
    source: r.source != null && r.source !== "" ? String(r.source) : null,
    display_order: Number(r.display_order ?? 0),
  }));
}

/**
 * Hide-aware first-class sensitivity tables, in `display_order`. The RPC has
 * ALREADY stripped restricted companies' axis entries + their matching cell
 * rows/cols server-side and omitted any table with no visible company — the
 * frontend just consumes the result. Every cell coerced to `number | null`.
 *
 * Backed by SECURITY DEFINER RPC `get_stock_guide_sensitivity_tables`.
 */
export async function rpcGetStockGuideSensitivityTables(
  supabase: SupabaseClient,
): Promise<SensitivityTable[]> {
  const { data, error } = await supabase.rpc(
    "get_stock_guide_sensitivity_tables",
  );
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  return rows.map(mapSensitivityTable);
}

/** Page size for the scenario-grid read. */
const SCENARIO_GRID_PAGE = 40_000;

/**
 * The multi-axis, multi-metric scenario-grid mesh for ONE scenario-grid
 * sensitivity table: every `(ticker, metric, x_value, y_value, z_value,
 * primary_value)` point, ordered by ticker then metric then the coordinate axes.
 * `metric` selects which `definition.grid.outputs[]` the point feeds; `x/y/z_value`
 * are the driver levels (one per `definition.grid.axes` entry; an unused axis is
 * always 0); `primary_value` is the metric's value at that mesh node. HIDE-AWARE — a non-admin
 * only receives points for VISIBLE tickers (a restricted company's per-scenario
 * target prices never reach the browser). All four numerics are coerced; any row
 * with a non-finite coordinate or value is dropped so the interpolator never
 * sees `NaN`.
 *
 * **Paginated** — a dense 3-axis × multi-metric × multi-ticker mesh easily
 * exceeds the PostgREST project `max-rows` cap (50,000); a single unpaginated
 * `SETOF` call would silently truncate to the first 50k rows, starving the
 * multilinear interpolator of most of the later tickers/metrics (the mesh is
 * ordered ticker → metric → x → y → z, so truncation drops whole tickers). We
 * therefore page through the RPC with `p_limit` / `p_offset` (page size 40,000,
 * safely under the cap) via the shared cap-safe pager `paginateRpc`
 * (`src/lib/paginateRpc.ts`): it appends the RAW page, advances by the number of
 * rows actually received, and stops only on an EMPTY page — so a final, partial
 * page is followed by exactly one extra (empty) round-trip that ends the loop.
 * This empty-page-stop is correct for ANY server cap, including a cap lower than
 * the client page size (the well-by-well incident); a "short page = done" check
 * would silently truncate in that case. The RPC's
 * `ORDER BY ticker, metric, x_value, y_value, z_value` is deterministic, so the
 * limit/offset windows are stable and non-overlapping.
 *
 * Pagination is driven by the RAW page length (rows returned by the RPC) — the
 * NaN-drop/coercion runs on the accumulated rows AFTER `paginateRpc` returns, so
 * the post-coercion length never influences the loop.
 *
 * Lazy / on-demand: the dashboard calls this only when the user selects a
 * scenario-grid table (and caches by `sensitivityId`).
 *
 * Backed by SECURITY DEFINER RPC
 * `get_stock_guide_scenario_grid(p_sensitivity_id, p_limit, p_offset)`.
 */
export async function rpcGetStockGuideScenarioGrid(
  supabase: SupabaseClient,
  sensitivityId: number,
): Promise<ScenarioGridPoint[]> {
  // Fetch every raw page first (cap-safe empty-page-stop), then coerce/drop.
  const rows = await paginateRpc<Record<string, unknown>>(
    async (limit, offset) => {
      const { data, error } = await supabase.rpc("get_stock_guide_scenario_grid", {
        p_sensitivity_id: sensitivityId,
        p_limit: limit,
        p_offset: offset,
      });
      if (error) throw error;
      return (data ?? []) as Record<string, unknown>[];
    },
    { pageSize: SCENARIO_GRID_PAGE },
  );

  const out: ScenarioGridPoint[] = [];
  for (const r of rows) {
    const x = toNumOrNull(r.x_value);
    const y = toNumOrNull(r.y_value);
    const z = toNumOrNull(r.z_value);
    const v = toNumOrNull(r.primary_value);
    if (x == null || y == null || z == null || v == null) continue;
    // Postgres column DEFAULT 'target_price'; coerce a blank/missing metric to it.
    const metric =
      r.metric != null && String(r.metric).trim()
        ? String(r.metric).trim()
        : "target_price";
    out.push({
      ticker: String(r.ticker),
      metric,
      x_value: x,
      y_value: y,
      z_value: z,
      primary_value: v,
    });
  }
  return out;
}

// ── Admin reads (GRANT authenticated; is_admin()-guarded server-side) ─────────

/**
 * ALL sensitivity tables UNFILTERED (full definition incl. hidden companies) +
 * audit columns (`updated_at`, `updated_by`). For the admin-panel builder only;
 * the RPC raises `forbidden` (42501) for non-admins.
 *
 * Backed by SECURITY DEFINER RPC `admin_get_stock_guide_sensitivity_tables`.
 */
export async function rpcAdminGetStockGuideSensitivityTables(
  supabase: SupabaseClient,
): Promise<SensitivityTableAdmin[]> {
  const { data, error } = await supabase.rpc(
    "admin_get_stock_guide_sensitivity_tables",
  );
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  return rows.map((r) => ({
    ...mapSensitivityTable(r),
    updated_at: r.updated_at != null ? String(r.updated_at) : null,
    updated_by: r.updated_by != null ? String(r.updated_by) : null,
  }));
}

// ── Admin writes (GRANT authenticated; is_admin()-guarded server-side) ────────
// Consumed by the future admin-panel builder pass (drivers CRUD + table builder).

/**
 * Upsert a driver. `id === null` → INSERT, else UPDATE that id. `data` keys:
 * `name` (required), `unit`, `current_value`, `source` (dynamic-driver binding —
 * '' / null = static, else a market-driver catalog key like `'avg_brent_2026'`),
 * `display_order`. For a DYNAMIC driver `current_value` may be null (the value is
 * computed live in the browser). The wrapper is generic — it forwards whatever
 * keys the editor sets, so `source` is passed through untouched. Passed as JSONB;
 * the server coerces numerics and sets `updated_by = auth.uid()`. Returns the
 * driver's id.
 *
 * Backed by SECURITY DEFINER RPC `admin_upsert_stock_guide_driver`.
 */
export async function rpcAdminUpsertStockGuideDriver(
  supabase: SupabaseClient,
  id: number | null,
  data: Record<string, unknown>,
): Promise<number> {
  const { data: out, error } = await supabase.rpc(
    "admin_upsert_stock_guide_driver",
    { p_id: id, p_data: data },
  );
  if (error) throw error;
  return Number(out);
}

/**
 * Delete a driver by id.
 *
 * Backed by SECURITY DEFINER RPC `admin_delete_stock_guide_driver`.
 */
export async function rpcAdminDeleteStockGuideDriver(
  supabase: SupabaseClient,
  id: number,
): Promise<void> {
  const { error } = await supabase.rpc("admin_delete_stock_guide_driver", {
    p_id: id,
  });
  if (error) throw error;
}

/**
 * Upsert a sensitivity table. `id === null` → INSERT, else UPDATE that id.
 * `data` keys: `title` (required), `value_mode`, `metric_label`, `unit`,
 * `companies` (string[] → text[]), `definition` (jsonb: `{ row_axis, col_axis,
 * cells, cells_secondary? }`), `display_order`. Passed as JSONB; the server
 * validates `value_mode`/object shape and sets `updated_by = auth.uid()`.
 * Returns the table's id.
 *
 * `definition` may also carry the optional CONSOLIDATED-PANEL keys
 * `panel` (`"brent" | "margin"`) and `row_label` (string) — when present, the
 * dashboard merges a single-row static table as one row into the matching
 * always-visible block (`mapSensitivityTable` validates them on read; the server
 * stores the `definition` jsonb verbatim). The scenario-grid `grid` block is
 * likewise stored verbatim. These keys are written by the admin Sensitivities
 * editor.
 *
 * Backed by SECURITY DEFINER RPC `admin_upsert_stock_guide_sensitivity_table`.
 */
export async function rpcAdminUpsertStockGuideSensitivityTable(
  supabase: SupabaseClient,
  id: number | null,
  data: Record<string, unknown>,
): Promise<number> {
  const { data: out, error } = await supabase.rpc(
    "admin_upsert_stock_guide_sensitivity_table",
    { p_id: id, p_data: data },
  );
  if (error) throw error;
  return Number(out);
}

/**
 * Delete a sensitivity table by id.
 *
 * Backed by SECURITY DEFINER RPC `admin_delete_stock_guide_sensitivity_table`.
 */
export async function rpcAdminDeleteStockGuideSensitivityTable(
  supabase: SupabaseClient,
  id: number,
): Promise<void> {
  const { error } = await supabase.rpc(
    "admin_delete_stock_guide_sensitivity_table",
    { p_id: id },
  );
  if (error) throw error;
}

/**
 * One row of the scenario-grid mesh upload payload, with the SHORT keys the
 * `admin_replace_stock_guide_scenario_grid` RPC expects (`{ticker, metric, x, y,
 * z, v}`; `v` = primary_value; `y`/`z` are 0 when the axis is unused). Produced
 * by the browser parser in `src/lib/stockGuideGridUpload.ts`.
 */
export interface ScenarioGridUploadRow {
  ticker: string;
  metric: string;
  x: number;
  y: number;
  z: number;
  v: number;
}

/**
 * REPLACE-TOTAL chunked upload of a scenario-grid mesh for one sensitivity table
 * (the in-admin "Upload filled template" path — same DB shape as the service-role
 * Python uploader). `firstChunk === true` makes the RPC DELETE every existing row
 * of `sensitivityId` BEFORE inserting (so the very first chunk wipes the previous
 * snapshot); subsequent chunks append. Every chunk ON CONFLICTs on the 6-col PK
 * (idempotent retry). The RPC validates server-side (non-empty ticker/metric, 4
 * finite numerics, NaN rejected with `22023`) and is `is_admin()`-guarded (`42501`).
 *
 * NOT atomic across chunks — the caller MUST validate the whole workbook
 * client-side BEFORE the first chunk; on a mid-upload failure, re-run the WHOLE
 * upload (firstChunk=true again — idempotent).
 *
 * Backed by SECURITY DEFINER RPC `admin_replace_stock_guide_scenario_grid`.
 * Returns the number of rows written by this chunk.
 */
export async function rpcAdminReplaceStockGuideScenarioGrid(
  supabase: SupabaseClient,
  sensitivityId: number,
  rows: ScenarioGridUploadRow[],
  firstChunk: boolean,
): Promise<number> {
  const { data, error } = await supabase.rpc(
    "admin_replace_stock_guide_scenario_grid",
    {
      p_sensitivity_id: sensitivityId,
      p_rows: rows,
      p_first_chunk: firstChunk,
    },
  );
  if (error) throw error;
  return Number(data ?? 0);
}

/** Post-upload point count for a scenario-grid table, broken down by metric. */
export interface ScenarioGridCount {
  total: number;
  byMetric: Record<string, number>;
}

/**
 * Confirm a scenario-grid upload landed: total point count + a per-metric
 * breakdown. `is_admin()`-guarded. The `by_metric` jsonb arrives as an object of
 * `metric → count`; counts are coerced to `number`.
 *
 * Backed by SECURITY DEFINER RPC `admin_count_stock_guide_scenario_grid`.
 */
export async function rpcAdminCountStockGuideScenarioGrid(
  supabase: SupabaseClient,
  sensitivityId: number,
): Promise<ScenarioGridCount> {
  const { data, error } = await supabase.rpc(
    "admin_count_stock_guide_scenario_grid",
    { p_sensitivity_id: sensitivityId },
  );
  if (error) throw error;
  // RPC RETURNS TABLE(total bigint, by_metric jsonb) → an array with one row.
  const row = (Array.isArray(data) ? data[0] : data) as
    | Record<string, unknown>
    | null
    | undefined;
  const byMetric: Record<string, number> = {};
  const raw = row?.by_metric;
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const n = toNumOrNull(v);
      if (n != null) byMetric[k] = n;
    }
  }
  return { total: toNumOrNull(row?.total) ?? 0, byMetric };
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

// ─── MODULE: Alerts (/src/app/(dashboard)/alerts) ────────────────────────────
//
// Rebuilt logged-in-only email subscription product (Phase 4). The subscriber's
// email is implicit (their auth email). All functions below are SECURITY
// DEFINER and deployed in
// supabase/migrations/20260608100000_alerts_rebuild_new_schema.sql.
//
// Six wrappers — the client/anon surface:
//   list_subscribable_bases   [authenticated]  catalog + the user's flags
//   set_my_subscription       [authenticated]  toggle one base
//   set_my_subscriptions      [authenticated]  bulk toggle (per-category)
//   list_my_subscriptions     [authenticated]  the user's active/paused subs
//   list_my_recent_alerts     [authenticated]  read-only recent feed
//   unsubscribe_by_token      [anon + auth]    email-footer landing page
//
// These wrappers intentionally let RPC errors propagate (no silent try/catch +
// return []), so the dashboard hook can surface failures via DataErrorBoundary
// and optimistic toggles can revert. The legacy double-opt-in wrappers
// (subscribe_to_alerts / confirm_subscription / ...) were deleted with the old
// product and must NOT be reintroduced.

/** Catalog of subscribable bases joined with the current user's flags.
 *  authenticated-only — anon callers get an empty set (RLS via auth.uid()). */
export async function rpcListSubscribableBases(
  supabase: SupabaseClient,
): Promise<SubscribableBase[]> {
  const { data, error } = await supabase.rpc("list_subscribable_bases");
  if (error) throw error;
  return (data ?? []) as SubscribableBase[];
}

/** Subscribe / unsubscribe one base. Returns the resulting active flag. */
export async function rpcSetMySubscription(
  supabase: SupabaseClient,
  sourceSlug: string,
  active: boolean,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("set_my_subscription", {
    p_source_slug: sourceSlug,
    p_active: active,
  });
  if (error) throw error;
  return Boolean(data);
}

/** Bulk subscribe / unsubscribe (e.g. per-category Select all / Clear).
 *  Returns the number of subscriptions affected. */
export async function rpcSetMySubscriptions(
  supabase: SupabaseClient,
  sourceSlugs: string[],
  active: boolean,
): Promise<number> {
  const { data, error } = await supabase.rpc("set_my_subscriptions", {
    p_source_slugs: sourceSlugs,
    p_active: active,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

/** The current user's subscriptions (active and paused). */
export async function rpcListMySubscriptions(
  supabase: SupabaseClient,
): Promise<MySubscription[]> {
  const { data, error } = await supabase.rpc("list_my_subscriptions");
  if (error) throw error;
  return (data ?? []) as MySubscription[];
}

/** Read-only feed of the user's most recent sent alerts (default 20). */
export async function rpcListMyRecentAlerts(
  supabase: SupabaseClient,
  limit = 20,
): Promise<RecentAlert[]> {
  const { data, error } = await supabase.rpc("list_my_recent_alerts", {
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as RecentAlert[];
}

/** One-click unsubscribe via the token embedded in the email footer.
 *  anon + authenticated. Idempotent server-side. */
export async function rpcUnsubscribeByToken(
  supabase: SupabaseClient,
  token: string,
): Promise<UnsubscribeResult> {
  const { data, error } = await supabase.rpc("unsubscribe_by_token", {
    p_token: token,
  });
  if (error) throw error;
  return (data ?? { success: false }) as UnsubscribeResult;
}

// ─── MODULE: Alerts admin (/src/app/(dashboard)/admin-panel — "Alerts" tab) ───
//
// Admin-only operations for the rebuilt client-alerts product. All five RPCs
// are SECURITY DEFINER and guard their body with `is_admin()`, so a non-admin
// caller gets a raised exception (surfaced as a thrown error here). They are
// consumed ONLY by the admin panel — never by the Client-facing /alerts page.
// The source list/names are read via the existing `rpcListSubscribableBases`.
//
// Errors propagate (no silent try/catch + []), so the admin panel can show a
// friendly inline message and optimistic toggles can revert.

/** Aggregate alert counters: totals, per-source counts, sent/bounced (7d). */
export async function rpcAdminAlertsStats(
  supabase: SupabaseClient,
): Promise<AdminAlertsStats> {
  const { data, error } = await supabase.rpc("admin_alerts_stats");
  if (error) throw error;
  return data as AdminAlertsStats;
}

/** List subscribers, optionally filtered to one source slug (default all). */
export async function rpcAdminAlertsListSubscribers(
  supabase: SupabaseClient,
  sourceSlug: string | null = null,
  limit = 200,
): Promise<AdminAlertsSubscriber[]> {
  const { data, error } = await supabase.rpc("admin_alerts_list_subscribers", {
    p_source_slug: sourceSlug,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as AdminAlertsSubscriber[];
}

/** Most recent rows of the alert email-delivery log (default 100). */
export async function rpcAdminAlertsEmailLogRecent(
  supabase: SupabaseClient,
  limit = 100,
): Promise<AdminAlertsEmailLogRow[]> {
  const { data, error } = await supabase.rpc("admin_alerts_email_log_recent", {
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as AdminAlertsEmailLogRow[];
}

/** Enable / disable a source in the catalog. Returns the resulting flag. */
export async function rpcAdminAlertsToggleSource(
  supabase: SupabaseClient,
  sourceSlug: string,
  isActive: boolean,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_alerts_toggle_source", {
    p_source_slug: sourceSlug,
    p_is_active: isActive,
  });
  if (error) throw error;
  return Boolean(data);
}

/** Inject a synthetic test event for a source. Does NOT send immediately —
 *  the event is delivered on the next alert hook / digest run. Returns the
 *  created event id. `email` optionally targets a single recipient. */
export async function rpcAdminAlertsSendTest(
  supabase: SupabaseClient,
  sourceSlug: string,
  email: string | null = null,
): Promise<string> {
  const { data, error } = await supabase.rpc("admin_alerts_send_test", {
    p_source_slug: sourceSlug,
    p_email: email,
  });
  if (error) throw error;
  return data as string;
}
