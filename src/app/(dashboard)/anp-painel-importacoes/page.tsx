"use client";

// Viewport router for /anp-painel-importacoes. The desktop (≥769px) and mobile
// (≤768px) views share the same brain (`useAnpPainelImpData`) but render with
// different chrome. See docs/app/dual-view-pattern.md and CLAUDE.md
// § "Dual-view (web + mobile) policy".

import { useIsMobile } from "@/hooks/useIsMobile";
import DesktopView from "./desktop/View";
import MobileView from "./mobile/View";

export default function AnpPainelImportacoesPage(): React.ReactElement {
  const isMobile = useIsMobile();
  return isMobile ? <MobileView /> : <DesktopView />;
}
