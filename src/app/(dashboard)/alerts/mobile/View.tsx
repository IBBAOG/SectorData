"use client";

// ─── /alerts — Mobile View (≤768px) ──────────────────────────────────────────
//
// Mobile-first layout:
//   - Tab bar: "Subscribe" | "Active" | "Feed" (auth) or just "Subscribe" (anon)
//   - "Subscribe" tab: source catalog in BottomSheet, chip strip for selections,
//     sticky subscribe button at bottom of viewport
//   - "Active" tab: subscriptions list with pause/resume toggles (auth only)
//   - "Feed" tab: recent alert activity feed (auth only)
//
// Same business logic as desktop — consumes useAlertsData, no RPC calls here.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import Link from "next/link";

import BarrelLoading from "@/components/dashboard/BarrelLoading";
import BottomSheet from "@/components/dashboard/mobile/BottomSheet";
import MobileTabBar from "@/components/dashboard/mobile/MobileTabBar";

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

// ─── Source Catalog BottomSheet content ──────────────────────────────────────

function CatalogContent({
  sourceGroups,
  selectedSlugs,
  subscribedSlugs,
  onToggle,
  onSelectAll,
  onDeselectAll,
  selectAll,
  deselectAll,
}: {
  sourceGroups: ReturnType<typeof useAlertsData>["sourceGroups"];
  selectedSlugs: Set<string>;
  subscribedSlugs: Set<string>;
  onToggle: (slug: string) => void;
  onSelectAll: (cat: AlertSourceCategory) => void;
  onDeselectAll: (cat: AlertSourceCategory) => void;
  selectAll: () => void;
  deselectAll: () => void;
}) {
  const [expandedCats, setExpandedCats] = useState<Set<string>>(
    new Set(sourceGroups.map((g) => g.category)),
  );

  const toggleCat = (cat: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  return (
    <div>
      {/* Global selection buttons */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button type="button" className={styles.toolbarBtn} style={{ flex: 1 }} onClick={selectAll}>
          Select all
        </button>
        <button type="button" className={styles.toolbarBtnGhost} style={{ flex: 1 }} onClick={deselectAll}>
          Clear all
        </button>
      </div>

      {sourceGroups.map((group) => {
        const expanded = expandedCats.has(group.category);
        const selectedInCat = group.sources.filter((s) => selectedSlugs.has(s.source_slug)).length;

        return (
          <div key={group.category} className={styles.categoryCard}>
            <div
              className={styles.categoryHeader}
              onClick={() => toggleCat(group.category)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") toggleCat(group.category);
              }}
              aria-expanded={expanded}
            >
              <span className={styles.categoryTitle}>
                {group.category}
                {selectedInCat > 0 && (
                  <span className={styles.categoryBadge}>{selectedInCat}</span>
                )}
              </span>
              <span
                className={styles.categoryActions}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className={styles.selectAllBtn}
                  onClick={() => onSelectAll(group.category)}
                >
                  All
                </button>
                <button
                  type="button"
                  className={styles.selectAllBtn}
                  onClick={() => onDeselectAll(group.category)}
                >
                  None
                </button>
                <span className={`${styles.chevron} ${expanded ? styles.chevronOpen : ""}`}>
                  ▾
                </span>
              </span>
            </div>

            {expanded && (
              <div className={styles.sourceList}>
                {group.sources.map((src) => {
                  const checked = selectedSlugs.has(src.source_slug);
                  const alreadySub = subscribedSlugs.has(src.source_slug);
                  return (
                    <label key={src.source_slug} className={styles.sourceRow}>
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
                            <span style={{ marginLeft: 5, fontSize: 10, color: "#22c55e", fontWeight: 700 }}>
                              ✓
                            </span>
                          )}
                        </div>
                        {src.frequency_hint && (
                          <div className={styles.sourceFrequency}>{src.frequency_hint}</div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Subscribe Tab ────────────────────────────────────────────────────────────

function SubscribeTab() {
  const {
    sourcesLoading,
    sourceGroups,
    selectedSlugs,
    subscribedSlugs,
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
    isAuthenticated,
    allSources,
  } = useAlertsData();

  const [sheetOpen, setSheetOpen] = useState(false);
  const isSubmitting = subscribeState.kind === "submitting";
  const hasFlowResult = subscribeState.kind !== "idle" && subscribeState.kind !== "submitting";
  const noneSelected = selectedSlugs.size === 0;

  // Chip strip: selected source names
  const selectedSources = allSources.filter((s) => selectedSlugs.has(s.source_slug));

  return (
    <div style={{ paddingBottom: hasFlowResult ? 16 : 96 }}>
      {/* Email input */}
      <div className={styles.emailSection}>
        <label htmlFor="mobile-alert-email" className={styles.emailLabel}>
          Your email address
        </label>
        <input
          id="mobile-alert-email"
          type="email"
          className={`${styles.emailInput}${emailError ? ` ${styles.hasError}` : ""}`}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          aria-describedby={emailError ? "m-email-error" : "m-email-hint"}
        />
        {emailError ? (
          <div id="m-email-error" className={styles.emailError} role="alert">
            {emailError}
          </div>
        ) : (
          <div id="m-email-hint" className={styles.emailHint}>
            {isAuthenticated
              ? "You can use a different address — confirmation email will be sent."
              : "We'll send a confirmation link to verify."}
          </div>
        )}
      </div>

      {/* Open catalog button */}
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        style={{
          width: "100%",
          padding: "11px 16px",
          border: "1px solid #d1d1d9",
          borderRadius: 8,
          background: "#fff",
          textAlign: "left",
          fontSize: 14,
          color: noneSelected ? "#8c8c96" : "#1a1a1a",
          fontFamily: "Arial, sans-serif",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <span>
          {sourcesLoading
            ? "Loading sources…"
            : noneSelected
            ? "Choose sources to subscribe to…"
            : `${selectedSlugs.size} source${selectedSlugs.size !== 1 ? "s" : ""} selected`}
        </span>
        <span style={{ color: "#ff5000", fontWeight: 700, fontSize: 18 }}>+</span>
      </button>

      {/* Chip strip */}
      {selectedSources.length > 0 && (
        <div className={styles.chipStrip} style={{ marginBottom: 12 }}>
          {selectedSources.map((src) => (
            <span key={src.source_slug} className={styles.chip}>
              {src.display_name.split(" ").slice(0, 3).join(" ")}
              <button
                type="button"
                className={styles.chipClose}
                onClick={() => toggleSource(src.source_slug)}
                aria-label={`Remove ${src.display_name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Flow result cards */}
      {subscribeState.kind === "needs_confirmation" && (
        <div className={`${styles.statusCard} ${styles.pending}`}>
          <div className={styles.statusTitle}>Check your inbox</div>
          <div className={styles.statusBody}>
            Confirmation link sent to your email address.
          </div>
          <button
            type="button"
            className={styles.resendBtn}
            onClick={resend}
            disabled={resendCooldown > 0}
          >
            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend"}
          </button>
        </div>
      )}

      {subscribeState.kind === "activated" && (
        <div className={`${styles.statusCard} ${styles.success}`}>
          <div className={styles.statusTitle}>
            Subscribed! {subscribeState.count} source{subscribeState.count !== 1 ? "s" : ""} activated.
          </div>
          <div className={styles.statusBody}>
            You&apos;ll receive emails when new data is published.
          </div>
        </div>
      )}

      {subscribeState.kind === "error" && (
        <div className={`${styles.statusCard} ${styles.error}`}>
          <div className={styles.statusTitle}>Something went wrong</div>
          <div className={styles.statusBody}>{subscribeState.message}</div>
        </div>
      )}

      <p className={styles.legalText} style={{ marginTop: 12 }}>
        1 email per update. One-click unsubscribe in every email.
      </p>

      {/* Catalog BottomSheet */}
      <BottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Choose alert sources"
        height="90vh"
        footer={
          <button
            type="button"
            className={styles.subscribeBtn}
            onClick={() => setSheetOpen(false)}
          >
            {noneSelected
              ? "Close"
              : `Confirm ${selectedSlugs.size} source${selectedSlugs.size !== 1 ? "s" : ""}`}
          </button>
        }
      >
        {sourcesLoading ? (
          <div style={{ textAlign: "center", padding: 20 }}>
            <BarrelLoading bare />
          </div>
        ) : (
          <CatalogContent
            sourceGroups={sourceGroups}
            selectedSlugs={selectedSlugs}
            subscribedSlugs={subscribedSlugs}
            onToggle={toggleSource}
            onSelectAll={selectAllInCategory}
            onDeselectAll={deselectAllInCategory}
            selectAll={selectAll}
            deselectAll={deselectAll}
          />
        )}
      </BottomSheet>

      {/* Sticky subscribe button */}
      {!hasFlowResult && (
        <div className={styles.stickyBar}>
          <button
            type="button"
            className={styles.subscribeBtn}
            onClick={submit}
            disabled={isSubmitting || noneSelected}
          >
            {isSubmitting
              ? "Subscribing…"
              : noneSelected
              ? "Select sources to subscribe"
              : `Subscribe to ${selectedSlugs.size} source${selectedSlugs.size !== 1 ? "s" : ""}`}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Active Subscriptions Tab ─────────────────────────────────────────────────

function ActiveTab() {
  const {
    subscriptionsLoading,
    mySubscriptions,
    allSources,
    toggleSubscriptionActive,
    isAuthenticated,
  } = useAlertsData();

  const sourceMap = Object.fromEntries(allSources.map((s) => [s.source_slug, s]));

  if (!isAuthenticated) {
    return (
      <div style={{ textAlign: "center", padding: "32px 16px" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1a1a", marginBottom: 8 }}>
          Sign in to manage subscriptions
        </div>
        <Link
          href="/login"
          style={{
            display: "inline-block",
            padding: "9px 20px",
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
    );
  }

  if (subscriptionsLoading) {
    return (
      <div style={{ textAlign: "center", padding: 24 }}>
        <BarrelLoading bare />
      </div>
    );
  }

  if (mySubscriptions.length === 0) {
    return <div className={styles.emptyState}>No active subscriptions yet.</div>;
  }

  return (
    <div className={styles.subsPanel}>
      {mySubscriptions.map((sub: MySubscription) => {
        const src = sourceMap[sub.source_slug];
        return (
          <div key={sub.source_slug} className={styles.subRow}>
            <div style={{ flex: 1 }}>
              <div className={styles.subName}>{src?.display_name ?? sub.source_slug}</div>
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
              onClick={() => toggleSubscriptionActive(sub.source_slug, sub.is_active)}
              aria-label={sub.is_active ? "Pause" : "Resume"}
            >
              {sub.is_active ? "Pause" : "Resume"}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── Recent Feed Tab ──────────────────────────────────────────────────────────

function FeedTab() {
  const { feedLoading, recentAlerts, allSources, isAuthenticated } = useAlertsData();
  const sourceMap = Object.fromEntries(allSources.map((s) => [s.source_slug, s]));

  if (!isAuthenticated) {
    return (
      <div style={{ textAlign: "center", padding: "32px 16px" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1a1a", marginBottom: 8 }}>
          Sign in to view your alert history
        </div>
        <Link
          href="/login"
          style={{
            display: "inline-block",
            padding: "9px 20px",
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
    );
  }

  if (feedLoading) {
    return (
      <div style={{ textAlign: "center", padding: 24 }}>
        <BarrelLoading bare />
      </div>
    );
  }

  if (recentAlerts.length === 0) {
    return <div className={styles.emptyState}>No alerts received yet.</div>;
  }

  return (
    <div className={styles.subsPanel}>
      {recentAlerts.map((item: RecentAlertItem, i: number) => {
        const src = sourceMap[item.source_slug];
        return (
          <div key={i} className={styles.feedItem}>
            <div className={styles.feedDot} aria-hidden="true" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className={styles.feedSource}>
                {src?.display_name ?? item.display_name ?? item.source_slug}
              </div>
              <div className={styles.feedMeta}>{formatSentAt(item.sent_at)}</div>
            </div>
            <StatusPill status={item.status} />
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Mobile View ─────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement {
  const { guardLoading, guardVisible, isAuthenticated } = useAlertsData();
  const [activeTab, setActiveTab] = useState("subscribe");

  if (guardLoading) {
    return (
      <div style={{ padding: 32, textAlign: "center" }}>
        <BarrelLoading bare />
      </div>
    );
  }

  if (!guardVisible) return <></>;

  const tabs = isAuthenticated
    ? [
        { key: "subscribe", label: "Subscribe" },
        { key: "active", label: "Active" },
        { key: "feed", label: "Recent" },
      ]
    : [{ key: "subscribe", label: "Subscribe" }];

  return (
    <div style={{ fontFamily: "Arial, sans-serif", minHeight: "100vh", background: "#f9f9fb" }}>
      {/* Header */}
      <div
        style={{
          padding: "16px 16px 10px",
          background: "#fff",
          borderBottom: "1px solid #e6e6ec",
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1a1a", marginBottom: 2 }}>
          Alerts
        </div>
        <div style={{ fontSize: 13, color: "#6b6b73" }}>
          Email notifications when new data is published
        </div>
      </div>

      {/* Tab bar */}
      {isAuthenticated && (
        <div style={{ padding: "10px 0 0", background: "#fff", borderBottom: "1px solid #e6e6ec" }}>
          <MobileTabBar
            tabs={tabs}
            activeKey={activeTab}
            onChange={setActiveTab}
            variant="underline"
            ariaLabel="Alerts section navigation"
          />
        </div>
      )}

      {/* Tab content */}
      <div style={{ padding: "16px 16px 0" }}>
        {activeTab === "subscribe" && <SubscribeTab />}
        {activeTab === "active" && <ActiveTab />}
        {activeTab === "feed" && <FeedTab />}
      </div>
    </div>
  );
}
