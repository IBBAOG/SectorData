"use client";

/**
 * /stocks — viewport router.
 *
 * Delegates to DesktopView (≥769px) or MobileView (≤768px) based on the
 * SSR-safe useIsMobile hook. All data logic lives in useStocksData.ts.
 *
 * DO NOT add business logic here. This file is intentionally a 5-line router.
 */

import { useIsMobile } from "../../../hooks/useIsMobile";
import DesktopView from "./desktop/View";
import MobileView from "./mobile/View";

export default function StocksPage(): React.ReactElement {
  const isMobile = useIsMobile();
  return isMobile ? <MobileView /> : <DesktopView />;
}
