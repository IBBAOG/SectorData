"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { getSupabaseClient } from "../../lib/supabaseClient";

const LOGO_URL = "/logo.png";

const BG_GIFS = [
  "https://media0.giphy.com/media/fy9QYx06VF8c9D3Sc3/giphy.gif",
  "https://i.pinimg.com/originals/c5/b0/c6/c5b0c6ca2a20e5fea7f938e8027b255b.gif",
];
const BG_URL = BG_GIFS[Math.floor(Math.random() * BG_GIFS.length)];

export default function LoginPage() {
  const router = useRouter();
  const supabase = getSupabaseClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!supabase) {
      setChecking(false);
      return () => {
        cancelled = true;
      };
    }
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        if (data.session) router.replace("/");
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router, supabase]);

  async function handleLogin() {
    if (!supabase) {
      setError("Missing Supabase config. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
      return;
    }
    if (submitting) return;
    setError(null);
    if (!email || !password) {
      setError("Please enter your email and password.");
      return;
    }

    setSubmitting(true);
    try {
      const { error: signInError } =
        await supabase.auth.signInWithPassword({
          email,
          password,
        });
      if (signInError) throw signInError;
      router.replace("/");
    } catch (e) {
      setError("Incorrect email or password.");
      // eslint-disable-next-line no-console
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) return null;

  if (!supabase) {
    return (
      <div id="login-container">
        <div id="login-card">
          <h5 style={{ fontFamily: "Arial", fontWeight: 600, marginBottom: 8 }}>
            Missing configuration
          </h5>
          <div style={{ fontFamily: "Arial", fontSize: 13, color: "#555" }}>
            Create a <code>.env.local</code> in <code>frontend-next/</code> with:
            <div style={{ marginTop: 8 }}>
              <code>NEXT_PUBLIC_SUPABASE_URL</code>
              <br />
              <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div id="login-container" style={{ backgroundImage: `url("${BG_URL}")` }}>
      <div id="login-card">
        <div style={{ textAlign: "center" }}>
          <img
            src={LOGO_URL}
            alt="Itaú BBA"
            style={{ width: "100%", maxWidth: 280, marginBottom: 24 }}
          />
        </div>

        <h5
          style={{
            fontFamily: "Arial",
            fontWeight: 600,
            color: "#1a1a1a",
            marginBottom: 4,
          }}
        >
          Sign in to your account
        </h5>
        <p
          style={{
            fontFamily: "Arial",
            fontSize: 13,
            color: "#888",
            marginBottom: 20,
          }}
        >
          Enter your credentials to continue.
        </p>

        <hr />

        <label htmlFor="input-email" className="form-label" style={{ fontFamily: "Arial" }}>
          Email
        </label>
        <input
          id="input-email"
          className="form-control mb-3"
          type="email"
          placeholder="name@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleLogin()}
        />

        <label
          htmlFor="input-password"
          className="form-label"
          style={{ fontFamily: "Arial" }}
        >
          Password
        </label>
        <input
          id="input-password"
          className="form-control mb-4"
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleLogin()}
        />

        <button
          id="btn-login"
          className="btn"
          onClick={handleLogin}
          disabled={submitting}
        >
          {submitting ? "Signing in..." : "Continue \u2192"}
        </button>

        {error ? (
          <div
            id="login-error"
            className="alert alert-danger"
            style={{ fontSize: 13, marginTop: 8, marginBottom: 0 }}
          >
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}

