"use client";

// ─── /alerts — Desktop View (≥769px) ─────────────────────────────────────────
//
// Layout:
//   Left column  — Source catalog (expandable category cards) + email + subscribe
//   Right column — Active Subscriptions panel + Recent Alerts feed (auth only)
//
// This View is a pure presentation layer over useAlertsData.
// No Supabase calls here.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import Link from "next/link";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import BarrelLoading from "@/components/dashboard/BarrelLoading";

import { useAlertsData } from "../useAlertsData";
import type { AlertSource, AlertSourceCategory, MySubscription, RecentAlertItem } from "@/types/alerts";

import styles from "../page.module.css";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSentAt(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function StatusPill({ status }: { status: string }) {
  const cls = {
    sent: styles.pillSent,
    failed: styles.pillFailed,
    queued: styles.pillQueued,
    skipped: styles.pillSkipped,
    sending: styles.pillQueued,
  }[status] ?? styles.pillQueued;

  return (
    <span className={`${styles.statusPill} ${cls}`} aria-label={`Status: ${status}`}>
      {status}
    </span>
  );
}

// ─── Category Card ────────────────────────────────────────────────────────────

function CategoryCard({
  category,
  sources,
  selectedSlugs,
  subscribedSlugs,
  onToggle,
  onSelectAll,
  onDeselectAll,
}: {
  category: AlertSourceCategory;
  sources: AlertSource[];
  selectedSlugs: Set<string>;
  subscribedSlugs: Set<string>;
  onToggle: (slug: string) => void;
  onSelectAll: (cat: AlertSourceCategory) => void;
  onDeselectAll: (cat: AlertSourceCategory) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const selectedInCat = sources.filter((s) => selectedSlugs.has(s.source_slug)).length;

  return (
    <div className={styles.categoryCard}>
      <div
        className={styles.categoryHeader}
        onClick={() => setExpanded((p) => !p)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setExpanded((p) => !p); }}
        aria-expanded={expanded}
      >
        <span className={styles.categoryTitle}>
          {category}
          {selectedInCat > 0 && (
            <span className={styles.categoryBadge}>{selectedInCat} selected</span>
          )}
        </span>
        <span className={styles.categoryActions} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={styles.selectAllBtn}
            onClick={() => onSelectAll(category)}
          >
            Select all
          </button>
          <button
            type="button"
            className={styles.selectAllBtn}
            onClick={() => onDeselectAll(category)}
          >
            Clear
          </button>
          <span className={`${styles.chevron} ${expanded ? styles.chevronOpen : ""}`}>
            ▾
          </span>
        </span>
      </div>

      {expanded && (
        <div className={styles.sourceList}>
          {sources.map((src) => {
            const checked = selectedSlugs.has(src.source_slug);
            const alreadySub = subscribedSlugs.has(src.source_slug);
            return (
              <label
                key={src.source_slug}
                className={styles.sourceRow}
                style={{ cursor: "pointer" }}
              >
                <input
                  type="checkbox"
                  className={styles.sourceCheckbox}
                  checked={checked}
                  onChange={() => onToggle(src.source_slug)}
                  aria-label={src.display_name}
                />
                <div className={styles.sourceInfo}>
                  <div className={styles.sourceName}>
                    {src.display_name}
                    {alreadySub && (
                      <span
                        style={{ marginLeft: 6, fontSize: 10, color: "#22c55e", fontWeight: 700 }}
                      >
                        ✓ subscribed
                      </span>
                    )}
                  </div>
                  {src.frequency_hint && (
                    <div className={styles.sourceFrequency}>{src.frequency_hint}</div>
                  )}
                  {src.description && (
                    <div className={styles.sourceDescription}>{src.description}</div>
                  )}
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Active Subscriptions Panel ───────────────────────────────────────────────

function ActiveSubsPanel({
  loading,
  subscriptions,
  allSources,
  onToggleActive,
}: {
  loading: boolean;
  subscriptions: MySubscription[];
  allSources: AlertSource[];
  onToggleActive: (slug: string, current: boolean) => Promise<void>;
}) {
  const sourceMap = Object.fromEntries(allSources.map((s) => [s.source_slug, s]));

  return (
    <div className={styles.subsPanel}>
      <div className={styles.subsPanelHeader}>
        <span className={styles.subsPanelTitle}>Active Subscriptions</span>
        <span style={{ fontSize: 12, color: "#8c8c96" }}>{subscriptions.length} source{subscriptions.length !== 1 ? "s" : ""}</span>
      </div>

      {loading ? (
        <div style={{ padding: 20, textAlign: "center" }}>
          <BarrelLoading bare />
        </div>
      ) : subscriptions.length === 0 ? (
        <div className={styles.emptyState}>No active subscriptions yet.</div>
      ) : (
        subscriptions.map((sub) => {
          const src = sourceMap[sub.source_slug];
          return (
            <div key={sub.source_slug} className={styles.subRow}>
              <div style={{ flex: 1 }}>
                <div className={styles.subName}>
                  {src?.display_name ?? sub.source_slug}
                </div>
                {src?.frequency_hint && (
                  <div className={styles.subFrequency}>{src.frequency_hint}</div>
                )}
                {!sub.is_confirmed && (
                  <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 2 }}>
                    Awaiting confirmation
                  </div>
                )}
              </div>
              <button
                type="button"
                className={`${styles.toggleBtn} ${sub.is_active ? styles.active : styles.paused}`}
                onClick={() => onToggleActive(sub.source_slug, sub.is_active)}
                aria-label={sub.is_active ? "Pause alerts for this source" : "Resume alerts for this source"}
              >
                {sub.is_active ? "Pause" : "Resume"}
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

// ─── Recent Alerts Feed ───────────────────────────────────────────────────────

function RecentAlertsFeed({
  loading,
  alerts,
  allSources,
}: {
  loading: boolean;
  alerts: RecentAlertItem[];
  allSources: AlertSource[];
}) {
  const sourceMap = Object.fromEntries(allSources.map((s) => [s.source_slug, s]));

  return (
    <div className={styles.subsPanel} style={{ marginTop: 16 }}>
      <div className={styles.subsPanelHeader}>
        <span className={styles.subsPanelTitle}>Recent Activity</span>
        <span style={{ fontSize: 12, color: "#8c8c96" }}>last 20</span>
      </div>

      {loading ? (
        <div style={{ padding: 20, textAlign: "center" }}>
          <BarrelLoading bare />
        </div>
      ) : alerts.length === 0 ? (
        <div className={styles.emptyState}>No alerts received yet.</div>
      ) : (
        alerts.map((item, i) => {
          const src = sourceMap[item.source_slug];
          return (
            <div key={i} className={styles.feedItem}>
              <div className={styles.feedDot} aria-hidden="true" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className={styles.feedSource}>
                  {src?.display_name ?? item.display_name ?? item.source_slug}
                </div>
                <div className={styles.feedMeta}>
                  {formatSentAt(item.sent_at)}
                </div>
              </div>
              <StatusPill status={item.status} />
            </div>
          );
        })
      )}
    </div>
  );
}

// ─── Subscribe flow feedback ──────────────────────────────────────────────────

function SubscribeStatusCard({
  state,
  resend,
  resendCooldown,
  onReset,
}: {
  state: ReturnType<typeof useAlertsData>["subscribeState"];
  resend: () => Promise<void>;
  resendCooldown: number;
  onReset: () => void;
}) {
  if (state.kind === "idle" || state.kind === "submitting") return null;

  if (state.kind === "confirmation_pending") {
    return (
      <div className={`${styles.statusCard} ${styles.pending}`}>
        <div className={styles.statusTitle}>Check your inbox to confirm</div>
        <div className={styles.statusBody}>
          We&apos;ve sent a confirmation link to <strong>{state.email}</strong>.<br />
          Click the link in the email to activate your subscriptions.
        </div>
        <button
          type="button"
          className={styles.resendBtn}
          onClick={resend}
          disabled={resendCooldown > 0}
        >
          {resendCooldown > 0
            ? `Resend in ${resendCooldown}s`
            : "Resend confirmation email"}
        </button>
      </div>
    );
  }

  if (state.kind === "instant_confirmed") {
    return (
      <div className={`${styles.statusCard} ${styles.success}`}>
        <div className={styles.statusTitle}>
          Subscribed! {state.count} source{state.count !== 1 ? "s" : ""} activated.
        </div>
        <div className={styles.statusBody}>
          You&apos;ll receive an email whenever new data is published.
        </div>
      </div>
    );
  }

  if (state.kind === "already_subscribed") {
    return (
      <div className={`${styles.statusCard} ${styles.info}`}>
        <div className={styles.statusTitle}>Already subscribed</div>
        <div className={styles.statusBody}>
          You&apos;re already subscribed to these sources. Check your Active Subscriptions panel to manage them.
        </div>
      </div>
    );
  }

  if (state.kind === "suppressed") {
    return (
      <div className={`${styles.statusCard} ${styles.error}`}>
        <div className={styles.statusTitle}>Email suppressed</div>
        <div className={styles.statusBody}>
          This email address has been suppressed due to a previous bounce or complaint. Please contact support.
        </div>
      </div>
    );
  }

  if (state.kind === "rate_limited") {
    return (
      <div className={`${styles.statusCard} ${styles.error}`}>
        <div className={styles.statusTitle}>Too many requests</div>
        <div className={styles.statusBody}>
          Sign-up limit reached. Please try again in one hour.
        </div>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className={`${styles.statusCard} ${styles.error}`}>
        <div className={styles.statusTitle}>Something went wrong</div>
        <div className={styles.statusBody}>{state.message}</div>
        <button type="button" className={styles.resendBtn} onClick={onReset}>
          Try again
        </button>
      </div>
    );
  }

  return null;
}

// ─── Main Desktop View ────────────────────────────────────────────────────────

export default function DesktopView(): React.ReactElement {
  const {
    guardLoading,
    guardVisible,
    isAuthenticated,
    sourcesLoading,
    sourceGroups,
    selectedSlugs,
    toggleSource,
    selectAllInCategory,
    deselectAllInCategory,
    selectAll,
    deselectAll,
    email,
    setEmail,
    emailError,
    subscribeState,
    submit,
    resend,
    resendCooldown,
    subscriptionsLoading,
    mySubscriptions,
    toggleSubscriptionActive,
    feedLoading,
    recentAlerts,
    allSources,
    subscribedSlugs,
  } = useAlertsData();

  // Local state to allow resetting subscribe flow
  const [, forceRender] = useState(0);
  const handleReset = () => {
    // The hook state is managed internally; we rely on re-render from parent
    // For simplicity, we reload the page to reset (the hook state is local)
    window.location.reload();
  };

  if (guardLoading) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <BarrelLoading bare />
      </div>
    );
  }

  if (!guardVisible) return <></>;

  const isSubmitting = subscribeState.kind === "submitting";
  const hasFlowResult =
    subscribeState.kind !== "idle" && subscribeState.kind !== "submitting";
  const noneSelected = selectedSlugs.size === 0;

  return (
    <div style={{ padding: "24px 32px", fontFamily: "Arial, sans-serif", maxWidth: 1280, margin: "0 auto" }}>
      <DashboardHeader
        title="Alerts"
        sub="Stay informed — receive email notifications when new data is published"
        lang="en"
        hideDivider={false}
      />

      <div className={styles.desktopLayout}>
        {/* ── Left: catalog + subscribe form ── */}
        <div>
          {/* Global selection toolbar */}
          <div className={styles.toolbar}>
            <button type="button" className={styles.toolbarBtn} onClick={selectAll}>
              Select all sources
            </button>
            <button type="button" className={styles.toolbarBtnGhost} onClick={deselectAll}>
              Clear all
            </button>
            <span className={styles.selectionCount}>
              {selectedSlugs.size > 0
                ? `${selectedSlugs.size} source${selectedSlugs.size !== 1 ? "s" : ""} selected`
                : "No sources selected"}
            </span>
          </div>

          {/* Source catalog */}
          {sourcesLoading ? (
            <div style={{ padding: 20, textAlign: "center" }}>
              <BarrelLoading bare />
            </div>
          ) : (
            sourceGroups.map((group) => (
              <CategoryCard
                key={group.category}
                category={group.category}
                sources={group.sources}
                selectedSlugs={selectedSlugs}
                subscribedSlugs={subscribedSlugs}
                onToggle={toggleSource}
                onSelectAll={selectAllInCategory}
                onDeselectAll={deselectAllInCategory}
              />
            ))
          )}

          {/* Email + submit */}
          <div style={{ marginTop: 20 }}>
            <div className={styles.emailSection}>
              <label htmlFor="alert-email" className={styles.emailLabel}>
                Your email address
              </label>
              <input
                id="alert-email"
                type="email"
                className={`${styles.emailInput}${emailError ? ` ${styles.hasError}` : ""}`}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                aria-describedby={emailError ? "alert-email-error" : "alert-email-hint"}
                autoComplete="email"
              />
              {emailError ? (
                <div id="alert-email-error" className={styles.emailError} role="alert">
                  {emailError}
                </div>
              ) : (
                <div id="alert-email-hint" className={styles.emailHint}>
                  {isAuthenticated
                    ? "Pre-filled with your account email. You can use a different address — confirmation email will be sent."
                    : "We'll send a confirmation link to verify your email."}
                </div>
              )}
            </div>

            {!hasFlowResult && (
              <button
                type="button"
                className={styles.subscribeBtn}
                onClick={submit}
                disabled={isSubmitting || noneSelected}
                aria-live="polite"
              >
                {isSubmitting
                  ? "Subscribing…"
                  : noneSelected
                  ? "Select sources above to subscribe"
                  : `Subscribe to ${selectedSlugs.size} selected source${selectedSlugs.size !== 1 ? "s" : ""}`}
              </button>
            )}

            <SubscribeStatusCard
              state={subscribeState}
              resend={resend}
              resendCooldown={resendCooldown}
              onReset={handleReset}
            />

            <p className={styles.legalText}>
              We send 1 email per data update. Each email includes a one-click unsubscribe link.
              Subscriptions are per-source — you can pause or cancel any source independently.
            </p>
          </div>
        </div>

        {/* ── Right: management panel (auth only) ── */}
        <div>
          {isAuthenticated ? (
            <>
              <ActiveSubsPanel
                loading={subscriptionsLoading}
                subscriptions={mySubscriptions}
                allSources={allSources}
                onToggleActive={toggleSubscriptionActive}
              />
              <RecentAlertsFeed
                loading={feedLoading}
                alerts={recentAlerts}
                allSources={allSources}
              />
            </>
          ) : (
            <div
              style={{
                background: "#fafafa",
                border: "1px solid #e6e6ec",
                borderRadius: 10,
                padding: 20,
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1a1a", marginBottom: 8 }}>
                Manage your subscriptions
              </div>
              <div style={{ fontSize: 13, color: "#6b6b73", marginBottom: 16 }}>
                Sign in to view and manage your active subscriptions and recent alert history.
              </div>
              <Link
                href="/login"
                style={{
                  display: "inline-block",
                  padding: "9px 18px",
                  background: "#ff5000",
                  color: "#fff",
                  borderRadius: 7,
                  fontWeight: 700,
                  fontSize: 13,
                  textDecoration: "none",
                }}
              >
                Sign in
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
