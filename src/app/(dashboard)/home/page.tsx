"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import NavBar from "../../../components/NavBar";

const ORANGE = "#E85D20";
const BG = "#f5f5f5";
const SURFACE = "#1a1a1a";
const BORDER_DEFAULT = "rgba(255,255,255,0.08)";

interface CardDef {
  preview: string | null;
  title: string;
  description: string;
  badge: string;
  href: string | null;
  disabled: boolean;
}

const CARDS: CardDef[] = [
  {
    preview: "/previews/preview-sales.jpg",
    title: "Sales Dashboard",
    description: "Volume analysis by product, segment, agent, region, and period",
    badge: "Available",
    href: "/",
    disabled: false,
  },
  {
    preview: "/previews/preview-market-share.jpg",
    title: "Market Share",
    description: "Market share evolution over time broken down by distributor",
    badge: "Available",
    href: "/market-share",
    disabled: false,
  },
  {
    preview: "/previews/preview-navios-diesel.jpg",
    title: "Diesel Imports Line-Up",
    description: "Scheduled vessel arrivals and diesel import line-up by port",
    badge: "Available",
    href: "/navios-diesel",
    disabled: false,
  },
  {
    preview: "/previews/preview-dg-margins.jpg",
    title: "D&G Margins",
    description: "Diesel and gasoline margin tracking across regions and time",
    badge: "Available",
    href: "/diesel-gasoline-margins",
    disabled: false,
  },
  {
    preview: "/previews/preview-price-bands.jpg",
    title: "Price Bands",
    description: "Price band distribution and competitive positioning by fuel type",
    badge: "Available",
    href: "/price-bands",
    disabled: false,
  },
  {
    preview: null,
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
      <section style={{ maxWidth: 960, margin: "0 auto", padding: "72px 24px 48px" }}>
        <div
          style={{
            display: "inline-block",
            background: "rgba(232,93,32,0.10)",
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
          Sectorial data{" "}
          <span style={{ color: ORANGE }}>promptly available</span>
        </h1>
        <p style={{ fontSize: "clamp(1rem, 2vw, 1.15rem)", color: "#666", lineHeight: 1.6, margin: 0, whiteSpace: "nowrap" }}>
          Easy access to up-to-date data for the Fuel Distribution and Oil &amp; Gas industries.
        </p>
      </section>

      {/* Divider */}
      <hr style={{ border: "none", borderTop: "1px solid rgba(0,0,0,0.08)", margin: "0 24px" }} />

      {/* Cards */}
      <section style={{ maxWidth: 960, margin: "0 auto", padding: "48px 24px 80px" }}>
        <h2
          style={{
            fontSize: "0.75rem",
            fontWeight: 600,
            color: "#FF5000",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            marginBottom: 24,
          }}
        >
          Check it out!
        </h2>

        <div className="row g-4">
          {CARDS.map((card, i) => {
            const isHovered = hoveredIndex === i && !card.disabled;
            return (
              <div key={card.title} className="col-md-6 col-lg-4">
                <div
                  onClick={() => { if (!card.disabled && card.href) router.push(card.href); }}
                  onMouseEnter={() => !card.disabled && setHoveredIndex(i)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  style={{
                    background: SURFACE,
                    border: `1px solid ${isHovered ? ORANGE : BORDER_DEFAULT}`,
                    borderRadius: 14,
                    overflow: "hidden",
                    cursor: card.disabled ? "default" : "pointer",
                    transition: "border-color .25s, transform .25s, box-shadow .25s",
                    transform: isHovered ? "translateY(-5px)" : "translateY(0)",
                    boxShadow: isHovered
                      ? "0 16px 40px rgba(232,93,32,0.18), 0 4px 16px rgba(0,0,0,0.25)"
                      : "0 2px 8px rgba(0,0,0,0.15)",
                    opacity: card.disabled ? 0.5 : 1,
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  {/* Screenshot preview */}
                  <div
                    style={{
                      position: "relative",
                      height: 160,
                      overflow: "hidden",
                      background: "#e8e8e8",
                      flexShrink: 0,
                    }}
                  >
                    {card.preview ? (
                      <img
                        src={card.preview}
                        alt={card.title}
                        style={{
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
                      /* Coming soon placeholder */
                      <div
                        style={{
                          width: "100%",
                          height: "100%",
                          background: "repeating-linear-gradient(45deg, #f0f0f0, #f0f0f0 10px, #e8e8e8 10px, #e8e8e8 20px)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <span style={{ fontSize: 32, opacity: 0.3 }}>🔒</span>
                      </div>
                    )}

                    {/* Gradient fade from image to dark */}
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: "linear-gradient(to bottom, transparent 30%, #1a1a1a 100%)",
                        pointerEvents: "none",
                      }}
                    />

                    {/* Badge floated in the image */}
                    <div style={{ position: "absolute", top: 10, right: 10 }}>
                      <span
                        style={
                          card.disabled
                            ? {
                                background: "rgba(0,0,0,0.45)",
                                color: "#ddd",
                                borderRadius: 20,
                                padding: "2px 10px",
                                fontSize: 11,
                                fontWeight: 600,
                                letterSpacing: "0.04em",
                                backdropFilter: "blur(4px)",
                              }
                            : {
                                background: "rgba(232,93,32,0.85)",
                                color: "#fff",
                                borderRadius: 20,
                                padding: "2px 10px",
                                fontSize: 11,
                                fontWeight: 600,
                                letterSpacing: "0.04em",
                                backdropFilter: "blur(4px)",
                              }
                        }
                      >
                        {card.badge}
                      </span>
                    </div>
                  </div>

                  {/* Text content */}
                  <div style={{ padding: "14px 20px 18px", display: "flex", flexDirection: "column", gap: 6, flex: 1, background: "#1a1a1a" }}>
                    <div style={{ fontSize: "1rem", fontWeight: 700, color: "#fff" }}>
                      {card.title}
                    </div>
                    <div style={{ fontSize: "0.83rem", color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>
                      {card.description}
                    </div>
                    {!card.disabled && (
                      <div
                        style={{
                          marginTop: "auto",
                          paddingTop: 8,
                          fontSize: 12,
                          color: isHovered ? ORANGE : "rgba(255,255,255,0.2)",
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
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
