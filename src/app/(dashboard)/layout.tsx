"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "../../lib/supabaseClient";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const supabase = getSupabaseClient();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setChecking(false);
      return;
    }
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (!data.session) router.replace("/login");
      else setChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, [router, supabase]);

  if (!supabase) {
    return (
      <div className="container" style={{ padding: 24, fontFamily: "Arial" }}>
        <h5 style={{ fontWeight: 700 }}>Missing configuration</h5>
        <div style={{ fontSize: 13, color: "#555" }}>
          Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to{" "}
          <code>.env.local</code>.
        </div>
      </div>
    );
  }

  if (checking) return null;

  return <>{children}</>;
}
