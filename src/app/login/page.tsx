"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import BrandLogo from "../../components/BrandLogo";
import MfaChallenge from "../../components/MfaChallenge";
import { getSupabaseClient } from "../../lib/supabaseClient";
import Footer from "../../components/Footer";


// Locally hosted to avoid hotlink blocking by Giphy/Pinterest (observed 100%
// block rate from those CDNs in 2026-05; the rotation was producing a white
// background in production). Files live in /public/login-bg/ and ship with
// the build.
const BG_GIFS = [
  "/login-bg/bg1.gif",
  "/login-bg/bg2.gif",
  "/login-bg/bg3.gif",
];
// Deterministic default for SSR — picking with Math.random() at module scope
// caused an SSR/CSR hydration mismatch (server-rendered URL differed from
// client-rendered URL, and React silently dropped the inline style). The
// random pick now happens client-side in useEffect (see useState + useEffect
// in LoginPage below).
const DEFAULT_BG = BG_GIFS[0];

// Normalize the user-typed identifier into an email Supabase Auth accepts.
// - Strings containing "@" are treated as emails (lowercased).
// - Strings without "@" are treated as internal usernames and aliased to
//   "<username>@sectordata.internal" (e.g. "IBBA" -> "ibba@sectordata.internal").
// Internal accounts are provisioned server-side by worker_supabase; this helper
// only translates the input transparently before signInWithPassword.
function normalizeIdentifier(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes("@")) return trimmed.toLowerCase();
  return `${trimmed.toLowerCase()}@sectordata.internal`;
}

export default function LoginPage() {
  const router = useRouter();
  const supabase = getSupabaseClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(true);

  // When the signed-in user has a verified MFA factor but has not yet
  // completed the AAL2 challenge for this session, we display the challenge
  // form instead of the credential form.
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);

  // GIF rotation is client-only to keep SSR/CSR markup identical (see
  // DEFAULT_BG note above). On first client paint we pick a random one of
  // the three; SSR/initial render always shows DEFAULT_BG.
  const [bgUrl, setBgUrl] = useState<string>(DEFAULT_BG);

  useEffect(() => {
    setBgUrl(BG_GIFS[Math.floor(Math.random() * BG_GIFS.length)]);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("password_reset") === "success") {
      setSuccess("Password updated successfully. Please sign in.");
    }
  }, []);

  // Helper: returns the id of an enrolled verified TOTP factor, or null.
  // Used to decide whether the user must pass an AAL2 challenge before
  // we forward them to /home.
  async function findVerifiedFactor(): Promise<string | null> {
    if (!supabase) return null;
    const { data } = await supabase.auth.mfa.listFactors();
    const factor = data?.totp?.find((f) => f.status === "verified");
    return factor?.id ?? null;
  }

  // Returns true if the active session already satisfies AAL2.
  async function isAal2Satisfied(): Promise<boolean> {
    if (!supabase) return false;
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    return data?.currentLevel === "aal2";
  }

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
      .then(async ({ data }) => {
        if (cancelled) return;
        if (data.session) {
          // If MFA is enrolled but not satisfied, surface the challenge here
          // instead of redirecting — the user still needs a second factor.
          const factorId = await findVerifiedFactor();
          if (factorId && !(await isAal2Satisfied())) {
            if (!cancelled) {
              setMfaFactorId(factorId);
            }
          } else if (!cancelled) {
            router.replace("/home");
          }
        }
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
      setError("Please enter your email or username and password.");
      return;
    }

    setSubmitting(true);
    try {
      const { error: signInError } =
        await supabase.auth.signInWithPassword({
          email: normalizeIdentifier(email),
          password,
        });
      if (signInError) throw signInError;

      // After password auth, decide whether to enter the MFA stage or
      // forward straight to /home. A verified TOTP factor implies AAL2 is
      // required (Supabase reports nextLevel === 'aal2').
      const factorId = await findVerifiedFactor();
      if (factorId && !(await isAal2Satisfied())) {
        setMfaFactorId(factorId);
      } else {
        router.replace("/home");
      }
    } catch (e) {
      setError("Incorrect credentials.");
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
            Create a <code>.env.local</code> at the project root with:
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
    <div
      id="login-container"
      style={{ backgroundImage: `url("${bgUrl}")` }}
    >
      {/* SVG filter for glass distortion */}
      <svg style={{ position: "absolute", width: 0, height: 0 }} aria-hidden="true">
        <defs>
          <filter id="glass-distortion">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.015"
              numOctaves="3"
              seed="2"
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="6"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>
      <div id="login-card">
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <BrandLogo variant="auth" />
        </div>

        {mfaFactorId ? (
          <MfaChallenge
            factorId={mfaFactorId}
            onSuccess={() => router.replace("/home")}
          />
        ) : (
          <>
            <h5
              style={{
                fontFamily: "Arial",
                fontWeight: 600,
                color: "#1a1a1a",
                marginBottom: 4,
                textAlign: "center",
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
                textAlign: "center",
              }}
            >
              Enter your credentials to continue.
            </p>

            <hr />

            <label htmlFor="input-email" className="form-label" style={{ fontFamily: "Arial" }}>
              Email or username
            </label>
            <input
              id="input-email"
              className="form-control mb-3"
              type="text"
              autoComplete="username"
              placeholder="you@company.com or IBBA"
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
              className="form-control"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            />

            <div style={{ textAlign: "right", marginBottom: 16, marginTop: 6 }}>
              <a
                href="/forgot-password"
                className="forgot-password-link"
              >
                Forgot your password?
              </a>
            </div>

            <button
              id="btn-login"
              className="btn"
              onClick={handleLogin}
              disabled={submitting}
            >
              {submitting ? "Signing in..." : "Go!"}
            </button>

            {success ? (
              <div
                className="alert alert-success"
                style={{ fontSize: 13, marginTop: 8, marginBottom: 0 }}
              >
                {success}
              </div>
            ) : null}

            {error ? (
              <div
                id="login-error"
                className="alert alert-danger"
                style={{ fontSize: 13, marginTop: 8, marginBottom: 0 }}
              >
                {error}
              </div>
            ) : null}
          </>
        )}
      </div>
      <Footer />
    </div>
  );
}
