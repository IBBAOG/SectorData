"use client";

// Viewport router for /home.
// Sits between the Server Component (page.tsx) and the two Views.
// Receives initialPreviews from the server (SSR) and passes them to DesktopView.
// MobileView uses gradient thumbnails and does not need initialPreviews.

import { useIsMobile } from "@/hooks/useIsMobile";
import DesktopView from "./desktop/View";
import MobileView from "./mobile/View";

interface HomeRouterProps {
  /** Preview URLs fetched server-side: slug → public URL */
  initialPreviews: Record<string, string>;
}

export default function HomeRouter({
  initialPreviews,
}: HomeRouterProps): React.ReactElement {
  const isMobile = useIsMobile();
  return isMobile ? (
    <MobileView />
  ) : (
    <DesktopView initialPreviews={initialPreviews} />
  );
}
