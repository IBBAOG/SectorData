"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { getSupabaseClient } from "../lib/supabaseClient";

const LOGO_URL = "/logo.png";

// Add new modules here — each entry becomes a nav link automatically.
const NAV_MODULES = [
  { href: "/", label: "Sales" },
  { href: "/market-share", label: "Market Share" },
  { href: "/navios-diesel", label: "Diesel Imports Line-Up" },
  { href: "/diesel-gasoline-margins", label: "D&G Margins" },
];

export default function NavBar() {
  const router = useRouter();
  const supabase = getSupabaseClient();
  const [signingOut, setSigningOut] = useState(false);

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
    <nav
      id="main-navbar"
      className="navbar navbar-expand-lg sticky-top"
    >
      <div className="container-fluid">
        <Link href="/" className="navbar-brand d-flex align-items-center">
          <img src={LOGO_URL} alt="Itaú BBA" style={{ height: 56 }} />
        </Link>

        <div className="navbar-nav me-auto ms-3">
          {NAV_MODULES.map((mod) => (
            <Link key={mod.href} href={mod.href} className="nav-link">
              {mod.label}
            </Link>
          ))}
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

