"use client";

// /admin-analytics — Admin-only telemetry dashboard for the SectorData app.
//
// Layout (4 sections + period filter at top):
//   1. Period toggle  (7d / 30d / 90d) — controls every RPC below.
//   2. KPI cards      — DAU / WAU / MAU / Active users (period) + sub-cards
//                        for Page views / Exports / Logins (period).
//   3. By dashboard   — sortable table (route, page_views, unique_users,
//                        exports, bytes_total).
//   4. By user        — searchable table; each row expands to a 500-event
//                        timeline pulled from get_analytics_user_timeline.
//   5. Heatmap        — Plotly 7×24 (dow × hour) heatmap, BRAND_ORANGE max.
//
// Auth: useRoleGuard("Admin") — non-Admins are redirected to /home before
// this component renders. There is NO module_visibility row for this slug:
// the page is Admin-only and intentionally invisible to Clients.
//
// This page is excluded from page_view tracking in (dashboard)/layout.tsx
// so the analytics dashboard does not pollute its own metrics.

import { useCallback, useEffect, useMemo, useState } from "react";

import NavBar from "@/components/NavBar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import BarrelLoading from "@/components/dashboard/BarrelLoading";
import PlotlyChart from "@/components/PlotlyChart";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { useDebounce } from "@/hooks/useDebounce";
import { formatBytes } from "@/lib/exportSizeHeuristics";
import { BRAND_ORANGE, COMMON_LAYOUT } from "@/lib/plotlyDefaults";
import {
  rpcGetAnalyticsKpis,
  rpcGetAnalyticsByDashboard,
  rpcGetAnalyticsByUser,
  rpcGetAnalyticsUserTimeline,
  rpcGetAnalyticsHeatmap,
  type AnalyticsKpis,
  type AnalyticsByDashboardRow,
  type AnalyticsByUserRow,
  type AnalyticsTimelineEvent,
  type AnalyticsHeatmapCell,
} from "@/lib/rpc";

const ORANGE = "#ff5000";
const PERIOD_OPTIONS: { label: string; days: number }[] = [
  { label: "7 dias", days: 7 },
  { label: "30 dias", days: 30 },
  { label: "90 dias", days: 90 },
];

// Janelas longas (> 90 dias) expostas via dropdown.
const LONG_PERIOD_OPTIONS: { label: string; days: number }[] = [
  { label: "180 dias (6 meses)", days: 180 },
  { label: "365 dias (1 ano)", days: 365 },
  { label: "730 dias (2 anos)", days: 730 },
  { label: "1825 dias (5 anos)", days: 1825 },
];

const DOW_LABELS_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

type SortField = keyof Pick<
  AnalyticsByDashboardRow,
  "route" | "page_views" | "unique_users" | "exports" | "bytes_total"
>;
type SortDir = "asc" | "desc";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  return new Intl.NumberFormat("pt-BR").format(n);
}

function formatTimestampBR(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatLastLogin(iso: string | null): string {
  if (!iso) return "—";
  return formatTimestampBR(iso);
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AdminAnalyticsPage() {
  const { allowed, loading: roleLoading } = useRoleGuard("Admin");
  const supabase = getSupabaseClient();

  const [periodDays, setPeriodDays] = useState(30);

  // Section data
  const [kpis, setKpis] = useState<AnalyticsKpis | null>(null);
  const [kpisLoading, setKpisLoading] = useState(true);

  const [byDashboard, setByDashboard] = useState<AnalyticsByDashboardRow[]>([]);
  const [byDashboardLoading, setByDashboardLoading] = useState(true);

  const [byUser, setByUser] = useState<AnalyticsByUserRow[]>([]);
  const [byUserLoading, setByUserLoading] = useState(true);

  const [heatmap, setHeatmap] = useState<AnalyticsHeatmapCell[]>([]);
  const [heatmapLoading, setHeatmapLoading] = useState(true);

  // Search box for the by-user table (debounced).
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebounce(searchInput, 350);

  // Sort state for the by-dashboard table.
  const [sortField, setSortField] = useState<SortField>("page_views");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Expanded user row → timeline state.
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<AnalyticsTimelineEvent[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineLimit, setTimelineLimit] = useState(50);

  // ── Fetchers ──────────────────────────────────────────────────────────────

  const loadKpis = useCallback(async () => {
    if (!supabase) return;
    setKpisLoading(true);
    const data = await rpcGetAnalyticsKpis(supabase, periodDays);
    setKpis(data);
    setKpisLoading(false);
  }, [supabase, periodDays]);

  const loadByDashboard = useCallback(async () => {
    if (!supabase) return;
    setByDashboardLoading(true);
    const data = await rpcGetAnalyticsByDashboard(supabase, periodDays);
    setByDashboard(data);
    setByDashboardLoading(false);
  }, [supabase, periodDays]);

  const loadByUser = useCallback(async () => {
    if (!supabase) return;
    setByUserLoading(true);
    const data = await rpcGetAnalyticsByUser(
      supabase,
      periodDays,
      debouncedSearch || null,
    );
    setByUser(data);
    setByUserLoading(false);
  }, [supabase, periodDays, debouncedSearch]);

  const loadHeatmap = useCallback(async () => {
    if (!supabase) return;
    setHeatmapLoading(true);
    const data = await rpcGetAnalyticsHeatmap(supabase, periodDays);
    setHeatmap(data);
    setHeatmapLoading(false);
  }, [supabase, periodDays]);

  // Reset expanded user when period changes — its timeline is now stale.
  useEffect(() => {
    setExpandedUserId(null);
    setTimeline([]);
    setTimelineLimit(50);
  }, [periodDays]);

  useEffect(() => { if (allowed) loadKpis(); }, [allowed, loadKpis]);
  useEffect(() => { if (allowed) loadByDashboard(); }, [allowed, loadByDashboard]);
  useEffect(() => { if (allowed) loadByUser(); }, [allowed, loadByUser]);
  useEffect(() => { if (allowed) loadHeatmap(); }, [allowed, loadHeatmap]);

  // ── Timeline: fire when expandedUserId changes ────────────────────────────
  useEffect(() => {
    if (!allowed || !supabase || !expandedUserId) {
      setTimeline([]);
      return;
    }
    let cancelled = false;
    setTimelineLoading(true);
    setTimelineLimit(50);
    rpcGetAnalyticsUserTimeline(supabase, expandedUserId, periodDays).then((data) => {
      if (cancelled) return;
      setTimeline(data);
      setTimelineLoading(false);
    });
    return () => { cancelled = true; };
  }, [supabase, allowed, expandedUserId, periodDays]);

  // ── Sorted by-dashboard rows ──────────────────────────────────────────────
  const sortedByDashboard = useMemo(() => {
    const rows = [...byDashboard];
    rows.sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const an = Number(av);
      const bn = Number(bv);
      return sortDir === "asc" ? an - bn : bn - an;
    });
    return rows;
  }, [byDashboard, sortField, sortDir]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "route" ? "asc" : "desc");
    }
  }

  // ── Heatmap matrix (7 rows × 24 cols) ─────────────────────────────────────
  const heatmapMatrix = useMemo(() => {
    const z: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const cell of heatmap) {
      const dow = Math.max(0, Math.min(6, cell.dow));
      const hour = Math.max(0, Math.min(23, cell.hour));
      z[dow][hour] = cell.event_count;
    }
    return z;
  }, [heatmap]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (roleLoading || !allowed) return null;

  return (
    <main style={{ background: "#f5f5f5", minHeight: "100vh", fontFamily: "Arial, sans-serif" }}>
      <NavBar />
      <div style={{ padding: "clamp(16px, 3vw, 32px)", maxWidth: 1400, margin: "0 auto" }}>
        <DashboardHeader
          title="Admin Analytics"
          sub="Engajamento da plataforma — eventos de login, navegação e exportação."
          extraBadge={
            <span style={{ marginLeft: 12, fontSize: 11, color: ORANGE, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>
              Admin only
            </span>
          }
        />

        {/* ── Period filter ───────────────────────────────────────────────── */}
        <div style={{ display: "flex", gap: 8, marginBottom: 24, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "#666", fontWeight: 600, marginRight: 4 }}>
            Período:
          </span>
          {PERIOD_OPTIONS.map((opt) => {
            const active = periodDays === opt.days;
            return (
              <button
                key={opt.days}
                type="button"
                onClick={() => setPeriodDays(opt.days)}
                style={{
                  border: `1px solid ${active ? ORANGE : "#ddd"}`,
                  background: active ? ORANGE : "#fff",
                  color: active ? "#fff" : "#333",
                  borderRadius: 999,
                  padding: "5px 16px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "Arial, sans-serif",
                  transition: "background 0.15s, color 0.15s, border-color 0.15s",
                }}
              >
                {opt.label}
              </button>
            );
          })}

          {/* Separador visual entre pílulas e dropdown */}
          <span style={{ color: "#ddd", fontSize: 14, margin: "0 2px", userSelect: "none" }}>|</span>

          {/* Dropdown de janelas longas (> 90 dias) */}
          <select
            value={LONG_PERIOD_OPTIONS.some((o) => o.days === periodDays) ? periodDays : ""}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v > 0) setPeriodDays(v);
            }}
            style={{
              border: `1px solid ${LONG_PERIOD_OPTIONS.some((o) => o.days === periodDays) ? ORANGE : "#ddd"}`,
              background: "#fff",
              color: LONG_PERIOD_OPTIONS.some((o) => o.days === periodDays) ? ORANGE : "#555",
              borderRadius: 999,
              padding: "5px 28px 5px 14px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "Arial, sans-serif",
              outline: "none",
              appearance: "none",
              WebkitAppearance: "none",
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23999'/%3E%3C/svg%3E")`,
              backgroundRepeat: "no-repeat",
              backgroundPosition: "right 10px center",
              transition: "border-color 0.15s, color 0.15s",
            }}
          >
            <option value="" disabled>
              Janela longa…
            </option>
            {LONG_PERIOD_OPTIONS.map((opt) => (
              <option key={opt.days} value={opt.days}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* ── Section 2: KPIs ─────────────────────────────────────────────── */}
        <section style={{ marginBottom: 32 }}>
          <SectionTitle text="Visão geral" />
          {kpisLoading ? (
            <BarrelLoading />
          ) : !kpis ? (
            <EmptyMessage text="Sem dados de KPI." />
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 12 }}>
                <KpiCard label="DAU" value={kpis.dau} hint="Active hoje" big />
                <KpiCard label="WAU" value={kpis.wau} hint="Active 7d" big />
                <KpiCard label="MAU" value={kpis.mau} hint="Active 30d" big />
                <KpiCard
                  label="Ativos no período"
                  value={kpis.active_users_period}
                  hint={`de ${formatNumber(kpis.total_users)} cadastrados`}
                  big
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
                <KpiCard label="Page views" value={kpis.page_views_period} />
                <KpiCard label="Exports" value={kpis.exports_period} />
                <KpiCard label="Logins" value={kpis.logins_period} />
              </div>
            </>
          )}
        </section>

        {/* ── Section 3: By dashboard ─────────────────────────────────────── */}
        <section style={{ marginBottom: 32 }}>
          <SectionTitle text="Engajamento por dashboard" />
          <div className="settings-card" style={{ padding: 0, overflow: "hidden" }}>
            {byDashboardLoading ? (
              <div style={{ padding: 32 }}><BarrelLoading /></div>
            ) : sortedByDashboard.length === 0 ? (
              <EmptyMessage text="Sem eventos no período selecionado." padded />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead style={{ background: "#fafafa", borderBottom: "1px solid #eee" }}>
                    <tr>
                      <ThSort label="Rota" field="route" current={sortField} dir={sortDir} onSort={handleSort} align="left" />
                      <ThSort label="Page views" field="page_views" current={sortField} dir={sortDir} onSort={handleSort} />
                      <ThSort label="Usuários únicos" field="unique_users" current={sortField} dir={sortDir} onSort={handleSort} />
                      <ThSort label="Exports" field="exports" current={sortField} dir={sortDir} onSort={handleSort} />
                      <ThSort label="Bytes baixados" field="bytes_total" current={sortField} dir={sortDir} onSort={handleSort} />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedByDashboard.map((r) => (
                      <tr key={r.route} style={{ borderBottom: "1px solid #f0f0f0" }}>
                        <td style={{ padding: "10px 16px", fontFamily: "monospace", color: "#1a1a1a", fontSize: 12 }}>
                          {r.route}
                        </td>
                        <td style={tdNum}>{formatNumber(r.page_views)}</td>
                        <td style={tdNum}>{formatNumber(r.unique_users)}</td>
                        <td style={tdNum}>{formatNumber(r.exports)}</td>
                        <td style={tdNum}>{r.bytes_total > 0 ? formatBytes(r.bytes_total) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* ── Section 4: By user ──────────────────────────────────────────── */}
        <section style={{ marginBottom: 32 }}>
          <SectionTitle text="Engajamento por usuário" />
          <div className="settings-card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid #eee", background: "#fafafa" }}>
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Buscar por nome ou email…"
                style={{
                  width: "100%",
                  maxWidth: 360,
                  padding: "7px 12px",
                  border: "1px solid #ddd",
                  borderRadius: 8,
                  fontSize: 13,
                  fontFamily: "Arial, sans-serif",
                  outline: "none",
                }}
              />
            </div>

            {byUserLoading ? (
              <div style={{ padding: 32 }}><BarrelLoading /></div>
            ) : byUser.length === 0 ? (
              <EmptyMessage text="Nenhum usuário com atividade no período." padded />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead style={{ background: "#fafafa", borderBottom: "1px solid #eee" }}>
                    <tr>
                      <Th label="Nome" align="left" />
                      <Th label="Role" />
                      <Th label="Último login" />
                      <Th label="Page views" />
                      <Th label="Exports" />
                      <Th label="Top dashboards" align="left" />
                    </tr>
                  </thead>
                  <tbody>
                    {byUser.map((u) => {
                      const isOpen = expandedUserId === u.user_id;
                      return (
                        <UserRow
                          key={u.user_id}
                          user={u}
                          isOpen={isOpen}
                          onToggle={() => setExpandedUserId(isOpen ? null : u.user_id)}
                          timeline={isOpen ? timeline : []}
                          timelineLoading={isOpen && timelineLoading}
                          timelineLimit={timelineLimit}
                          onShowMore={() => setTimelineLimit((n) => n + 50)}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* ── Section 5: Heatmap ──────────────────────────────────────────── */}
        <section style={{ marginBottom: 64 }}>
          <SectionTitle text="Heatmap horário" />
          <div className="settings-card" style={{ padding: 16 }}>
            {heatmapLoading ? (
              <BarrelLoading />
            ) : (
              <PlotlyChart
                style={{ width: "100%", height: 320 }}
                data={[
                  {
                    type: "heatmap",
                    z: heatmapMatrix,
                    x: Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}h`),
                    y: DOW_LABELS_PT,
                    colorscale: [
                      [0, "#fff5ee"],
                      [0.5, "#ffb088"],
                      [1, BRAND_ORANGE],
                    ],
                    hovertemplate:
                      "<b>%{y} · %{x}</b><br>Eventos: %{z}<extra></extra>",
                    showscale: true,
                    colorbar: { thickness: 10, len: 0.85 },
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  } as any,
                ]}
                layout={{
                  ...COMMON_LAYOUT,
                  margin: { t: 20, b: 40, l: 60, r: 40 },
                  xaxis: { title: { text: "Hora" }, side: "bottom", fixedrange: true },
                  yaxis: { title: { text: "Dia da semana" }, autorange: "reversed", fixedrange: true },
                }}
                config={{ displayModeBar: false, responsive: true }}
              />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

function SectionTitle({ text }: { text: string }) {
  return (
    <h2 style={{ fontSize: 14, fontWeight: 700, color: "#1a1a1a", margin: "0 0 12px", letterSpacing: "0.04em", textTransform: "uppercase" }}>
      {text}
    </h2>
  );
}

function KpiCard({
  label,
  value,
  hint,
  big = false,
}: {
  label: string;
  value: number;
  hint?: string;
  big?: boolean;
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e8e8e8",
        borderRadius: 12,
        padding: big ? "18px 20px" : "14px 16px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ fontSize: big ? 28 : 22, fontWeight: 700, color: "#1a1a1a", lineHeight: 1.1, fontFamily: "Arial, sans-serif" }}>
        {formatNumber(value)}
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: "#999", marginTop: 1 }}>{hint}</div>
      )}
    </div>
  );
}

function EmptyMessage({ text, padded = false }: { text: string; padded?: boolean }) {
  return (
    <div
      style={{
        padding: padded ? "32px 16px" : "8px 0",
        textAlign: "center",
        color: "#999",
        fontSize: 13,
        background: padded ? "#fff" : "transparent",
      }}
    >
      {text}
    </div>
  );
}

const tdNum: React.CSSProperties = {
  padding: "10px 16px",
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
  color: "#1a1a1a",
};

function Th({ label, align = "right" }: { label: string; align?: "left" | "right" }) {
  return (
    <th
      style={{
        padding: "10px 16px",
        textAlign: align,
        fontSize: 11,
        fontWeight: 700,
        color: "#666",
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}
    >
      {label}
    </th>
  );
}

function ThSort({
  label,
  field,
  current,
  dir,
  onSort,
  align = "right",
}: {
  label: string;
  field: SortField;
  current: SortField;
  dir: SortDir;
  onSort: (f: SortField) => void;
  align?: "left" | "right";
}) {
  const active = field === current;
  return (
    <th
      onClick={() => onSort(field)}
      style={{
        padding: "10px 16px",
        textAlign: align,
        fontSize: 11,
        fontWeight: 700,
        color: active ? ORANGE : "#666",
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      {label}
      {active && <span style={{ marginLeft: 4 }}>{dir === "asc" ? "▲" : "▼"}</span>}
    </th>
  );
}

function UserRow({
  user,
  isOpen,
  onToggle,
  timeline,
  timelineLoading,
  timelineLimit,
  onShowMore,
}: {
  user: AnalyticsByUserRow;
  isOpen: boolean;
  onToggle: () => void;
  timeline: AnalyticsTimelineEvent[];
  timelineLoading: boolean;
  timelineLimit: number;
  onShowMore: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        style={{
          borderBottom: isOpen ? "none" : "1px solid #f0f0f0",
          cursor: "pointer",
          background: isOpen ? "#fff8f3" : "transparent",
        }}
      >
        <td style={{ padding: "10px 16px" }}>
          <span style={{ marginRight: 6, color: "#aaa", fontSize: 10 }}>
            {isOpen ? "▼" : "▶"}
          </span>
          <strong style={{ color: "#1a1a1a" }}>{user.full_name || "(sem nome)"}</strong>
        </td>
        <td style={{ padding: "10px 16px", textAlign: "right" }}>
          <span
            style={{
              fontSize: 11,
              padding: "2px 8px",
              borderRadius: 10,
              fontWeight: 700,
              background: user.role === "Admin" ? "rgba(255,80,0,0.10)" : "rgba(0,0,0,0.05)",
              color: user.role === "Admin" ? ORANGE : "#666",
            }}
          >
            {user.role}
          </span>
        </td>
        <td style={tdNum}>{formatLastLogin(user.last_login)}</td>
        <td style={tdNum}>{formatNumber(user.page_views)}</td>
        <td style={tdNum}>{formatNumber(user.exports)}</td>
        <td style={{ padding: "10px 16px" }}>
          {user.top_routes.length === 0 ? (
            <span style={{ color: "#bbb", fontSize: 12 }}>—</span>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {user.top_routes.slice(0, 3).map((r) => (
                <span
                  key={r.route}
                  style={{
                    fontSize: 11,
                    padding: "2px 8px",
                    borderRadius: 10,
                    background: "rgba(255,80,0,0.08)",
                    color: "#1a1a1a",
                    fontFamily: "monospace",
                  }}
                  title={`${r.views} views`}
                >
                  {r.route} · {formatNumber(r.views)}
                </span>
              ))}
            </div>
          )}
        </td>
      </tr>
      {isOpen && (
        <tr style={{ borderBottom: "1px solid #f0f0f0", background: "#fff8f3" }}>
          <td colSpan={6} style={{ padding: "12px 24px 18px" }}>
            {timelineLoading ? (
              <div style={{ padding: 12, color: "#888", fontSize: 12 }}>Carregando timeline…</div>
            ) : timeline.length === 0 ? (
              <div style={{ padding: 12, color: "#999", fontSize: 12 }}>Sem eventos no período.</div>
            ) : (
              <>
                <div style={{ fontSize: 11, color: "#888", marginBottom: 8, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                  Timeline · {formatNumber(timeline.length)} eventos
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 360, overflowY: "auto" }}>
                  {timeline.slice(0, timelineLimit).map((ev, i) => (
                    <TimelineRow key={i} ev={ev} />
                  ))}
                </div>
                {timeline.length > timelineLimit && (
                  <button
                    type="button"
                    onClick={onShowMore}
                    style={{
                      marginTop: 8,
                      border: "1px solid #ddd",
                      background: "#fff",
                      borderRadius: 6,
                      padding: "4px 12px",
                      fontSize: 12,
                      cursor: "pointer",
                      color: "#555",
                    }}
                  >
                    Mostrar mais ({formatNumber(timeline.length - timelineLimit)} restantes)
                  </button>
                )}
              </>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function TimelineRow({ ev }: { ev: AnalyticsTimelineEvent }) {
  const tag =
    ev.event_type === "login" ? { label: "LOGIN", color: "#43A047" }
    : ev.event_type === "export" ? { label: "EXPORT", color: "#1565C0" }
    : { label: "VIEW", color: "#888" };

  let payloadPreview = "";
  try {
    if (ev.payload && Object.keys(ev.payload).length > 0) {
      payloadPreview = JSON.stringify(ev.payload);
      if (payloadPreview.length > 80) payloadPreview = payloadPreview.slice(0, 77) + "…";
    }
  } catch {
    payloadPreview = "";
  }

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "150px 70px 1fr",
      gap: 8,
      alignItems: "center",
      fontSize: 12,
      padding: "4px 8px",
      borderRadius: 4,
      background: "#fff",
      border: "1px solid #f1f1f1",
    }}>
      <span style={{ color: "#666", fontFamily: "monospace", fontSize: 11 }}>
        {formatTimestampBR(ev.created_at)}
      </span>
      <span style={{
        fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4,
        background: `${tag.color}22`, color: tag.color, textAlign: "center",
      }}>
        {tag.label}
      </span>
      <span style={{ color: "#1a1a1a", fontFamily: "monospace", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {ev.route ?? "—"}
        {payloadPreview && <span style={{ color: "#888", marginLeft: 8 }}>{payloadPreview}</span>}
      </span>
    </div>
  );
}
