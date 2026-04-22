"use client";

/**
 * Tab switcher for the Diesel Imports module. The module has two pages:
 *   1. /navios-diesel       — scheduled line-up (port scraping)
 *   2. /navios-diesel-radar — AIS-based early-warning radar
 * Styled to match the pill pattern used on the Price Bands YTD control.
 */

import Link from "next/link";

const TABS = [
  { href: "/navios-diesel",        label: "Line-Up" },
  { href: "/navios-diesel-radar",  label: "Radar" },
];

export default function LineUpTabs({ active }: { active: "line-up" | "radar" }) {
  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center", backgroundColor: "#f0f0f0", borderRadius: 999, padding: "3px 4px", marginTop: 8 }}>
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: 3,
          bottom: 3,
          left: `calc(4px + ${active === "radar" ? 1 : 0} * (100% - 8px) / 2)`,
          width: `calc((100% - 8px) / 2)`,
          backgroundColor: "#ff5000",
          borderRadius: 999,
          transition: "left 0.22s cubic-bezier(0.4, 0, 0.2, 1)",
          zIndex: 0,
          pointerEvents: "none",
        }}
      />
      {TABS.map((tab, i) => {
        const isActive = (i === 0 && active === "line-up") || (i === 1 && active === "radar");
        return (
          <Link
            key={tab.href}
            href={tab.href}
            prefetch
            style={{
              position: "relative",
              zIndex: 1,
              color: isActive ? "#ffffff" : "#555555",
              fontFamily: "Arial",
              fontSize: 12,
              fontWeight: isActive ? 700 : 500,
              padding: "4px 16px",
              borderRadius: 999,
              textDecoration: "none",
              transition: "color 0.18s",
              lineHeight: 1.4,
              userSelect: "none",
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
