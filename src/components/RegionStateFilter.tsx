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
    const next = selectedUfs.filter((u) => visibleUfs.includes(u));
    if (next.length !== selectedUfs.length) onUfsChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleUfs.join("|")]);

  function toggleRegion(r: string) {
    if (selectedRegioes.includes(r)) onRegioesChange(selectedRegioes.filter((x) => x !== r));
    else onRegioesChange(Array.from(new Set([...selectedRegioes, r])));
  }

  function toggleUf(u: string) {
    if (selectedUfs.includes(u)) onUfsChange(selectedUfs.filter((x) => x !== u));
    else onUfsChange(Array.from(new Set([...selectedUfs, u])));
  }

  return (
    <div>
      <div className="filter-chip-actions">
        <button
          type="button"
          className="filter-btn-link filter-btn-link--secondary"
          onClick={() => onRegioesChange(regioes.slice())}
        >
          {props.regAllLabel ?? "All regions"}
        </button>
        <button
          type="button"
          className="filter-btn-link filter-btn-link--secondary"
          onClick={() => onRegioesChange([])}
        >
          {props.regClearLabel ?? "Clear"}
        </button>
      </div>

      {regioes.length === 0 ? (
        <div style={{ fontSize: 12, color: "#888", fontFamily: "Arial" }}>
          No regions available.
        </div>
      ) : (
        <div className="filter-chip-group">
          {regioes.map((r) => (
            <button
              key={r}
              type="button"
              className={`filter-chip${selectedRegioes.includes(r) ? " filter-chip--active" : ""}`}
              onClick={() => toggleRegion(r)}
            >
              {String(r)}
            </button>
          ))}
        </div>
      )}

      {visibleUfs.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "#aaa", fontFamily: "Arial" }}>
              States
            </div>
            <div className="filter-chip-actions" style={{ marginBottom: 0 }}>
              <button
                type="button"
                className="filter-btn-link filter-btn-link--secondary"
                onClick={() => onUfsChange(visibleUfs.slice())}
              >
                All
              </button>
              <button
                type="button"
                className="filter-btn-link filter-btn-link--secondary"
                onClick={() => onUfsChange([])}
              >
                Clear
              </button>
            </div>
          </div>
          <div className="filter-chip-group">
            {visibleUfs.map((u) => (
              <button
                key={u}
                type="button"
                className={`filter-chip${selectedUfs.includes(u) ? " filter-chip--active" : ""}`}
                onClick={() => toggleUf(u)}
              >
                {String(u)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
