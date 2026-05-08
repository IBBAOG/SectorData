"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { getSupabaseClient } from "../lib/supabaseClient";
import { useUserProfile } from "../context/UserProfileContext";
import { getInitials } from "../lib/avatarUtils";


/* ── Types ─────────────────────────────────────────────────────────────────── */

interface NavItem { label: string; href: string }
interface NavGroup { heading: string; items: NavItem[] }
interface NavModule {
  label: string;
  items: NavItem[];
  groups?: NavGroup[];
  disabled?: boolean;
}
type NavEntry = NavItem | NavModule;

function isModule(entry: NavEntry): entry is NavModule {
  return "items" in entry;
}

/** Flatten optional groups into a single items list (for visibility filtering, mobile fallback). */
function flattenModuleItems(mod: NavModule): NavItem[] {
  if (mod.groups && mod.groups.length > 0) {
    return mod.groups.flatMap((g) => g.items);
  }
  return mod.items;
}

/* ── Navigation entries ────────────────────────────────────────────────────── */

const NAV_ENTRIES: NavEntry[] = [
  { label: "Home", href: "/home" },
  {
    label: "Oil & Gas",
    items: [
      { href: "/anp-cdp", label: "ANP CDP Production" },
    ],
  },
  {
    label: "Fuel Distribution",
    items: [], // populated via groups (mega-menu)
    groups: [
      {
        heading: "Proprietary data",
        items: [
          { href: "/market-share", label: "Market Share" },
          { href: "/navios-diesel", label: "Diesel Imports Line-Up" },
          { href: "/diesel-gasoline-margins", label: "Diesel and Gasoline Margins" },
          { href: "/price-bands", label: "Price Bands" },
        ],
      },
      {
        heading: "ANP data",
        items: [
          { href: "/sales-volumes", label: "Sales Volumes — ANP" },
          { href: "/anp-ppi", label: "PPI" },
          { href: "/anp-precos-produtores", label: "Producer Prices" },
          { href: "/anp-precos-distribuicao", label: "Distribution Prices" },
          { href: "/anp-glp", label: "LPG" },
          { href: "/anp-daie", label: "Imports and Exports" },
          { href: "/anp-desembaracos", label: "Customs Clearances" },
          { href: "/anp-painel-importacoes", label: "Imports Panel" },
          { href: "/anp-lpc", label: "LPC Prices" },
        ],
      },
      {
        heading: "Sindicom data",
        items: [
          { href: "/sindicom", label: "Sales Volumes — Sindicom" },
        ],
      },
      {
        heading: "Comex data",
        items: [
          { href: "/mdic-comex", label: "MDIC Comex" },
        ],
      },
    ],
  },
  { label: "Market Watch", href: "/stocks" },
  { label: "News Hunter", href: "/news-hunter" },
];

/** Map nested/alternate routes to the root module slug for visibility checks */
const SLUG_MAP: Record<string, string> = {};

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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
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
  const firstName = profile?.full_name?.trim().split(/\s+/)[0] ?? null;

  return (
    <nav id="main-navbar" className="navbar navbar-expand-lg sticky-top">
      <div className="container-fluid">
        {/* Hamburger — visible only on mobile (< 768px) */}
        <button
          className="d-md-none nav-hamburger-btn"
          onClick={() => setMobileNavOpen(v => !v)}
          aria-label="Toggle navigation"
          aria-expanded={mobileNavOpen}
        >
          <span className="nav-hamburger-icon" />
        </button>

        <Link href="/home" className="navbar-brand d-flex align-items-center">
          <span style={{ height: 36, display: "inline-flex", alignItems: "center", padding: "0 10px", border: "2px dashed #aaa", color: "#aaa", fontSize: 13, fontWeight: 700, letterSpacing: 2, borderRadius: 4 }}>TBD</span>
        </Link>

        <div className={`navbar-nav-center${mobileNavOpen ? " mobile-open" : ""}`}>
          {NAV_ENTRIES.map((entry) => {
            /* ── Standalone link ── */
            if (!isModule(entry)) {
              // Hide visibility-controlled links from Client users when toggled off
              if (!profileLoading && profile?.role !== "Admin") {
                const rawSlug = entry.href.replace(/^\//, "");
                const slug = SLUG_MAP[rawSlug] ?? rawSlug;
                if (!(moduleVisibility[slug] ?? true)) return null;
              }
              return (
                <Link key={entry.href} href={entry.href} className="nav-link">
                  {entry.label}
                </Link>
              );
            }

            /* ── Module (dropdown or disabled placeholder) ── */
            const mod = entry;

            // Visibility filter helper — applied to flat items and to each group's items
            const isVisibleItem = (item: NavItem) => {
              if (profileLoading || profile?.role === "Admin") return true;
              const rawSlug = item.href.replace(/^\//, "");
              const slug = SLUG_MAP[rawSlug] ?? rawSlug;
              return moduleVisibility[slug] ?? true;
            };

            // Mega-menu path: filter inside each group, hide empty groups
            const visibleGroups: NavGroup[] | undefined = mod.groups
              ?.map((g) => ({ ...g, items: g.items.filter(isVisibleItem) }))
              .filter((g) => g.items.length > 0);

            // Flat list (used by simple dropdown OR by mobile fallback for mega-menu)
            const visibleItems = flattenModuleItems(mod).filter(isVisibleItem);

            // Hide the entire dropdown trigger if no items are visible
            const totalRawItems = flattenModuleItems(mod).length;
            if (!mod.disabled && totalRawItems > 0 && visibleItems.length === 0) {
              return null;
            }

            const isMega = !!mod.groups && mod.groups.length > 0;

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
                  isMega && visibleGroups && visibleGroups.length > 0 ? (
                    <div className="nav-module-dropdown nav-megamenu">
                      {visibleGroups.map((group) => (
                        <div key={group.heading} className="nav-megamenu-col">
                          <div className="nav-megamenu-heading">{group.heading}</div>
                          {group.items.map((item) => (
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
                      ))}
                    </div>
                  ) : (
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
                  )
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
          {firstName && (
            <span className="nav-username-label">{firstName}</span>
          )}
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

              {/* Admin Panel — only visible to Admins */}
              {isAdmin && (
                <Link
                  href="/admin-panel"
                  className="nav-user-dropdown-item"
                  onClick={() => setOpenUserMenu(false)}
                >
                  Admin Panel
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
