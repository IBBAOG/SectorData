"use client";

import { useEffect, useMemo } from "react";
import { ufsForRegion } from "../lib/filterUtils";

export default function RegionStateFilter(props: {
  regioes: string[];
  ufs: string[];
  selectedRegioes: string[];
  selectedUfs: string[];
  onRegioesChange: (next: string[]) => void;
  onUfsChange: (next: string[]) => void;
  regAllLabel?: string;
  regClearLabel?: string;
}) {
  const {
    regioes,
    ufs,
    selectedRegioes,
    selectedUfs,
    onRegioesChange,
    onUfsChange,
  } = props;

  const visibleUfs = useMemo(() => {
    if (!selectedRegioes || selectedRegioes.length === 0) return [];
    const set = new Set<string>();
    for (const r of selectedRegioes) {
      for (const u of ufsForRegion(r, ufs)) set.add(u);
    }
    return Array.from(set);
  }, [selectedRegioes, ufs]);

  useEffect(() => {
    if (!visibleUfs.length) {
      onUfsChange([]);
      return;
    }
    // Keep only UFs still visible with current regions
    const next = selectedUfs.filter((u) => visibleUfs.includes(u));
    if (next.length !== selectedUfs.length) onUfsChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleUfs.join("|")]);

  return (
    <div>
      <div className="d-flex gap-2 mb-1">
        <button
          type="button"
          className="btn btn-link p-0"
          style={{
            fontSize: 11,
            color: "#FF5000",
            fontFamily: "Arial",
            fontWeight: 600,
          }}
          onClick={() => onRegioesChange(regioes.slice())}
        >
          {props.regAllLabel ?? "All regions"}
        </button>
        <button
          type="button"
          className="btn btn-link p-0"
          style={{
            fontSize: 11,
            color: "#888",
            fontFamily: "Arial",
            fontWeight: 600,
          }}
          onClick={() => onRegioesChange([])}
        >
          {props.regClearLabel ?? "Clear"}
        </button>
      </div>
      <hr style={{ margin: "4px 0 6px 0", borderTop: "1px solid #e0e0e0" }} />

      {regioes.length === 0 ? (
        <div style={{ fontSize: 12, color: "#888", fontFamily: "Arial" }}>
          No regions available.
        </div>
      ) : (
        <div style={{ fontFamily: "Arial", fontSize: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          {regioes.map((r) => (
            <label
              key={r}
              style={{ display: "flex", alignItems: "center", gap: 8, userSelect: "none" }}
            >
              <input
                type="checkbox"
                checked={selectedRegioes.includes(r)}
                onChange={(e) => {
                  const checked = e.target.checked;
                  if (checked) onRegioesChange(Array.from(new Set([...selectedRegioes, r])));
                  else onRegioesChange(selectedRegioes.filter((x) => x !== r));
                }}
              />
              <span>{String(r)}</span>
            </label>
          ))}
        </div>
      )}

      <div style={{ marginTop: 10, display: visibleUfs.length ? "block" : "none" }}>
        <hr style={{ margin: "6px 0", borderTop: "1px solid #e0e0e0" }} />
        <div style={{ fontSize: 11, color: "#888", marginBottom: 4, fontFamily: "Arial" }}>
          States
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, fontFamily: "Arial", fontSize: 12 }}>
          {visibleUfs.map((u) => (
            <label
              key={u}
              style={{ display: "flex", alignItems: "center", gap: 8, userSelect: "none" }}
            >
              <input
                type="checkbox"
                checked={selectedUfs.includes(u)}
                onChange={(e) => {
                  const checked = e.target.checked;
                  if (checked) onUfsChange(Array.from(new Set([...selectedUfs, u])));
                  else onUfsChange(selectedUfs.filter((x) => x !== u));
                }}
              />
              <span>{String(u)}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

