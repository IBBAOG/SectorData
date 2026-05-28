// Mobile design-system icon set — P2 audit cleanup (2026-05-21).
//
// Canonical home for the ~30 inline SVG icons that were copy-pasted across
// the 24 mobile/View.tsx files. Centralising them collapses ~600 LOC and
// guarantees visual drift between dashboards is impossible by construction.
//
// Conventions (mirror the shapes that already lived inline):
//   • viewBox       = "0 0 24 24"
//   • stroke        = "currentColor"   (color follows parent via CSS color)
//   • strokeWidth   = 2                (override per-icon via `strokeWidth` prop)
//   • strokeLinecap = "round"
//   • strokeLinejoin= "round"
//   • fill          = "none"           (stroke-only Lucide-style)
//   • default size  = 20px             (override via `size` prop)
//   • aria-hidden   = "true" by default (these are decorative; consumers add
//                     `role="img"` + `aria-label="..."` when meaningful)
//
// Why a single <Icon> wrapper:
//   - One source of truth for the props above; per-icon component only
//     supplies its <path>/<circle>/<line> children.
//   - SVGProps spread on the wrapper means consumers can still pass
//     style/className/strokeWidth/onClick/etc and they reach the real <svg>.
//
// Usage:
//   import { FilterIcon, CloseIcon } from "@/components/dashboard/mobile";
//   <FilterIcon size={18} />
//   <CloseIcon className="text-muted" />
//
// What's NOT here (and shouldn't be):
//   - Per-dashboard module-card brand glyphs in /home/mobile/View.tsx — those
//     are identity-specific (Stocks / Market Share / etc.) and belong with
//     the card map, not in the design-system icon barrel.

import type { ReactNode, SVGProps } from "react";

export type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  /** Pixel size for both width and height. Default 20. */
  size?: number;
};

type WrapperProps = IconProps & { children: ReactNode };

const Icon = ({
  size = 20,
  strokeWidth = 2,
  children,
  ...rest
}: WrapperProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden={rest["aria-label"] ? undefined : true}
    {...rest}
  >
    {children}
  </svg>
);

// ─── Navigation / Chevrons ──────────────────────────────────────────────────

/** House silhouette. Used by the global mobile Home pill (single floating
 *  primary nav action — see MobileHomePill). */
export const HomeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z" />
  </Icon>
);

/** Three vertical dots (⋮). Used by the mobile kebab menu trigger in the
 *  header right slot — see MobileKebabMenu. */
export const MoreVerticalIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="5" r="1.2" />
    <circle cx="12" cy="12" r="1.2" />
    <circle cx="12" cy="19" r="1.2" />
  </Icon>
);

/** Door with arrow pointing right. Used inside the kebab menu's Logout row. */
export const LogOutIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </Icon>
);

/** Chevron pointing right ( > ). Used for "next", drill-in affordances. */
export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <polyline points="9 18 15 12 9 6" />
  </Icon>
);

/** Chevron pointing left ( < ). Used for back / "previous" navigation. */
export const ChevronLeftIcon = (p: IconProps) => (
  <Icon {...p}>
    <polyline points="15 18 9 12 15 6" />
  </Icon>
);

/** Chevron pointing down ( v ). Used for expand / dropdown affordances. */
export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <polyline points="6 9 12 15 18 9" />
  </Icon>
);

/** Chevron pointing up ( ^ ). Used for collapse affordances. */
export const ChevronUpIcon = (p: IconProps) => (
  <Icon {...p}>
    <polyline points="18 15 12 9 6 15" />
  </Icon>
);

/** Long arrow pointing left. Full-width back button glyph. */
export const ArrowLeftIcon = (p: IconProps) => (
  <Icon {...p}>
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </Icon>
);

/** Long arrow pointing right. Used for "go to detail" affordances. */
export const ArrowRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </Icon>
);

// ─── Common actions ─────────────────────────────────────────────────────────

/** × cross. Used on close buttons, dismiss chips, modal headers. */
export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </Icon>
);

/** + plus sign. Used on "add" affordances (add filter, add keyword). */
export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

/** – minus sign. Used to mirror PlusIcon (remove / collapse). */
export const MinusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14" />
  </Icon>
);

/** ✓ checkmark. Used inline next to "applied" filters, success states. */
export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <polyline points="20 6 9 17 4 12" />
  </Icon>
);

/** Magnifier. Used in search inputs, empty-state hints. */
export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
);

/** Horizontal-lines funnel (Lucide-style). Used on the "open filters" CTA. */
export const FilterIcon = (p: IconProps) => (
  <Icon {...p}>
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="7" y1="12" x2="17" y2="12" />
    <line x1="10" y1="18" x2="14" y2="18" />
  </Icon>
);

/** Solid filter funnel polygon. Used as compact filter chip glyph. */
export const FunnelIcon = (p: IconProps) => (
  <Icon {...p}>
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  </Icon>
);

/** Three-dot share graph. Used on news-hunter share affordance. */
export const ShareIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <path d="M8.6 13.5 15.4 17.5" />
    <path d="M15.4 6.5 8.6 10.5" />
  </Icon>
);

/** Bookmark / ribbon. Used on news-hunter save affordance. */
export const BookmarkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </Icon>
);

/** Pencil. Used to edit profile / inline rename. */
export const PencilIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 3l12 12-4 4H5v-4z" />
    <path d="M14 6l4 4" />
  </Icon>
);

// ─── Export / Files ─────────────────────────────────────────────────────────

/** Tray with arrow pointing down. Used as the export FAB glyph. */
export const DownloadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </Icon>
);

/** Tray with arrow pointing up. Used to upload (mirror of DownloadIcon). */
export const UploadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 9v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9" />
    <polyline points="7 14 12 9 17 14" />
    <line x1="12" y1="9" x2="12" y2="21" />
  </Icon>
);

/** Document with folded corner + 3 lines (Lucide file-text). */
export const FileTextIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
    <path d="M16 13H8" />
    <path d="M16 17H8" />
    <path d="M10 9H8" />
  </Icon>
);

/** Document with folded corner + 3 lines, fewer middle paths (variant). */
export const FileLinesIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <line x1="10" y1="9" x2="8" y2="9" />
  </Icon>
);

// ─── Charts / Trends ────────────────────────────────────────────────────────

/** Activity pulse line (heartbeat). Used to denote live / streaming data. */
export const ActivityIcon = (p: IconProps) => (
  <Icon {...p}>
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </Icon>
);

/** Diagonal trend up + arrow. Used on KPIs that grew period-over-period. */
export const TrendingUpIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 17l6-6 4 4 8-8" />
    <polyline points="14 7 21 7 21 14" />
  </Icon>
);

/** Bar-chart small/medium/tall. Used on volume / production overviews. */
export const BarChartIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 3v18h18" />
    <rect x="6" y="13" width="3" height="6" />
    <rect x="11" y="9" width="3" height="10" />
    <rect x="16" y="5" width="3" height="14" />
  </Icon>
);

/** Bar-chart medium/tall/tallest. Compact variant used in market-share. */
export const BarChartTallIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="12" width="4" height="9" rx="1" />
    <rect x="10" y="6" width="4" height="15" rx="1" />
    <rect x="17" y="3" width="4" height="18" rx="1" />
  </Icon>
);

// ─── Calendar / time ────────────────────────────────────────────────────────

/** Calendar grid. Used as the period / date-range icon. */
export const CalendarIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </Icon>
);

// ─── People / location ──────────────────────────────────────────────────────

/** Head + shoulders silhouette. Used for user / profile affordances. */
export const UserIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </Icon>
);

/** Map pin / location marker. Used for region / port affordances. */
export const MapPinIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </Icon>
);

/** Shield. Used to denote Admin role / protected area in profile. */
export const ShieldIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </Icon>
);

// ─── Theme ──────────────────────────────────────────────────────────────────

/** Crescent moon. Used by MobileTopBar's dark-mode toggle. */
export const MoonIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </Icon>
);

/** Sun with rays. Mirror of MoonIcon for light-mode toggles. */
export const SunIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2" />
    <path d="M12 20v2" />
    <path d="m4.93 4.93 1.41 1.41" />
    <path d="m17.66 17.66 1.41 1.41" />
    <path d="M2 12h2" />
    <path d="M20 12h2" />
    <path d="m4.93 19.07 1.41-1.41" />
    <path d="m17.66 6.34 1.41-1.41" />
  </Icon>
);

// ─── Misc ───────────────────────────────────────────────────────────────────

/** Three horizontal lines (alternative funnel shape with dots at the left). */
export const ListIcon = (p: IconProps) => (
  <Icon {...p}>
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </Icon>
);

/** Two arrows opposing horizontally. Used to indicate transfer / swap. */
export const ArrowsLeftRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 12h7" />
    <path d="M6 9l-3 3 3 3" />
    <path d="M21 12h-7" />
    <path d="M18 9l3 3-3 3" />
  </Icon>
);

// ─── /home tile glyphs (Onda 5 — visual refresh, 2026-05-28) ─────────────────
//
// One identity-recognisable glyph per dashboard tile in the mobile /home grid.
// Conventions for this group:
//   • viewBox 24×24, stroke-only (matches the rest of the icon set).
//   • Slightly thicker default strokeWidth (consumers pass strokeWidth={1.75}
//     so the glyph reads at the 24-28px tile size in front of a tinted bg).
//   • Children render in the tile's foreground colour (white by default) via
//     `currentColor` — no hard-coded fills/strokes inside the glyph itself.
//
// Mapping `slug → component` lives in MobileHomeIconTile.tsx (TILE_PALETTE).

/** Pumpjack / oil derrick. Identity glyph for /well-by-well. */
export const PumpJackIcon = (p: IconProps) => (
  <Icon {...p}>
    {/* Ground line + base */}
    <line x1="3" y1="20" x2="21" y2="20" />
    {/* Triangular A-frame (the derrick body) */}
    <path d="M7 20 L12 8 L17 20" />
    {/* Beam over the pivot (the walking beam) */}
    <line x1="6" y1="9" x2="18" y2="9" />
    {/* Counterweight on the rear, drop-rod on the front */}
    <circle cx="6" cy="9" r="1.2" />
    <line x1="18" y1="9" x2="18" y2="14" />
  </Icon>
);

/** Layered horizontal bars — "granular data". Identity glyph for /anp-cdp. */
export const GranularDataIcon = (p: IconProps) => (
  <Icon {...p}>
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="10" x2="15" y2="10" />
    <line x1="4" y1="14" x2="18" y2="14" />
    <line x1="4" y1="18" x2="12" y2="18" />
    {/* Tick marks evoking individual well/row entries */}
    <line x1="4" y1="4.5" x2="4" y2="19.5" />
  </Icon>
);

/** Water droplet. Identity glyph for /anp-cdp-bsw (Basic Sediment & Water). */
export const WaterDropIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3 C 8 9, 5 12, 5 15.5 A 7 7 0 0 0 19 15.5 C 19 12, 16 9, 12 3 Z" />
    {/* Tiny shine reflection */}
    <path d="M9.5 14 C 9.5 16, 10.5 17, 12 17" />
  </Icon>
);

/** Hourglass — depletion / decline. Identity glyph for /anp-cdp-depletion. */
export const HourglassIcon = (p: IconProps) => (
  <Icon {...p}>
    {/* Top and bottom caps */}
    <line x1="5" y1="3" x2="19" y2="3" />
    <line x1="5" y1="21" x2="19" y2="21" />
    {/* The two triangles meeting at the waist */}
    <path d="M6 3 L18 3 L12 12 L18 21 L6 21 L12 12 Z" />
    {/* Sand grain at the waist */}
    <circle cx="12" cy="12" r="0.6" fill="currentColor" />
  </Icon>
);

/** Calendar with a single highlighted day. Identity glyph for /anp-cdp-diaria. */
export const CalendarDayIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2" ry="2" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <line x1="8" y1="3" x2="8" y2="7" />
    <line x1="16" y1="3" x2="16" y2="7" />
    {/* Highlighted day cell */}
    <rect x="10.5" y="13" width="3" height="3" fill="currentColor" stroke="none" />
  </Icon>
);

/** Pie chart with one slice rotated out. Identity glyph for /market-share. */
export const PieChartIcon = (p: IconProps) => (
  <Icon {...p}>
    {/* Outer ring */}
    <circle cx="12" cy="12" r="9" />
    {/* Two slice separators meeting at centre */}
    <path d="M12 3 L12 12 L20.5 12" />
  </Icon>
);

/** Line chart with shaded bands. Identity glyph for /price-bands. */
export const ChartBandsIcon = (p: IconProps) => (
  <Icon {...p}>
    {/* Axis */}
    <line x1="3" y1="20" x2="21" y2="20" />
    <line x1="3" y1="20" x2="3" y2="4" />
    {/* Upper-band envelope */}
    <path d="M3 8 C 8 6, 12 10, 17 7 S 21 9, 21 9" />
    {/* Mid line (price) */}
    <path d="M3 13 C 7 11, 11 14, 15 12 S 21 14, 21 14" />
    {/* Lower-band envelope */}
    <path d="M3 17 C 7 15, 12 18, 17 15 S 21 17, 21 17" />
  </Icon>
);

/** Receipt / invoice. Identity glyph for /subsidy-tracker. */
export const ReceiptIcon = (p: IconProps) => (
  <Icon {...p}>
    {/* Body of the receipt with the iconic zig-zag bottom */}
    <path d="M5 3 H 19 V 21 L 17 19.5 L 15 21 L 13 19.5 L 11 21 L 9 19.5 L 7 21 L 5 19.5 Z" />
    {/* Lines of items */}
    <line x1="8" y1="8" x2="16" y2="8" />
    <line x1="8" y1="12" x2="14" y2="12" />
    <line x1="8" y1="16" x2="13" y2="16" />
  </Icon>
);

/** Round speed gauge with needle. Identity glyph for /diesel-gasoline-margins. */
export const GaugeIcon = (p: IconProps) => (
  <Icon {...p}>
    {/* Half-circle gauge */}
    <path d="M4 16 A 8 8 0 0 1 20 16" />
    {/* Needle pointing top-right at "high" */}
    <line x1="12" y1="16" x2="16.5" y2="9.5" />
    {/* Pivot */}
    <circle cx="12" cy="16" r="1" fill="currentColor" stroke="none" />
    {/* Tick marks at left and right ends */}
    <line x1="4" y1="16" x2="5.5" y2="15" />
    <line x1="20" y1="16" x2="18.5" y2="15" />
  </Icon>
);

/** Price tag with a $ mark. Identity glyph for /anp-prices. */
export const PriceTagIcon = (p: IconProps) => (
  <Icon {...p}>
    {/* Tag body */}
    <path d="M20 12 L 12 20 L 3 11 V 3 H 11 Z" />
    {/* Hole */}
    <circle cx="7" cy="7" r="1.5" />
  </Icon>
);

/** Gas cylinder / canister. Identity glyph for /anp-glp. */
export const GasCylinderIcon = (p: IconProps) => (
  <Icon {...p}>
    {/* Valve handle on top */}
    <rect x="10" y="2.5" width="4" height="2.5" rx="0.5" />
    {/* Cylinder body */}
    <rect x="6" y="5" width="12" height="16" rx="2" ry="2" />
    {/* Label band */}
    <line x1="6" y1="11" x2="18" y2="11" />
    <line x1="6" y1="15" x2="18" y2="15" />
  </Icon>
);

/** Globe with horizontal arrows (import/export). Identity glyph for /imports-exports. */
export const GlobeArrowsIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="7" />
    {/* Meridian + equator */}
    <ellipse cx="12" cy="12" rx="3" ry="7" />
    <line x1="5" y1="12" x2="19" y2="12" />
    {/* Inbound/outbound arrow heads on the equator endpoints */}
    <polyline points="6.5 10.5 5 12 6.5 13.5" />
    <polyline points="17.5 10.5 19 12 17.5 13.5" />
  </Icon>
);

/** Cargo ship silhouette. Identity glyph for /navios-diesel. */
export const ShipIcon = (p: IconProps) => (
  <Icon {...p}>
    {/* Wheelhouse + cargo stack on deck */}
    <rect x="9" y="6" width="6" height="4" />
    <line x1="12" y1="3" x2="12" y2="6" />
    {/* Hull (trapezoid) */}
    <path d="M3 13 L 21 13 L 18 18 L 6 18 Z" />
    {/* Water line waves */}
    <path d="M3 20 C 5 19, 7 21, 9 20 S 13 21, 15 20 S 19 21, 21 20" />
  </Icon>
);
