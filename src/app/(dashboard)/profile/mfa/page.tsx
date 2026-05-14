"use client";

/* ─────────────────────────────────────────────────────────────────────────────
 * /profile/mfa — TOTP MFA enrollment & management
 *
 * - Lists current MFA factors via supabase.auth.mfa.listFactors().
 * - If a verified factor exists, shows a "MFA enabled" panel with Disable.
 * - Otherwise, the "Enable MFA" button calls supabase.auth.mfa.enroll
 *   ({ factorType: 'totp' }) and renders the returned QR code + secret.
 * - The 6-digit code input issues mfa.challenge then mfa.verify; on success,
 *   the factor moves to verified=true.
 * - Admins are not allowed to disable their last verified factor in the UI;
 *   the backend RPC require_admin_mfa also enforces this.
 * ───────────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useState } from "react";

import NavBar from "../../../../components/NavBar";
import { useUserProfile } from "../../../../context/UserProfileContext";
import { getSupabaseClient } from "../../../../lib/supabaseClient";

const ORANGE = "#FF5000";
const BG = "#f5f5f5";

type Factor = {
  id: string;
  factor_type: string;
  status: "verified" | "unverified";
  friendly_name?: string | null;
};

type EnrollPayload = {
  factorId: string;
  qrCode: string;
  secret: string;
};

export default function MfaPage() {
  const supabase = getSupabaseClient();
  const { profile } = useUserProfile();
  const isAdmin = profile?.role === "Admin";

  const [factors, setFactors] = useState<Factor[]>([]);
  const [loadingFactors, setLoadingFactors] = useState(true);

  const [enrollment, setEnrollment] = useState<EnrollPayload | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [challengeId, setChallengeId] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const verifiedFactors = factors.filter((f) => f.status === "verified");
  const hasVerifiedFactor = verifiedFactors.length > 0;

  const refreshFactors = useCallback(async () => {
    if (!supabase) return;
    setLoadingFactors(true);
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) {
      setError(error.message);
      setLoadingFactors(false);
      return;
    }
    // listFactors returns { all, totp, phone }; we only care about TOTP.
    const totp = (data?.totp ?? []) as Factor[];
    setFactors(totp);
    setLoadingFactors(false);
  }, [supabase]);

  useEffect(() => {
    refreshFactors();
  }, [refreshFactors]);

  async function handleStartEnroll() {
    if (!supabase) return;
    setError(null);
    setInfo(null);
    setEnrolling(true);
    try {
      // Reuse any pre-existing unverified factor before enrolling a new one;
      // Supabase rejects a second enroll if one is already in-flight.
      const existingUnverified = factors.find((f) => f.status === "unverified");
      if (existingUnverified) {
        // We cannot recover the original QR code, so unenroll and start fresh.
        await supabase.auth.mfa.unenroll({ factorId: existingUnverified.id });
      }

      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (error || !data) throw error ?? new Error("Could not start enrollment.");
      setEnrollment({
        factorId: data.id,
        qrCode: data.totp.qr_code,
        secret: data.totp.secret,
      });

      // Issue the challenge so we can verify the first code immediately.
      const challenge = await supabase.auth.mfa.challenge({ factorId: data.id });
      if (challenge.error || !challenge.data) {
        throw challenge.error ?? new Error("Could not start MFA challenge.");
      }
      setChallengeId(challenge.data.id);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Enrollment failed.";
      setError(message);
    } finally {
      setEnrolling(false);
    }
  }

  async function handleVerifyCode() {
    if (!supabase || !enrollment || !challengeId) return;
    if (code.length !== 6) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setVerifying(true);
    setError(null);
    try {
      const { error } = await supabase.auth.mfa.verify({
        factorId: enrollment.factorId,
        challengeId,
        code,
      });
      if (error) throw error;
      setEnrollment(null);
      setChallengeId(null);
      setCode("");
      setInfo("Two-factor authentication enabled.");
      await refreshFactors();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Verification failed.";
      setError(message);
    } finally {
      setVerifying(false);
    }
  }

  async function handleCancelEnrollment() {
    if (!supabase || !enrollment) {
      setEnrollment(null);
      setChallengeId(null);
      return;
    }
    try {
      await supabase.auth.mfa.unenroll({ factorId: enrollment.factorId });
    } catch {
      // Ignore — best-effort cleanup.
    }
    setEnrollment(null);
    setChallengeId(null);
    setCode("");
    setError(null);
    await refreshFactors();
  }

  async function handleDisable(factorId: string) {
    if (!supabase) return;
    // Admins cannot remove their last verified factor.
    if (isAdmin && verifiedFactors.length <= 1) {
      setError("Admins must keep at least one verified factor enrolled.");
      return;
    }
    if (
      typeof window !== "undefined" &&
      !window.confirm("Disable two-factor authentication on this account?")
    ) {
      return;
    }
    setError(null);
    setInfo(null);
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) {
      setError(error.message);
      return;
    }
    setInfo("Two-factor authentication disabled.");
    await refreshFactors();
  }

  function handleCodeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/\D/g, "").slice(0, 6);
    setCode(raw);
    if (error) setError(null);
  }

  return (
    <main style={{ background: BG, minHeight: "100vh", fontFamily: "Arial, sans-serif" }}>
      <NavBar />

      <section style={{ maxWidth: 720, margin: "0 auto", padding: "64px 24px" }}>
        <div style={{ marginBottom: 32 }}>
          <div
            style={{
              display: "inline-block",
              background: "rgba(232,93,32,0.10)",
              color: ORANGE,
              borderRadius: 20,
              padding: "3px 12px",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              marginBottom: 14,
            }}
          >
            Security
          </div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#111", margin: 0 }}>
            Two-factor authentication
          </h1>
          <p style={{ color: "#666", fontSize: 14, marginTop: 8 }}>
            Add a one-time password from an authenticator app (Google Authenticator,
            1Password, Authy, etc.) as a second verification step.
          </p>
          {isAdmin ? (
            <div
              style={{
                background: "rgba(232,93,32,0.10)",
                color: "#7a2d10",
                padding: "10px 14px",
                borderRadius: 6,
                fontSize: 13,
                marginTop: 12,
              }}
            >
              Admin accounts must keep MFA enabled. Once enrolled, admin actions
              such as changing roles or module visibility require a verified
              factor.
            </div>
          ) : null}
        </div>

        <div
          style={{
            background: "white",
            borderRadius: 8,
            padding: 24,
            boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          }}
        >
          {loadingFactors ? (
            <div style={{ color: "#888", fontSize: 14 }}>Loading factors...</div>
          ) : enrollment ? (
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
                Scan the QR code
              </h2>
              <p style={{ color: "#666", fontSize: 13, marginBottom: 16 }}>
                Open your authenticator app and scan this QR code, then enter the
                6-digit code below to confirm enrollment.
              </p>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={enrollment.qrCode}
                  alt="MFA QR code"
                  width={200}
                  height={200}
                  style={{ background: "white", padding: 8, borderRadius: 4 }}
                />
                <div style={{ fontSize: 12, color: "#888" }}>
                  Or enter this secret manually:
                </div>
                <code
                  style={{
                    background: "#f4f4f4",
                    padding: "6px 10px",
                    borderRadius: 4,
                    fontSize: 13,
                    wordBreak: "break-all",
                    fontFamily: "monospace",
                  }}
                >
                  {enrollment.secret}
                </code>
              </div>

              <label
                htmlFor="mfa-enroll-code"
                className="form-label"
                style={{ fontSize: 14, fontWeight: 500 }}
              >
                Verification code
              </label>
              <input
                id="mfa-enroll-code"
                className="form-control mb-3"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={code}
                onChange={handleCodeChange}
                onKeyDown={(e) => e.key === "Enter" && handleVerifyCode()}
                disabled={verifying}
                maxLength={6}
                style={{ letterSpacing: "0.3em", fontSize: 18, textAlign: "center" }}
              />

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={handleVerifyCode}
                  disabled={verifying || code.length !== 6}
                  style={{
                    flex: 1,
                    background: ORANGE,
                    color: "white",
                    border: "none",
                    padding: "8px 16px",
                    borderRadius: 4,
                    fontWeight: 600,
                  }}
                >
                  {verifying ? "Verifying..." : "Verify and enable"}
                </button>
                <button
                  type="button"
                  onClick={handleCancelEnrollment}
                  disabled={verifying}
                  style={{
                    flex: 1,
                    background: "#eee",
                    color: "#333",
                    border: "none",
                    padding: "8px 16px",
                    borderRadius: 4,
                    fontWeight: 600,
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : hasVerifiedFactor ? (
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
                MFA is enabled
              </h2>
              <p style={{ color: "#666", fontSize: 13, marginBottom: 16 }}>
                You will be asked for an authenticator code each time you sign in.
              </p>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {verifiedFactors.map((factor) => (
                  <li
                    key={factor.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "12px 0",
                      borderBottom: "1px solid #eee",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>
                        {factor.friendly_name || "Authenticator app"}
                      </div>
                      <div style={{ fontSize: 12, color: "#888" }}>
                        Type: {factor.factor_type} · Status: {factor.status}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDisable(factor.id)}
                      disabled={isAdmin && verifiedFactors.length <= 1}
                      title={
                        isAdmin && verifiedFactors.length <= 1
                          ? "Admins must keep at least one factor enrolled"
                          : "Disable this factor"
                      }
                      style={{
                        background: "transparent",
                        color: "#cc3333",
                        border: "1px solid #cc3333",
                        padding: "4px 12px",
                        borderRadius: 4,
                        fontSize: 13,
                        cursor:
                          isAdmin && verifiedFactors.length <= 1
                            ? "not-allowed"
                            : "pointer",
                        opacity: isAdmin && verifiedFactors.length <= 1 ? 0.5 : 1,
                      }}
                    >
                      Disable
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
                MFA is not enabled
              </h2>
              <p style={{ color: "#666", fontSize: 13, marginBottom: 16 }}>
                {isAdmin
                  ? "Admin accounts are required to enable MFA. You will be prompted to enroll before performing admin actions."
                  : "Adding a second factor is optional but strongly recommended."}
              </p>
              <button
                type="button"
                onClick={handleStartEnroll}
                disabled={enrolling}
                style={{
                  background: ORANGE,
                  color: "white",
                  border: "none",
                  padding: "8px 16px",
                  borderRadius: 4,
                  fontWeight: 600,
                }}
              >
                {enrolling ? "Starting..." : "Enable MFA"}
              </button>
            </div>
          )}

          {info ? (
            <div
              className="alert alert-success"
              style={{ fontSize: 13, marginTop: 16, marginBottom: 0 }}
            >
              {info}
            </div>
          ) : null}
          {error ? (
            <div
              className="alert alert-danger"
              style={{ fontSize: 13, marginTop: 16, marginBottom: 0 }}
            >
              {error}
            </div>
          ) : null}
        </div>

        <div style={{ marginTop: 16 }}>
          <a href="/profile" style={{ color: "#666", fontSize: 13 }}>
            ← Back to profile
          </a>
        </div>
      </section>
    </main>
  );
}
