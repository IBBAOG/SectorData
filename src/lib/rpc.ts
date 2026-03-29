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

