"use client";

// Brain hook for /home (dual-view pattern).
//
// Owns:
//   - module list sourced from CARDS (static) + visibility filters from UserProfileContext
//   - search query state (live filter)
//   - collapsed-section state (for mobile category sections)
//   - category metadata (slug → category assignment)
//
// Views NEVER filter or derive from moduleVisibility directly — they call this hook.

import { useCallback, useMemo, useState } from "react";
import { useUserProfile } from "../../../context/UserProfileContext";

// ---- Types -------------------------------------------------------------------

export type HomeCategory = "markets" | "oilgas" | "fuel" | "admin";

export interface HomeCardDef {
  slug: string;
  preview: string | null;
  title: string;
  description: string;
  badge: string;
  href: string | null;
  disabled: boolean;
  category: HomeCategory;
}

export interface HomeSectionState {
  markets: boolean;
  oilgas: boolean;
  fuel: boolean;
  admin: boolean;
}

export interface UseHomeData {
  /** Full card catalog filtered by visibility + search. */
  visibleCards: HomeCardDef[];
  /** Cards grouped by category, already filtered. */
  cardsByCategory: Record<HomeCategory, HomeCardDef[]>;
  /** Current search query (controlled by setSearch). */
  search: string;
  setSearch: (q: string) => void;
  /** Per-category collapsed state (used by mobile View). */
  collapsed: HomeSectionState;
  toggleCollapsed: (cat: HomeCategory) => void;
  /** True while profile/visibility is loading from context. */
  loading: boolean;
}

// ---- Static card catalogue ---------------------------------------------------

/**
 * Maps a card href to its module_visibility slug.
 * The Sales card uses href="/sales-volumes" but the slug is "sales".
 */
function hrefToSlug(href: string | null): string {
  if (!href) return "";
  if (href === "/sales-volumes") return "sales";
  return href.replace(/^\//, "");
}

const CARDS: Omit<HomeCardDef, "category">[] = [
  // Markets
  {
    slug: "stocks",
    preview: null,
    title: "Market Watch",
    description: "Real-time stock quotes, historical charts, and market overview",
    badge: "Available",
    href: "/stocks",
    disabled: false,
  },
  {
    slug: "news-hunter",
    preview: null,
    title: "News Hunter",
    description: "Live oil & gas news feed with incremental 30s polling across ~60 sources",
    badge: "Available",
    href: "/news-hunter",
    disabled: false,
  },
  // Oil & Gas
  {
    slug: "anp-cdp",
    preview: null,
    title: "ANP CDP Production",
    description: "ANP CDP oil and gas production data by well and field",
    badge: "Available",
    href: "/anp-cdp",
    disabled: false,
  },
  {
    slug: "anp-cdp-bsw",
    preview: null,
    title: "ANP CDP — BSW by Well",
    description: "Water cut vs months since first production, by well",
    badge: "Available",
    href: "/anp-cdp-bsw",
    disabled: false,
  },
  {
    slug: "anp-cdp-depletion",
    preview: null,
    title: "ANP CDP — Depletion",
    description: "Uptime-normalized oil production and decline analysis by field",
    badge: "Available",
    href: "/anp-cdp-depletion",
    disabled: false,
  },
  {
    slug: "anp-cdp-diaria",
    preview: null,
    title: "ANP CDP Diária",
    description: "Daily oil and gas production by field from ANP Power BI",
    badge: "Available",
    href: "/anp-cdp-diaria",
    disabled: false,
  },
  // Fuel Distribution
  {
    slug: "sales",
    preview: "/previews/preview-sales.jpg",
    title: "Sales Volumes",
    description: "Volume analysis by product, segment, agent, region, and period",
    badge: "Available",
    href: "/sales-volumes",
    disabled: false,
  },
  {
    slug: "market-share",
    preview: "/previews/preview-market-share.jpg",
    title: "Market Share",
    description: "Market share evolution over time broken down by distributor",
    badge: "Available",
    href: "/market-share",
    disabled: false,
  },
  {
    slug: "navios-diesel",
    preview: "/previews/preview-navios-diesel.jpg",
    title: "Diesel Imports Line-Up",
    description: "Scheduled line-up + AIS-based early-warning radar for diesel imports",
    badge: "Available",
    href: "/navios-diesel",
    disabled: false,
  },
  {
    slug: "diesel-gasoline-margins",
    preview: "/previews/preview-dg-margins.jpg",
    title: "Diesel and Gasoline Margins",
    description: "Diesel and gasoline margin tracking across regions and time",
    badge: "Available",
    href: "/diesel-gasoline-margins",
    disabled: false,
  },
  {
    slug: "price-bands",
    preview: "/previews/preview-price-bands.jpg",
    title: "Price Bands",
    description: "Price band distribution and competitive positioning by fuel type",
    badge: "Available",
    href: "/price-bands",
    disabled: false,
  },
  {
    slug: "subsidy-tracker",
    preview: "/previews/preview-subsidy-tracker.jpg",
    title: "Subsidy Tracker",
    description: "ANP diesel reference vs commercialization price",
    badge: "Available",
    href: "/subsidy-tracker",
    disabled: false,
  },
  {
    slug: "anp-precos-produtores",
    preview: null,
    title: "ANP Producer Prices",
    description: "Producer prices for fuels tracked by ANP",
    badge: "Available",
    href: "/anp-precos-produtores",
    disabled: false,
  },
  {
    slug: "anp-precos-distribuicao",
    preview: null,
    title: "ANP Distribution Prices",
    description: "Distribution prices for fuels tracked by ANP",
    badge: "Available",
    href: "/anp-precos-distribuicao",
    disabled: false,
  },
  {
    slug: "anp-glp",
    preview: null,
    title: "ANP LPG",
    description: "LPG production and distribution data from ANP",
    badge: "Available",
    href: "/anp-glp",
    disabled: false,
  },
  {
    slug: "imports-exports",
    preview: null,
    title: "Imports & Exports",
    description: "ANP fuel imports and exports — origins, customs clearances, and (after backfill) importers",
    badge: "Available",
    href: "/imports-exports",
    disabled: false,
  },
  {
    slug: "anp-lpc",
    preview: null,
    title: "ANP LPC Prices",
    description: "ANP consumer price survey across Brazilian gas stations",
    badge: "Available",
    href: "/anp-lpc",
    disabled: false,
  },
  // Tools
  {
    slug: "alerts",
    preview: null,
    title: "Alerts",
    description: "Email notifications when new data is published",
    badge: "Available",
    href: "/alerts",
    disabled: false,
  },
];

/** Assign a category to each slug. */
const SLUG_CATEGORY: Record<string, HomeCategory> = {
  stocks: "markets",
  "news-hunter": "markets",
  "anp-cdp": "oilgas",
  "anp-cdp-bsw": "oilgas",
  "anp-cdp-depletion": "oilgas",
  "anp-cdp-diaria": "oilgas",
  sales: "fuel",
  "market-share": "fuel",
  "navios-diesel": "fuel",
  "diesel-gasoline-margins": "fuel",
  "price-bands": "fuel",
  "subsidy-tracker": "fuel",
  "anp-precos-produtores": "fuel",
  "anp-precos-distribuicao": "fuel",
  "anp-glp": "fuel",
  "imports-exports": "fuel",
  "anp-lpc": "fuel",
  alerts: "markets",
};

/** Static admin entries shown on mobile home (not in module_visibility). */
const ADMIN_CARDS: HomeCardDef[] = [
  {
    slug: "profile",
    preview: null,
    title: "Profile",
    description: "Account & preferences",
    badge: "",
    href: "/profile",
    disabled: false,
    category: "admin",
  },
  {
    slug: "admin-panel",
    preview: null,
    title: "Admin Panel",
    description: "Permissions & module visibility",
    badge: "",
    href: "/admin-panel",
    disabled: false,
    category: "admin",
  },
];

const CARDS_WITH_CATEGORY: HomeCardDef[] = CARDS.map((c) => ({
  ...c,
  category: SLUG_CATEGORY[c.slug] ?? "fuel",
}));

// ---- Hook -------------------------------------------------------------------

export function useHomeData(): UseHomeData {
  const {
    role,
    moduleVisibility,
    publicVisibility,
    homeVisibility,
    loading,
  } = useUserProfile();

  const [search, setSearchState] = useState("");
  const [collapsed, setCollapsed] = useState<HomeSectionState>({
    markets: false,
    oilgas: false,
    fuel: false,
    admin: false,
  });

  const setSearch = useCallback((q: string) => {
    setSearchState(q);
  }, []);

  const toggleCollapsed = useCallback((cat: HomeCategory) => {
    setCollapsed((prev) => ({ ...prev, [cat]: !prev[cat] }));
  }, []);

  // Apply visibility filters across the three tiers:
  //   - homeVisibility (is_visible_on_home) applies to EVERYONE.
  //   - Admin sees every card past that filter.
  //   - Client filters by moduleVisibility (is_visible_for_clients).
  //   - Anon filters by publicVisibility (is_visible_for_public).
  const visibilityFiltered = useMemo<HomeCardDef[]>(() => {
    const base = CARDS_WITH_CATEGORY.filter((card) => {
      if (!(homeVisibility[card.slug] ?? true)) return false;
      if (role === "Admin") return true;
      const slug = hrefToSlug(card.href);
      if (role === "Anon") return publicVisibility[slug] ?? true;
      return moduleVisibility[slug] ?? true;
    });
    return base;
  }, [role, moduleVisibility, publicVisibility, homeVisibility]);

  // Apply search query filter (title + description, case-insensitive)
  const visibleCards = useMemo<HomeCardDef[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return visibilityFiltered;
    return visibilityFiltered.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q),
    );
  }, [visibilityFiltered, search]);

  // Group by category (admin cards appended separately — not in module_visibility)
  const cardsByCategory = useMemo<Record<HomeCategory, HomeCardDef[]>>(() => {
    const map: Record<HomeCategory, HomeCardDef[]> = {
      markets: [],
      oilgas: [],
      fuel: [],
      admin: [],
    };
    for (const card of visibleCards) {
      map[card.category].push(card);
    }
    // Admin/Profile static entries: only meaningful for logged-in users. Anon
    // visitors have no profile to view and no admin panel to manage, and the
    // page guards already redirect them to /login — so suppress the cards
    // entirely to avoid a dead-end tap.
    if (role !== "Anon") {
      const q = search.trim().toLowerCase();
      const baseAdmin = role === "Admin"
        ? ADMIN_CARDS                                          // both Profile + Admin Panel
        : ADMIN_CARDS.filter((c) => c.slug !== "admin-panel"); // Client: Profile only
      const filteredAdmin = q
        ? baseAdmin.filter(
            (c) =>
              c.title.toLowerCase().includes(q) ||
              c.description.toLowerCase().includes(q),
          )
        : baseAdmin;
      map.admin.push(...filteredAdmin);
    }
    return map;
  }, [visibleCards, search, role]);

  return {
    visibleCards,
    cardsByCategory,
    search,
    setSearch,
    collapsed,
    toggleCollapsed,
    loading,
  };
}
