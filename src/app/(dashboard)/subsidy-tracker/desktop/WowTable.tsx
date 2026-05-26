"use client";

// ─── WowTable — week-on-week data table for the subsidy-tracker desktop view ──
//
// Renders a Bootstrap table-sm with 4 rows (one per series) and 4 columns:
//   Series (colored swatch + label) | Last reading | Date | WoW %

import type { SubsidyTrackerWowRow } from "../useSubsidyTrackerData";
import { fmtDateLabel } from "../useSubsidyTrackerData";

interface WowTableProps {
  rows: SubsidyTrackerWowRow[];
}

function ColorSwatch({ color }: { color: string }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: 2,
        background: color,
        flexShrink: 0,
        marginRight: 6,
        verticalAlign: "middle",
      }}
    />
  );
}

function WoWCell({ pct }: { pct: number | null }): React.ReactElement {
  if (pct == null) {
    return <span style={{ color: "#aaa" }}>—</span>;
  }
  const positive = pct > 0;
  const color = positive ? "#15803d" : pct < 0 ? "#b91c1c" : "#555";
  const sign = positive ? "+" : "";
  return (
    <span
      style={{
        color,
        fontWeight: 600,
        fontVariantNumeric: "tabular-nums",
        fontFamily: "Arial",
      }}
    >
      {sign}{pct.toFixed(2)}%
    </span>
  );
}

export default function WowTable({ rows }: WowTableProps): React.ReactElement {
  return (
    <table
      className="table table-sm"
      style={{
        fontSize: 12,
        marginTop: 8,
        marginBottom: 0,
        fontFamily: "Arial, Helvetica, sans-serif",
        borderCollapse: "collapse",
      }}
    >
      <thead>
        <tr style={{ color: "#888", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          <th style={{ borderTop: "none", paddingLeft: 0, width: "35%" }}>Series</th>
          <th style={{ borderTop: "none", textAlign: "right", width: "22%" }}>Last</th>
          <th style={{ borderTop: "none", textAlign: "right", width: "25%" }}>Date</th>
          <th style={{ borderTop: "none", textAlign: "right", width: "18%" }}>WoW</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.field} style={{ borderBottom: "1px solid #f0f0f0" }}>
            <td style={{ paddingLeft: 0, verticalAlign: "middle" }}>
              <ColorSwatch color={r.color} />
              <span style={{ verticalAlign: "middle", fontWeight: 500 }}>{r.label}</span>
            </td>
            <td style={{ textAlign: "right", verticalAlign: "middle", fontVariantNumeric: "tabular-nums", fontFamily: "Arial", fontWeight: 600 }}>
              {r.latestValue != null ? `R$ ${r.latestValue.toFixed(2)}` : <span style={{ color: "#aaa" }}>—</span>}
            </td>
            <td style={{ textAlign: "right", verticalAlign: "middle", color: "#666" }}>
              {r.latestDate ? fmtDateLabel(r.latestDate) : <span style={{ color: "#aaa" }}>—</span>}
            </td>
            <td style={{ textAlign: "right", verticalAlign: "middle" }}>
              <WoWCell pct={r.wowPct} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
