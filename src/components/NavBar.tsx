"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import BrandLogo from "./BrandLogo";
import { getSupabaseClient } from "../lib/supabaseClient";
import { useUserProfile } from "../context/UserProfileContext";


/* ── Types ─────────────────────────────────────────────────────────────────── */

interface NavItem { label: string; href: string; adminOnly?: boolean }
interface NavSubGroup { label: string; items: NavItem[] }
interface NavGroup { heading: string; items: NavItem[]; subGroups?: NavSubGroup[]; hideHeading?: boolean; noBorderRight?: boolean }
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
    return mod.groups.flatMap((g) =>
      g.subGroups ? g.subGroups.flatMap((sg) => sg.items) : g.items
    );
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
      { href: "/anp-cdp-diaria", label: "ANP CDP Diária" },
      { href: "/anp-cdp-bsw", label: "ANP CDP — BSW by Well" },
      { href: "/anp-cdp-depletion", label: "ANP CDP — Depletion" },
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
          { href: "/subsidy-tracker", label: "Subsidy Tracker" },
        ],
      },
      {
        heading: "ANP data",
        noBorderRight: true,
        items: [],
        subGroups: [
          {
            label: "Prices",
            items: [
              { href: "/anp-ppi",                label: "PPI" },
              { href: "/anp-precos-produtores",   label: "Producer Prices" },
              { href: "/anp-precos-distribuicao", label: "Distribution Prices" },
              { href: "/anp-lpc",                label: "LPC Prices" },
            ],
          },
          {
            label: "Volumes",
            items: [
              { href: "/sales-volumes", label: "Sales Volumes — ANP" },
              { href: "/anp-glp",       label: "LPG" },
            ],
          },
        ],
      },
      {
        heading: "ANP data",
        hideHeading: true,
        items: [],
        subGroups: [
          {
            label: "Imports",
            items: [
              { href: "/imports-exports", label: "Imports & Exports" },
            ],
          },
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
const SLUG_MAP: Record<string, string> = { "sales-volumes": "sales" };

/* ── Route → tab title map ─────────────────────────────────────────────────── */

/**
 * Flat map of pathname → human label, derived from NAV_ENTRIES.
 * Used by the dashboard layout to set `document.title` on route changes.
 * Includes admin/profile routes that are not in the NavBar.
 */
export const ROUTE_TITLES: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  const collect = (items: NavItem[]) => items.forEach((i) => { map[i.href] = i.label; });
  for (const entry of NAV_ENTRIES) {
    if ("href" in entry) {
      map[entry.href] = entry.label;
    } else {
      if (entry.items) collect(entry.items);
      entry.groups?.forEach((g) => {
        collect(g.items);
        g.subGroups?.forEach((sg) => collect(sg.items));
      });
    }
  }
  map["/profile"] = "Profile";
  map["/admin-panel"] = "Admin Panel";
  map["/admin-analytics"] = "Admin Analytics";
  return map;
})();

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
  const {
    profile,
    role,
    moduleVisibility,
    publicVisibility,
    loading: profileLoading,
  } = useUserProfile();

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

  // Fetch session email once for the dropdown header. Anon visitors have no
  // session so the call resolves to null silently.
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

  const isAdmin = role === "Admin";
  const isAnon = role === "Anon";
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
          <BrandLogo variant="navbar" />
        </Link>

        <div className={`navbar-nav-center${mobileNavOpen ? " mobile-open" : ""}`}>
          {NAV_ENTRIES.map((entry) => {
            /* ── Standalone link ── */
            if (!isModule(entry)) {
              // Admin-only links are hidden for non-Admins (and during profile load)
              if (entry.adminOnly && !isAdmin) return null;
              // Hide visibility-controlled links per tier:
              //   - Admin sees everything
              //   - Client checks moduleVisibility (is_visible_for_clients)
              //   - Anon checks publicVisibility (is_visible_for_public)
              if (!profileLoading && !isAdmin) {
                const rawSlug = entry.href.replace(/^\//, "");
                const slug = SLUG_MAP[rawSlug] ?? rawSlug;
                const visMap = isAnon ? publicVisibility : moduleVisibility;
                if (!(visMap[slug] ?? true)) return null;
              }
              return (
                <Link key={entry.href} href={entry.href} className="nav-link">
                  {entry.label}
                </Link>
              );
            }

            /* ── Module (dropdown or disabled placeholder) ── */
            const mod = entry;

            // Visibility filter helper — applied to flat items and to each group's items.
            // Tier-aware: Admins see all; Anon checks publicVisibility; Client checks moduleVisibility.
            const isVisibleItem = (item: NavItem) => {
              if (profileLoading || isAdmin) return true;
              const rawSlug = item.href.replace(/^\//, "");
              const slug = SLUG_MAP[rawSlug] ?? rawSlug;
              const visMap = isAnon ? publicVisibility : moduleVisibility;
              return visMap[slug] ?? true;
            };

            // Mega-menu path: filter inside each group (or each subGroup), hide empty groups
            const visibleGroups: NavGroup[] | undefined = mod.groups
              ?.map((g) => {
                if (g.subGroups) {
                  const filteredSubs = g.subGroups
                    .map((sg) => ({ ...sg, items: sg.items.filter(isVisibleItem) }))
                    .filter((sg) => sg.items.length > 0);
                  return { ...g, subGroups: filteredSubs };
                }
                return { ...g, items: g.items.filter(isVisibleItem) };
              })
              .filter((g) => (g.subGroups ? g.subGroups.length > 0 : g.items.length > 0));

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
                      {visibleGroups.map((group, i) => (
                        <div key={`${group.heading}-${i}`} className={`nav-megamenu-col${group.noBorderRight ? " nav-megamenu-col--no-sep" : ""}`}>
                          <div className={`nav-megamenu-heading${group.hideHeading ? " nav-megamenu-heading--hidden" : ""}`}>{group.heading}</div>
                          {group.subGroups ? (
                            group.subGroups.map((sg) => (
                              <div key={sg.label} className="nav-megamenu-subgroup">
                                <div className="nav-megamenu-subheading">{sg.label}</div>
                                {sg.items.map((item) => (
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
                            ))
                          ) : (
                            group.items.map((item) => (
                              <Link
                                key={item.href}
                                href={item.href}
                                className="nav-module-item"
                                onClick={() => setOpenModule(null)}
                              >
                                {item.label}
                              </Link>
                            ))
                          )}
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

        {/* ── Right side: Sign in CTA (anon) or user dropdown (logged-in) ── */}
        <div
          ref={menuRef}
          style={{ position: "relative", display: "flex", alignItems: "center" }}
        >
          {isAnon ? (
            <Link
              href="/login"
              className="nav-signin-cta"
              style={{
                display: "inline-block",
                padding: "8px 20px",
                background: "#ff5000",
                color: "#fff",
                fontWeight: 600,
                fontSize: 14,
                borderRadius: 6,
                textDecoration: "none",
                letterSpacing: "0.02em",
                transition: "background 0.15s ease, transform 0.15s ease",
              }}
            >
              Sign in
            </Link>
          ) : (
            <>
              <button
                className="nav-user-greeting-btn"
                onClick={() => setOpenUserMenu((v) => !v)}
                aria-label="Open user menu"
                aria-expanded={openUserMenu}
                disabled={!supabase}
              >
                Hello,&nbsp;<strong>{firstName ?? "User"}</strong>
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
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
