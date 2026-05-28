"use client";

// ─── useNaviosDieselData — single brain for /navios-diesel ──────────────────
//
// All Supabase RPC calls, filter state, stale-fetch protection, and derived
// values live here. Neither desktop/View.tsx nor mobile/View.tsx call Supabase
// directly — they read from this hook exclusively.
//
// Cabotage rule (MANDATORY): every RPC in this module already enforces
// WHERE NOT is_cabotagem at the database level. The hook must never remove
// or skip parameters that drive that filter.
//
// RPCs used:
//   get_nd_coletas_distintas   — available snapshot timestamps (DESC)
//   get_nd_navios              — vessel rows for a given snapshot
//   get_nd_resumo_portos       — per-port aggregates for a given snapshot
//   get_nd_volume_mensal_descarga — monthly discharged/pending volumes
//   get_nd_navios_descarregados   — delivered vessels for current snapshot
//   get_nd_resumo_mensal_portos   — port × month summary table
//
// NOT used here (AIS layer is desktop-only at this stage):
//   get_ais_positions_latest / get_ais_positions_all_recent /
//   get_ais_arrivals_open / get_port_polygons
//   These remain in desktop/View.tsx as local state to avoid over-fetching
//   on mobile where the map tab isn't rendered.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";
import {
  rpcGetNdColetasDistintas,
  rpcGetNdNavios,
  rpcGetNdResumoPortos,
  rpcGetNdVolumeMensalDescarga,
  rpcGetNdNaviosDescarregados,
  rpcGetNdResumoMensalPortos,
  type NavioDieselRow,
  type PortoResumo,
  type NdVolumeMensalDescargaRow,
  type NdNavioDescarregadoRow,
  type NdResumoMensalPortoRow,
} from "@/lib/rpc";

// ─── Public types ─────────────────────────────────────────────────────────────

export type {
  NavioDieselRow,
  PortoResumo,
  NdVolumeMensalDescargaRow,
  NdNavioDescarregadoRow,
  NdResumoMensalPortoRow,
};

/** Aggregated per-port data for the port summary scroller (mobile) and map (desktop). */
export interface PortSummary {
  porto: string;
  /** Short display name without "Porto de " prefix. */
  label: string;
  totalNavios: number;
  totalVolume: number;
  /** Counts per status for the dot indicators. */
  counts: {
    unloading: number;
    anchored: number;
    enroute: number;
    completed: number;
  };
}

export interface UseNaviosDieselData {
  // ── Snapshot selection ──────────────────────────────────────────────────────
  /** All available snapshot timestamps (DESC). */
  coletas: string[];
  /** Dates that have at least one snapshot, as "YYYY-MM-DD" strings. */
  daysWithData: Set<string>;
  /** Map from "YYYY-MM-DD" → snapshot timestamp list (DESC). */
  coletasByDay: Map<string, string[]>;
  /** Currently selected day ("YYYY-MM-DD"). */
  selectedDay: string;
  setSelectedDay: (day: string) => void;
  /** Currently selected snapshot timestamp. */
  selectedColeta: string;
  setSelectedColeta: (ts: string) => void;

  // ── Data ────────────────────────────────────────────────────────────────────
  /** All vessel rows for the current snapshot (includes ERRO_COLETA). */
  navios: NavioDieselRow[];
  /** Vessels to display in the active line-up (excludes ERRO_COLETA + Despachado). */
  naviosDisplay: NavioDieselRow[];
  /** Set of "navio__porto" keys that appeared in today's snapshot but not yesterday's. */
  newVesselSet: Set<string>;
  /** Port names where collection errored in this snapshot. */
  errorPorts: string[];

  // ── Per-port aggregates ──────────────────────────────────────────────────────
  resumoPortos: PortoResumo[];
  portSummaries: PortSummary[];

  // ── Monthly charts ──────────────────────────────────────────────────────────
  volumeMensal: NdVolumeMensalDescargaRow[];
  naviosDescarregados: NdNavioDescarregadoRow[];
  resumoMensal: NdResumoMensalPortoRow[];

  // ── Port monthly summary (for the desktop table) ─────────────────────────────
  portMonthlySummary: {
    ports: string[];
    months: string[];
    monthLabels: Record<string, string>;
    portMap: Map<string, Map<string, { vessels: number; volume: number }>>;
  };

  // ── Resume by porto (map) ────────────────────────────────────────────────────
  resumoByPorto: Map<string, { total_navios: number; total_convertida: number }>;

  // ── Loading / error ──────────────────────────────────────────────────────────
  loading: boolean;
  error: Error | null;
}

// ─── Status mapping helpers (shared by both Views) ────────────────────────────

/** Maps navios_diesel.status to the mobile status tone. */
export function statusToTone(
  status: string,
): "unloading" | "anchored" | "enroute" | "completed" | "neutral" {
  switch (status) {
    case "Iniciada Descarga":
      return "unloading";
    case "Atracado":
    case "Fundeado":
    case "Ao Largo":
      return "anchored";
    case "Esperado":
      return "enroute";
    case "Despachado":
    case "Descarregado":
      return "completed";
    default:
      return "neutral";
  }
}

/** English label for each status value. */
export const STATUS_LABELS: Record<string, string> = {
  Atracado:          "Berthed",
  Esperado:          "Expected",
  "Ao Largo":        "Offshore",
  Fundeado:          "Anchored",
  Despachado:        "Delivered",
  "Iniciada Descarga": "Unloading",
  Descarregado:      "Discharged",
};

// ─── Hook implementation ──────────────────────────────────────────────────────

// ─── Hook options ─────────────────────────────────────────────────────────────

export interface UseNaviosDieselDataOptions {
  /**
   * When true, the hook skips `get_nd_navios` (per-vessel rows), the
   * previous-day diff fetch, `get_nd_volume_mensal_descarga`, and
   * `get_nd_navios_descarregados`. Only the snapshot list, port aggregates,
   * and monthly port summary are fetched.
   *
   * Mobile view uses `aggregateOnly: true` to trim the payload for narrow
   * viewports that do not render the per-vessel line-up or AIS map.
   * Desktop always passes `false` (default).
   */
  aggregateOnly?: boolean;
}

export function useNaviosDieselData(
  options: UseNaviosDieselDataOptions = {},
): UseNaviosDieselData {
  const { aggregateOnly = false } = options;
  const supabase = getSupabaseClient();

  // ── Snapshot state ──────────────────────────────────────────────────────────
  const [coletas, setColetas] = useState<string[]>([]);
  const [selectedDay, setSelectedDay] = useState<string>("");
  const [selectedColeta, setSelectedColeta] = useState<string>("");

  // ── Data state ──────────────────────────────────────────────────────────────
  const [navios, setNavios] = useState<NavioDieselRow[]>([]);
  const [naviosAnteriores, setNaviosAnteriores] = useState<NavioDieselRow[]>([]);
  const [resumoPortos, setResumoPortos] = useState<PortoResumo[]>([]);
  const [volumeMensal, setVolumeMensal] = useState<NdVolumeMensalDescargaRow[]>([]);
  const [naviosDescarregados, setNaviosDescarregados] = useState<NdNavioDescarregadoRow[]>([]);
  const [resumoMensal, setResumoMensal] = useState<NdResumoMensalPortoRow[]>([]);

  // ── Loading / error ──────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Stale-fetch protection: each fetch gets an incremented id; only the most
  // recent result is applied.
  const fetchIdRef = useRef(0);

  // ── Derived: coletasByDay ────────────────────────────────────────────────────
  const coletasByDay = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const ts of coletas) {
      const day = ts.slice(0, 10);
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(ts);
    }
    return map;
  }, [coletas]);

  const days = useMemo(() => Array.from(coletasByDay.keys()), [coletasByDay]);
  const daysWithData = useMemo(() => new Set(days), [days]);

  // ── Derived: previous-day snapshot (for "New!" detection) ───────────────────
  const prevDaySnapshot = useMemo(() => {
    const dayIdx = days.indexOf(selectedDay);
    if (dayIdx < 0 || dayIdx >= days.length - 1) return null;
    const prevDay = days[dayIdx + 1]; // days sorted DESC → next index = previous day
    const times = coletasByDay.get(prevDay) ?? [];
    return times[0] ?? null;
  }, [days, selectedDay, coletasByDay]);

  // ── Derived: vessel display lists ────────────────────────────────────────────
  const naviosDisplay = useMemo(
    () => navios.filter((n) => n.status !== "ERRO_COLETA" && n.status !== "Despachado"),
    [navios],
  );

  const errorPorts = useMemo(
    () => navios.filter((n) => n.status === "ERRO_COLETA").map((n) => n.porto),
    [navios],
  );

  const newVesselSet = useMemo(() => {
    if (naviosAnteriores.length === 0) return new Set<string>();
    const prevKeys = new Set(naviosAnteriores.map((n) => `${n.navio}__${n.porto}`));
    return new Set(
      naviosDisplay
        .filter((n) => !prevKeys.has(`${n.navio}__${n.porto}`))
        .map((n) => `${n.navio}__${n.porto}`),
    );
  }, [naviosAnteriores, naviosDisplay]);

  // ── Derived: per-port aggregates ─────────────────────────────────────────────
  const resumoByPorto = useMemo(() => {
    const m = new Map<string, { total_navios: number; total_convertida: number }>();
    for (const r of resumoMensal) {
      const entry = m.get(r.porto) ?? { total_navios: 0, total_convertida: 0 };
      entry.total_navios += r.vessels;
      entry.total_convertida += r.volume;
      m.set(r.porto, entry);
    }
    return m;
  }, [resumoMensal]);

  /** Port summaries for the mobile horizontal scroller. */
  const portSummaries = useMemo((): PortSummary[] => {
    // Build a map from porto → status counts from naviosDisplay
    const byPorto = new Map<
      string,
      { unloading: number; anchored: number; enroute: number; completed: number }
    >();

    for (const n of naviosDisplay) {
      if (!byPorto.has(n.porto)) {
        byPorto.set(n.porto, { unloading: 0, anchored: 0, enroute: 0, completed: 0 });
      }
      const c = byPorto.get(n.porto)!;
      const tone = statusToTone(n.status);
      if (tone === "unloading") c.unloading++;
      else if (tone === "anchored") c.anchored++;
      else if (tone === "enroute") c.enroute++;
      else if (tone === "completed") c.completed++;
    }

    // Merge with the resumoPortos aggregates (which include delivered vessels too)
    const allPortos = new Set([
      ...resumoPortos.map((r) => r.porto),
      ...Array.from(byPorto.keys()),
    ]);

    return Array.from(allPortos)
      .sort()
      .map((porto) => {
        const agg = resumoPortos.find((r) => r.porto === porto);
        const counts = byPorto.get(porto) ?? {
          unloading: 0,
          anchored: 0,
          enroute: 0,
          completed: 0,
        };
        return {
          porto,
          label: porto.replace("Porto de ", ""),
          totalNavios: agg?.total_navios ?? naviosDisplay.filter((n) => n.porto === porto).length,
          totalVolume: agg?.total_convertida ?? 0,
          counts,
        };
      });
  }, [naviosDisplay, resumoPortos]);

  /** Port × month summary for the desktop table.
   *
   *  Months are derived from the UNION of `resumoMensal` (port × month
   *  vessel/volume aggregates, current snapshot only) and `volumeMensal`
   *  (full historical + future series from `get_nd_volume_mensal_historico`).
   *  This keeps the table aligned with the bar chart's x-axis even when the
   *  current snapshot doesn't carry a row for past or future months (the
   *  table renders `—` for cells without a vessel/volume entry). The current
   *  month is suffixed with " (live)" so the column header reads identically
   *  to the bar chart's x-tick label.
   */
  const portMonthlySummary = useMemo(() => {
    const portMap = new Map<string, Map<string, { vessels: number; volume: number }>>();
    const monthsSet = new Set<string>();

    for (const r of resumoMensal) {
      monthsSet.add(r.month);
      if (!portMap.has(r.porto)) portMap.set(r.porto, new Map());
      portMap.get(r.porto)!.set(r.month, { vessels: r.vessels, volume: r.volume });
    }

    // Union with the bar-chart month list so past/future months from
    // get_nd_volume_mensal_historico also appear as columns.
    const currentMonths = new Set<string>();
    for (const v of volumeMensal) {
      monthsSet.add(v.month);
      if (v.is_current) currentMonths.add(v.month);
    }

    const months = Array.from(monthsSet).sort();
    const ports = Array.from(portMap.keys()).sort();
    const monthLabels: Record<string, string> = {};
    for (const m of months) {
      const [yr, mo] = m.split("-");
      const base = new Date(Number(yr), Number(mo) - 1, 1).toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
      });
      monthLabels[m] = currentMonths.has(m) ? `${base} (live)` : base;
    }

    return { ports, months, monthLabels, portMap };
  }, [resumoMensal, volumeMensal]);

  // ── setSelectedDay: auto-select first timestamp of the day ───────────────────
  const handleSetSelectedDay = useCallback(
    (day: string) => {
      setSelectedDay(day);
      const times = coletasByDay.get(day) ?? [];
      if (times.length > 0) setSelectedColeta(times[0]);
    },
    [coletasByDay],
  );

  // ── Effect 1: load available snapshot timestamps ─────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const ts = await rpcGetNdColetasDistintas(supabase);
      if (cancelled) return;
      setColetas(ts);
      if (ts.length > 0) {
        const firstDay = ts[0].slice(0, 10);
        setSelectedDay(firstDay);
        setSelectedColeta(ts[0]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // ── Effect 2: load vessel data + port summary for the selected snapshot ───────
  // In aggregateOnly mode (mobile), per-vessel rows are skipped to reduce
  // payload. Only port aggregates and the monthly port summary are fetched.
  useEffect(() => {
    if (!supabase || !selectedColeta) return;
    const id = ++fetchIdRef.current;
    setLoading(true);
    setError(null);

    const fetches = aggregateOnly
      ? Promise.all([
          Promise.resolve([] as NavioDieselRow[]),
          rpcGetNdResumoPortos(supabase, selectedColeta),
          rpcGetNdResumoMensalPortos(supabase, selectedColeta),
        ])
      : Promise.all([
          rpcGetNdNavios(supabase, selectedColeta),
          rpcGetNdResumoPortos(supabase, selectedColeta),
          rpcGetNdResumoMensalPortos(supabase, selectedColeta),
        ]);

    fetches
      .then(([nav, resumo, mensal]) => {
        if (id !== fetchIdRef.current) return;
        setNavios(nav);
        setResumoPortos(resumo);
        setResumoMensal(mensal);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (id !== fetchIdRef.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
  }, [supabase, selectedColeta, aggregateOnly]);

  // ── Effect 3: monthly volume + discharged vessels (skipped in aggregateOnly) ──
  useEffect(() => {
    if (aggregateOnly || !supabase || !selectedColeta) return;
    let cancelled = false;
    (async () => {
      const [monthly, discharged] = await Promise.all([
        rpcGetNdVolumeMensalDescarga(supabase, selectedColeta),
        rpcGetNdNaviosDescarregados(supabase, selectedColeta),
      ]);
      if (cancelled) return;
      setVolumeMensal(monthly);
      setNaviosDescarregados(discharged);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, selectedColeta, aggregateOnly]);

  // ── Effect 4: previous-day vessels for "New!" badge (skipped in aggregateOnly) ─
  useEffect(() => {
    if (aggregateOnly || !supabase || !prevDaySnapshot) {
      setNaviosAnteriores([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const nav = await rpcGetNdNavios(supabase, prevDaySnapshot);
      if (!cancelled) setNaviosAnteriores(nav);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, prevDaySnapshot, aggregateOnly]);

  return {
    coletas,
    daysWithData,
    coletasByDay,
    selectedDay,
    setSelectedDay: handleSetSelectedDay,
    selectedColeta,
    setSelectedColeta,
    navios,
    naviosDisplay,
    newVesselSet,
    errorPorts,
    resumoPortos,
    portSummaries,
    volumeMensal,
    naviosDescarregados,
    resumoMensal,
    portMonthlySummary,
    resumoByPorto,
    loading,
    error,
  };
}
