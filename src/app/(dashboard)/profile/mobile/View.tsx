"use client";

// Mobile view for /profile.
// Closest archetype: mockups/home-mobile.html (admin-bundle visual language).
//
// Structure (top to bottom):
//   MobileTopBar        — back button (left) + screen title "Profile" (centre-left)
//   Hero card           — large avatar (96px), display name, role badge
//   Account section     — Email (read-only), Name (inline edit), Role (read-only),
//                         Member since (read-only). Each row is rendered with a
//                         MobileDataCard "compact" variant so touch targets stay
//                         ≥44 px and the visual rhythm matches the home gallery.
//   Security section    — "Manage two-factor authentication" link
//   Sticky save FAB     — appears only while editing the name; tapping commits
//                         the upsert via the shared hook.
//
// No MobileBottomTabBar — this is a single-screen edit page (the home tab bar
// brought users here, leaving without saving simply uses the system back gesture
// or the in-page back button).

import { useRouter } from "next/navigation";

import {
  MobileTopBar,
  ChevronLeftIcon,
  ShieldIcon,
  ChevronRightIcon,
} from "@/components/dashboard/mobile";
import { useProfileData } from "../useProfileData";

// ---- Icons ------------------------------------------------------------------
//
// BackIcon, ShieldIcon, ChevronRightIcon come from the canonical mobile design-
// system icon set; only PencilIcon stays inline because its viewBox (0 0 14 14)
// and strokeWidth (1.4) diverge from the canonical Lucide-style PencilIcon and
// the visual at 16x16 is intentionally a thinner-stroke variant.

const BackIcon = () => <ChevronLeftIcon size={22} />;

function PencilIcon(): React.ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}
      aria-hidden="true"
    >
      <path
        d="M9.5 1.5L12.5 4.5L4.5 12.5H1.5V9.5L9.5 1.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---- InfoRow ----------------------------------------------------------------
// Mirrors the rhythm of MobileDataCard "compact" but allows arbitrary right
// content (read-only value, pencil button, inline form). Keeps the visual
// language of the rest of the mobile shell without forcing every row through
// the MobileDataCard prop API.

function InfoRow({
  label,
  children,
  isLast,
}: {
  label: string;
  children: React.ReactNode;
  isLast?: boolean;
}): React.ReactElement {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(100px, auto) 1fr",
        alignItems: "center",
        gap: 12,
        padding: "16px 16px",
        minHeight: 56,
        background: "var(--mobile-surface)",
        borderBottom: isLast ? "none" : "1px solid var(--mobile-divider)",
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "var(--mobile-text-muted)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <div
        style={{
          fontSize: 14,
          color: "var(--mobile-text)",
          textAlign: "right",
          wordBreak: "break-word",
          minWidth: 0,
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ---- SectionCard ------------------------------------------------------------

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section style={{ marginTop: 14 }}>
      <div
        style={{
          padding: "0 16px 8px",
          fontSize: 13,
          fontWeight: 700,
          color: "var(--mobile-text)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        {title}
      </div>
      <div
        style={{
          background: "var(--mobile-surface)",
          borderTop: "1px solid var(--mobile-divider)",
          borderBottom: "1px solid var(--mobile-divider)",
        }}
      >
        {children}
      </div>
    </section>
  );
}

// ---- Main component ---------------------------------------------------------

export default function MobileView(): React.ReactElement {
  const router = useRouter();
  const {
    profile,
    email,
    loading,
    isAdmin,
    displayName,
    initials,
    memberSince,
    editing,
    editName,
    saving,
    saveError,
    startEdit,
    cancelEdit,
    setEditName,
    canSave,
    saveName,
  } = useProfileData();

  async function handleSaveSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    await saveName();
  }

  const showSaveFooter = editing;

  return (
    <div
      style={{
        background: "var(--mobile-bg)",
        minHeight: "100dvh",
        fontFamily: "Arial, Helvetica, sans-serif",
        color: "var(--mobile-text)",
        fontSize: 14,
        lineHeight: 1.4,
        WebkitFontSmoothing: "antialiased",
        // Reserve room for the sticky save footer while editing so the last
        // section is never hidden behind it.
        paddingBottom: showSaveFooter
          ? "calc(72px + var(--mobile-safe-bottom))"
          : "var(--mobile-safe-bottom)",
      }}
    >
      {/* ---- Top bar ---------------------------------------------------- */}
      <MobileTopBar
        leftSlot={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              onClick={() => router.push("/home")}
              aria-label="Back to home"
              style={{
                width: 44,
                height: 44,
                marginLeft: -10,
                border: 0,
                background: "transparent",
                color: "var(--mobile-text-muted)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 12,
                cursor: "pointer",
              }}
            >
              <BackIcon />
            </button>
            <div
              style={{
                fontWeight: 700,
                fontSize: 17,
                color: "var(--mobile-text)",
                letterSpacing: "0.01em",
              }}
            >
              Profile
            </div>
          </div>
        }
      />

      {/* ---- Hero block ------------------------------------------------- */}
      <section
        aria-label="Account summary"
        style={{
          background: "var(--mobile-bg)",
          padding: "28px 16px 20px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 96,
            height: 96,
            borderRadius: "50%",
            background: "var(--mobile-accent)",
            color: "#fff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: 34,
            letterSpacing: "0.02em",
            boxShadow:
              "0 8px 24px rgba(255, 80, 0, 0.30), 0 1px 0 rgba(255, 255, 255, 0.25) inset",
          }}
        >
          {initials}
        </div>
        <div
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: "var(--mobile-text)",
            textAlign: "center",
            lineHeight: 1.2,
            wordBreak: "break-word",
            maxWidth: 320,
          }}
        >
          {loading ? "Loading…" : displayName}
        </div>
        <span
          style={{
            display: "inline-block",
            padding: "3px 10px",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.04em",
            background: isAdmin
              ? "rgba(255, 80, 0, 0.12)"
              : "rgba(26, 26, 26, 0.08)",
            color: isAdmin ? "var(--mobile-accent)" : "var(--mobile-text-muted)",
          }}
        >
          {loading ? "—" : (profile?.role ?? "Client")}
        </span>
      </section>

      {/* ---- Account section ------------------------------------------ */}
      <SectionCard title="Account">
        <InfoRow label="Email">
          <span style={{ color: loading ? "var(--mobile-text-faint)" : undefined }}>
            {loading ? "Loading…" : (email ?? "—")}
          </span>
        </InfoRow>

        {/* Name row — read-only with pencil, or inline form while editing */}
        <InfoRow label="Name">
          {editing ? (
            <form
              onSubmit={handleSaveSubmit}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                alignItems: "stretch",
                width: "100%",
                textAlign: "left",
              }}
            >
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                disabled={saving}
                autoFocus
                maxLength={80}
                placeholder="Your full name"
                aria-label="Full name"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1.5px solid var(--mobile-border)",
                  borderRadius: 10,
                  fontFamily: "inherit",
                  fontSize: 16, // ≥16px prevents iOS auto-zoom on focus
                  color: "var(--mobile-text)",
                  background: "var(--mobile-surface)",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              {saveError && (
                <span
                  style={{
                    fontSize: 12,
                    color: "#c0392b",
                    textAlign: "left",
                  }}
                >
                  Error saving. Try again.
                </span>
              )}
            </form>
          ) : (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                justifyContent: "flex-end",
                width: "100%",
              }}
            >
              <span style={{ color: loading ? "var(--mobile-text-faint)" : undefined }}>
                {loading ? "—" : (profile?.full_name ?? "—")}
              </span>
              {!loading && (
                <button
                  type="button"
                  onClick={startEdit}
                  aria-label="Edit name"
                  style={{
                    width: 44,
                    height: 44,
                    border: 0,
                    background: "transparent",
                    color: "var(--mobile-text-muted)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 10,
                    cursor: "pointer",
                    marginRight: -10,
                  }}
                >
                  <PencilIcon />
                </button>
              )}
            </div>
          )}
        </InfoRow>

        <InfoRow label="Role">
          <span style={{ color: loading ? "var(--mobile-text-faint)" : undefined }}>
            {loading ? "—" : (profile?.role ?? "Client")}
          </span>
        </InfoRow>

        <InfoRow label="Member since" isLast>
          <span style={{ color: loading ? "var(--mobile-text-faint)" : undefined }}>
            {loading ? "—" : memberSince}
          </span>
        </InfoRow>
      </SectionCard>

      {/* ---- Security section ------------------------------------------ */}
      <SectionCard title="Security">
        <button
          type="button"
          onClick={() => router.push("/profile/mfa")}
          aria-label="Manage two-factor authentication"
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr auto",
            alignItems: "center",
            gap: 14,
            width: "100%",
            padding: "16px",
            minHeight: 64,
            background: "var(--mobile-surface)",
            border: 0,
            borderBottom: "none",
            cursor: "pointer",
            color: "var(--mobile-text)",
            fontFamily: "inherit",
            textAlign: "left",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: "var(--mobile-accent-soft)",
              color: "var(--mobile-accent)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ShieldIcon size={22} />
          </span>
          <span style={{ minWidth: 0 }}>
            <span
              style={{
                display: "block",
                fontSize: 15,
                fontWeight: 600,
                color: "var(--mobile-text)",
                lineHeight: 1.25,
              }}
            >
              Two-factor authentication
            </span>
            <span
              style={{
                display: "block",
                marginTop: 2,
                fontSize: 12,
                color: "var(--mobile-text-muted)",
                lineHeight: 1.35,
              }}
            >
              {isAdmin
                ? "Required for Admin accounts."
                : "Optional extra protection."}
            </span>
          </span>
          <span style={{ color: "var(--mobile-text-faint)" }}>
            <ChevronRightIcon size={18} />
          </span>
        </button>
      </SectionCard>

      {/* ---- Sticky save footer (only while editing name) -------------- */}
      {showSaveFooter && (
        <div
          role="region"
          aria-label="Save changes"
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 40,
            padding: "12px 16px calc(12px + var(--mobile-safe-bottom)) 16px",
            background: "var(--mobile-glass-bg)",
            WebkitBackdropFilter: "var(--mobile-glass-blur)",
            backdropFilter: "var(--mobile-glass-blur)",
            borderTop: "1px solid var(--mobile-glass-border)",
            boxShadow: "0 -2px 12px rgba(0, 0, 0, 0.05)",
            display: "flex",
            gap: 10,
          }}
        >
          <button
            type="button"
            onClick={cancelEdit}
            disabled={saving}
            style={{
              flex: 1,
              minHeight: 48,
              borderRadius: 12,
              border: "1.5px solid var(--mobile-border)",
              background: "var(--mobile-surface)",
              color: "var(--mobile-text)",
              fontFamily: "inherit",
              fontSize: 15,
              fontWeight: 600,
              cursor: saving ? "default" : "pointer",
              opacity: saving ? 0.6 : 1,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              void saveName();
            }}
            disabled={!canSave}
            style={{
              flex: 2,
              minHeight: 48,
              borderRadius: 12,
              border: 0,
              background: canSave
                ? "var(--mobile-accent)"
                : "rgba(255, 80, 0, 0.4)",
              color: "#fff",
              fontFamily: "inherit",
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: "0.02em",
              cursor: canSave ? "pointer" : "default",
              boxShadow: canSave
                ? "0 4px 14px rgba(255, 80, 0, 0.30)"
                : "none",
              transition: "background 0.15s ease, box-shadow 0.15s ease",
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}
