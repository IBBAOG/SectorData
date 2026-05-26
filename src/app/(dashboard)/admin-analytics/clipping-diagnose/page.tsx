"use client";

// /admin-analytics/clipping-diagnose — Admin-only diagnostic tool for the
// clipping extraction pipeline.
//
// Paste any article URL and click "Run Diagnose" to call
// POST /api/clipping/scrape?debug=1. The response is displayed in three
// side-by-side panels:
//   1. Debug metadata (selectorUsed, paragraph counts, viaCascade)
//   2. Extracted paragraphs (numbered, final output)
//   3. Noise samples removed by the pipeline
//
// Auth: useRoleGuard("Admin") — non-Admins are redirected to /home.
// This is a read-only diagnostic tool; it does not persist anything.
//
// Phase 5 of the clipping reform plan (see src/lib/clipping/README.md).

import { useCallback, useState } from "react";

import NavBar from "@/components/NavBar";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { getSupabaseClient } from "@/lib/supabaseClient";
import type { ScrapeResult, ScrapeDebug } from "@/lib/clipping/types";

const ORANGE = "#FF5000";

// ── Helpers ─────────────────────────────────────────────────────────────────

async function getSessionToken(): Promise<string | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function runDiagnose(url: string): Promise<ScrapeResult | null> {
  const token = await getSessionToken();
  if (!token) return null;

  const res = await fetch("/api/clipping/scrape?debug=1", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ urls: [url] }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }

  const results: ScrapeResult[] = await res.json();
  return results[0] ?? null;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MetaPanel({ debug, status }: { debug: ScrapeDebug | undefined; status: string }) {
  const rows: [string, React.ReactNode][] = debug
    ? [
        ["Selector used", debug.selectorUsed ?? <em style={{ color: "#999" }}>none matched</em>],
        ["Container HTML bytes", debug.containerHtmlByteSize.toLocaleString()],
        ["<p> count raw", debug.pCountRaw],
        ["<p> after stripNoise", debug.pCountAfterStripNoise],
        ["<p> after cleanParagraphs", debug.pCountAfterClean],
        ["Fetch cascade", debug.viaCascade.join(" → ") || "—"],
      ]
    : [["Fetch status", status]];

  return (
    <div style={panelStyle}>
      <h3 style={panelHeading}>Debug Metadata</h3>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: "5px 8px", color: "#555", whiteSpace: "nowrap", verticalAlign: "top" }}>
                {label}
              </td>
              <td style={{ padding: "5px 8px", wordBreak: "break-all" }}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ParagraphsPanel({ paragraphs, title }: { paragraphs: string[]; title: string }) {
  return (
    <div style={panelStyle}>
      <h3 style={panelHeading}>
        Extracted paragraphs{" "}
        <span style={{ fontWeight: 400, fontSize: 13, color: "#777" }}>
          ({paragraphs.length})
        </span>
      </h3>
      {title && (
        <p style={{ fontSize: 12, color: ORANGE, fontWeight: 600, marginBottom: 8, wordBreak: "break-word" }}>
          {title}
        </p>
      )}
      {paragraphs.length === 0 ? (
        <p style={{ color: "#999", fontStyle: "italic", fontSize: 13 }}>No paragraphs extracted.</p>
      ) : (
        <ol style={{ paddingLeft: 22, margin: 0 }}>
          {paragraphs.map((p, i) => (
            <li
              key={i}
              style={{
                fontSize: 13,
                lineHeight: 1.5,
                marginBottom: 6,
                color: "#222",
                wordBreak: "break-word",
              }}
            >
              {p}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function NoiseSamplesPanel({ samples }: { samples: string[] }) {
  return (
    <div style={panelStyle}>
      <h3 style={panelHeading}>
        Noise removed samples{" "}
        <span style={{ fontWeight: 400, fontSize: 13, color: "#777" }}>
          (up to 3)
        </span>
      </h3>
      {samples.length === 0 ? (
        <p style={{ color: "#999", fontStyle: "italic", fontSize: 13 }}>
          No noise samples recorded. Either nothing was discarded or debug was not active.
        </p>
      ) : (
        <ul style={{ paddingLeft: 18, margin: 0 }}>
          {samples.map((s, i) => (
            <li
              key={i}
              style={{
                fontSize: 12,
                lineHeight: 1.4,
                marginBottom: 8,
                color: "#c0392b",
                wordBreak: "break-word",
                fontFamily: "monospace",
              }}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: "#fff",
  border: "1px solid #e0e0e0",
  borderRadius: 8,
  padding: 16,
  overflowY: "auto",
  maxHeight: 600,
};

const panelHeading: React.CSSProperties = {
  margin: "0 0 12px",
  fontSize: 14,
  fontWeight: 600,
  color: "#1a1a1a",
  borderBottom: `2px solid ${ORANGE}`,
  paddingBottom: 6,
};

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ClippingDiagnosePage(): React.ReactElement | null {
  const { allowed, loading: guardLoading } = useRoleGuard("Admin");

  const [url, setUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScrapeResult | null>(null);

  const handleRun = useCallback(async () => {
    if (!url.trim()) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const r = await runDiagnose(url.trim());
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [url]);

  if (guardLoading || !allowed) return null;

  const paragraphs = result?.item?.paragraphs ?? [];
  const title = result?.item?.title ?? "";
  const debug = result?.debug;
  const status = result?.status ?? "";
  const noiseSamples = debug?.noiseRemovedSamples ?? [];

  return (
    <>
      <NavBar />
      <div style={{ padding: "24px 32px", background: "#f5f5f5", minHeight: "100vh" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#1a1a1a", margin: "0 0 4px" }}>
          Clipping Pipeline Diagnose
        </h1>
        <p style={{ fontSize: 13, color: "#666", margin: "0 0 20px" }}>
          Admin-only. Calls{" "}
          <code style={{ background: "#eee", padding: "1px 4px", borderRadius: 3 }}>
            POST /api/clipping/scrape?debug=1
          </code>{" "}
          and shows pipeline internals. See{" "}
          <code style={{ background: "#eee", padding: "1px 4px", borderRadius: 3 }}>
            src/lib/clipping/README.md
          </code>{" "}
          for interpretation guide.
        </p>

        {/* Input row */}
        <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRun();
            }}
            placeholder="https://www.example.com.br/artigo-slug"
            style={{
              flex: 1,
              padding: "9px 12px",
              fontSize: 14,
              border: "1px solid #ccc",
              borderRadius: 6,
              outline: "none",
              fontFamily: "inherit",
            }}
            disabled={running}
          />
          <button
            onClick={handleRun}
            disabled={running || !url.trim()}
            style={{
              padding: "9px 20px",
              background: running || !url.trim() ? "#ccc" : ORANGE,
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 600,
              cursor: running || !url.trim() ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {running ? "Running…" : "Run Diagnose"}
          </button>
        </div>

        {/* Status badge */}
        {result && !error && (
          <div style={{ marginBottom: 16 }}>
            <span
              style={{
                display: "inline-block",
                padding: "3px 10px",
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 600,
                background:
                  status === "ok"
                    ? "#e6f9ee"
                    : status === "paywall"
                    ? "#fff0e6"
                    : "#fdecea",
                color:
                  status === "ok"
                    ? "#1a7a3d"
                    : status === "paywall"
                    ? "#b95000"
                    : "#c0392b",
              }}
            >
              Status: {status}
            </span>
            {result.via && (
              <span
                style={{
                  display: "inline-block",
                  marginLeft: 8,
                  padding: "3px 10px",
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  background: "#e8f4fd",
                  color: "#1a5a8a",
                }}
              >
                via {result.via}
              </span>
            )}
            {result.via_wayback && (
              <span
                style={{
                  display: "inline-block",
                  marginLeft: 8,
                  padding: "3px 10px",
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  background: "#e8f4fd",
                  color: "#1a5a8a",
                }}
              >
                via Wayback
              </span>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div
            style={{
              padding: "12px 16px",
              background: "#fdecea",
              border: "1px solid #f5c6cb",
              borderRadius: 6,
              color: "#c0392b",
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            <strong>Error:</strong> {error}
          </div>
        )}

        {result?.error && status !== "ok" && (
          <div
            style={{
              padding: "12px 16px",
              background: "#fffbe6",
              border: "1px solid #ffe58f",
              borderRadius: 6,
              color: "#7d5a00",
              fontSize: 13,
              fontFamily: "monospace",
              marginBottom: 16,
              wordBreak: "break-all",
            }}
          >
            {result.error}
          </div>
        )}

        {/* Three-column output */}
        {result && (
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
            <MetaPanel debug={debug} status={status} />
            <ParagraphsPanel paragraphs={paragraphs} title={title} />
            <NoiseSamplesPanel samples={noiseSamples} />
          </div>
        )}
      </div>
    </>
  );
}
