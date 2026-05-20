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
  {
    slug: "mdic-comex",
    preview: null,
    title: "MDIC Comex",
    description: "Brazilian trade balance and import/export volumes by product and origin",
    badge: "Available",
    href: "/mdic-comex",
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
    slug: "anp-ppi",
    preview: null,
    title: "ANP PPI",
    description: "ANP import price parity reference benchmarks for fuel pricing",
    badge: "Available",
    href: "/anp-ppi",
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
    slug: "anp-daie",
    preview: null,
    title: "ANP Open Data IE",
    description: "Open import/export energy data from ANP's DAIE dataset",
    badge: "Available",
    href: "/anp-daie",
    disabled: false,
  },
  {
    slug: "anp-desembaracos",
    preview: null,
    title: "ANP Customs Clearances",
    description: "Fuel customs clearance volumes from ANP",
    badge: "Available",
    href: "/anp-desembaracos",
    disabled: false,
  },
  {
    slug: "anp-painel-importacoes",
    preview: null,
    title: "ANP Imports Panel",
    description: "ANP fuel import dashboard with volume and origin country tracking",
    badge: "Available",
    href: "/anp-painel-importacoes",
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
  {
    slug: "sindicom",
    preview: null,
    title: "SINDICOM",
    description: "Fuel distribution data from the SINDICOM industry association",
    badge: "Available",
    href: "/sindicom",
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
  "mdic-comex": "oilgas",
  sales: "fuel",
  "market-share": "fuel",
  "navios-diesel": "fuel",
  "diesel-gasoline-margins": "fuel",
  "price-bands": "fuel",
  "subsidy-tracker": "fuel",
  "anp-ppi": "fuel",
  "anp-precos-produtores": "fuel",
  "anp-precos-distribuicao": "fuel",
  "anp-glp": "fuel",
  "anp-daie": "fuel",
  "anp-desembaracos": "fuel",
  "anp-painel-importacoes": "fuel",
  "anp-lpc": "fuel",
  sindicom: "fuel",
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
  const { profile, moduleVisibility, homeVisibility, loading } = useUserProfile();

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

  // Apply visibility filters (same logic as original HomeClient)
  const visibilityFiltered = useMemo<HomeCardDef[]>(() => {
    const base = CARDS_WITH_CATEGORY.filter((card) => {
      // homeVisibility applies to ALL users (Admin + Client).
      if (!(homeVisibility[card.slug] ?? true)) return false;
      // moduleVisibility (is_visible_for_clients) only restricts Client users.
      if (profile?.role === "Admin") return true;
      return moduleVisibility[hrefToSlug(card.href)] ?? true;
    });
    return base;
  }, [profile, moduleVisibility, homeVisibility]);

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
    // Admin entries (profile + admin-panel) are static, always appended.
    // They are not in module_visibility so we include them directly.
    const q = search.trim().toLowerCase();
    const filteredAdmin = q
      ? ADMIN_CARDS.filter(
          (c) =>
            c.title.toLowerCase().includes(q) ||
            c.description.toLowerCase().includes(q),
        )
      : ADMIN_CARDS;
    map.admin.push(...filteredAdmin);
    return map;
  }, [visibleCards, search]);

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
