"use client";

// /profile — excluded from mobile (mobile users are redirected to /home).
// Desktop: full profile editor with inline name editing and avatar.
// Anonymous visitors are redirected to /login (DesktopView assumes auth).
//
// MobileExcludedRedirect is a side-effect-only client component — on mobile it
// redirects to /home?excluded=profile and fires an app-toast event; on desktop
// it renders null.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUserProfile } from "@/context/UserProfileContext";
import MobileExcludedRedirect from "@/components/dashboard/mobile/MobileExcludedRedirect";
import DesktopView from "./desktop/View";

export default function ProfilePage(): React.ReactElement | null {
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

  return (
    <>
      <MobileExcludedRedirect slug="profile" />
      <DesktopView />
    </>
  );
}
