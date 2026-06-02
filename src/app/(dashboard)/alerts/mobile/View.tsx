"use client";

// Mobile View — /alerts (≤768px).
//
// Same analysis as desktop, mobile-first chrome. Consumes useAlertsData
// exclusively — no direct Supabase calls. Global chrome (top bar, Home pill,
// toast host) is mounted by MobileShell; this View renders only its body.
//
// Two stacked tabs (no horizontal room for two columns):
//   • Browse      — category sections + per-base toggles + Select all / Clear
//   • My alerts   — My Subscriptions list + Recent Alerts feed
//
// Logged-in-only: Anon visitors are redirected to /home by
// useModuleVisibilityGuard("alerts"). No email field, no signup, no double
// opt-in — toggling a base IS the subscribe. Cadence is a READ-ONLY badge.
//
// Constraints (docs/app/dual-view-pattern.md § 5): touch targets ≥44px, no
// horizontal scroll, light-only, NO export. Do NOT render NavBar / Home pill /
// footer here.
//
// Binding sync rule (CLAUDE.md § Dual-view policy): meaningful changes here must
// land in desktop/View.tsx in the SAME commit, or the commit message must
// declare [mobile-only] with a reason.

import { useState } from "react";

import { MobileTabBar } from "@/components/dashboard/mobile";
import BarrelLoading from "@/components/dashboard/BarrelLoading";
import DataErrorBoundary from "@/components/dashboard/DataErrorBoundary";
import { useModuleVisibilityGuard } from "@/hooks/useModuleVisibilityGuard";
import {
  useAlertsData,
  isBaseOn,
  type CategoryGroup,
} from "../useAlertsData";
import {
  CadenceBadge,
  StatusPill,
  ToggleSwitch,
  formatRelative,
  formatPeriod,
} from "../shared";
import type {
  SubscribableBase,
  MySubscription,
  RecentAlert,
} from "@/types/alerts";

type Tab = "browse" | "mine";

// ─── Small layout primitives (mobile tokens) ─────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div
      style={{
        padding: "14px 16px 6px",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.07em",
        textTransform: "uppercase",
        color: "var(--mobile-text-muted)",
      }}
    >
      {children}
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div
      style={{
        padding: "28px 20px",
        textAlign: "center",
        color: "var(--mobile-text-muted)",
        fontSize: 14,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

// ─── Category section ─────────────────────────────────────────────────────────

function CategorySection({
  group,
  onToggleBase,
  onToggleCategory,
  isPending,
}: {
  group: CategoryGroup;
  onToggleBase: (slug: string, next: boolean) => void;
  onToggleCategory: (category: CategoryGroup["category"], next: boolean) => void;
  isPending: (slug: string) => boolean;
}): React.ReactElement {
  return (
    <div style={{ marginBottom: 18 }}>
      {/* Category header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "8px 16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "var(--mobile-accent)",
            }}
          >
            {group.category}
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--mobile-text-muted)" }}>
            {group.subscribedCount}/{group.bases.length}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <CatActionButton
            label="All"
            disabled={group.allSubscribed}
            onClick={() => onToggleCategory(group.category, true)}
          />
          <CatActionButton
            label="Clear"
            disabled={group.noneSubscribed}
            onClick={() => onToggleCategory(group.category, false)}
          />
        </div>
      </div>

      {/* Bases */}
      <div
        style={{
          background: "var(--mobile-surface)",
          border: "1px solid var(--mobile-border)",
          borderRadius: "var(--mobile-radius-md)",
          margin: "0 12px",
          overflow: "hidden",
        }}
      >
        {group.bases.map((base, i) => (
          <BaseRow
            key={base.source_slug}
            base={base}
            divider={i < group.bases.length - 1}
            onToggle={onToggleBase}
            pending={isPending(base.source_slug)}
          />
        ))}
      </div>
    </div>
  );
}

function CatActionButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        minHeight: 32,
        padding: "0 12px",
        borderRadius: 999,
        border: "1px solid var(--mobile-border)",
        background: "var(--mobile-surface)",
        color: disabled ? "var(--mobile-text-muted)" : "var(--mobile-accent)",
        fontSize: 12,
        fontWeight: 600,
        fontFamily: "inherit",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}

// ─── Base row ─────────────────────────────────────────────────────────────────

function BaseRow({
  base,
  divider,
  onToggle,
  pending,
}: {
  base: SubscribableBase;
  divider: boolean;
  onToggle: (slug: string, next: boolean) => void;
  pending: boolean;
}): React.ReactElement {
  const on = isBaseOn(base);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        borderBottom: divider ? "1px solid var(--mobile-divider)" : "none",
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--mobile-text)" }}>
            {base.display_name}
          </span>
          <CadenceBadge cadence={base.cadence} />
        </div>
        {base.description && (
          <div
            style={{
              marginTop: 3,
              fontSize: 12,
              lineHeight: 1.4,
              color: "var(--mobile-text-muted)",
            }}
          >
            {base.description}
          </div>
        )}
        {base.frequency_hint && (
          <div style={{ marginTop: 3, fontSize: 11, color: "var(--mobile-text-muted)" }}>
            {base.frequency_hint}
          </div>
        )}
      </div>
      <ToggleSwitch
        on={on}
        disabled={pending}
        ariaLabel={`${on ? "Unsubscribe from" : "Subscribe to"} ${base.display_name}`}
        onChange={(next) => onToggle(base.source_slug, next)}
      />
    </div>
  );
}

// ─── My Subscriptions list ───────────────────────────────────────────────────

function SubscriptionsList({
  subs,
  onUnsubscribe,
  isPending,
}: {
  subs: MySubscription[];
  onUnsubscribe: (slug: string) => void;
  isPending: (slug: string) => boolean;
}): React.ReactElement {
  if (subs.length === 0) {
    return (
      <EmptyState>
        You&apos;re not subscribed to any alerts yet — pick some from{" "}
        <strong style={{ color: "var(--mobile-text)" }}>Browse</strong>.
      </EmptyState>
    );
  }
  return (
    <div
      style={{
        background: "var(--mobile-surface)",
        border: "1px solid var(--mobile-border)",
        borderRadius: "var(--mobile-radius-md)",
        margin: "0 12px",
        overflow: "hidden",
      }}
    >
      {subs.map((s, i) => (
        <div
          key={s.source_slug}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 14px",
            borderBottom: i < subs.length - 1 ? "1px solid var(--mobile-divider)" : "none",
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "var(--mobile-text)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {s.display_name}
            </div>
            <div
              style={{
                marginTop: 3,
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 11,
                color: "var(--mobile-text-muted)",
              }}
            >
              <span>{s.category}</span>
              <CadenceBadge cadence={s.effective_cadence} />
            </div>
          </div>
          <button
            type="button"
            disabled={isPending(s.source_slug)}
            onClick={() => onUnsubscribe(s.source_slug)}
            style={{
              flexShrink: 0,
              minHeight: 36,
              padding: "0 14px",
              borderRadius: 999,
              border: "1px solid var(--mobile-border)",
              background: "var(--mobile-surface)",
              color: "var(--mobile-down, #c62828)",
              fontSize: 12,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: isPending(s.source_slug) ? "not-allowed" : "pointer",
              opacity: isPending(s.source_slug) ? 0.5 : 1,
            }}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Recent Alerts feed ──────────────────────────────────────────────────────

function RecentList({ recent }: { recent: RecentAlert[] }): React.ReactElement {
  if (recent.length === 0) {
    return <EmptyState>No alerts sent yet.</EmptyState>;
  }
  return (
    <div
      style={{
        background: "var(--mobile-surface)",
        border: "1px solid var(--mobile-border)",
        borderRadius: "var(--mobile-radius-md)",
        margin: "0 12px",
        overflow: "hidden",
      }}
    >
      {recent.map((a, i) => {
        const period = formatPeriod(a.payload?.period);
        const route = a.payload?.frontend_route;
        return (
          <div
            key={a.outbox_id}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              padding: "12px 14px",
              borderBottom: i < recent.length - 1 ? "1px solid var(--mobile-divider)" : "none",
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "var(--mobile-text)" }}>
                  {a.display_name}
                </span>
                {period && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--mobile-text-muted)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {period}
                  </span>
                )}
              </div>
              <div
                style={{
                  marginTop: 3,
                  fontSize: 11,
                  color: "var(--mobile-text-muted)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatRelative(a.sent_at ?? a.detected_at)}
              </div>
              {route && (
                <a
                  href={route}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    marginTop: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--mobile-accent)",
                    textDecoration: "none",
                  }}
                >
                  View data &rarr;
                </a>
              )}
            </div>
            <StatusPill status={a.status} />
          </div>
        );
      })}
    </div>
  );
}

// ─── Mobile View ─────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("alerts");
  const {
    role,
    profileLoading,
    groups,
    subscriptions,
    recent,
    totalSubscribed,
    loading,
    error,
    refetch,
    toggleBase,
    toggleCategory,
    isPending,
  } = useAlertsData();

  const [tab, setTab] = useState<Tab>("browse");

  if (visLoading || !visible) return <></>;
  if (role === "Anon" && !profileLoading) return <></>;

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "var(--mobile-bg)",
        paddingBottom: "calc(96px + var(--mobile-safe-bottom))",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ padding: "12px 16px 4px" }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "var(--mobile-accent)" }}>
          Alerts
        </h1>
        <p
          style={{
            margin: "4px 0 0",
            fontSize: 13,
            lineHeight: 1.45,
            color: "var(--mobile-text-muted)",
          }}
        >
          Get an email the moment a data source you follow updates.
        </p>
      </div>

      {/* ── Tabs (sticky under the global top bar) ─────────────────────── */}
      <div
        style={{
          position: "sticky",
          top: "var(--mobile-topbar-h)",
          zIndex: 20,
          background: "var(--mobile-bg)",
          paddingTop: 8,
          paddingBottom: 8,
        }}
      >
        <MobileTabBar
          tabs={[
            { key: "browse", label: "Browse", badge: <TabBadge n={totalSubscribed} /> },
            { key: "mine", label: "My alerts", badge: <TabBadge n={subscriptions.length} /> },
          ]}
          activeKey={tab}
          onChange={(k) => setTab(k as Tab)}
          ariaLabel="Alerts sections"
        />
      </div>

      <DataErrorBoundary error={error} loading={loading} retry={refetch}>
        {loading ? (
          <div style={{ padding: "48px 0", display: "flex", justifyContent: "center" }}>
            <BarrelLoading bare />
          </div>
        ) : tab === "browse" ? (
          // ── Browse tab ────────────────────────────────────────────────
          <div style={{ paddingTop: 8 }}>
            {groups.length === 0 ? (
              <EmptyState>No subscribable data sources are available right now.</EmptyState>
            ) : (
              groups.map((group) => (
                <CategorySection
                  key={group.category}
                  group={group}
                  onToggleBase={toggleBase}
                  onToggleCategory={toggleCategory}
                  isPending={isPending}
                />
              ))
            )}
          </div>
        ) : (
          // ── My alerts tab ─────────────────────────────────────────────
          <div style={{ paddingTop: 4 }}>
            <SectionLabel>My Subscriptions</SectionLabel>
            <SubscriptionsList
              subs={subscriptions}
              onUnsubscribe={(slug) => toggleBase(slug, false)}
              isPending={isPending}
            />

            <SectionLabel>Recent Alerts</SectionLabel>
            <RecentList recent={recent} />
          </div>
        )}
      </DataErrorBoundary>
    </div>
  );
}

// ─── Tab count badge ──────────────────────────────────────────────────────────

function TabBadge({ n }: { n: number }): React.ReactElement | null {
  if (n <= 0) return null;
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 18,
        height: 18,
        padding: "0 5px",
        borderRadius: 999,
        background: "currentColor",
        fontSize: 10,
        fontWeight: 700,
      }}
    >
      <span style={{ color: "var(--mobile-surface)", lineHeight: 1 }}>{n}</span>
    </span>
  );
}
