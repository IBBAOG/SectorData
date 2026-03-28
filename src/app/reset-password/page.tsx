"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "../../lib/supabaseClient";

const LOGO_URL = "/logo.png";

const BG_GIFS = [
  "https://media0.giphy.com/media/fy9QYx06VF8c9D3Sc3/giphy.gif",
  "https://i.pinimg.com/originals/c5/b0/c6/c5b0c6ca2a20e5fea7f938e8027b255b.gif",
  "https://media3.giphy.com/media/4B9havABFnB2U/giphy.gif",
];

export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = getSupabaseClient();
  const [bgUrl, setBgUrl] = useState("");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setBgUrl(BG_GIFS[Math.floor(Math.random() * BG_GIFS.length)]);
  }, []);

  useEffect(() => {
    if (!supabase) return;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event) => {
        if (event === "PASSWORD_RECOVERY") {
          setReady(true);
        }
      },
    );

    // Also check if user already has a session (recovery token already processed)
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setReady(true);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase]);

  async function handleReset() {
    if (!supabase) {
      setError("Missing Supabase config.");
      return;
    }
    if (submitting) return;
    setError(null);

    if (!password || !confirmPassword) {
      setError("Please fill in both fields.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setSubmitting(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });
      if (updateError) throw updateError;

      await supabase.auth.signOut();
      router.replace("/login?password_reset=success");
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : "Failed to update password.";
      setError(msg);
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready) {
    return (
      <div id="login-container" style={{ backgroundImage: `url("${bgUrl}")` }}>
        <svg style={{ position: "absolute", width: 0, height: 0 }} aria-hidden="true">
          <defs>
            <filter id="glass-distortion">
              <feTurbulence type="fractalNoise" baseFrequency="0.015" numOctaves="3" seed="2" result="noise" />
              <feDisplacementMap in="SourceGraphic" in2="noise" scale="6" xChannelSelector="R" yChannelSelector="G" />
            </filter>
          </defs>
        </svg>
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
            Invalid or expired link
          </h5>
          <p
            style={{
              fontFamily: "Arial",
              fontSize: 13,
              color: "#888",
              marginBottom: 20,
            }}
          >
            This password reset link is invalid or has expired. Please request a
            new one.
          </p>
          <div style={{ textAlign: "center" }}>
            <a href="/forgot-password" className="forgot-password-link">
              Request a new link
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div id="login-container" style={{ backgroundImage: `url("${bgUrl}")` }}>
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
          Set a new password
        </h5>
        <p
          style={{
            fontFamily: "Arial",
            fontSize: 13,
            color: "#888",
            marginBottom: 20,
          }}
        >
          Enter your new password below.
        </p>

        <hr />

        <label
          htmlFor="input-password"
          className="form-label"
          style={{ fontFamily: "Arial" }}
        >
          New password
        </label>
        <input
          id="input-password"
          className="form-control mb-3"
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleReset()}
        />

        <label
          htmlFor="input-confirm-password"
          className="form-label"
          style={{ fontFamily: "Arial" }}
        >
          Confirm new password
        </label>
        <input
          id="input-confirm-password"
          className="form-control mb-4"
          type="password"
          placeholder="••••••••"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleReset()}
        />

        <button
          id="btn-login"
          className="btn"
          onClick={handleReset}
          disabled={submitting}
        >
          {submitting ? "Updating..." : "Update password"}
        </button>

        {error ? (
          <div
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
