"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { getSupabaseClient } from "../lib/supabaseClient";
import { useUserProfile } from "../context/UserProfileContext";
import { getInitials } from "../lib/avatarUtils";

const LOGO_URL = "/logo-navbar.png";

/* ── Types ─────────────────────────────────────────────────────────────────── */

interface NavItem { label: string; href: string }
interface NavModule { label: string; items: NavItem[]; disabled?: boolean }
type NavEntry = NavItem | NavModule;

function isModule(entry: NavEntry): entry is NavModule {
  return "items" in entry;
}

/* ── Navigation entries ────────────────────────────────────────────────────── */

const NAV_ENTRIES: NavEntry[] = [
  { label: "Home", href: "/home" },
  { label: "Oil & Gas", items: [], disabled: true },
  {
    label: "Fuel Distribution",
    items: [
      { href: "/sales", label: "Sales" },
      { href: "/market-share", label: "Market Share" },
      { href: "/navios-diesel", label: "Diesel Imports Line-Up" },
      { href: "/diesel-gasoline-margins", label: "Diesel and Gasoline Margins" },
      { href: "/price-bands", label: "Price Bands" },
    ],
  },
];

/* ── Chevron SVG ───────────────────────────────────────────────────────────── */

function Chevron() {
  return (
    <svg
      width="10" height="6" viewBox="0 0 10 6" fill="none"
      xmlns="http://www.w3.org/2000/svg" className="nav-chevron"
    >
      <path
        d="M1 1L5 5L9 1" stroke="currentColor"
        strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

/* ── Component ─────────────────────────────────────────────────────────────── */

export default function NavBar() {
  const router = useRouter();
  const supabase = getSupabaseClient();
  const { profile, moduleVisibility, loading: profileLoading } = useUserProfile();

  const [signingOut, setSigningOut] = useState(false);
  const [openModule, setOpenModule] = useState<string | null>(null);
  const [openUserMenu, setOpenUserMenu] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // Ref for click-outside detection on the user menu
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!openUserMenu) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenUserMenu(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [openUserMenu]);

  // Fetch session email once for the dropdown header
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setUserEmail(data.session?.user?.email ?? null);
    });
  }, [supabase]);

  async function onLogout() {
    if (!supabase) return;
    if (signingOut) return;
    setSigningOut(true);
    setOpenUserMenu(false);
    try {
      await supabase.auth.signOut();
    } finally {
      router.replace("/login");
    }
  }

  const initials = getInitials(profile, userEmail);
  const isAdmin = profile?.role === "Admin";

  return (
    <nav id="main-navbar" className="navbar navbar-expand-lg sticky-top">
      <div className="container-fluid">
        <Link href="/home" className="navbar-brand d-flex align-items-center">
          <img src={LOGO_URL} alt="Itaú BBA" style={{ height: 36 }} />
        </Link>

        <div className="navbar-nav navbar-nav-center">
          {NAV_ENTRIES.map((entry) => {
            /* ── Standalone link ── */
            if (!isModule(entry)) {
              return (
                <Link key={entry.href} href={entry.href} className="nav-link">
                  {entry.label}
                </Link>
              );
            }

            /* ── Module (dropdown or disabled placeholder) ── */
            const mod = entry;

            // Filter items by visibility for Client users.
            // Admins always see everything; while profile is loading show all.
            const visibleItems = mod.items.filter((item) => {
              if (profileLoading || profile?.role === "Admin") return true;
              const slug = item.href.replace(/^\//, "");
              return moduleVisibility[slug] ?? true;
            });

            // Hide the entire dropdown trigger if no items are visible
            if (!mod.disabled && mod.items.length > 0 && visibleItems.length === 0) {
              return null;
            }

            return (
              <div
                key={mod.label}
                className="nav-module"
                onMouseEnter={() => !mod.disabled && setOpenModule(mod.label)}
                onMouseLeave={() => setOpenModule(null)}
              >
                <span
                  className={`nav-link nav-module-trigger${mod.disabled ? " nav-module-disabled" : ""}`}
                >
                  {mod.label} <Chevron />
                </span>

                {openModule === mod.label && visibleItems.length > 0 && (
                  <div className="nav-module-dropdown">
                    {visibleItems.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className="nav-module-item"
                        onClick={() => setOpenModule(null)}
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Right side: avatar circle + user dropdown ──────────────────── */}
        <div
          ref={menuRef}
          style={{ position: "relative", display: "flex", alignItems: "center" }}
        >
          <button
            className="nav-avatar-btn"
            onClick={() => setOpenUserMenu((v) => !v)}
            aria-label="Open user menu"
            aria-expanded={openUserMenu}
            disabled={!supabase}
          >
            <span className="nav-avatar-circle">{initials}</span>
          </button>

          {openUserMenu && (
            <div className="nav-user-dropdown">
              {/* Header — name/email + role badge */}
              <div className="nav-user-dropdown-header">
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span>{profile?.full_name ?? userEmail ?? "User"}</span>
                  <span className={`role-badge role-badge--${isAdmin ? "admin" : "client"}`}>
                    {profile?.role ?? "Client"}
                  </span>
                </div>
                {profile?.full_name && userEmail && (
                  <div className="nav-user-dropdown-header-email">{userEmail}</div>
                )}
              </div>

              <hr />

              <Link
                href="/profile"
                className="nav-user-dropdown-item"
                onClick={() => setOpenUserMenu(false)}
              >
                My Profile
              </Link>

              {/* Settings — only visible to Admins */}
              {isAdmin && (
                <Link
                  href="/settings"
                  className="nav-user-dropdown-item"
                  onClick={() => setOpenUserMenu(false)}
                >
                  Settings
                </Link>
              )}

              <hr />

              <button
                className="nav-user-dropdown-item nav-user-dropdown-signout"
                onClick={onLogout}
                disabled={signingOut || !supabase}
              >
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
