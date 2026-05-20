// Mobile design system — Fase 1 (2026-05).
// All 8 shared components + their TypeScript types, re-exported from a
// single barrel so consumers can write:
//
//   import {
//     MobileTopBar, MobileBottomTabBar,
//     BottomSheet, FilterDrawer,
//     MobileChart, MobileDataCard,
//     StickyBreadcrumb, ExportFAB, MobileTabBar,
//   } from "@/components/dashboard/mobile";
//
// Visual source of truth: mockups/*-mobile.html (approved 2026-05-20).
// Tokens live in src/app/globals.css under
//   "Mobile design system (Fase 1 — 2026-05)".

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
