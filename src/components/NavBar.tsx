"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { getSupabaseClient } from "../lib/supabaseClient";

const LOGO_URL = "/logo.png";

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
      { href: "/", label: "Sales" },
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
  const [signingOut, setSigningOut] = useState(false);
  const [openModule, setOpenModule] = useState<string | null>(null);

  async function onLogout() {
    if (!supabase) return;
    if (signingOut) return;
    setSigningOut(true);
    try {
      await supabase.auth.signOut();
    } finally {
      router.replace("/login");
    }
  }

  return (
    <nav id="main-navbar" className="navbar navbar-expand-lg sticky-top">
      <div className="container-fluid">
        <Link href="/home" className="navbar-brand d-flex align-items-center">
          <img src={LOGO_URL} alt="Itaú BBA" style={{ height: 36 }} />
        </Link>

        <div className="navbar-nav me-auto ms-3">
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

                {openModule === mod.label && mod.items.length > 0 && (
                  <div className="nav-module-dropdown">
                    {mod.items.map((item) => (
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

        <button
          className="btn btn-outline-light btn-sm"
          onClick={onLogout}
          disabled={signingOut || !supabase}
          style={{ fontFamily: "Arial", fontSize: 12 }}
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}
