"use client";

// Admin-only right-rail sidebar showing the ordered selection queue.
// Displayed only when Selection Mode is active.

import BarrelLoading from "@/components/dashboard/BarrelLoading";
import type { ArticleSnapshot } from "@/lib/clipping/types";

interface Props {
  selection: ArticleSnapshot[];
  onRemove: (url: string) => void;
  onClear: () => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onGenerate: () => void;
  generating: boolean;
}

export default function SelectionSidebar({
  selection,
  onRemove,
  onClear,
  onMoveUp,
  onMoveDown,
  onGenerate,
  generating,
}: Props) {
  return (
    <aside
      style={{
        position: "fixed",
        top: 60,
        right: 0,
        width: 280,
        height: "calc(100vh - 60px)",
        background: "#fff",
        borderLeft: "2px solid #ff5000",
        display: "flex",
        flexDirection: "column",
        zIndex: 200,
        fontFamily: "Arial, sans-serif",
        fontSize: 13,
        boxShadow: "-4px 0 16px rgba(0,0,0,0.08)",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 14px 10px",
          borderBottom: "1px solid #eee",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#fff3ee",
        }}
      >
        <span style={{ fontWeight: 700, color: "#ff5000", fontSize: 14 }}>
          Clipping Queue
        </span>
        <span style={{ color: "#666", fontSize: 12 }}>
          {selection.length} article{selection.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* List */}
      <ul
        style={{
          flex: "1 1 auto",
          overflowY: "auto",
          margin: 0,
          padding: "8px 0",
          listStyle: "none",
        }}
      >
        {selection.length === 0 && (
          <li
            style={{
              padding: "20px 14px",
              color: "#999",
              fontStyle: "italic",
              fontSize: 12,
              textAlign: "center",
            }}
          >
            No articles selected.
            <br />
            Click checkboxes in the feed.
          </li>
        )}
        {selection.map((article, idx) => (
          <li
            key={article.url}
            style={{
              padding: "8px 12px",
              borderBottom: "1px solid #f0f0f0",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div style={{ display: "flex", gap: 4, alignItems: "flex-start" }}>
              {/* Order badge */}
              <span
                style={{
                  background: "#ff5000",
                  color: "#fff",
                  borderRadius: "50%",
                  width: 18,
                  height: 18,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  fontWeight: 700,
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                {idx + 1}
              </span>
              <span
                style={{
                  flex: 1,
                  lineHeight: 1.35,
                  fontSize: 12,
                  color: "#1a1a1a",
                  wordBreak: "break-word",
                }}
              >
                <b style={{ color: "#555", fontSize: 11 }}>{article.source_name}</b>{" "}
                {article.title}
              </span>
            </div>
            {/* Controls */}
            <div style={{ display: "flex", gap: 4, paddingLeft: 22 }}>
              <button
                type="button"
                onClick={() => onMoveUp(idx)}
                disabled={idx === 0 || generating}
                title="Move up"
                style={arrowBtnStyle}
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => onMoveDown(idx)}
                disabled={idx === selection.length - 1 || generating}
                title="Move down"
                style={arrowBtnStyle}
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => onRemove(article.url)}
                disabled={generating}
                title="Remove"
                style={{ ...arrowBtnStyle, color: "#a8232f", marginLeft: "auto" }}
              >
                ×
              </button>
            </div>
          </li>
        ))}
      </ul>

      {/* Footer actions */}
      <div
        style={{
          padding: "10px 12px",
          borderTop: "1px solid #eee",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <button
          type="button"
          onClick={onGenerate}
          disabled={selection.length === 0 || generating}
          style={{
            background: selection.length === 0 ? "#ccc" : "#ff5000",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "9px 14px",
            fontWeight: 700,
            fontSize: 13,
            cursor: selection.length === 0 || generating ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            fontFamily: "Arial, sans-serif",
          }}
        >
          {generating ? (
            <>
              <BarrelLoading size={18} bare />
              Scraping…
            </>
          ) : (
            "Generate Clipping"
          )}
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={selection.length === 0 || generating}
          style={{
            background: "transparent",
            border: "1px solid #ccc",
            borderRadius: 6,
            padding: "7px 14px",
            fontSize: 12,
            color: "#666",
            cursor: selection.length === 0 || generating ? "not-allowed" : "pointer",
            fontFamily: "Arial, sans-serif",
          }}
        >
          Clear selection
        </button>
      </div>
    </aside>
  );
}

const arrowBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid #ddd",
  borderRadius: 4,
  padding: "1px 6px",
  fontSize: 13,
  cursor: "pointer",
  color: "#555",
  lineHeight: 1.4,
  fontFamily: "Arial, sans-serif",
};
