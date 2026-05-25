"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import NavBar from "../../../components/NavBar";
import { useUserProfile } from "../../../context/UserProfileContext";

/**
 * Maps a card's href to its module_visibility slug.
 * The Sales card uses href="/sales-volumes" but the slug is "sales".
 */
function hrefToSlug(href: string | null): string {
  if (!href) return "";
  if (href === "/sales-volumes") return "sales";
  return href.replace(/^\//, "");
}

const ORANGE = "#E85D20";
const BG = "#f5f5f5";

interface CardDef {
  slug: string;
  preview: string | null;
  title: string;
  description: string;
  badge: string;
  href: string | null;
  disabled: boolean;
}

const CARDS: CardDef[] = [
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
  // Statistics — Fuel Distribution
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
  // Statistics — Oil & Gas
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
    slug: "anp-cdp-diaria",
    preview: null,
    title: "ANP CDP Diária",
    description: "Daily oil and gas production by field from ANP Power BI",
    badge: "Available",
    href: "/anp-cdp-diaria",
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
];

interface HomeClientProps {
  /** Preview URLs fetched server-side: slug → public URL */
  initialPreviews: Record<string, string>;
}

export default function HomeClient({ initialPreviews }: HomeClientProps) {
  const router = useRouter();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const {
    role,
    moduleVisibility,
    publicVisibility,
    homeVisibility,
    loading: profileLoading,
  } = useUserProfile();

  // initialPreviews arrive from the server — no client-side fetch needed.
  const cardPreviews = initialPreviews;

  // Three-tier filtering:
  //   - homeVisibility applies to EVERYONE (the "Show on Home" admin toggle)
  //   - Admin sees every card past the home filter
  //   - Client filters by moduleVisibility[slug] (is_visible_for_clients)
  //   - Anon filters by publicVisibility[slug] (is_visible_for_public)
  const visibleCards = profileLoading
    ? CARDS
    : CARDS.filter((card) => {
        if (!(homeVisibility[card.slug] ?? true)) return false;
        if (role === "Admin") return true;
        const slug = hrefToSlug(card.href);
        if (role === "Anon") return publicVisibility[slug] ?? true;
        return moduleVisibility[slug] ?? true;
      });

  return (
    <main style={{ background: BG, minHeight: "100vh", color: "#1a1a1a", fontFamily: "Arial, sans-serif" }}>
      <NavBar />

      {/* Cards */}
      <section style={{ margin: 0, padding: "32px 24px 80px" }}>
        <div className="row g-4">
          {visibleCards.map((card, i) => {
            const isHovered = hoveredIndex === i && !card.disabled;
            const imgSrc = cardPreviews[card.slug] ?? card.preview;

            return (
              <div key={card.title} className="col-md-6 col-lg-4">
                <div
                  onClick={() => { if (!card.disabled && card.href) router.push(card.href); }}
                  onMouseEnter={() => !card.disabled && setHoveredIndex(i)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  style={{
                    position: "relative",
                    height: 220,
                    borderRadius: 0,
                    overflow: "hidden",
                    cursor: card.disabled ? "default" : "pointer",
                    transition: "transform .25s, box-shadow .25s",
                    transform: isHovered ? "translateY(-5px)" : "translateY(0)",
                    boxShadow: isHovered
                      ? "0 16px 40px rgba(232,93,32,0.18), 0 4px 16px rgba(0,0,0,0.25)"
                      : "0 2px 8px rgba(0,0,0,0.15)",
                    opacity: card.disabled ? 0.5 : 1,
                    background: "#1a1a1a",
                  }}
                >
                  {/* Image layer */}
                  {imgSrc ? (
                    <img
                      src={imgSrc}
                      alt={card.title}
                      style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        objectPosition: "top left",
                        display: "block",
                        transition: "transform .35s ease",
                        transform: isHovered ? "scale(1.06)" : "scale(1.0)",
                        filter: card.disabled ? "grayscale(1) opacity(0.5)" : "none",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: "repeating-linear-gradient(45deg, #2a2a2a, #2a2a2a 10px, #222 10px, #222 20px)",
                      }}
                    />
                  )}

                  {/* Gradient */}
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: isHovered
                        ? "linear-gradient(to bottom, transparent 20%, #1a1a1a 60%)"
                        : "linear-gradient(to bottom, transparent 55%, #1a1a1a 100%)",
                      transition: "background .3s ease",
                      pointerEvents: "none",
                    }}
                  />

                  {/* Badge */}
                  <div style={{ position: "absolute", top: 10, right: 10 }}>
                    <span
                      style={
                        card.disabled
                          ? { background: "rgba(0,0,0,0.45)", color: "#ddd", borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", backdropFilter: "blur(4px)" }
                          : { background: "rgba(232,93,32,0.85)", color: "#fff", borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", backdropFilter: "blur(4px)" }
                      }
                    >
                      {card.badge}
                    </span>
                  </div>

                  {/* Text overlay */}
                  <div
                    style={{
                      position: "absolute",
                      bottom: 0,
                      left: 0,
                      right: 0,
                      padding: "0 18px 14px",
                    }}
                  >
                    <div style={{ fontSize: "2rem", fontWeight: 700, color: "#fff", marginBottom: isHovered ? 6 : 0 }}>
                      {card.title}
                    </div>
                    <div
                      style={{
                        maxHeight: isHovered ? "100px" : "0px",
                        opacity: isHovered ? 1 : 0,
                        overflow: "hidden",
                        transition: "max-height .3s ease, opacity .25s ease",
                      }}
                    >
                      <div style={{ fontSize: "0.82rem", color: "rgba(255,255,255,0.55)", lineHeight: 1.5, marginBottom: 8 }}>
                        {card.description}
                      </div>
                      {!card.disabled && (
                        <div style={{ fontSize: 12, color: ORANGE, fontWeight: 600, letterSpacing: "0.04em" }}>
                          Open →
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
