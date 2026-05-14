"use client";

/* ─────────────────────────────────────────────────────────────────────────────
 * MfaChallenge — second-factor verification (TOTP)
 *
 * Renders a 6-digit numeric input that challenges the given factor and
 * verifies the user-supplied code via supabase.auth.mfa.verify. On success,
 * calls onSuccess() so the parent can advance navigation. The "Cancel" link
 * signs the user out and reloads to /login so they cannot reach protected
 * pages without completing the challenge.
 * ───────────────────────────────────────────────────────────────────────── */

import { useEffect, useRef, useState } from "react";

import { getSupabaseClient } from "../lib/supabaseClient";

interface Props {
  factorId: string;
  onSuccess: () => void;
}

export default function MfaChallenge({ factorId, onSuccess }: Props) {
  const supabase = getSupabaseClient();
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  // Issue a fresh challenge as soon as the component mounts. The challenge id
  // is required to call mfa.verify below.
  useEffect(() => {
    let cancelled = false;
    if (!supabase) {
      setError("Supabase client unavailable.");
      setInitializing(false);
      return;
    }
    supabase.auth.mfa
      .challenge({ factorId })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          setError(error?.message ?? "Could not start MFA challenge.");
        } else {
          setChallengeId(data.id);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setInitializing(false);
          // Focus the input as soon as it's enabled.
          setTimeout(() => inputRef.current?.focus(), 50);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [factorId, supabase]);

  async function handleVerify() {
    if (!supabase || !challengeId) return;
    if (code.length !== 6) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setVerifying(true);
    setError(null);
    try {
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId,
        code,
      });
      if (verifyError) throw verifyError;
      onSuccess();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Verification failed.";
      setError(message);
      setVerifying(false);
    }
  }

  async function handleCancel() {
    if (supabase) {
      await supabase.auth.signOut();
    }
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    // Restrict to digits only and cap at 6 characters.
    const raw = e.target.value.replace(/\D/g, "").slice(0, 6);
    setCode(raw);
    if (error) setError(null);
  }

  return (
    <div style={{ fontFamily: "Arial" }}>
      <h5
        style={{
          fontFamily: "Arial",
          fontWeight: 600,
          color: "#1a1a1a",
          marginBottom: 4,
          textAlign: "center",
        }}
      >
        Two-factor authentication
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
        Enter the 6-digit code from your authenticator app.
      </p>

      <hr />

      <label htmlFor="mfa-code" className="form-label" style={{ fontFamily: "Arial" }}>
        Authentication code
      </label>
      <input
        id="mfa-code"
        ref={inputRef}
        className="form-control mb-3"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123456"
        value={code}
        onChange={handleChange}
        onKeyDown={(e) => e.key === "Enter" && handleVerify()}
        disabled={initializing || verifying}
        maxLength={6}
        style={{ letterSpacing: "0.3em", fontSize: 18, textAlign: "center" }}
      />

      <button
        id="btn-mfa-verify"
        className="btn"
        onClick={handleVerify}
        disabled={initializing || verifying || code.length !== 6 || !challengeId}
        style={{
          width: "100%",
          background: "#FF5000",
          color: "white",
          border: "none",
          padding: "8px 16px",
          borderRadius: 4,
          fontWeight: 600,
        }}
      >
        {verifying ? "Verifying..." : initializing ? "Loading..." : "Verify"}
      </button>

      <div style={{ textAlign: "center", marginTop: 12 }}>
        <button
          type="button"
          onClick={handleCancel}
          style={{
            background: "none",
            border: "none",
            color: "#888",
            fontSize: 13,
            textDecoration: "underline",
            cursor: "pointer",
          }}
        >
          Cancel and sign out
        </button>
      </div>

      {error ? (
        <div
          className="alert alert-danger"
          style={{ fontSize: 13, marginTop: 12, marginBottom: 0 }}
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
