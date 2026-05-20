"use client";

// Developer-only preview of the mobile design system (Fase 1 — 2026-05).
// Admin-gated, not linked from the NavBar. Visit /mobile-preview directly.
//
// Renders each of the 8 shared components with realistic sample data so
// `worker_dash-*` agents can see what they're consuming before composing
// per-dashboard mobile Views.
//
// This page forces data-viewport="mobile" on the documentElement so that
// the mobile tokens are active regardless of actual viewport width — that
// way the preview works on the CTO's laptop too.

import { useEffect, useState } from "react";

import { useRoleGuard } from "../../../hooks/useRoleGuard";
import {
  MobileTopBar,
  MobileBottomTabBar,
  BottomSheet,
  FilterDrawer,
  MobileChart,
  MobileDataCard,
  StickyBreadcrumb,
  ExportFAB,
  MobileTabBar,
} from "../../../components/dashboard/mobile";

// ---------------------------------------------------------------- Icons ----

const StocksIcon = (
  <svg
    viewBox="0 0 24 24"
    width={26}
    height={26}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M7 4v3" />
    <path d="M7 14v6" />
    <rect x="5" y="7" width="4" height="7" rx="1" />
    <path d="M17 3v4" />
    <path d="M17 14v7" />
    <rect x="15" y="7" width="4" height="7" rx="1" />
  </svg>
);

const HomeIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 11.5 12 4l9 7.5" />
    <path d="M5 10v10h14V10" />
  </svg>
);

const DiscoverIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="m9 15 2-6 6-2-2 6z" />
  </svg>
);

const SavedIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M6 4h12v17l-6-4-6 4z" />
  </svg>
);

const ProfileIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
);

// ---------------------------------------------------- Sample chart traces ---

const SAMPLE_LINE = [
  {
    type: "scatter",
    mode: "lines",
    x: [
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
      "Jan",
      "Feb",
      "Mar",
    ],
    y: [27, 28, 28, 27, 26, 27, 28, 28, 29, 29, 28, 28],
    line: { color: "#ff5000", width: 2, shape: "spline" },
    fill: "tozeroy",
    fillcolor: "rgba(255,80,0,0.10)",
    hovertemplate: "<b>%{y}%</b><br>%{x}<extra></extra>",
  },
] as unknown as Plotly.PlotData[];

// ----------------------------------------------------------- Page shell ---

export default function MobilePreviewPage(): React.ReactElement | null {
  const { allowed, loading } = useRoleGuard("Admin");

  const [sheetOpen, setSheetOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("active");
  const [activeBottomTab, setActiveBottomTab] = useState("home");
  const [activeUnderline, setActiveUnderline] = useState("petroleum");

  // Force mobile token resolution regardless of viewport width.
  useEffect(() => {
    const prev = document.documentElement.getAttribute("data-viewport");
    document.documentElement.setAttribute("data-viewport", "mobile");
    return () => {
      if (prev) document.documentElement.setAttribute("data-viewport", prev);
      else document.documentElement.removeAttribute("data-viewport");
    };
  }, []);

  if (loading || !allowed) return null;

  return (
    <div
      style={{
        background: "var(--mobile-bg)",
        color: "var(--mobile-text)",
        fontFamily: "Arial, Helvetica, sans-serif",
        minHeight: "100vh",
      }}
    >
      <div
        style={{
          maxWidth: 428,
          margin: "0 auto",
          paddingBottom: "calc(72px + env(safe-area-inset-bottom))",
        }}
      >
        {/* 1. MobileTopBar ------------------------------------------------- */}
        <MobileTopBar
          title={
            <span>
              SECTORDATA<span style={{ color: "var(--mobile-accent)" }}>.</span>
            </span>
          }
          showThemeToggle
          showAvatar
          avatarInitials="EM"
          avatarLabel="Eduardo Mendes"
        />

        {/* 2. StickyBreadcrumb -------------------------------------------- */}
        <StickyBreadcrumb
          segments={[
            { label: "Brasil", onClick: () => {} },
            { label: "Campos", onClick: () => {} },
            { label: "Tupi", onClick: () => {} },
            { label: "9-RJS-456D", active: true },
          ]}
          onReset={() => {}}
        />

        <div style={{ padding: "16px 16px 4px" }}>
          <SectionLabel n={1} title="MobileTopBar + StickyBreadcrumb" />
          <p style={subtitleStyle}>
            Sticky liquid-glass top chrome (56px) with theme toggle + avatar,
            followed by a horizontally-scrolling breadcrumb (40px) for
            drill-down dashboards.
          </p>
        </div>

        {/* 3. MobileTabBar ------------------------------------------------ */}
        <div style={{ padding: "8px 0 4px" }}>
          <SectionLabel n={2} title="MobileTabBar (container)" />
          <p style={subtitleStyle}>
            Top-of-page segmented control. Active tab is brand orange with
            soft glow.
          </p>
        </div>
        <MobileTabBar
          tabs={[
            { key: "active", label: "Active" },
            { key: "recent", label: "Recent" },
            { key: "expected", label: "Expected" },
          ]}
          activeKey={activeTab}
          onChange={setActiveTab}
        />

        <div style={{ padding: "16px 0 4px" }}>
          <SectionLabel n={3} title="MobileTabBar (underline)" />
          <p style={subtitleStyle}>
            Variant with no container — minimal underline indicator.
          </p>
        </div>
        <MobileTabBar
          variant="underline"
          tabs={[
            { key: "petroleum", label: "Petroleum" },
            { key: "gas", label: "Gas" },
            { key: "water", label: "Water" },
          ]}
          activeKey={activeUnderline}
          onChange={setActiveUnderline}
        />

        {/* 4. MobileChart ------------------------------------------------- */}
        <div style={{ padding: "16px 16px 4px" }}>
          <SectionLabel n={4} title="MobileChart" />
          <p style={subtitleStyle}>
            Plotly wrapper with mobile-optimised defaults (no modebar,
            scrollZoom off, fixedrange both axes, smaller margins).
          </p>
        </div>
        <div
          style={{
            margin: "8px 16px 16px",
            padding: 12,
            background: "var(--mobile-surface)",
            borderRadius: "var(--mobile-radius-lg)",
            border: "1px solid var(--mobile-divider)",
          }}
        >
          <MobileChart data={SAMPLE_LINE} height={220} />
        </div>

        {/* 5. MobileDataCard --------------------------------------------- */}
        <div style={{ padding: "8px 16px 4px" }}>
          <SectionLabel n={5} title="MobileDataCard (variants)" />
          <p style={subtitleStyle}>
            The atomic row: leftIcon · title + subtitle · rightSlot. Supports
            sparklines, status pills, compact / default / expanded heights.
          </p>
        </div>

        <MobileDataCard
          title="PETR4"
          subtitle="Petrobras PN"
          sparkline={[37, 37.4, 37.1, 37.6, 38.0, 38.3, 38.45]}
          sparklineColor="#16a34a"
          rightSlot={
            <>
              <div style={{ fontWeight: 700, fontSize: 17 }}>R$ 38.45</div>
              <div style={{ color: "var(--mobile-up)", fontSize: 13, fontWeight: 600 }}>
                +1.23%
              </div>
            </>
          }
          onClick={() => {}}
        />
        <MobileDataCard
          title="MV Eagle Houston"
          subtitle="Houston → Suape, PE · Diesel S10 · 47.5K m³"
          status={{ label: "Unloading", tone: "unloading" }}
          rightSlot={
            <div style={{ fontSize: 12, color: "var(--mobile-text-muted)" }}>
              47%
            </div>
          }
          onClick={() => {}}
        />
        <MobileDataCard
          variant="compact"
          title="STI Aristotelis"
          subtitle="Rotterdam → Santos"
          status={{ label: "En-route", tone: "enroute" }}
          onClick={() => {}}
        />
        <MobileDataCard
          variant="expanded"
          leftIcon={
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: "var(--mobile-radius-lg)",
                background: "linear-gradient(135deg, #2563eb 0%, #0d9488 100%)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
              }}
            >
              {StocksIcon}
            </div>
          }
          title="Market Share"
          subtitle="Distributors by product & region — monthly view with stacked-area chart and ranked top players"
          rightSlot={
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          }
          onClick={() => {}}
        />

        {/* 6. BottomSheet ------------------------------------------------- */}
        <div style={{ padding: "20px 16px 4px" }}>
          <SectionLabel n={6} title="BottomSheet (primitive)" />
          <p style={subtitleStyle}>
            Slide-up sheet with scrim, drag-to-close handle (tap-only), body
            scroll, optional sticky footer. Foundation for FilterDrawer.
          </p>
          <button type="button" style={buttonStyle} onClick={() => setSheetOpen(true)}>
            Open BottomSheet
          </button>
        </div>

        {/* 7. FilterDrawer ------------------------------------------------ */}
        <div style={{ padding: "8px 16px 4px" }}>
          <SectionLabel n={7} title="FilterDrawer" />
          <p style={subtitleStyle}>
            Specialised sheet for filter UIs — title + close × at top,
            sticky Reset / Apply footer.
          </p>
          <button type="button" style={buttonStyle} onClick={() => setFilterOpen(true)}>
            Open FilterDrawer
          </button>
        </div>

        {/* 8. ExportFAB --------------------------------------------------- */}
        <div style={{ padding: "8px 16px 24px" }}>
          <SectionLabel n={8} title="ExportFAB" />
          <p style={subtitleStyle}>
            Floating action button bottom-right. Brand orange with glow.
            Hugs the 428px column edge when previewed on a wider viewport
            (look at the bottom-right corner of this preview).
          </p>
        </div>

        {/* 9. MobileBottomTabBar (sticky, real instance) ----------------- */}
        <MobileBottomTabBar
          tabs={[
            { key: "home", label: "Home", icon: HomeIcon, active: activeBottomTab === "home" },
            { key: "discover", label: "Discover", icon: DiscoverIcon, active: activeBottomTab === "discover" },
            { key: "saved", label: "Saved", icon: SavedIcon, active: activeBottomTab === "saved" },
            { key: "profile", label: "Profile", icon: ProfileIcon, active: activeBottomTab === "profile" },
          ]}
          onChange={setActiveBottomTab}
        />

        {/* Floating action button (live) */}
        <ExportFAB onClick={() => alert("Export tapped")} ariaLabel="Export data" />

        {/* BottomSheet instance */}
        <BottomSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title="Bottom sheet"
          footer={
            <button
              type="button"
              style={{ ...buttonStyle, width: "100%" }}
              onClick={() => setSheetOpen(false)}
            >
              Got it
            </button>
          }
        >
          <p style={{ margin: 0, color: "var(--mobile-text-muted)" }}>
            This is the primitive bottom sheet. It locks page scroll while
            open, closes on Escape and on scrim tap, and slides up smoothly
            via translateY.
          </p>
          <ul style={{ marginTop: 16, paddingLeft: 18, color: "var(--mobile-text-muted)" }}>
            <li>Drag-to-close handle (tap to close)</li>
            <li>Optional sticky footer</li>
            <li>height: auto | 70vh | 90vh</li>
            <li>showScrim: false to suppress the dark overlay</li>
          </ul>
        </BottomSheet>

        {/* FilterDrawer instance */}
        <FilterDrawer
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          onReset={() => {}}
          onApply={() => setFilterOpen(false)}
          footerHint="3 selected"
        >
          <FilterSection label="Product" hint="1 selected">
            <CheckPillRow items={["Diesel", "Gasoline", "Ethanol", "LPG"]} activeIndex={0} />
          </FilterSection>
          <FilterSection label="Region" hint="1 of 5">
            <CheckPillRow
              items={["North", "Northeast", "Center-West", "Southeast", "South"]}
              activeIndex={3}
            />
          </FilterSection>
          <FilterSection label="Segment" hint="All">
            <CheckPillRow items={["All", "Retail", "Wholesale"]} activeIndex={0} />
          </FilterSection>
        </FilterDrawer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Helpers ---

const subtitleStyle: React.CSSProperties = {
  margin: "4px 0 12px",
  fontSize: 12,
  color: "var(--mobile-text-muted)",
  lineHeight: 1.4,
};

const buttonStyle: React.CSSProperties = {
  minHeight: 44,
  padding: "0 18px",
  border: 0,
  borderRadius: 12,
  background: "var(--mobile-accent)",
  color: "#fff",
  fontFamily: "inherit",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
  boxShadow: "0 4px 12px rgba(255, 80, 0, 0.30)",
};

function SectionLabel({ n, title }: { n: number; title: string }): React.ReactElement {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: "var(--mobile-text-muted)",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      {n}. {title}
    </div>
  );
}

function FilterSection({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div style={{ marginBottom: 22 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--mobile-text-muted)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          {label}
        </span>
        {hint && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--mobile-text-faint)",
            }}
          >
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function CheckPillRow({
  items,
  activeIndex,
}: {
  items: string[];
  activeIndex: number;
}): React.ReactElement {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {items.map((item, i) => {
        const on = i === activeIndex;
        return (
          <span
            key={item}
            style={{
              minHeight: 36,
              padding: "0 14px",
              borderRadius: 999,
              border: `1px solid ${on ? "var(--mobile-accent)" : "var(--mobile-border)"}`,
              background: on ? "var(--mobile-accent)" : "var(--mobile-surface)",
              color: on ? "#fff" : "var(--mobile-text)",
              fontSize: 13,
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              boxShadow: on ? "0 2px 6px rgba(255,80,0,0.25)" : "none",
              cursor: "pointer",
            }}
          >
            {item}
          </span>
        );
      })}
    </div>
  );
}
