"use client";

// ─── useAlertsData — shared brain for /alerts ─────────────────────────────────
//
// SINGLE source of truth for all RPC calls, state, and derived values.
// Both desktop/View.tsx and mobile/View.tsx consume this hook and never call
// Supabase directly.
//
// Auth tiers:
//   - Anon       → sources catalog + subscribe (double opt-in)
//   - Client     → same + list_my_subscriptions + list_my_recent_alerts + toggle
//   - Admin      → same as Client (admin panel lives in worker_dash-admin)
//
// Polling: recent alerts feed polled 1×/60s (nice-to-have; emails are push).
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseClient } from "@/lib/supabaseClient";
import { useUserProfile } from "@/context/UserProfileContext";
import { useModuleVisibilityGuard } from "@/hooks/useModuleVisibilityGuard";

import {
  rpcListAlertSources,
  rpcSubscribeToAlerts,
  rpcResendConfirmation,
  rpcListMySubscriptions,
  rpcListMyRecentAlerts,
  rpcUpdateSubscriptionActive,
} from "@/lib/rpc";

import type {
  AlertSource,
  AlertSourceCategory,
  MySubscription,
  RecentAlertItem,
  SubscribeFlowState,
} from "@/types/alerts";

// ─── RFC 5322 email regex (simplified, client-side gate only) ────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Rate-limit: prevent double-submit within 30 seconds.
const SUBMIT_COOLDOWN_MS = 30_000;

// Recent alerts poll interval (1 minute).
const FEED_POLL_MS = 60_000;

// ─── Grouped source catalog type ─────────────────────────────────────────────
export interface SourceGroup {
  category: AlertSourceCategory;
  sources: AlertSource[];
}

// ─── Hook return type ─────────────────────────────────────────────────────────
export interface AlertsData {
  // Visibility guard
  guardLoading: boolean;
  guardVisible: boolean;

  // Auth
  isAuthenticated: boolean;
  userEmail: string; // pre-filled from auth or empty string

  // Source catalog
  sourcesLoading: boolean;
  sourceGroups: SourceGroup[];

  // Selection state
  selectedSlugs: Set<string>;
  toggleSource: (slug: string) => void;
  selectAllInCategory: (category: AlertSourceCategory) => void;
  deselectAllInCategory: (category: AlertSourceCategory) => void;
  selectAll: () => void;
  deselectAll: () => void;

  // Email field
  email: string;
  setEmail: (v: string) => void;
  emailError: string | null;

  // Subscribe flow
  subscribeState: SubscribeFlowState;
  submit: () => Promise<void>;
  resend: () => Promise<void>;
  resendCooldown: number; // seconds remaining before resend is allowed again

  // Authenticated management
  subscriptionsLoading: boolean;
  mySubscriptions: MySubscription[];
  toggleSubscriptionActive: (slug: string, current: boolean) => Promise<void>;

  // Recent alerts feed (authenticated only)
  feedLoading: boolean;
  recentAlerts: RecentAlertItem[];

  // Helpers
  allSources: AlertSource[];
  subscribedSlugs: Set<string>; // slugs already in mySubscriptions
}

export function useAlertsData(): AlertsData {
  const rawSupabase = getSupabaseClient();
  // Type-assert: at runtime supabase will be available (env vars set).
  // Null guard is handled per-call with early returns.
  const supabase = rawSupabase as SupabaseClient;
  const { role } = useUserProfile();
  const { visible: guardVisible, loading: guardLoading } =
    useModuleVisibilityGuard("alerts");

  const isAuthenticated = role !== "Anon";

  // Fetch the authenticated user's email from the auth session.
  const [userEmail, setUserEmail] = useState<string>("");
  useEffect(() => {
    if (!rawSupabase) return;
    rawSupabase.auth.getSession().then(({ data }) => {
      setUserEmail(data.session?.user?.email ?? "");
    });
  }, [rawSupabase]);

  // ── Source catalog ───────────────────────────────────────────────────────
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [allSources, setAllSources] = useState<AlertSource[]>([]);

  useEffect(() => {
    let cancelled = false;
    setSourcesLoading(true);
    rpcListAlertSources(supabase).then((rows) => {
      if (!cancelled) {
        setAllSources(rows);
        setSourcesLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [supabase]);

  // Derive grouped catalog
  const sourceGroups: SourceGroup[] = (() => {
    const order: AlertSourceCategory[] = [
      "Fuel Distribution",
      "Oil & Gas",
      "Vessels",
      "Proprietary",
    ];
    return order
      .map((cat) => ({
        category: cat,
        sources: allSources.filter((s) => s.category === cat),
      }))
      .filter((g) => g.sources.length > 0);
  })();

  // ── Selection state ──────────────────────────────────────────────────────
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set());

  const toggleSource = useCallback((slug: string) => {
    setSelectedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);

  const selectAllInCategory = useCallback(
    (category: AlertSourceCategory) => {
      const slugs = allSources
        .filter((s) => s.category === category)
        .map((s) => s.source_slug);
      setSelectedSlugs((prev) => {
        const next = new Set(prev);
        slugs.forEach((s) => next.add(s));
        return next;
      });
    },
    [allSources],
  );

  const deselectAllInCategory = useCallback(
    (category: AlertSourceCategory) => {
      const slugs = new Set(
        allSources
          .filter((s) => s.category === category)
          .map((s) => s.source_slug),
      );
      setSelectedSlugs((prev) => {
        const next = new Set(prev);
        slugs.forEach((s) => next.delete(s));
        return next;
      });
    },
    [allSources],
  );

  const selectAll = useCallback(() => {
    setSelectedSlugs(new Set(allSources.map((s) => s.source_slug)));
  }, [allSources]);

  const deselectAll = useCallback(() => {
    setSelectedSlugs(new Set());
  }, []);

  // ── Email field ──────────────────────────────────────────────────────────
  const [email, setEmailRaw] = useState<string>("");
  const [emailError, setEmailError] = useState<string | null>(null);

  // Pre-fill with auth email when user logs in
  useEffect(() => {
    if (isAuthenticated && userEmail && !email) {
      setEmailRaw(userEmail);
    }
  }, [isAuthenticated, userEmail, email]);

  const setEmail = useCallback((v: string) => {
    setEmailRaw(v);
    if (emailError) setEmailError(null);
  }, [emailError]);

  // ── Subscribe flow ───────────────────────────────────────────────────────
  const [subscribeState, setSubscribeState] = useState<SubscribeFlowState>({
    kind: "idle",
  });
  const lastSubmitRef = useRef<number>(0);
  const [resendCooldown, setResendCooldown] = useState(0);
  const resendTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Pending slugs stored so "resend" can re-use them without user re-selecting
  const pendingEmailRef = useRef<string>("");
  const pendingSlugsRef = useRef<string[]>([]);

  // Ref to avoid forward-reference issue: submit calls refreshSubscriptions
  // which is defined later. We populate this ref after refreshSubscriptions is created.
  const refreshSubscriptionsRef = useRef<(() => Promise<void>) | null>(null);

  const submit = useCallback(async () => {
    // Client-side guard: email format
    if (!EMAIL_RE.test(email)) {
      setEmailError("Please enter a valid email address");
      return;
    }
    // Client-side guard: must select at least 1 source
    if (selectedSlugs.size === 0) {
      return; // caller should disable button when size === 0
    }
    // Rate limit: 1 submit per 30s
    const now = Date.now();
    if (now - lastSubmitRef.current < SUBMIT_COOLDOWN_MS) {
      return;
    }
    lastSubmitRef.current = now;

    setSubscribeState({ kind: "submitting" });

    const slugs = Array.from(selectedSlugs);
    pendingEmailRef.current = email;
    pendingSlugsRef.current = slugs;

    const result = await rpcSubscribeToAlerts(supabase, email, slugs);

    // Backend returns { ok, error?, requires_confirmation?, subscribed, confirmation_sent }.
    // 'suppressed', 'already_subscribed', 'rate_limited' are never returned — no branches.
    if (result.error) {
      setSubscribeState({ kind: "error", message: result.error });
      return;
    }

    // Insta-activated: logged-in user + email matches auth.email — no confirmation needed.
    if (!result.requires_confirmation && result.subscribed > 0) {
      setSubscribeState({ kind: "activated", count: result.subscribed });
      // Refresh my subscriptions panel via ref (avoids forward-reference)
      if (isAuthenticated && refreshSubscriptionsRef.current) {
        refreshSubscriptionsRef.current();
      }
      return;
    }

    // Anon (or email override) path — double opt-in required.
    setSubscribeState({ kind: "needs_confirmation" });
  }, [email, selectedSlugs, supabase, isAuthenticated]);

  const resend = useCallback(async () => {
    if (resendCooldown > 0) return;
    const result = await rpcResendConfirmation(
      supabase,
      pendingEmailRef.current,
      pendingSlugsRef.current,
    );
    if (result.retry_after_seconds) {
      let remaining = result.retry_after_seconds;
      setResendCooldown(remaining);
      if (resendTimerRef.current) clearInterval(resendTimerRef.current);
      resendTimerRef.current = setInterval(() => {
        remaining -= 1;
        setResendCooldown(remaining);
        if (remaining <= 0) {
          clearInterval(resendTimerRef.current!);
          resendTimerRef.current = null;
        }
      }, 1000);
    }
  }, [supabase, resendCooldown]);

  // Cleanup resend timer on unmount
  useEffect(() => {
    return () => {
      if (resendTimerRef.current) clearInterval(resendTimerRef.current);
    };
  }, []);

  // ── Authenticated subscriptions ──────────────────────────────────────────
  const [subscriptionsLoading, setSubscriptionsLoading] = useState(false);
  const [mySubscriptions, setMySubscriptions] = useState<MySubscription[]>([]);

  const refreshSubscriptions = useCallback(async () => {
    if (!isAuthenticated) return;
    setSubscriptionsLoading(true);
    const rows = await rpcListMySubscriptions(supabase);
    setMySubscriptions(rows);
    setSubscriptionsLoading(false);
  }, [isAuthenticated, supabase]);

  // Keep the ref in sync so submit() can call refreshSubscriptions without
  // creating a circular dependency in the useCallback deps array.
  refreshSubscriptionsRef.current = refreshSubscriptions;

  useEffect(() => {
    if (isAuthenticated) refreshSubscriptions();
  }, [isAuthenticated, refreshSubscriptions]);

  const subscribedSlugs = new Set(mySubscriptions.map((s) => s.source_slug));

  const toggleSubscriptionActive = useCallback(
    async (slug: string, current: boolean) => {
      // Optimistic update
      setMySubscriptions((prev) =>
        prev.map((s) =>
          s.source_slug === slug ? { ...s, is_active: !current } : s,
        ),
      );
      const ok = await rpcUpdateSubscriptionActive(supabase, slug, !current);
      if (!ok) {
        // Revert on failure
        setMySubscriptions((prev) =>
          prev.map((s) =>
            s.source_slug === slug ? { ...s, is_active: current } : s,
          ),
        );
      }
    },
    [supabase],
  );

  // ── Recent alerts feed (poll 1×/60s) ────────────────────────────────────
  const [feedLoading, setFeedLoading] = useState(false);
  const [recentAlerts, setRecentAlerts] = useState<RecentAlertItem[]>([]);

  const fetchFeed = useCallback(async () => {
    if (!isAuthenticated) return;
    setFeedLoading(true);
    const rows = await rpcListMyRecentAlerts(supabase, 20);
    setRecentAlerts(rows);
    setFeedLoading(false);
  }, [isAuthenticated, supabase]);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchFeed();
    const intervalId = setInterval(fetchFeed, FEED_POLL_MS);
    return () => clearInterval(intervalId);
  }, [isAuthenticated, fetchFeed]);

  return {
    guardLoading,
    guardVisible,
    isAuthenticated,
    userEmail,
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
  };
}
