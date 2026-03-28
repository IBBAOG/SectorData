"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "../../lib/supabaseClient";

const LOGO_URL = "/logo.png";

const BG_GIFS = [
  "https://media0.giphy.com/media/fy9QYx06VF8c9D3Sc3/giphy.gif",
  "https://i.pinimg.com/originals/c5/b0/c6/c5b0c6ca2a20e5fea7f938e8027b255b.gif",
  "https://media3.giphy.com/media/4B9havABFnB2U/giphy.gif",
];

export default function ForgotPasswordPage() {
  const supabase = getSupabaseClient();
  const [bgUrl, setBgUrl] = useState("");

  useEffect(() => {
    setBgUrl(BG_GIFS[Math.floor(Math.random() * BG_GIFS.length)]);
  }, []);

  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!supabase) {
      setError("Missing Supabase config.");
      return;
    }
    if (submitting) return;
    setError(null);

    if (!email) {
      setError("Please enter your email address.");
      return;
    }

    setSubmitting(true);
    try {
      const redirectTo = `${window.location.origin}/reset-password`;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email,
        { redirectTo },
      );
      if (resetError) throw resetError;
      setSent(true);
    } catch (e) {
      console.error(e);
      // Always show success for security (don't reveal if email exists)
      setSent(true);
    } finally {
      setSubmitting(false);
    }
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
          Reset your password
        </h5>
        <p
          style={{
            fontFamily: "Arial",
            fontSize: 13,
            color: "#888",
            marginBottom: 20,
          }}
        >
          Enter the email associated with your account and we&apos;ll send you a
          link to reset your password.
        </p>

        <hr />

        {sent ? (
          <div
            className="alert alert-success"
            style={{ fontSize: 13, marginTop: 12 }}
          >
            If an account exists for <strong>{email}</strong>, a password reset
            link has been sent. Please check your inbox.
          </div>
        ) : (
          <>
            <label
              htmlFor="input-email"
              className="form-label"
              style={{ fontFamily: "Arial" }}
            >
              Email
            </label>
            <input
              id="input-email"
              className="form-control mb-4"
              type="email"
              placeholder="name@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />

            <button
              id="btn-login"
              className="btn"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? "Sending..." : "Send reset link →"}
            </button>

            {error ? (
              <div
                className="alert alert-danger"
                style={{ fontSize: 13, marginTop: 8, marginBottom: 0 }}
              >
                {error}
              </div>
            ) : null}
          </>
        )}

        <div style={{ textAlign: "center", marginTop: 16 }}>
          <a
            href="/login"
            className="forgot-password-link"
          >
            ← Back to login
          </a>
        </div>
      </div>
    </div>
  );
}
