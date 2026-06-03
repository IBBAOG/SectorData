// moduleIcons.tsx — Centralized SVG icon registry for all dashboard module slugs.
//
// Each icon is a React element (inline SVG). Icons are decorative — always pair with
// a visible module name. Use aria-hidden="true" on the icon wrapper.
//
// Design intent: clean, modern 2px-stroke outline icons on a 24×24 viewBox,
// round linecap/linejoin. Brand orange (#ff5000) is applied by the consumer
// via `color: inherit` on the wrapper, not baked into the SVG.

import React from "react";

type IconElement = React.ReactElement;

interface SlugIconProps {
  size?: number;
  strokeWidth?: number;
}

// ── Individual icon components ──────────────────────────────────────────────

export function IconMarketShare({ size = 24, strokeWidth = 2 }: SlugIconProps): IconElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <path d="M12 2v10l7 7" />
      <circle cx="12" cy="12" r="10" />
      <path d="M12 12 5 5" />
    </svg>
  );
}

export function IconNaviosDiesel({ size = 24, strokeWidth = 2 }: SlugIconProps): IconElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <path d="M3 17l2 3h14l2-3" />
      <path d="M3 17l9-5 9 5" />
      <path d="M12 3v9" />
      <path d="M8.5 7h7" />
    </svg>
  );
}

export function IconDieselGasolineMargins({ size = 24, strokeWidth = 2 }: SlugIconProps): IconElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <path d="M3 17h18" />
      <path d="M5 17l4-8 4 5 3-3 4 6" />
      <path d="M3 12h18" strokeDasharray="3 3" strokeWidth={1.2} />
    </svg>
  );
}

export function IconPriceBands({ size = 24, strokeWidth = 2 }: SlugIconProps): IconElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
      <path d="M3 15h18" />
      <path d="M9 3v18" />
    </svg>
  );
}

export function IconStocks({ size = 24, strokeWidth = 2 }: SlugIconProps): IconElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <polyline points="3 17 9 11 13 15 21 7" />
      <polyline points="15 7 21 7 21 13" />
    </svg>
  );
}

export function IconStockGuide({ size = 24, strokeWidth = 2 }: SlugIconProps): IconElement {
  // Candlestick chart — two candles with high/low wicks. Reads as "equities
  // research", deliberately distinct from IconStocks (the /stocks line chart)
  // and IconMarketShare. Mirrored by StockGuideIcon in the mobile icon set so
  // the /home tile and the floating Stock Guide pill share one identity.
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <line x1="8" y1="3" x2="8" y2="6" />
      <rect x="6" y="6" width="4" height="8" rx="0.5" />
      <line x1="8" y1="14" x2="8" y2="17" />
      <line x1="16" y1="7" x2="16" y2="10" />
      <rect x="14" y="10" width="4" height="6" rx="0.5" />
      <line x1="16" y1="16" x2="16" y2="20" />
    </svg>
  );
}

export function IconNewsHunter({ size = 24, strokeWidth = 2 }: SlugIconProps): IconElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <rect x="4" y="4" width="13" height="16" rx="2" />
      <path d="M19 8h1a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2" />
      <path d="M8 8h7" />
      <path d="M8 12h7" />
      <path d="M8 16h4" />
    </svg>
  );
}

export function IconAnpCdp({ size = 24, strokeWidth = 2 }: SlugIconProps): IconElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <path d="M12 2.5S5 10 5 15a7 7 0 0 0 14 0c0-5-7-12.5-7-12.5z" />
      <path d="M9 15a3 3 0 0 0 3 3" />
      <path d="M12 9v3" />
    </svg>
  );
}

export function IconAnpCdpBsw({ size = 24, strokeWidth = 2 }: SlugIconProps): IconElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <ellipse cx="12" cy="14" rx="7" ry="5" />
      <path d="M12 4v5" />
      <path d="M9 7c0-1.7 1.3-3 3-3s3 1.3 3 3" />
      <path d="M9 16a3 3 0 0 0 6 0" />
    </svg>
  );
}

export function IconAnpCdpDepletion({ size = 24, strokeWidth = 2 }: SlugIconProps): IconElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <path d="M3 4l5 8 4-3 5 7 4-5" />
      <path d="M3 20h18" />
      <path d="M12 8v12" strokeDasharray="2 2" strokeWidth={1.5} />
    </svg>
  );
}

export function IconAnpCdpDiaria({ size = 24, strokeWidth = 2 }: SlugIconProps): IconElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <path d="M7 15h2" />
      <path d="M11 15h2" />
      <path d="M15 15h2" />
    </svg>
  );
}

export function IconAnpGlp({ size = 24, strokeWidth = 2 }: SlugIconProps): IconElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <path d="M9 3h6l1 3H8z" />
      <rect x="7" y="6" width="10" height="14" rx="4" />
      <path d="M10 11h4" />
      <path d="M10 15h4" />
    </svg>
  );
}

export function IconAnpPrices({ size = 24, strokeWidth = 2 }: SlugIconProps): IconElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <path d="M12 2v20" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

export function IconImportsExports({ size = 24, strokeWidth = 2 }: SlugIconProps): IconElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M2 12h20" />
      <path d="M12 2c-4 3-6 6.5-6 10s2 7 6 10" />
      <path d="M12 2c4 3 6 6.5 6 10s-2 7-6 10" />
    </svg>
  );
}

export function IconSubsidyTracker({ size = 24, strokeWidth = 2 }: SlugIconProps): IconElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <path d="M3 18l9-14 9 14" />
      <path d="M6 14h12" />
      <path d="M9 18h6" />
    </svg>
  );
}

export function IconAlerts({ size = 24, strokeWidth = 2 }: SlugIconProps): IconElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

export function IconAdminAnalytics({ size = 24, strokeWidth = 2 }: SlugIconProps): IconElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <rect x="3" y="12" width="4" height="8" rx="1" />
      <rect x="10" y="7" width="4" height="13" rx="1" />
      <rect x="17" y="4" width="4" height="16" rx="1" />
      <path d="M3 4h4" />
    </svg>
  );
}

export function IconProfile({ size = 24, strokeWidth = 2 }: SlugIconProps): IconElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20a8 8 0 0 1 16 0" />
    </svg>
  );
}

export function IconAdminPanel({ size = 24, strokeWidth = 2 }: SlugIconProps): IconElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
    </svg>
  );
}

export function IconProduction({ size = 24, strokeWidth = 2 }: SlugIconProps): IconElement {
  // Offshore production platform: sea baseline, deck on two legs with a
  // diagonal brace, derrick tower on top, and a small flare tip.
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <path d="M2 20h20" />
      <path d="M5 14h14" />
      <path d="M7 14v6" />
      <path d="M17 14v6" />
      <path d="M7 20l10-6" />
      <path d="M10 14l2-9 2 9" />
      <path d="M11 10h2" />
      <path d="M12 5V3" />
    </svg>
  );
}

// ── Central registry ────────────────────────────────────────────────────────

/** Returns the icon element for a given module slug at the requested size. */
export function getModuleIcon(slug: string, size = 24, strokeWidth = 2): IconElement {
  switch (slug) {
    case "market-share":
      return <IconMarketShare size={size} strokeWidth={strokeWidth} />;
    case "navios-diesel":
      return <IconNaviosDiesel size={size} strokeWidth={strokeWidth} />;
    case "diesel-gasoline-margins":
      return <IconDieselGasolineMargins size={size} strokeWidth={strokeWidth} />;
    case "price-bands":
      return <IconPriceBands size={size} strokeWidth={strokeWidth} />;
    case "stocks":
      return <IconStocks size={size} strokeWidth={strokeWidth} />;
    case "stock-guide":
      return <IconStockGuide size={size} strokeWidth={strokeWidth} />;
    case "news-hunter":
      return <IconNewsHunter size={size} strokeWidth={strokeWidth} />;
    case "anp-cdp":
      return <IconAnpCdp size={size} strokeWidth={strokeWidth} />;
    case "anp-cdp-bsw":
      return <IconAnpCdpBsw size={size} strokeWidth={strokeWidth} />;
    case "anp-cdp-depletion":
      return <IconAnpCdpDepletion size={size} strokeWidth={strokeWidth} />;
    case "anp-cdp-diaria":
      return <IconAnpCdpDiaria size={size} strokeWidth={strokeWidth} />;
    case "anp-glp":
      return <IconAnpGlp size={size} strokeWidth={strokeWidth} />;
    case "anp-prices":
      return <IconAnpPrices size={size} strokeWidth={strokeWidth} />;
    case "imports-exports":
      return <IconImportsExports size={size} strokeWidth={strokeWidth} />;
    case "subsidy-tracker":
      return <IconSubsidyTracker size={size} strokeWidth={strokeWidth} />;
    case "alerts":
      return <IconAlerts size={size} strokeWidth={strokeWidth} />;
    case "admin-analytics":
      return <IconAdminAnalytics size={size} strokeWidth={strokeWidth} />;
    case "profile":
      return <IconProfile size={size} strokeWidth={strokeWidth} />;
    case "admin-panel":
      return <IconAdminPanel size={size} strokeWidth={strokeWidth} />;
    case "well-by-well":
      return <IconProduction size={size} strokeWidth={strokeWidth} />;
    default:
      // Generic fallback: grid/apps icon
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      );
  }
}
