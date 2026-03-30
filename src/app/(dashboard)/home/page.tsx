"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import NavBar from "../../../components/NavBar";

const ORANGE = "#E85D20";
const BG = "#f5f5f5";
const SURFACE = "#ffffff";
const BORDER_DEFAULT = "rgba(0,0,0,0.08)";

function BarChartIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="12" width="4" height="9" rx="1" fill={ORANGE} />
      <rect x="10" y="7" width="4" height="14" rx="1" fill={ORANGE} opacity="0.75" />
      <rect x="17" y="3" width="4" height="18" rx="1" fill={ORANGE} opacity="0.5" />
    </svg>
  );
}

function PieChartIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke={ORANGE} strokeWidth="2" opacity="0.3" />
      <path d="M12 12 L12 3 A9 9 0 0 1 21 12 Z" fill={ORANGE} />
      <path d="M12 12 L21 12 A9 9 0 0 1 3.7 17.5 Z" fill={ORANGE} opacity="0.6" />
    </svg>
  );
}

function ShipIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 17l1.5-6h15l1.5 6H3z" fill={ORANGE} opacity="0.5" />
      <path d="M8 11V7h8v4" stroke={ORANGE} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 7V4" stroke={ORANGE} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M2 20c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0 3-1.5 4.5 0 3 1.5 4.5 0" stroke={ORANGE} strokeWidth="1.8" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function TrendIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <polyline points="3,17 9,11 13,14 21,6" stroke={ORANGE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="17,6 21,6 21,10" stroke={ORANGE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PriceTagIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2L2 12l10 10 10-10L22 2H12z" stroke={ORANGE} strokeWidth="1.8" strokeLinejoin="round" fill={ORANGE} fillOpacity="0.15" />
      <circle cx="16" cy="6" r="1.5" fill={ORANGE} />
      <path d="M8 12l2 2 4-4" stroke={ORANGE} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="#bbb" strokeWidth="2" />
      <path d="M12 7 L12 12 L16 14" stroke="#bbb" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

interface CardDef {
  icon: React.ReactNode;
  title: string;
  description: string;
  badge: string;
  href: string | null;
  disabled: boolean;
}

const CARDS: CardDef[] = [
  {
    icon: <BarChartIcon />,
    title: "Sales Dashboard",
    description: "Volume analysis by product, segment, agent, region, and period",
    badge: "Available",
    href: "/",
    disabled: false,
  },
  {
    icon: <PieChartIcon />,
    title: "Market Share",
    description: "Market share evolution over time broken down by distributor",
    badge: "Available",
    href: "/market-share",
    disabled: false,
  },
  {
    icon: <ShipIcon />,
    title: "Diesel Imports Line-Up",
    description: "Scheduled vessel arrivals and diesel import line-up by port",
    badge: "Available",
    href: "/navios-diesel",
    disabled: false,
  },
  {
    icon: <TrendIcon />,
    title: "D&G Margins",
    description: "Diesel and gasoline margin tracking across regions and time",
    badge: "Available",
    href: "/diesel-gasoline-margins",
    disabled: false,
  },
  {
    icon: <PriceTagIcon />,
    title: "Price Bands",
    description: "Price band distribution and competitive positioning by fuel type",
    badge: "Available",
    href: "/price-bands",
    disabled: false,
  },
  {
    icon: <ClockIcon />,
    title: "Coming Soon",
    description: "New modules are currently under development",
    badge: "Soon",
    href: null,
    disabled: true,
  },
];

export default function HomePage() {
  const router = useRouter();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <main style={{ background: BG, minHeight: "100vh", color: "#1a1a1a", fontFamily: "Arial, sans-serif" }}>
      <NavBar />

      {/* Hero */}
      <section
        style={{
          maxWidth: 960,
          margin: "0 auto",
          padding: "72px 24px 48px",
        }}
      >
        <div
          style={{
            display: "inline-block",
            background: `rgba(232,93,32,0.10)`,
            color: ORANGE,
            borderRadius: 20,
            padding: "3px 12px",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            marginBottom: 20,
          }}
        >
          Itaú BBA · Analytics
        </div>
        <h1
          style={{
            fontSize: "clamp(2rem, 5vw, 3.5rem)",
            fontWeight: 700,
            lineHeight: 1.1,
            margin: "0 0 20px",
            letterSpacing: "-0.01em",
            color: "#111",
          }}
        >
          Market intelligence{" "}
          <span style={{ color: ORANGE }}>in real time</span>
        </h1>
        <p
          style={{
            fontSize: "clamp(1rem, 2vw, 1.15rem)",
            color: "#666",
            maxWidth: 560,
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          Access exclusive analytics for Sales, Market Share, Diesel Imports,
          Margins, and Price Bands — updated data, precise filters, actionable insights.
        </p>
      </section>

      {/* Divider */}
      <hr
        style={{
          border: "none",
          borderTop: "1px solid rgba(0,0,0,0.08)",
          margin: "0 24px",
        }}
      />

      {/* Dashboard cards */}
      <section style={{ maxWidth: 960, margin: "0 auto", padding: "48px 24px 80px" }}>
        <h2
          style={{
            fontSize: "0.75rem",
            fontWeight: 600,
            color: "#999",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            marginBottom: 24,
          }}
        >
          Your dashboards
        </h2>

        <div className="row g-4">
          {CARDS.map((card, i) => {
            const isHovered = hoveredIndex === i && !card.disabled;
            return (
              <div key={card.title} className="col-md-6 col-lg-4">
                <div
                  onClick={() => {
                    if (!card.disabled && card.href) router.push(card.href);
                  }}
                  onMouseEnter={() => !card.disabled && setHoveredIndex(i)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  style={{
                    background: SURFACE,
                    border: `1px solid ${isHovered ? ORANGE : BORDER_DEFAULT}`,
                    borderRadius: 12,
                    padding: 24,
                    cursor: card.disabled ? "default" : "pointer",
                    transition: "border-color .2s, transform .2s, box-shadow .2s",
                    transform: isHovered ? "translateY(-2px)" : "translateY(0)",
                    boxShadow: isHovered
                      ? `0 8px 24px rgba(232,93,32,0.10)`
                      : "0 1px 4px rgba(0,0,0,0.06)",
                    opacity: card.disabled ? 0.5 : 1,
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  {/* Icon + badge row */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div
                      style={{
                        background: "rgba(232,93,32,0.08)",
                        borderRadius: 10,
                        width: 48,
                        height: 48,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {card.icon}
                    </div>
                    <span
                      style={
                        card.disabled
                          ? {
                              background: "rgba(0,0,0,0.06)",
                              color: "#aaa",
                              borderRadius: 20,
                              padding: "2px 10px",
                              fontSize: 11,
                              fontWeight: 600,
                              letterSpacing: "0.04em",
                            }
                          : {
                              background: "rgba(232,93,32,0.12)",
                              color: ORANGE,
                              borderRadius: 20,
                              padding: "2px 10px",
                              fontSize: 11,
                              fontWeight: 600,
                              letterSpacing: "0.04em",
                            }
                      }
                    >
                      {card.badge}
                    </span>
                  </div>

                  {/* Title + description */}
                  <div>
                    <div
                      style={{
                        fontSize: "1rem",
                        fontWeight: 700,
                        color: "#111",
                        marginBottom: 6,
                      }}
                    >
                      {card.title}
                    </div>
                    <div
                      style={{
                        fontSize: "0.85rem",
                        color: "#777",
                        lineHeight: 1.5,
                      }}
                    >
                      {card.description}
                    </div>
                  </div>

                  {/* Arrow for enabled cards */}
                  {!card.disabled && (
                    <div
                      style={{
                        marginTop: "auto",
                        fontSize: 12,
                        color: isHovered ? ORANGE : "#ccc",
                        transition: "color .2s",
                        fontWeight: 600,
                        letterSpacing: "0.04em",
                      }}
                    >
                      Open →
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
