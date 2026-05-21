"use client";

// Viewport router for /profile.
// useIsMobile is SSR-safe — returns false during SSR + first paint, then flips
// after mount. See docs/app/dual-view-pattern.md for the canonical template.
//
// Anonymous visitors are redirected to /login at this layer (the underlying
// Views assume a profile is present and rely on RPCs that require auth).

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useUserProfile } from "@/context/UserProfileContext";
import DesktopView from "./desktop/View";
import MobileView from "./mobile/View";

export default function ProfilePage(): React.ReactElement | null {
  const isMobile = useIsMobile();
  const router = useRouter();
  const { role, loading } = useUserProfile();

  useEffect(() => {
    if (!loading && role === "Anon") {
      router.replace("/login");
    }
  }, [loading, role, router]);

  // Hide the view entirely while the redirect is pending so anon users do not
  // briefly see profile chrome backed by null data.
  if (!loading && role === "Anon") return null;

  return isMobile ? <MobileView /> : <DesktopView />;
}
