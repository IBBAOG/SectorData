"use client";

// MobileKebabMenu — the 3-dot vertical button + BottomSheet-anchored menu used
// by the mobile reform (2026-05-27, Onda 1) to expose account actions in the
// header right-slot. Logout-only for now; reserved as the hook for any future
// global mobile actions (e.g. "Report bug", "Open feedback").
//
// Why a BottomSheet (and not a popover):
//   The plan § 3.2 ships with breathable-density / thumb-friendly UX. A floating
//   popover anchored top-right is finicky on small screens (44px hit target +
//   safe-area, animated arrow tail, scroll-position bugs). A BottomSheet is
//   already in our design system, already touch-tested, already drag-handled,
//   already supports keyboard escape and scrim dismiss. Reuse beats novelty.
//
// Anonymous behaviour:
//   The pill is hidden entirely when there is no session. The Designer plan
//   states "Hide when user is anonymous (no session) — pass isAnon prop or read
//   from UserProfileContext". We accept both: the `isAnon` prop overrides
//   (cheap, prop-driven, doesn't require the Provider to be mounted), and as
//   a fallback we read from useUserProfile() which is the source of truth.
//
// Touch target:
//   Visible icon button is 32×32; hit area is 44×44 via padding (8px ring).
//
// Visual recipe:
//   • Plain ghost button (transparent), color follows --mobile-text-muted.
//   • Active/hover: bg --mobile-row-press, color --mobile-text.
//   • Focus-visible: 2px outline using --mobile-accent.

import { useState } from "react";
import { useRouter } from "next/navigation";
import BottomSheet from "./BottomSheet";
import { LogOutIcon, MoreVerticalIcon } from "./icons";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import { useUserProfile } from "../../../context/UserProfileContext";

export interface MobileKebabMenuProps {
  /**
   * Force-hide the menu (when the caller already knows the user is anon).
   * If omitted, falls back to the role from UserProfileContext.
   */
  isAnon?: boolean;
  /** Override the post-logout destination. Defaults to /login. */
  postLogoutHref?: string;
}

export default function MobileKebabMenu(
  props: MobileKebabMenuProps = {},
): React.ReactElement | null {
  const { isAnon: isAnonProp, postLogoutHref = "/login" } = props;
  const { role } = useUserProfile();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Hide entirely for anonymous visitors — no actions to expose.
  const anon = isAnonProp ?? role === "Anon";
  if (anon) return null;

  async function onLogout(): Promise<void> {
    if (signingOut) return;
    setSigningOut(true);
    const supabase = getSupabaseClient();
    try {
      if (supabase) {
        await supabase.auth.signOut();
      }
    } finally {
      setOpen(false);
      router.replace(postLogoutHref);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="mobile-kebab-trigger"
        style={{
          // Hit area 44×44 via padding; visible glyph 24×24.
          width: 44,
          height: 44,
          padding: 10,
          border: 0,
          background: "transparent",
          color: "var(--mobile-text-muted)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 12,
          cursor: "pointer",
          transition: "background 0.15s ease, color 0.15s ease",
        }}
      >
        <MoreVerticalIcon size={22} aria-hidden />
      </button>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Menu"
        height="auto"
      >
        <ul
          role="menu"
          aria-label="Account actions"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <li role="none">
            <button
              type="button"
              role="menuitem"
              onClick={onLogout}
              disabled={signingOut}
              className="mobile-kebab-menu-item"
              style={{
                width: "100%",
                minHeight: 48,
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                border: 0,
                borderRadius: "var(--mobile-radius-md)",
                background: "transparent",
                color: "var(--mobile-text)",
                fontFamily: "Arial, Helvetica, sans-serif",
                fontSize: 15,
                fontWeight: 600,
                textAlign: "left",
                cursor: signingOut ? "wait" : "pointer",
                opacity: signingOut ? 0.6 : 1,
                transition: "background 0.15s ease",
              }}
            >
              <LogOutIcon size={20} aria-hidden />
              <span>{signingOut ? "Signing out…" : "Sign out"}</span>
            </button>
          </li>
        </ul>
      </BottomSheet>
    </>
  );
}
