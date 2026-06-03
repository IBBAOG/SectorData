"use client";

// Desktop View — /alerts (≥769px).
//
// Consumes useAlertsData exclusively — no direct Supabase calls here.
// Layout: two columns — catalog (left: category cards + per-base toggles) and
// the management panel (right: My Subscriptions + Recent Alerts feed).
//
// Logged-in-only: Anon visitors are redirected to /home by
// useModuleVisibilityGuard("alerts"). There is NO email field, NO signup, NO
// double opt-in — toggling a base IS the subscribe. Cadence is a READ-ONLY
// badge.
//
// Binding sync rule (CLAUDE.md § Dual-view policy): any meaningful change here
// (new analysis, new control, copy change) must land in mobile/View.tsx in the
// SAME commit, or the commit message must declare [desktop-only] with a reason.

import NavBar from "@/components/NavBar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
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
import styles from "../page.module.css";

// ─── Category card ────────────────────────────────────────────────────────────

function CategoryCard({
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
    <div className={styles.catCard}>
      <div className={styles.catHeader}>
        <div className={styles.catTitleWrap}>
          <span className={styles.catTitle}>{group.category}</span>
          <span className={styles.catMeta}>
            {group.subscribedCount}/{group.bases.length} on
          </span>
        </div>
        <div className={styles.catActions}>
          <button
            type="button"
            className={styles.linkBtn}
            disabled={group.allSubscribed}
            onClick={() => onToggleCategory(group.category, true)}
          >
            Select all
          </button>
          <button
            type="button"
            className={styles.linkBtn}
            disabled={group.noneSubscribed}
            onClick={() => onToggleCategory(group.category, false)}
          >
            Clear
          </button>
        </div>
      </div>

      {group.bases.map((base) => (
        <BaseRow
          key={base.source_slug}
          base={base}
          onToggle={onToggleBase}
          pending={isPending(base.source_slug)}
        />
      ))}
    </div>
  );
}

// ─── Base row ─────────────────────────────────────────────────────────────────

function BaseRow({
  base,
  onToggle,
  pending,
}: {
  base: SubscribableBase;
  onToggle: (slug: string, next: boolean) => void;
  pending: boolean;
}): React.ReactElement {
  const on = isBaseOn(base);
  return (
    <div className={styles.baseRow}>
      <div className={styles.baseInfo}>
        <div className={styles.baseNameLine}>
          <span className={styles.baseName}>{base.display_name}</span>
          <CadenceBadge cadence={base.cadence} />
          {base.frequency_hint && (
            <span className={styles.freqHint}>{base.frequency_hint}</span>
          )}
        </div>
        {base.description && (
          <div className={styles.baseDesc}>{base.description}</div>
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

// ─── My Subscriptions panel ──────────────────────────────────────────────────

function SubscriptionsPanel({
  subs,
  onUnsubscribe,
  isPending,
}: {
  subs: MySubscription[];
  onUnsubscribe: (slug: string) => void;
  isPending: (slug: string) => boolean;
}): React.ReactElement {
  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <span className={styles.panelTitle}>My Subscriptions</span>
        <span className={styles.sectionCount}>{subs.length}</span>
      </div>
      <div className={styles.panelBody}>
        {subs.length === 0 ? (
          <div className={styles.empty}>
            You&apos;re not subscribed to any alerts yet — pick some above.
          </div>
        ) : (
          subs.map((s) => (
            <div className={styles.subRow} key={s.source_slug}>
              <div className={styles.subInfo}>
                <div className={styles.subName}>{s.display_name}</div>
                <div className={styles.subSub}>
                  <span>{s.category}</span>
                  <CadenceBadge cadence={s.effective_cadence} />
                </div>
              </div>
              <button
                type="button"
                className={styles.removeBtn}
                disabled={isPending(s.source_slug)}
                onClick={() => onUnsubscribe(s.source_slug)}
              >
                Unsubscribe
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Recent Alerts panel ─────────────────────────────────────────────────────

function RecentPanel({ recent }: { recent: RecentAlert[] }): React.ReactElement {
  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <span className={styles.panelTitle}>Recent Alerts</span>
        {recent.length > 0 && (
          <span className={styles.sectionCount}>Last {recent.length}</span>
        )}
      </div>
      <div className={styles.panelBody}>
        {recent.length === 0 ? (
          <div className={styles.empty}>No alerts sent yet.</div>
        ) : (
          recent.map((a) => {
            const period = formatPeriod(a.payload?.period);
            const route = a.payload?.frontend_route;
            return (
              <div className={styles.feedRow} key={a.outbox_id}>
                <div className={styles.feedMain}>
                  <div className={styles.feedTop}>
                    <span className={styles.feedName}>{a.display_name}</span>
                    {period && <span className={styles.feedPeriod}>{period}</span>}
                  </div>
                  <div className={styles.feedTime}>
                    {formatRelative(a.sent_at ?? a.detected_at)}
                  </div>
                  {route && (
                    <a className={styles.feedLink} href={route}>
                      View data &rarr;
                    </a>
                  )}
                </div>
                <StatusPill status={a.status} />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Desktop View ─────────────────────────────────────────────────────────────

export default function DesktopView(): React.ReactElement {
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

  // Guard: hide everything until visibility resolves; Anon is redirected by the
  // guard hook (alerts is clients-only). Render nothing in the meantime.
  if (visLoading || !visible) return <></>;
  if (profileLoading) {
    return (
      <div>
        <NavBar />
        <div id="page-content" className={styles.page}>
          <BarrelLoading />
        </div>
      </div>
    );
  }
  // Defensive: if the profile resolved to Anon (race with the guard redirect),
  // render nothing rather than an empty logged-out catalog.
  if (role === "Anon") return <></>;

  return (
    <div>
      <NavBar />
      <div id="page-content" className={styles.page}>
        <DashboardHeader
          title="Alerts"
          sub="Get an email the moment a data source you follow updates."
          lang="en"
        />

        <p className={styles.note}>
          Toggle a data source on to start receiving email alerts at the address
          on your account. Alerts marked <strong>Immediate</strong> are sent as
          soon as new data lands; <strong>Daily digest</strong> sources are
          bundled into one daily email.
        </p>

        <DataErrorBoundary error={error} loading={loading} retry={refetch}>
          {loading ? (
            <BarrelLoading />
          ) : (
            <div className={styles.layout}>
              {/* ── Left: catalog ──────────────────────────────────────── */}
              <div className={styles.colLeft}>
                <div className={styles.sectionTitle}>
                  Browse &amp; subscribe
                  <span className={styles.sectionCount}>
                    {totalSubscribed} active
                  </span>
                </div>
                <hr className={styles.sectionHr} />

                {groups.length === 0 ? (
                  <div className={styles.empty}>
                    No subscribable data sources are available right now.
                  </div>
                ) : (
                  groups.map((group) => (
                    <CategoryCard
                      key={group.category}
                      group={group}
                      onToggleBase={toggleBase}
                      onToggleCategory={toggleCategory}
                      isPending={isPending}
                    />
                  ))
                )}
              </div>

              {/* ── Right: management panel ────────────────────────────── */}
              <div className={styles.colRight}>
                <SubscriptionsPanel
                  subs={subscriptions}
                  onUnsubscribe={(slug) => toggleBase(slug, false)}
                  isPending={isPending}
                />
                <RecentPanel recent={recent} />
              </div>
            </div>
          )}
        </DataErrorBoundary>
      </div>
    </div>
  );
}
