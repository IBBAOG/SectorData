"use client";

// ─── useAlertsData — single brain for the /alerts dual-view ──────────────────
//
// Both desktop/View.tsx and mobile/View.tsx consume this hook EXCLUSIVELY.
// Neither View calls supabase.rpc(...) directly, nor imports rpc.ts wrappers.
//
// Responsibilities:
//   • Fetch the subscribable-base catalog (with the user's current flags).
//   • Fetch the user's active/paused subscriptions.
//   • Fetch + poll (60s) the read-only recent-alerts feed.
//   • Optimistic subscribe/unsubscribe (single + bulk per category), reverting
//     on RPC failure and surfacing an app-toast.
//   • Group the catalog by category in a stable, curated order.
//
// The subscriber's email is implicit (their auth email) — there is NO email
// field, NO anonymous signup, NO double opt-in, NO confirmation token here.
// Cadence is shown as a READ-ONLY badge: the backend engine honors the
// source-level cadence only; we never expose a per-subscription cadence toggle.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getSupabaseClient } from "@/lib/supabaseClient";
import { useUserProfile } from "@/context/UserProfileContext";
import {
  rpcListSubscribableBases,
  rpcListMySubscriptions,
  rpcListMyRecentAlerts,
  rpcSetMySubscription,
  rpcSetMySubscriptions,
} from "@/lib/rpc";
import type {
  SubscribableBase,
  MySubscription,
  RecentAlert,
  AlertCategory,
} from "@/types/alerts";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Curated display order for the four seeded categories. Anything not listed
 *  here is appended afterwards in alphabetical order (forward-compatible). */
export const CATEGORY_ORDER: AlertCategory[] = [
  "Fuel Distribution",
  "Oil & Gas",
  "Vessels",
  "Proprietary",
];

/** Recent-alerts feed poll interval. Emails are the real channel — this is a
 *  nice-to-have so the in-app feed feels live without hammering Supabase. */
const FEED_POLL_MS = 60_000;

const FEED_LIMIT = 20;

// ─── Derived shapes (exposed to both Views) ──────────────────────────────────

/** A category with its bases, ready to render as a section. */
export interface CategoryGroup {
  category: AlertCategory;
  bases: SubscribableBase[];
  /** Count of bases the user is actively subscribed to in this category. */
  subscribedCount: number;
  /** True when every base in the category is actively subscribed. */
  allSubscribed: boolean;
  /** True when none of the bases in the category is actively subscribed. */
  noneSubscribed: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** A base counts as "subscribed" in the UI only when an active subscription
 *  row exists. A paused subscription (row present, active off) reads as off. */
export function isBaseOn(b: Pick<SubscribableBase, "is_subscribed" | "sub_is_active">): boolean {
  return b.is_subscribed && b.sub_is_active;
}

/** Fire a transient pill message (handled by MobileToastHost on mobile; harmless
 *  no-op on desktop where no host is mounted). */
function toast(message: string, tone: "info" | "warning" | "error" = "info"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("app-toast", {
      detail: { message, tone, source: "alerts" },
    }),
  );
}

// ─── Hook return type ─────────────────────────────────────────────────────────

export interface UseAlertsData {
  /** Current tier — Views redirect Anon to /home (clients-only module). */
  role: "Anon" | "Client" | "Admin";
  profileLoading: boolean;

  /** Raw catalog (flat). Prefer `groups` for rendering. */
  bases: SubscribableBase[];
  /** Catalog grouped + ordered by category. */
  groups: CategoryGroup[];
  /** The user's active + paused subscriptions. */
  subscriptions: MySubscription[];
  /** Read-only recent-alerts feed. */
  recent: RecentAlert[];

  /** Total count of bases the user is actively subscribed to (across all). */
  totalSubscribed: number;

  loading: boolean;
  error: Error | null;
  /** Re-run the catalog + subscriptions fetch. */
  refetch: () => void;

  /** Optimistically toggle one base; reverts on failure. */
  toggleBase: (sourceSlug: string, nextActive: boolean) => Promise<void>;
  /** Optimistically toggle every base in a category; reverts on failure. */
  toggleCategory: (category: AlertCategory, nextActive: boolean) => Promise<void>;
  /** True while a write is in flight for the given slug (disable its control). */
  isPending: (sourceSlug: string) => boolean;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAlertsData(): UseAlertsData {
  const supabase = getSupabaseClient();
  const { role, loading: profileLoading } = useUserProfile();

  const [bases, setBases] = useState<SubscribableBase[]>([]);
  const [subscriptions, setSubscriptions] = useState<MySubscription[]>([]);
  const [recent, setRecent] = useState<RecentAlert[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const [pending, setPending] = useState<Set<string>>(new Set());

  const catalogFetchId = useRef(0);
  const mountedRef = useRef(true);

  // Only authenticated users have subscriptions; anon callers get empty sets.
  const enabled = !profileLoading && role !== "Anon";

  // ── Catalog + subscriptions fetch ─────────────────────────────────────────
  const loadCatalog = useCallback(async () => {
    if (!supabase) return;
    const id = ++catalogFetchId.current;
    setLoading(true);
    setError(null);
    try {
      const [catalog, subs] = await Promise.all([
        rpcListSubscribableBases(supabase),
        rpcListMySubscriptions(supabase),
      ]);
      if (id !== catalogFetchId.current || !mountedRef.current) return;
      setBases(catalog);
      setSubscriptions(subs);
      setLoading(false);
    } catch (err: unknown) {
      if (id !== catalogFetchId.current || !mountedRef.current) return;
      setError(err instanceof Error ? err : new Error(String(err)));
      setLoading(false);
    }
  }, [supabase]);

  // ── Recent feed fetch (separate so a feed error never blanks the catalog) ──
  const loadRecent = useCallback(async () => {
    if (!supabase) return;
    try {
      const rows = await rpcListMyRecentAlerts(supabase, FEED_LIMIT);
      if (!mountedRef.current) return;
      setRecent(rows);
    } catch {
      // Soft-fail: the feed is a nice-to-have; emails are the real channel.
      // Leave the previous feed state untouched on a transient error.
    }
  }, [supabase]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Initial load once the profile resolves and the user is logged in.
  useEffect(() => {
    if (!enabled) {
      // Anon (or still resolving): nothing to fetch — clear the loading gate so
      // the View can render its redirect/guard without a perpetual spinner.
      if (!profileLoading) setLoading(false);
      return;
    }
    loadCatalog();
    loadRecent();
  }, [enabled, profileLoading, loadCatalog, loadRecent]);

  // Poll the feed every 60s while logged in.
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(loadRecent, FEED_POLL_MS);
    return () => clearInterval(t);
  }, [enabled, loadRecent]);

  // ── Optimistic single toggle ──────────────────────────────────────────────
  // basesRef lets applyLocalToggle / toggle* read the latest catalog without
  // re-creating their callbacks on every catalog change (declared before the
  // callbacks that read it).
  const basesRef = useRef<SubscribableBase[]>([]);
  useEffect(() => {
    basesRef.current = bases;
  }, [bases]);

  const applyLocalToggle = useCallback(
    (slug: string, active: boolean) => {
      setBases((prev) =>
        prev.map((b) =>
          b.source_slug === slug
            ? { ...b, is_subscribed: active, sub_is_active: active }
            : b,
        ),
      );
      // Keep `subscriptions` in sync so My Subscriptions reflects instantly.
      setSubscriptions((prev) => {
        const exists = prev.some((s) => s.source_slug === slug);
        if (active) {
          if (exists) {
            return prev.map((s) =>
              s.source_slug === slug ? { ...s, is_active: true } : s,
            );
          }
          const base = basesRef.current.find((b) => b.source_slug === slug);
          if (!base) return prev;
          const optimistic: MySubscription = {
            source_slug: base.source_slug,
            display_name: base.display_name,
            category: base.category,
            is_active: true,
            effective_cadence: base.cadence,
            created_at: new Date().toISOString(),
          };
          return [...prev, optimistic];
        }
        // Unsubscribe → drop the row from the active list.
        return prev.filter((s) => s.source_slug !== slug);
      });
    },
    [],
  );

  const setPendingFor = useCallback((slugs: string[], on: boolean) => {
    setPending((prev) => {
      const next = new Set(prev);
      for (const s of slugs) {
        if (on) next.add(s);
        else next.delete(s);
      }
      return next;
    });
  }, []);

  const toggleBase = useCallback(
    async (sourceSlug: string, nextActive: boolean) => {
      if (!supabase) return;
      // Snapshot for revert.
      const prevBases = basesRef.current;
      const wasOn = isBaseOn(
        prevBases.find((b) => b.source_slug === sourceSlug) ?? {
          is_subscribed: false,
          sub_is_active: false,
        },
      );
      applyLocalToggle(sourceSlug, nextActive);
      setPendingFor([sourceSlug], true);
      try {
        await rpcSetMySubscription(supabase, sourceSlug, nextActive);
        // Refresh subscriptions in the background to pick up server-authoritative
        // fields (created_at, effective_cadence) without blocking the UI.
        loadRecent();
      } catch (err: unknown) {
        // Revert to the prior state.
        applyLocalToggle(sourceSlug, wasOn);
        toast(
          nextActive
            ? "Couldn't subscribe — please try again."
            : "Couldn't unsubscribe — please try again.",
          "error",
        );
        console.error("set_my_subscription failed", err);
      } finally {
        setPendingFor([sourceSlug], false);
      }
    },
    [supabase, applyLocalToggle, setPendingFor, loadRecent],
  );

  // ── Optimistic per-category bulk toggle ───────────────────────────────────
  const toggleCategory = useCallback(
    async (category: AlertCategory, nextActive: boolean) => {
      if (!supabase) return;
      const prevBases = basesRef.current;
      const targets = prevBases.filter((b) => b.category === category);
      // Only flip the bases that actually change (Select all skips already-on).
      const slugs = targets
        .filter((b) => isBaseOn(b) !== nextActive)
        .map((b) => b.source_slug);
      if (slugs.length === 0) return;

      // Snapshot prior per-slug on/off for revert.
      const priorOn = new Map(prevBases.map((b) => [b.source_slug, isBaseOn(b)]));

      for (const slug of slugs) applyLocalToggle(slug, nextActive);
      setPendingFor(slugs, true);
      try {
        await rpcSetMySubscriptions(supabase, slugs, nextActive);
        loadRecent();
      } catch (err: unknown) {
        // Revert every slug we touched.
        for (const slug of slugs) {
          applyLocalToggle(slug, priorOn.get(slug) ?? false);
        }
        toast("Couldn't update the category — please try again.", "error");
        console.error("set_my_subscriptions failed", err);
      } finally {
        setPendingFor(slugs, false);
      }
    },
    [supabase, applyLocalToggle, setPendingFor, loadRecent],
  );

  const isPending = useCallback((slug: string) => pending.has(slug), [pending]);

  // ── Derived: group by category in curated order ───────────────────────────
  const groups = useMemo<CategoryGroup[]>(() => {
    const byCat = new Map<AlertCategory, SubscribableBase[]>();
    for (const b of bases) {
      const arr = byCat.get(b.category);
      if (arr) arr.push(b);
      else byCat.set(b.category, [b]);
    }
    // Sort bases within a category by display name for a stable layout.
    for (const arr of byCat.values()) {
      arr.sort((a, b) => a.display_name.localeCompare(b.display_name));
    }

    const ordered: AlertCategory[] = [
      ...CATEGORY_ORDER.filter((c) => byCat.has(c)),
      ...Array.from(byCat.keys())
        .filter((c) => !CATEGORY_ORDER.includes(c))
        .sort((a, b) => String(a).localeCompare(String(b))),
    ];

    return ordered.map((category) => {
      const groupBases = byCat.get(category) ?? [];
      const onCount = groupBases.filter(isBaseOn).length;
      return {
        category,
        bases: groupBases,
        subscribedCount: onCount,
        allSubscribed: groupBases.length > 0 && onCount === groupBases.length,
        noneSubscribed: onCount === 0,
      };
    });
  }, [bases]);

  const totalSubscribed = useMemo(
    () => bases.filter(isBaseOn).length,
    [bases],
  );

  // Active subscriptions only (paused rows are hidden from My Subscriptions).
  const activeSubscriptions = useMemo(
    () => subscriptions.filter((s) => s.is_active),
    [subscriptions],
  );

  return {
    role,
    profileLoading,
    bases,
    groups,
    subscriptions: activeSubscriptions,
    recent,
    totalSubscribed,
    loading,
    error,
    refetch: loadCatalog,
    toggleBase,
    toggleCategory,
    isPending,
  };
}
