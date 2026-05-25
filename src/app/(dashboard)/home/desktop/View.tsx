"use client";

// Desktop view for /home. [desktop-only]
//
// Layout: 50/50 split grid — left column holds module cards, right column
// holds the DataSourcesTable live panel. Mobile view is unchanged (cards only).
//
// initialPreviews: server-fetched card preview URLs (slug → public URL).
// Overrides the static card.preview paths when present (same as old HomeClient).

import { useState } from "react";
import { useRouter } from "next/navigation";
import NavBar from "../../../../components/NavBar";
import { useHomeData } from "../useHomeData";
import { useUserProfile } from "../../../../context/UserProfileContext";
import DataSourcesTable from "../../../../components/home/DataSourcesTable";

const ORANGE = "#E85D20";
const BG = "#f5f5f5";

interface DesktopViewProps {
  initialPreviews: Record<string, string>;
}

export default function DesktopView({
  initialPreviews,
}: DesktopViewProps): React.ReactElement {
  const router = useRouter();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // visibleCards already includes all visibility + search filtering.
  // Desktop ignores search (no search bar on desktop home) so search="" default is fine.
  const { visibleCards } = useHomeData();
  const { role } = useUserProfile();
  const isLoggedIn = role !== "Anon";

  return (
    <main
      style={{
        background: BG,
        minHeight: "100vh",
        color: "#1a1a1a",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <NavBar />

      {/* 50/50 split: cards left, Data Sources table right */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 0,
          alignItems: "start",
          padding: "32px 24px 80px",
        }}
      >
        {/* ── Left column: module cards ────────────────────────────────── */}
        <section style={{ paddingRight: 16 }}>
          <div className="row g-4">
            {visibleCards.map((card, i) => {
            const isHovered = hoveredIndex === i && !card.disabled;

            return (
              <div key={card.slug} className="col-6">
                <div
                  onClick={() => {
                    if (!card.disabled && card.href) router.push(card.href);
                  }}
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
                  {/* Image layer — initialPreviews (server-fetched) take priority */}
                  {initialPreviews[card.slug] ?? card.preview ? (
                    <img
                      src={initialPreviews[card.slug] ?? card.preview ?? ""}
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
                        filter: card.disabled
                          ? "grayscale(1) opacity(0.5)"
                          : "none",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background:
                          "repeating-linear-gradient(45deg, #2a2a2a, #2a2a2a 10px, #222 10px, #222 20px)",
                      }}
                    />
                  )}

                  {/* Gradient overlay */}
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
                  {card.badge && (
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
                  )}

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
                    <div
                      style={{
                        fontSize: "2rem",
                        fontWeight: 700,
                        color: "#fff",
                        marginBottom: isHovered ? 6 : 0,
                      }}
                    >
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
                      <div
                        style={{
                          fontSize: "0.82rem",
                          color: "rgba(255,255,255,0.55)",
                          lineHeight: 1.5,
                          marginBottom: 8,
                        }}
                      >
                        {card.description}
                      </div>
                      {!card.disabled && (
                        <div
                          style={{
                            fontSize: 12,
                            color: ORANGE,
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
              </div>
            );
          })}
          </div>
        </section>

        {/* ── Right column: Data Sources live table ───────────────────── */}
        <section style={{ paddingLeft: 16, paddingTop: 2 }}>
          <DataSourcesTable isLoggedIn={isLoggedIn} />
        </section>
      </div>
    </main>
  );
}
