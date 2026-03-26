"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { getSupabaseClient } from "../lib/supabaseClient";

const LOGO_URL =
  "https://raw.githubusercontent.com/IBBAOG/SectorData/main/assets/logo.webp";

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
      className="navbar navbar-expand-lg navbar-light bg-white sticky-top"
    >
      <div className="container-fluid">
        <Link href="/" className="navbar-brand d-flex align-items-center">
          <img src={LOGO_URL} alt="Itaú BBA" style={{ height: 32 }} />
        </Link>

        <div className="navbar-nav me-auto ms-3">
          <Link href="/" className="nav-link">
            Sales
          </Link>
          <Link href="/market-share" className="nav-link">
            Market Share
          </Link>
        </div>

        <button
          className="btn btn-outline-secondary btn-sm"
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

