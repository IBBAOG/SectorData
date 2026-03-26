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

function toListOrUndefined(v?: string[] | null): string[] | null {
  if (!v || v.length === 0) return null;
  return Array.from(v);
}

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
  const PAGE = 2000;

  const params = {
    p_data_inicio: filters.data_inicio ?? null,
    p_data_fim: filters.data_fim ?? null,
    p_regioes: toListOrUndefined(filters.regioes),
    p_ufs: toListOrUndefined(filters.ufs),
    p_mercados: toListOrUndefined(filters.mercados),
  };

  // First page + total count in one request
  const { data: firstData, error: firstError, count } = await supabase
    .rpc(fnName, params, { count: "exact" })
    .range(0, PAGE - 1);
  if (firstError) throw firstError;

  const firstRows = (firstData ?? []) as MsSerieRow[];
  const total = count ?? firstRows.length;
  if (total <= PAGE) return firstRows;

  // Fetch remaining pages in parallel
  const pageCount = Math.ceil(total / PAGE);
  const requests = Array.from({ length: pageCount - 1 }, (_, i) => {
    const start = (i + 1) * PAGE;
    return supabase.rpc(fnName, params).range(start, start + PAGE - 1);
  });

  const results = await Promise.all(requests);
  const allRows = [...firstRows];
  for (const { data, error } of results) {
    if (error) throw error;
    allRows.push(...((data ?? []) as MsSerieRow[]));
  }

  return allRows;
}

export async function rpcGetMsSerie(supabase: SupabaseClient, filters: MarketShareFilters) {
  return paginatedRpc(supabase, "get_ms_serie", filters);
}

export async function rpcGetMsSerieOthers(supabase: SupabaseClient, filters: MarketShareFilters) {
  return paginatedRpc(supabase, "get_ms_serie_others", filters);
}

