"use client";

// ─────────────────────────────────────────────────────────────────────────────
// TEMPORARY BANNER — P-78 daily-panel coverage gap. REMOVE WHEN ANP ADDS P-78.
//
// Removal condition: the day ANP registers FPSO P-78 ("PETROBRAS 78") in the
// daily Power BI panel, the ops canary (`cdp_roster_canary.yml`) emails the
// team and the 3×/day full-range ETL auto-backfills the entire history on its
// own — no data work needed here. Then DELETE this file and its render sites
// (desktop/View.tsx: below DashboardHeader; mobile/View.tsx: landing card +
// top of the Explore BottomSheet).
//
// Static by design — no RPC/data-driven gating (the canary is the trigger).
//
// Facts behind the copy (verified live against ANP's API on 2026-06-10):
// the daily panel has NOT registered P-78 at ANY granularity (field totals,
// installations, wells). Its two producer wells, 7-BUZ-79-RJS (first oil
// late Dec-2025) and 7-BUZ-94D-RJS (first oil late Mar-2026), Búzios field,
// produced ~87 kbpd gross in Apr-2026 and are ramping up. The monthly CDP
// data (/well-by-well, "Brazil Production Summary") DOES include P-78.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";

// Project warning palette (same family as the well-by-well tab-error boxes
// and the legacy ExportPanel warnings: #fff3cd / #ffe69c / #7d5800), with a
// #d97706 amber accent (design identity's canonical amber).
const AMBER_BG     = "#fff3cd";
const AMBER_BORDER = "#ffe69c";
const AMBER_ACCENT = "#d97706";
const AMBER_TEXT   = "#7d5800";
const AMBER_STRONG = "#664d03";

function WarningIcon({ size }: { size: number }): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0, marginTop: 2 }}
    >
      <path d="M12 3 L22.5 20.5 H1.5 Z" fill={AMBER_ACCENT} />
      <rect x="11" y="9.4" width="2" height="5.6" rx="1" fill="#fff" />
      <rect x="11" y="16.6" width="2" height="2" rx="1" fill="#fff" />
    </svg>
  );
}

/**
 * Prominent amber notice telling users the daily data does not include FPSO
 * P-78 yet. Rendered by BOTH views (binding dual-view sync — single source of
 * copy by construction): desktop directly under the DashboardHeader (above the
 * primary tab bar, so every tab sees it); mobile as an alert card under the
 * page heading plus a repeat at the top of the Explore BottomSheet (the sheet
 * covers the landing card).
 */
export default function P78CoverageNotice({
  variant,
}: {
  variant: "desktop" | "mobile";
}): React.ReactElement {
  const isMobile = variant === "mobile";
  return (
    <div
      role="alert"
      style={{
        display:      "flex",
        gap:          10,
        alignItems:   "flex-start",
        padding:      isMobile ? "12px 14px" : "12px 16px",
        background:   AMBER_BG,
        border:       `1px solid ${AMBER_BORDER}`,
        borderLeft:   `4px solid ${AMBER_ACCENT}`,
        borderRadius: isMobile ? 12 : 8,
        fontFamily:   "Arial, Helvetica, sans-serif",
        lineHeight:   1.5,
      }}
    >
      <WarningIcon size={isMobile ? 16 : 18} />
      <div style={{ fontSize: isMobile ? 12 : 13, color: AMBER_TEXT }}>
        <div
          style={{
            fontWeight:   700,
            marginBottom: 2,
            color:        AMBER_STRONG,
            fontSize:     isMobile ? 13 : 14,
          }}
        >
          Data coverage notice — FPSO P-78 not yet in ANP&apos;s daily panel
        </div>
        ANP&apos;s daily panel does not yet include FPSO P-78 (Búzios) — its two
        producer wells (~87 kbpd gross in Apr-2026, ramping up) are absent at
        every level, so daily figures here understate Búzios and Petrobras net
        production by roughly 85–90 kbpd. Monthly data on{" "}
        <Link
          href="/well-by-well"
          style={{ color: AMBER_STRONG, fontWeight: 700, textDecoration: "underline" }}
        >
          Brazil Production Summary
        </Link>{" "}
        already includes P-78; the full history here backfills automatically the
        moment ANP adds it.
      </div>
    </div>
  );
}
