"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import NavBar from "../../../components/NavBar";

const ORANGE = "#E85D20";
const BG = "#0d0d0d";
const SURFACE = "#141414";
const BORDER_DEFAULT = "rgba(255,255,255,0.08)";

function BarChartIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="12" width="4" height="9" rx="1" fill={ORANGE} />
      <rect x="10" y="7" width="4" height="14" rx="1" fill={ORANGE} opacity="0.8" />
      <rect x="17" y="3" width="4" height="18" rx="1" fill={ORANGE} opacity="0.6" />
    </svg>
  );
}

function PieChartIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke={ORANGE} strokeWidth="2" opacity="0.4" />
      <path d="M12 12 L12 3 A9 9 0 0 1 21 12 Z" fill={ORANGE} />
      <path d="M12 12 L21 12 A9 9 0 0 1 3.7 17.5 Z" fill={ORANGE} opacity="0.6" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="#555" strokeWidth="2" />
      <path d="M12 7 L12 12 L16 14" stroke="#555" strokeWidth="2" strokeLinecap="round" />
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
    description: "Análise de volume por produto, segmento, agente, região e período",
    badge: "Disponível",
    href: "/",
    disabled: false,
  },
  {
    icon: <PieChartIcon />,
    title: "Market Share",
    description: "Evolução temporal de participação de mercado por distribuidora",
    badge: "Disponível",
    href: "/market-share",
    disabled: false,
  },
  {
    icon: <ClockIcon />,
    title: "Em breve",
    description: "Novos módulos em desenvolvimento",
    badge: "Brevemente",
    href: null,
    disabled: true,
  },
];

export default function HomePage() {
  const router = useRouter();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <main style={{ background: BG, minHeight: "100vh", color: "#fff", fontFamily: "Arial, sans-serif" }}>
      <NavBar />

      {/* Hero */}
      <section
        style={{
          maxWidth: 900,
          margin: "0 auto",
          padding: "72px 24px 48px",
        }}
      >
        <div
          style={{
            display: "inline-block",
            background: `rgba(232,93,32,0.12)`,
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
          }}
        >
          Inteligência de mercado{" "}
          <span style={{ color: ORANGE }}>em tempo real</span>
        </h1>
        <p
          style={{
            fontSize: "clamp(1rem, 2vw, 1.15rem)",
            color: "rgba(255,255,255,0.55)",
            maxWidth: 560,
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          Acesse análises exclusivas de Sales e Market Share do setor de
          combustíveis — dados atualizados, filtros precisos, insights acionáveis.
        </p>
      </section>

      {/* Divider */}
      <hr
        style={{
          border: "none",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          margin: "0 24px",
        }}
      />

      {/* Dashboard cards */}
      <section style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px 80px" }}>
        <h2
          style={{
            fontSize: "1rem",
            fontWeight: 600,
            color: "rgba(255,255,255,0.4)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom: 24,
          }}
        >
          Seus dashboards
        </h2>

        <div className="row g-4">
          {CARDS.map((card, i) => {
            const isHovered = hoveredIndex === i && !card.disabled;
            return (
              <div key={card.title} className="col-md-6">
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
                      ? `0 8px 24px rgba(232,93,32,0.12)`
                      : "none",
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
                        background: "rgba(255,255,255,0.04)",
                        borderRadius: 10,
                        width: 52,
                        height: 52,
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
                              background: "rgba(255,255,255,0.08)",
                              color: "#888",
                              borderRadius: 20,
                              padding: "2px 10px",
                              fontSize: 11,
                              fontWeight: 600,
                              letterSpacing: "0.04em",
                            }
                          : {
                              background: "rgba(232,93,32,0.15)",
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

                  {/* Title */}
                  <div>
                    <div
                      style={{
                        fontSize: "1.05rem",
                        fontWeight: 700,
                        color: "#fff",
                        marginBottom: 6,
                      }}
                    >
                      {card.title}
                    </div>
                    <div
                      style={{
                        fontSize: "0.875rem",
                        color: "rgba(255,255,255,0.45)",
                        lineHeight: 1.5,
                      }}
                    >
                      {card.description}
                    </div>
                  </div>

                  {/* Arrow indicator for enabled cards */}
                  {!card.disabled && (
                    <div
                      style={{
                        marginTop: "auto",
                        fontSize: 12,
                        color: isHovered ? ORANGE : "rgba(255,255,255,0.2)",
                        transition: "color .2s",
                        fontWeight: 600,
                        letterSpacing: "0.04em",
                      }}
                    >
                      Acessar →
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
