// Mobile design system — Fase 1 (2026-05) + v2 reform (2026-05-27).
// Shared components + their TypeScript types, re-exported from a single barrel:
//
//   import {
//     // v2 (Onda 1, mobile reform)
//     MobileHomePill, MobileKebabMenu, MobileExcludedRedirect,
//     // Fase 1 (existing)
//     MobileTopBar, MobileBottomTabBar,
//     BottomSheet, FilterDrawer,
//     MobileChart, MobileDataCard,
//     StickyBreadcrumb, ExportFAB, MobileTabBar,
//   } from "@/components/dashboard/mobile";
//
// Visual source of truth: mockups/*-mobile.html (approved 2026-05-20) +
//   /.claude/plans/o-modo-mobile-da-tranquil-giraffe.md (v2, approved 2026-05-27).
// Tokens live in src/app/globals.css under
//   "Mobile design system (v2 — 2026-05-27, light-only)".

export {
  MobileTopBar,
  MobileBottomTabBar,
  type MobileTopBarProps,
  type MobileBottomTabBarProps,
  type MobileBottomTab,
} from "./MobileNavBar";

export { default as BottomSheet } from "./BottomSheet";
export type { BottomSheetProps, BottomSheetHeight } from "./BottomSheet";

export { default as FilterDrawer } from "./FilterDrawer";
export type { FilterDrawerProps } from "./FilterDrawer";

export { default as MobileChart } from "./MobileChart";
export type { MobileChartProps } from "./MobileChart";

export { default as MobileDataCard } from "./MobileDataCard";
export type {
  MobileDataCardProps,
  MobileDataCardVariant,
  MobileDataCardStatus,
} from "./MobileDataCard";

export { default as StickyBreadcrumb } from "./StickyBreadcrumb";
export type {
  StickyBreadcrumbProps,
  BreadcrumbSegment,
} from "./StickyBreadcrumb";

export { default as ExportFAB } from "./ExportFAB";
export type { ExportFABProps, ExportFABIcon } from "./ExportFAB";

export { default as MobileTabBar } from "./MobileTabBar";
export type { MobileTabBarProps, MobileTabBarTab } from "./MobileTabBar";

// Mobile reform v2 (2026-05-27, Onda 1) — single floating Home pill replacing
// the legacy 4-icon MobileBottomTabBar; kebab menu owns global account actions
// from the header right-slot; excluded-routes redirect ships routes that don't
// have a mobile View at all back to /home.
export { default as MobileHomePill } from "./MobileHomePill";
export type { MobileHomePillProps } from "./MobileHomePill";

export { default as MobileKebabMenu } from "./MobileKebabMenu";
export type { MobileKebabMenuProps } from "./MobileKebabMenu";

export { default as MobileExcludedRedirect } from "./MobileExcludedRedirect";
export type { MobileExcludedRedirectProps } from "./MobileExcludedRedirect";

// Canonical inline-SVG icon set (P2 audit cleanup, 2026-05-21).
// Re-exported wholesale so consumers can write
//   import { FilterIcon, CloseIcon } from "@/components/dashboard/mobile";
// alongside the layout components above.
export * from "./icons";
