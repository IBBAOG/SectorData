"use client";

// PDF-style Well-by-Well header table (Round 8, 2026-05-27).
//
// Self-contained shared component consumed by BOTH desktop/View.tsx and
// mobile/View.tsx. Renders an HTML table replicating page 2 of the monthly
// Well-by-Well PDF report:
//
//   ┌────────────────────────────────────────────────────────────────────┐
//   │                            BRAZIL                                  │ ← section header (dark navy)
//   ├────────────────┬───────┬───────┬─────┬───────┬─────┬───────────────┤
//   │  (empty)       │ Apr-26│ Mar-26│ΔMoM │Apr-25 │ΔYoY │     YTD       │ ← column header
//   ├────────────────┼───────┼───────┼─────┼───────┼─────┼───────────────┤
//   │ Oil (kbpd)     │ 4,337 │ 4,272 │ +2% │ 4,200 │ +3% │     4,150     │ ← category header (gray)
//   │   Pre-Salt     │ 3,500 │       │     │       │     │               │ ← indented sub-row
//   │   Post-Salt    │   450 │       │     │       │     │               │
//   │   Onshore      │   387 │       │     │       │     │               │
//   │ Gas (kboed)    │ ...   │ ...   │ ... │ ...   │ ... │     ...       │
//   │ Main fields    │ ...   │       │     │       │     │               │
//   │   Búzios       │   810 │       │     │       │     │               │
//   │   Tupi         │   650 │       │     │       │     │               │
//   ├────────────────┴───────┴───────┴─────┴───────┴─────┴───────────────┤
//   │                          PETROBRAS                                 │
//   └────────────────────────────────────────────────────────────────────┘
//
// Visual contract:
//   • Section header rows ('BRAZIL' / '{EMPRESA}'): dark-navy background,
//     white bold text, full-width row spanning ALL columns.
//   • Category rows ('Oil (kbpd)' / 'Gas (kboed)' / 'Main fields (kbpd)'):
//     light-gray band, bold, no indent.
//   • Sub-rows (Pre-Salt / Post-Salt / Onshore / campo names): white bg,
//     normal weight, indented ~20px.
//   • Numeric cells: right-aligned, pt-BR thousand separator (e.g. 4.337).
//   • Δ MoM / Δ YoY: integer percent with + / - sign (blank if NULL).
//   • Border: 1px solid #c0c0c0 between cells.
//
// Loading state:
//   • `loading && rows.length === 0` → skeleton rows (4 lines).
//   • `loading && rows.length > 0` → opacity 0.7 on existing rows.
//
// Empty state: `rows.length === 0 && !loading` → "No data" caption.
//
// Mobile layout note: parent (mobile/View.tsx) wraps this in a horizontally
// scrollable container with `overflow-x: auto`. The table itself sets
// `minWidth: 480` so all columns remain reachable via horizontal scroll on
// narrow phone widths.

import { useMemo } from "react";

import type { WellByWellView } from "../../../data/wellByWellEmpresas";
import type { WellByWellHeaderRow } from "../../../types/production";

// ─── Number formatters ──────────────────────────────────────────────────────

/** "4.337" — pt-BR thousand separators, no decimals. NULL → "—". */
function fmtIntPtBr(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(n);
}

/** "+2%" / "-1%" / "" — integer percent with sign. NULL → "".
 *
 *  Contract: `p` is already in percent units (the RPC `get_well_by_well_header`
 *  emits `(current/prev - 1) * 100`, e.g. 2.4 means +2.4%). Do NOT multiply by
 *  100 again — we only round to the nearest integer for the PDF-style render.
 */
function fmtPctInt(p: number | null): string {
  if (p == null || !Number.isFinite(p)) return "";
  const v = Math.round(p);
  if (v === 0) return "0%";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v}%`;
}

// ─── Month label formatter ──────────────────────────────────────────────────

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-04-01" → "Apr-26". Used by the column header row. */
function fmtMonthShort(anchor: string): string {
  const y = anchor.slice(2, 4);
  const m = parseInt(anchor.slice(5, 7), 10);
  return `${MONTH_ABBR[m - 1] ?? "???"}-${y}`;
}

/** Shift a YYYY-MM-01 anchor by +/- months (handles year boundary). */
function shiftAnchor(anchor: string, delta: number): string {
  const y = parseInt(anchor.slice(0, 4), 10);
  const m = parseInt(anchor.slice(5, 7), 10) - 1; // 0..11
  const total = y * 12 + m + delta;
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  return `${String(ny).padStart(4, "0")}-${String(nm + 1).padStart(2, "0")}-01`;
}

// ─── Styling tokens ─────────────────────────────────────────────────────────

const COLORS = {
  sectionBg:        "#000512",        // Very Dark Blue — official table section header (matches Excel export header in src/lib/export/core/style.ts)
  sectionFg:        "#ffffff",
  categoryBg:       "#e2e2e6",        // light gray
  categoryFg:       "#1a1a1a",
  rowBg:            "#ffffff",
  border:           "#c0c0c0",
  borderSoft:       "#e5e5e5",
  headerBg:         "#ffffff",
  headerFg:         "#1a1a1a",
  deltaPos:         "#197a39",        // green
  deltaNeg:         "#b3261e",        // red
  muted:            "#888888",
  bodyFg:           "#1a1a1a",
};

const TD_BASE: React.CSSProperties = {
  padding: "5px 8px",
  fontFamily: "Arial",
  fontSize: 11,
  color: COLORS.bodyFg,
  borderBottom: `1px solid ${COLORS.borderSoft}`,
  whiteSpace: "nowrap",
};

const TD_NUM: React.CSSProperties = {
  ...TD_BASE,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

const TH_BASE: React.CSSProperties = {
  padding: "6px 8px",
  fontFamily: "Arial",
  fontSize: 10.5,
  fontWeight: 700,
  color: COLORS.headerFg,
  background: COLORS.headerBg,
  borderBottom: `2px solid ${COLORS.border}`,
  whiteSpace: "nowrap",
};

// ─── Props ──────────────────────────────────────────────────────────────────

export interface HeaderTableProps {
  rows: WellByWellHeaderRow[];
  loading: boolean;
  /** YYYY-MM-DD anchor of the reference month — drives the column header
   *  labels ("Apr-26", "Mar-26", etc.). */
  referenceDate: string;
  /**
   * Round 9 (2026-05-27): when set to "Brasil", only the Brazil section rows
   * render — the company section returned by the RPC is dropped client-side
   * (the underlying RPC still returns both sections because the wrapper needs
   * a non-null empresa param).
   *
   * Round 12 (2026-05-27): empresa views now render ONLY that empresa's
   * section (12 rows: Oil + Gas + Main fields). The Brazil section is hidden
   * to mirror the active pill — picking PRIO shows only PRIO numbers, picking
   * Petrobras shows only Petrobras numbers, etc. Filter is by
   * `section === UPPER(viewMode)` (the RPC body upper-cases the section
   * label, e.g. `'PETROBRAS'`, `'PRIO'`).
   *
   * Optional / defaults to undefined → "show everything" (back-compat with
   * any caller that hasn't been updated yet).
   */
  viewMode?: WellByWellView;
  /**
   * Partial-month indicator (2026-06-11). When true, the "current" column
   * header gains a `*` marker and a footnote renders below the table noting
   * that the latest ANP figures are still partial. Optional / defaults to
   * undefined (false) for back-compat with callers that don't pass it.
   *
   * The caller is responsible for the guard: it should only set this true when
   * the reference month being rendered IS the still-incomplete latest month.
   */
  currentIsPartial?: boolean;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function HeaderTable({
  rows,
  loading,
  referenceDate,
  viewMode,
  currentIsPartial = false,
}: HeaderTableProps): React.ReactElement {
  // Sort rows by display_order defensively (DB should already do this, but
  // guard against future RPC body changes). Round 12 (2026-05-27): the table
  // now renders ONLY the active pill's section.
  //
  //   - Brasil pill   → rows where section === 'BRAZIL' (note the spelling:
  //                     the pill is named in Portuguese, "Brasil", but the
  //                     RPC emits the English-language section label,
  //                     "BRAZIL").
  //   - Empresa pill  → rows where section === UPPER(viewMode). The RPC body
  //                     upper-cases the section label (e.g. 'PETROBRAS',
  //                     'PRIO', 'PETRORECONCAVO', 'BRAVA ENERGIA').
  //
  // The RPC still returns both sections in a single payload — this filter
  // alone handles the partition. That also makes a defensive clear effect on
  // view change unnecessary: stale rows from the previous view simply don't
  // match the new filter.
  const sortedRows = useMemo(() => {
    const sorted = [...rows].sort((a, b) => a.display_order - b.display_order);
    if (viewMode == null) return sorted; // back-compat: show everything
    const wantedSection =
      viewMode === "Brasil" ? "BRAZIL" : viewMode.toUpperCase();
    return sorted.filter(
      (r) => (r.section ?? "").toUpperCase() === wantedSection,
    );
  }, [rows, viewMode]);

  // Column header labels — derive month abbreviations from referenceDate.
  // referenceDate is "YYYY-MM-DD" (always anchored to day 01).
  const colLabels = useMemo(() => {
    if (!referenceDate || referenceDate.length < 7) {
      return {
        current: "Current",
        prevMonth: "Prev mo",
        prevYear: "Prev yr",
      };
    }
    const cur = referenceDate.slice(0, 7) + "-01";
    return {
      current:   fmtMonthShort(cur),
      prevMonth: fmtMonthShort(shiftAnchor(cur, -1)),
      prevYear:  fmtMonthShort(shiftAnchor(cur, -12)),
    };
  }, [referenceDate]);

  const showSkeleton = loading && sortedRows.length === 0;
  const showEmpty = !loading && sortedRows.length === 0;
  const rowsOpacity = loading && sortedRows.length > 0 ? 0.7 : 1;

  return (
    <>
    <div
      className="wbw-header-table-wrap"
      style={{
        // Mobile horizontal-scroll affordance — desktop is wider than 480px
        // anyway so this only activates on phones.
        overflowX: "auto",
        background: COLORS.rowBg,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 4,
        // Prevent table from squishing below readable width on phones.
        // 480px lets all 7 columns render at minimum acceptable density.
      }}
    >
      <table
        style={{
          width: "100%",
          minWidth: 480,
          borderCollapse: "collapse",
          fontFamily: "Arial",
          opacity: rowsOpacity,
          transition: "opacity 0.18s ease",
        }}
      >
        <thead>
          <tr>
            <th style={{ ...TH_BASE, textAlign: "left", width: "30%" }}>
              {/* intentionally blank — left column carries row labels */}
            </th>
            <th style={{ ...TH_BASE, textAlign: "right" }}>
              {colLabels.current}
              {currentIsPartial && <span style={{ color: "#b5860b" }}> *</span>}
            </th>
            <th style={{ ...TH_BASE, textAlign: "right" }}>{colLabels.prevMonth}</th>
            <th style={{ ...TH_BASE, textAlign: "right" }}>Δ MoM</th>
            <th style={{ ...TH_BASE, textAlign: "right" }}>{colLabels.prevYear}</th>
            <th style={{ ...TH_BASE, textAlign: "right" }}>Δ YoY</th>
            <th style={{ ...TH_BASE, textAlign: "right" }}>YTD</th>
          </tr>
        </thead>
        <tbody>
          {showSkeleton && (
            <>
              {[0, 1, 2, 3, 4].map((i) => (
                <tr key={`skel-${i}`}>
                  <td colSpan={7} style={{ ...TD_BASE, padding: "8px 8px" }}>
                    <div
                      className="wbw-header-skeleton"
                      aria-busy="true"
                      aria-label="Loading"
                      style={{
                        height: 14,
                        width: i === 0 ? "55%" : i === 4 ? "70%" : "85%",
                        borderRadius: 3,
                        background: "linear-gradient(90deg, #ececec 0%, #f5f5f5 50%, #ececec 100%)",
                        backgroundSize: "200% 100%",
                        animation: "wbw-header-skel 1.2s ease-in-out infinite",
                      }}
                    />
                  </td>
                </tr>
              ))}
              <style>{`
                @keyframes wbw-header-skel {
                  0%   { background-position: 200% 0%; }
                  100% { background-position: -200% 0%; }
                }
              `}</style>
            </>
          )}

          {showEmpty && (
            <tr>
              <td
                colSpan={7}
                style={{
                  ...TD_BASE,
                  padding: 20,
                  textAlign: "center",
                  color: COLORS.muted,
                  fontSize: 12,
                }}
              >
                No header data for this reference month.
              </td>
            </tr>
          )}

          {sortedRows.map((r, idx) => {
            // Row taxonomy:
            //   • Section header — `subcategory IS NULL` AND category is empty
            //     (RPC returns '' for these full-width banner rows).
            //   • Category header — `subcategory IS NULL` AND category is set
            //     (e.g. "Oil (kbpd)"). Carries the category-total numbers.
            //   • Sub-row — `subcategory IS NOT NULL`. Indented row carrying
            //     an ambiente bucket or campo name.
            //
            // Be tolerant of NULL category (in case the RPC body evolves and
            // section headers send NULL instead of '').
            const catEmpty = !r.category || r.category.trim() === "";
            const isSectionHeader  = r.subcategory == null && catEmpty;
            const isCategoryHeader = r.subcategory == null && !catEmpty;
            const isSubRow         = r.subcategory != null;

            // ── Section header row (e.g. "BRAZIL" / "PETROBRAS") ─────────
            if (isSectionHeader) {
              return (
                <tr key={`row-${idx}-${r.section}-${r.display_order}`}>
                  <td
                    colSpan={7}
                    style={{
                      ...TD_BASE,
                      padding: "8px 12px",
                      background: COLORS.sectionBg,
                      color: COLORS.sectionFg,
                      fontWeight: 800,
                      fontSize: 11.5,
                      letterSpacing: "0.6px",
                      textTransform: "uppercase",
                      borderBottom: `1px solid ${COLORS.border}`,
                    }}
                  >
                    {r.section}
                  </td>
                </tr>
              );
            }

            // ── Category header row (e.g. "Oil (kbpd)") ─────────────────
            if (isCategoryHeader) {
              return (
                <tr key={`row-${idx}-${r.section}-${r.category}-${r.display_order}`}>
                  <td
                    style={{
                      ...TD_BASE,
                      background: COLORS.categoryBg,
                      color: COLORS.categoryFg,
                      fontWeight: 700,
                      padding: "5px 8px",
                    }}
                  >
                    {r.category}
                  </td>
                  <td style={{ ...TD_NUM, background: COLORS.categoryBg, fontWeight: 700 }}>
                    {fmtIntPtBr(r.current_val)}
                  </td>
                  <td style={{ ...TD_NUM, background: COLORS.categoryBg, fontWeight: 700 }}>
                    {fmtIntPtBr(r.prev_month_val)}
                  </td>
                  <td
                    style={{
                      ...TD_NUM,
                      background: COLORS.categoryBg,
                      fontWeight: 700,
                      color: r.mom_pct == null
                        ? COLORS.categoryFg
                        : r.mom_pct >= 0 ? COLORS.deltaPos : COLORS.deltaNeg,
                    }}
                  >
                    {fmtPctInt(r.mom_pct)}
                  </td>
                  <td style={{ ...TD_NUM, background: COLORS.categoryBg, fontWeight: 700 }}>
                    {fmtIntPtBr(r.prev_year_val)}
                  </td>
                  <td
                    style={{
                      ...TD_NUM,
                      background: COLORS.categoryBg,
                      fontWeight: 700,
                      color: r.yoy_pct == null
                        ? COLORS.categoryFg
                        : r.yoy_pct >= 0 ? COLORS.deltaPos : COLORS.deltaNeg,
                    }}
                  >
                    {fmtPctInt(r.yoy_pct)}
                  </td>
                  <td style={{ ...TD_NUM, background: COLORS.categoryBg, fontWeight: 700 }}>
                    {fmtIntPtBr(r.ytd_avg)}
                  </td>
                </tr>
              );
            }

            // ── Sub-row (indented; ambiente bucket or field name) ───────
            if (isSubRow) {
              const fw: React.CSSProperties["fontWeight"] = r.is_total ? 700 : 400;
              return (
                <tr
                  key={`row-${idx}-${r.section}-${r.category}-${r.subcategory}-${r.display_order}`}
                >
                  <td
                    style={{
                      ...TD_BASE,
                      paddingLeft: 28,
                      fontWeight: fw,
                      // Sub-rows of the same category share no inner border;
                      // the category header above already separates them
                      // visually. Use a very soft bottom border.
                      borderBottom: `1px solid ${COLORS.borderSoft}`,
                    }}
                  >
                    {r.subcategory}
                  </td>
                  <td style={{ ...TD_NUM, fontWeight: fw }}>
                    {fmtIntPtBr(r.current_val)}
                  </td>
                  <td style={{ ...TD_NUM, fontWeight: fw }}>
                    {fmtIntPtBr(r.prev_month_val)}
                  </td>
                  <td
                    style={{
                      ...TD_NUM,
                      fontWeight: fw,
                      color: r.mom_pct == null
                        ? COLORS.bodyFg
                        : r.mom_pct >= 0 ? COLORS.deltaPos : COLORS.deltaNeg,
                    }}
                  >
                    {fmtPctInt(r.mom_pct)}
                  </td>
                  <td style={{ ...TD_NUM, fontWeight: fw }}>
                    {fmtIntPtBr(r.prev_year_val)}
                  </td>
                  <td
                    style={{
                      ...TD_NUM,
                      fontWeight: fw,
                      color: r.yoy_pct == null
                        ? COLORS.bodyFg
                        : r.yoy_pct >= 0 ? COLORS.deltaPos : COLORS.deltaNeg,
                    }}
                  >
                    {fmtPctInt(r.yoy_pct)}
                  </td>
                  <td style={{ ...TD_NUM, fontWeight: fw }}>
                    {fmtIntPtBr(r.ytd_avg)}
                  </td>
                </tr>
              );
            }

            // Defensive: row shape we don't recognise — skip silently.
            return null;
          })}
        </tbody>
      </table>
    </div>
    {currentIsPartial && sortedRows.length > 0 && (
      <div
        style={{
          marginTop: 6,
          fontFamily: "Arial",
          fontSize: 10.5,
          color: "#7a5300",
        }}
      >
        * Partial ANP data — figures will be revised.
      </div>
    )}
    </>
  );
}
