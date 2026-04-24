"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import NavBar from "../../../components/NavBar";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";

type NewsArticle = {
  url: string;
  domain: string;
  source_name: string;
  title: string;
  snippet: string;
  published_at: string;
  found_at: string;
  matched_keywords: string[];
};

const WINDOW_PRESETS = [1, 3, 6, 12, 24, 48, 72, 168] as const;
const POLL_INTERVAL_MS = 30_000;
const PAGE_LIMIT = 500;

function labelForWindow(h: number): string {
  if (h < 24) return `${h}h`;
  if (h === 24) return "24h (1d)";
  if (h === 168) return "7d";
  return `${h}h (${Math.floor(h / 24)}d)`;
}

function humanizeAge(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "sem data";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "agora";
  if (secs < 3600) return `há ${Math.floor(secs / 60)} min`;
  if (secs < 86400) return `há ${Math.floor(secs / 3600)} h`;
  return `há ${Math.floor(secs / 86400)} d`;
}

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export default function NewsHunterPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("news-hunter");
  const supabase = useMemo(() => getSupabaseClient(), []);

  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [windowHours, setWindowHours] = useState<number>(24);
  const [filter, setFilter] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lastFoundAtRef = useRef<string | null>(null);

  const mergeArticles = useCallback(
    (prev: NewsArticle[], incoming: NewsArticle[]): NewsArticle[] => {
      if (incoming.length === 0) return prev;
      const byUrl = new Map(prev.map((a) => [a.url, a]));
      for (const a of incoming) byUrl.set(a.url, a);
      return Array.from(byUrl.values()).sort(
        (a, b) =>
          new Date(b.published_at).getTime() -
          new Date(a.published_at).getTime(),
      );
    },
    [],
  );

  const fetchInitial = useCallback(
    async (hours: number) => {
      if (!supabase) return;
      setLoading(true);
      setError(null);
      const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
      const { data, error: err } = await supabase
        .from("news_articles")
        .select("*")
        .gte("published_at", cutoff)
        .order("published_at", { ascending: false })
        .limit(PAGE_LIMIT);
      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }
      const rows = (data as NewsArticle[]) ?? [];
      setArticles(rows);
      setLastUpdate(new Date());
      lastFoundAtRef.current =
        rows.length > 0
          ? rows.reduce((max, r) => (r.found_at > max ? r.found_at : max), rows[0].found_at)
          : new Date().toISOString();
      setLoading(false);
    },
    [supabase],
  );

  const fetchIncremental = useCallback(async () => {
    if (!supabase || !lastFoundAtRef.current) return;
    const { data, error: err } = await supabase
      .from("news_articles")
      .select("*")
      .gt("found_at", lastFoundAtRef.current)
      .order("found_at", { ascending: false })
      .limit(PAGE_LIMIT);
    if (err) {
      setError(err.message);
      return;
    }
    const rows = (data as NewsArticle[]) ?? [];
    setLastUpdate(new Date());
    setError(null);
    if (rows.length === 0) return;
    lastFoundAtRef.current = rows.reduce(
      (max, r) => (r.found_at > max ? r.found_at : max),
      lastFoundAtRef.current!,
    );
    setArticles((prev) => {
      const merged = mergeArticles(prev, rows);
      const cutoff = Date.now() - windowHours * 3600 * 1000;
      return merged.filter((a) => new Date(a.published_at).getTime() >= cutoff);
    });
  }, [supabase, mergeArticles, windowHours]);

  useEffect(() => {
    void fetchInitial(windowHours);
  }, [fetchInitial, windowHours]);

  useEffect(() => {
    const id = setInterval(() => {
      void fetchIncremental();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchIncremental]);

  const filtered = useMemo(() => {
    const cutoff = Date.now() - windowHours * 3600 * 1000;
    const inWindow = articles.filter(
      (a) => new Date(a.published_at).getTime() >= cutoff,
    );
    const raw = filter.trim();
    if (!raw) return inWindow;
    const terms = stripAccents(raw.toLowerCase()).split(/\s+/).filter(Boolean);
    return inWindow.filter((a) => {
      const hay = stripAccents(
        `${a.title} ${a.source_name} ${a.snippet} ${a.matched_keywords.join(" ")}`.toLowerCase(),
      );
      return terms.every((t) => hay.includes(t));
    });
  }, [articles, filter, windowHours]);

  if (visLoading || !visible) return null;

  return (
    <>
      <NavBar />
      <div className="container-fluid py-4">
        <div className="d-flex flex-wrap align-items-center gap-3 mb-4">
          <h1 className="h3 mb-0">News Hunter</h1>
          <span className="text-muted small">
            {loading
              ? "⏳ carregando…"
              : lastUpdate
                ? `atualizado ${humanizeAge(lastUpdate.toISOString())}`
                : ""}
          </span>
          <span className="text-muted small ms-auto">auto-refresh: 30s</span>
        </div>

        <div className="row g-3 mb-4">
          <div className="col-md-6">
            <input
              type="search"
              className="form-control"
              placeholder="🔎 Filtrar (título, fonte, snippet)…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <div className="col-md-3">
            <select
              className="form-select"
              value={windowHours}
              onChange={(e) => setWindowHours(Number(e.target.value))}
            >
              {WINDOW_PRESETS.map((h) => (
                <option key={h} value={h}>
                  Janela: {labelForWindow(h)}
                </option>
              ))}
            </select>
          </div>
          <div className="col-md-3 text-muted small d-flex align-items-center">
            {filtered.length} notícia{filtered.length === 1 ? "" : "s"}
            {filter && ` (de ${articles.length})`}
          </div>
        </div>

        {error && (
          <div className="alert alert-warning">Erro ao carregar: {error}</div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="alert alert-light text-center">
            {articles.length === 0
              ? "Nenhuma notícia ainda. Verifique se o scanner local está rodando."
              : "Nenhuma notícia corresponde ao filtro."}
          </div>
        )}

        <div className="row g-3">
          {filtered.map((a) => (
            <div key={a.url} className="col-md-6 col-lg-4">
              <div className="card h-100 shadow-sm">
                <div className="card-body">
                  <div className="d-flex justify-content-between align-items-start mb-2">
                    <span className="badge bg-secondary">{a.source_name}</span>
                    <small className="text-muted">
                      {humanizeAge(a.published_at)}
                    </small>
                  </div>
                  <h5 className="card-title">
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-decoration-none"
                    >
                      {a.title}
                    </a>
                  </h5>
                  {a.snippet && (
                    <p className="card-text small text-muted">{a.snippet}</p>
                  )}
                  <div className="mt-2">
                    {a.matched_keywords.map((kw) => (
                      <span
                        key={kw}
                        className="badge bg-primary-subtle text-primary-emphasis me-1 mb-1"
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="card-footer bg-transparent">
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="small"
                  >
                    🔗 abrir matéria
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
