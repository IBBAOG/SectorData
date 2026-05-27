"use client";

// Admin-only clipping modal.
// Shows: rendered HTML preview in an iframe, per-URL status pills,
// manual-body textareas for failed/paywalled articles, Download .eml, Copy (rich clipboard).
// Rendering is client-side — no extra network round-trip needed to re-render.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BarrelLoading from "@/components/dashboard/BarrelLoading";
import { buildHtml } from "@/lib/clipping/buildHtml";
import { buildHtmlForClipboard } from "@/lib/clipping/buildHtmlForClipboard";
import { buildEml } from "@/lib/clipping/buildEml";
import { buildPlainText } from "@/lib/clipping/buildPlainText";
import type { ScrapeResult, ClippingItem } from "@/lib/clipping/types";

interface Props {
  open: boolean;
  results: ScrapeResult[];
  onClose: () => void;
  /** Called when admin submits manual bodies — returns new results from re-scrape. */
  onRegenerate: (manualBodies: Record<string, string>) => Promise<void>;
  regenerating: boolean;
}

const STATUS_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  ok: { bg: "#d4edda", color: "#155724", label: "OK" },
  paywall: { bg: "#fff3cd", color: "#856404", label: "Paywall" },
  fetch_failed: { bg: "#f8d7da", color: "#721c24", label: "Fetch failed" },
  unknown_domain: { bg: "#f8d7da", color: "#721c24", label: "Unknown domain" },
  skipped: { bg: "#e2e3e5", color: "#383d41", label: "Skipped" },
  error: { bg: "#f8d7da", color: "#721c24", label: "Error" },
};

export default function ClippingModal({
  open,
  results,
  onClose,
  onRegenerate,
  regenerating,
}: Props) {
  // Tab: "preview" or "status"
  const [tab, setTab] = useState<"preview" | "status">("preview");
  const [manualBodies, setManualBodies] = useState<Record<string, string>>({});
  const [copyToast, setCopyToast] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Compute ClippingItems from successful results.
  const items: ClippingItem[] = results
    .filter((r) => r.status === "ok" && r.item)
    .map((r) => r.item!);

  // Stable date for the clipping — created once when modal opens; useMemo so
  // useCallback deps don't re-trigger on every render.
  const today = useMemo(() => new Date(), [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const htmlContent = buildHtml(items, today);

  // Generate filename as Python does: ibba_oil_gas_news_YYYY-MM-DD.eml
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const emlFilename = `ibba_oil_gas_news_${dateStr}.eml`;

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !regenerating) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, regenerating]);

  // Note: manual bodies and tab reset when the modal component is remounted.
  // The parent passes key={openGeneration} to force remount on each new open.

  const handleDownloadEml = useCallback(() => {
    const bytes = buildEml(items, today);
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "message/rfc822" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = emlFilename;
    a.click();
    URL.revokeObjectURL(url);
  }, [items, today, emlFilename]);

  // Copies the digest as rich content (text/html + text/plain) so that pasting
  // into Outlook or Gmail produces formatted output (headings, links, lists)
  // rather than raw HTML markup.
  const handleCopy = useCallback(async () => {
    const plainContent = buildPlainText(items, today);
    // Use the clipboard-specific HTML (table + <div> + <font> stack) so that
    // pasting into Outlook survives Word's HTML normaliser. The iframe preview
    // above renders `buildHtml(items, today)` (the .eml-shaped HTML) so the
    // user sees exactly what the downloaded .eml will look like.
    const clipboardHtml = buildHtmlForClipboard(items, today);
    try {
      if (navigator.clipboard && typeof ClipboardItem !== "undefined") {
        const clipItem = new ClipboardItem({
          "text/html": new Blob([clipboardHtml], { type: "text/html" }),
          "text/plain": new Blob([plainContent], { type: "text/plain" }),
        });
        await navigator.clipboard.write([clipItem]);
      } else {
        // Legacy fallback — plain text for browsers without ClipboardItem support.
        await navigator.clipboard.writeText(plainContent);
      }
      setCopyToast(true);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setCopyToast(false), 2500);
    } catch {
      // Last-resort fallback for non-secure contexts.
      const ta = document.createElement("textarea");
      ta.value = plainContent;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopyToast(true);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setCopyToast(false), 2500);
    }
  }, [items, today]);

  const handleRegenerate = useCallback(async () => {
    await onRegenerate(manualBodies);
  }, [onRegenerate, manualBodies]);

  const needsManual = results.filter(
    (r) => r.status === "paywall" || r.status === "fetch_failed",
  );

  if (!open) return null;

  return (
    // Backdrop
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="clipping-modal-title"
      onClick={() => { if (!regenerating) onClose(); }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1050,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(2px)",
        fontFamily: "Arial, sans-serif",
      }}
    >
      {/* Panel */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: "min(900px, calc(100vw - 32px))",
          height: "min(700px, calc(100vh - 48px))",
          display: "flex",
          flexDirection: "column",
          background: "#fff",
          borderRadius: 10,
          boxShadow: "0 24px 64px rgba(0,0,0,0.28)",
          overflow: "hidden",
        }}
      >
        {/* Brand accent bar */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background: "#ff5000",
            pointerEvents: "none",
          }}
        />

        {/* Loading overlay */}
        {regenerating && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 10,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              background: "rgba(255,255,255,0.92)",
              backdropFilter: "blur(4px)",
            }}
          >
            <BarrelLoading size={100} />
            <span style={{ fontSize: 13, fontWeight: 600, color: "#555" }}>
              Scraping articles…
            </span>
          </div>
        )}

        {/* Header */}
        <div
          style={{
            padding: "14px 20px 12px",
            borderBottom: "1px solid #e6e6e6",
            background: "#fafafa",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div>
            <span
              id="clipping-modal-title"
              style={{ fontWeight: 700, fontSize: 14, color: "#1a1a1a", letterSpacing: "0.3px" }}
            >
              IBBA Oil &amp; Gas Clipping
            </span>
            <span style={{ marginLeft: 12, fontSize: 12, color: "#888" }}>
              {items.length} article{items.length !== 1 ? "s" : ""} ·{" "}
              {results.length - items.length} failed/skipped
            </span>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            disabled={regenerating}
            style={{
              border: "none",
              background: "transparent",
              fontSize: 20,
              lineHeight: 1,
              color: "#888",
              cursor: regenerating ? "not-allowed" : "pointer",
              padding: "0 4px",
            }}
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: "flex",
            borderBottom: "1px solid #e6e6e6",
            background: "#fafafa",
            flexShrink: 0,
          }}
        >
          {(["preview", "status"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              style={{
                padding: "8px 18px",
                border: "none",
                background: "transparent",
                fontFamily: "Arial, sans-serif",
                fontSize: 13,
                fontWeight: tab === t ? 700 : 400,
                color: tab === t ? "#ff5000" : "#555",
                borderBottom: tab === t ? "2px solid #ff5000" : "2px solid transparent",
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {t === "preview" ? "Preview" : `Status (${results.length})`}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: "1 1 auto", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {tab === "preview" && (
            <iframe
              srcDoc={htmlContent}
              title="Clipping preview"
              sandbox="allow-same-origin"
              style={{ flex: 1, border: "none", width: "100%" }}
            />
          )}

          {tab === "status" && (
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px" }}>
              {results.map((r) => {
                const pill = STATUS_COLORS[r.status] ?? STATUS_COLORS.error;
                const needsBody = r.status === "paywall" || r.status === "fetch_failed";
                return (
                  <div
                    key={r.url}
                    style={{
                      marginBottom: 16,
                      padding: "10px 12px",
                      border: "1px solid #e6e6e6",
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  >
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 4 }}>
                      <span
                        style={{
                          background: pill.bg,
                          color: pill.color,
                          borderRadius: 4,
                          padding: "2px 7px",
                          fontWeight: 700,
                          fontSize: 11,
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                        }}
                      >
                        {pill.label}
                      </span>
                      {r.via === "curl" && (
                        <span
                          title="Content retrieved via plain static curl (bypasses Node TLS fingerprint rejection)"
                          style={{
                            background: "#e8f4fd",
                            color: "#0c5460",
                            borderRadius: 4,
                            padding: "2px 7px",
                            fontSize: 11,
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                            flexShrink: 0,
                          }}
                        >
                          via curl
                        </span>
                      )}
                      {r.via === "curl_impersonate" && (
                        <span
                          title="Content retrieved via curl-impersonate chrome131 (full TLS fingerprint — Cloudflare / Investing.com)"
                          style={{
                            background: "#fff0e6",
                            color: "#7a3200",
                            borderRadius: 4,
                            padding: "2px 7px",
                            fontSize: 11,
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                            flexShrink: 0,
                          }}
                        >
                          via curl-impersonate
                        </span>
                      )}
                      {r.via === "headless" && (
                        <span
                          title="Content retrieved via headless Chromium browser (playwright-core + @sparticuz/chromium — JS challenge execution)"
                          style={{
                            background: "#e6f9ee",
                            color: "#155724",
                            borderRadius: 4,
                            padding: "2px 7px",
                            fontSize: 11,
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                            flexShrink: 0,
                          }}
                        >
                          via headless
                        </span>
                      )}
                      {(r.via === "wayback" || r.via_wayback) && (
                        <span
                          title="Content retrieved from Wayback Machine (live fetch failed or paywalled)"
                          style={{
                            background: "#e8f4fd",
                            color: "#0c5460",
                            borderRadius: 4,
                            padding: "2px 7px",
                            fontSize: 11,
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                            flexShrink: 0,
                          }}
                        >
                          via Wayback
                        </span>
                      )}
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          color: "#1a1a1a",
                          textDecoration: "none",
                          wordBreak: "break-all",
                          flex: 1,
                        }}
                      >
                        {r.item?.title ?? r.url}
                      </a>
                    </div>
                    {r.error && (
                      <p style={{ margin: "4px 0 6px", color: "#888", fontSize: 11 }}>{r.error}</p>
                    )}
                    {needsBody && (
                      <div style={{ marginTop: 6 }}>
                        <label
                          htmlFor={`manual-${r.url}`}
                          style={{ display: "block", fontWeight: 600, marginBottom: 4, color: "#555" }}
                        >
                          Could not fetch — paste body manually:
                        </label>
                        <textarea
                          id={`manual-${r.url}`}
                          rows={5}
                          placeholder="Paste the article text here…"
                          value={manualBodies[r.url] ?? ""}
                          onChange={(e) =>
                            setManualBodies((prev) => ({ ...prev, [r.url]: e.target.value }))
                          }
                          style={{
                            width: "100%",
                            fontFamily: "Arial, sans-serif",
                            fontSize: 12,
                            padding: "6px 8px",
                            border: "1px solid #ccc",
                            borderRadius: 4,
                            resize: "vertical",
                            boxSizing: "border-box",
                          }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}

              {needsManual.length > 0 && (
                <button
                  type="button"
                  onClick={() => void handleRegenerate()}
                  disabled={regenerating}
                  style={{
                    marginTop: 8,
                    background: "#ff5000",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    padding: "9px 18px",
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: regenerating ? "not-allowed" : "pointer",
                    fontFamily: "Arial, sans-serif",
                  }}
                >
                  Regenerate preview
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "10px 20px",
            borderTop: "1px solid #e6e6e6",
            background: "#fafafa",
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          {/* Copy toast */}
          {copyToast && (
            <span style={{ fontSize: 12, color: "#155724", marginRight: 8 }}>
              Copied!
            </span>
          )}
          <button
            type="button"
            onClick={() => void handleCopy()}
            disabled={items.length === 0}
            style={secondaryBtnStyle}
          >
            Copy
          </button>
          <button
            type="button"
            onClick={handleDownloadEml}
            disabled={items.length === 0}
            style={{
              ...secondaryBtnStyle,
              background: "#ff5000",
              color: "#fff",
              border: "none",
              fontWeight: 700,
            }}
          >
            Download .eml
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={regenerating}
            style={{ ...secondaryBtnStyle, marginLeft: 8 }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

const secondaryBtnStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #ccc",
  borderRadius: 6,
  padding: "7px 14px",
  fontSize: 13,
  cursor: "pointer",
  fontFamily: "Arial, sans-serif",
  color: "#333",
};
