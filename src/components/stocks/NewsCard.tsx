"use client";

import { useEffect, useMemo, useState } from "react";
import { useNewsHunter } from "../../context/NewsHunterContext";

const WINDOW_OPTIONS = [
  { label: "1h", value: 1 },
  { label: "3h", value: 3 },
  { label: "6h", value: 6 },
  { label: "12h", value: 12 },
  { label: "24h", value: 24 },
  { label: "48h", value: 48 },
  { label: "7d", value: 168 },
] as const;

function stripAccents(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function humanizeAge(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "agora";
  if (secs < 3600) return `há ${Math.floor(secs / 60)} min`;
  if (secs < 86400) return `há ${Math.floor(secs / 3600)} h`;
  return `há ${Math.floor(secs / 86400)} d`;
}

function formatTimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function labelForHours(h: number): string {
  if (h < 24) return `${h}h`;
  if (h === 168) return "7d";
  return `${h / 24}d`;
}

function DragIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.4 }}>
      <circle cx="5" cy="3" r="1.5" /><circle cx="11" cy="3" r="1.5" />
      <circle cx="5" cy="8" r="1.5" /><circle cx="11" cy="8" r="1.5" />
      <circle cx="5" cy="13" r="1.5" /><circle cx="11" cy="13" r="1.5" />
    </svg>
  );
}

export function NewsCard({ isDark, onRemove }: { isDark: boolean; onRemove: () => void }) {
  const { articles, justArrivedUrls, keywords, loading } = useNewsHunter();
  const [windowHours, setWindowHours] = useState(6);
  const [, setAgeTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setAgeTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    const cutoff = Date.now() - windowHours * 3600 * 1000;
    const inWindow = articles.filter(
      (a) => new Date(a.published_at).getTime() >= cutoff,
    );
    if (keywords.length === 0) return inWindow;
    const terms = keywords
      .map((k) => stripAccents(k.toLowerCase()).trim())
      .filter(Boolean);
    if (terms.length === 0) return inWindow;
    return inWindow.filter((a) => {
      const hay = stripAccents(
        `${a.title} ${a.source_name} ${a.snippet} ${(a.matched_keywords ?? []).join(" ")}`.toLowerCase(),
      );
      return terms.some((t) => hay.includes(t));
    });
  }, [articles, windowHours, keywords]);

  const borderColor = isDark ? "rgba(255,255,255,0.1)" : "#e0e0e0";
  const mutedColor = isDark ? "rgba(255,255,255,0.45)" : "#888";
  const textColor = isDark ? "#e6edf3" : "#111";
  const hoverColor = isDark ? "#ffd400" : "#b58700";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <style>{`
        @keyframes nhCardFlashAnim {
          0%, 100% { background-color: transparent; }
          40% { background-color: #ffd40033; }
        }
        .nh-card-row-flash { animation: nhCardFlashAnim 3.2s ease-in-out 1; }
        .nh-card-link:hover { color: ${hoverColor} !important; }
        .nh-card-link:hover span { color: ${hoverColor} !important; }
      `}</style>

      {/* Card header */}
      <div
        className="sd-drag-handle"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "4px 0 6px",
          gap: 6,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <DragIcon />
          <span style={{ fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
            News Hunter
          </span>
          {loading && (
            <span
              className="spinner-border spinner-border-sm"
              style={{ width: 10, height: 10, borderWidth: 1.5, color: mutedColor }}
            />
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <select
            className="sd-select"
            style={{ fontSize: 10, padding: "1px 18px 1px 4px" }}
            value={windowHours}
            onChange={(e) => setWindowHours(Number(e.target.value))}
          >
            {WINDOW_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            className="sd-btn"
            style={{ padding: "1px 5px", fontSize: 9, lineHeight: 1, opacity: 0.5 }}
            onClick={onRemove}
          >
            x
          </button>
        </div>
      </div>

      {/* Meta row */}
      <div
        style={{
          fontSize: 10,
          color: mutedColor,
          marginBottom: 4,
          paddingBottom: 4,
          borderBottom: `1px solid ${borderColor}`,
          flexShrink: 0,
        }}
      >
        {filtered.length} manchete{filtered.length !== 1 ? "s" : ""}{" "}
        · últimas {labelForHours(windowHours)}
      </div>

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div style={{ fontSize: 11, color: mutedColor, textAlign: "center", padding: "16px 0" }}>
          Sem manchetes nesta janela.
        </div>
      )}

      {/* Headlines */}
      {filtered.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, overflowY: "auto", flex: 1 }}>
          {filtered.map((a) => (
            <li
              key={a.url}
              className={justArrivedUrls.has(a.url) ? "nh-card-row-flash" : undefined}
              style={{
                display: "flex",
                gap: 6,
                alignItems: "baseline",
                padding: "4px 2px",
                borderBottom: `1px solid ${borderColor}`,
                borderRadius: 2,
              }}
            >
              <span
                style={{
                  fontWeight: 700,
                  fontSize: 10,
                  minWidth: 36,
                  color: textColor,
                  fontVariantNumeric: "tabular-nums",
                  flexShrink: 0,
                }}
              >
                {formatTimeLocal(a.published_at)}
              </span>
              <a
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="nh-card-link"
                style={{
                  flex: 1,
                  minWidth: 0,
                  color: textColor,
                  textDecoration: "none",
                  overflow: "hidden",
                  display: "flex",
                  gap: 5,
                  alignItems: "baseline",
                }}
              >
                <span style={{ fontWeight: 700, fontSize: 10, whiteSpace: "nowrap", flexShrink: 0 }}>
                  {a.source_name}:
                </span>
                <span
                  style={{
                    fontSize: 11,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {a.title}
                </span>
              </a>
              <time
                dateTime={a.published_at}
                style={{
                  fontSize: 10,
                  color: mutedColor,
                  whiteSpace: "nowrap",
                  marginLeft: "auto",
                  paddingLeft: 6,
                  flexShrink: 0,
                }}
              >
                {humanizeAge(a.published_at)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
