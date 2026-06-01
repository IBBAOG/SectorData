"use client";

// Mobile view — /anp-glp (LPG Market Share). Mobile reform v2 layout.
//
// Clone of /market-share/mobile/View.tsx retargeted at LPG:
//   1. Title block (h1 + subtitle + period badge)
//   2. Sticky SegmentedToggle (% Share / thousand t)
//   3. Product MobileTabBar (Total (All LPG) / P13 / Other - LPG / Other - Special)
//      — NO segment tab bar (LPG has a single 'GLP' segment).
//   4. Hero chart card (MobileChart — line chart for the active product)
//   5. 2-column legend below chart
//   6. Comparison table inline (player picker pills capped at 3 + MoM/QTD/YoY/YTD)
//   7. Filter chip row (Period info chip + "+ Filters" trigger)
//      FilterDrawer (Period slider + View Mode) — NO region/UF (LPG has no geo).
//      MobileHomePill (mounted by MobileShell)
//
// Export is desktop-only (policy § 3.4) — no FAB here.

import { useState } from "react";
import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import {
  FilterDrawer,
  MobileChart,
  MobileTabBar,
} from "../../../../components/dashboard/mobile";
import PeriodSlider from "../../../../components/dashboard/PeriodSlider";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import SegmentedToggle from "../../../../components/dashboard/SegmentedToggle";
import {
  useAnpGlpData,
  categoryLabel,
  MOBILE_PALETTE,
  type CompRow,
  type UnitMode,
} from "../useAnpGlpData";

// ─── Constants ─────────────────────────────────────────────────────────────────

const UNIT_OPTIONS: { value: UnitMode; label: string }[] = [
  { value: "share", label: "% Share" },
  { value: "volume", label: "thousand t" },
];

// ─── CompareMetric (inline cell) ────────────────────────────────────────────────

function CompareMetric({ label, value }: { label: string; value: number | null }) {
  const fmt = (v: number | null) =>
    v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
  const bg =
    value === null
      ? "transparent"
      : value > 0
        ? "rgba(34, 197, 94, 0.12)"
        : value < 0
          ? "rgba(239, 68, 68, 0.12)"
          : "transparent";
  const color =
    value === null
      ? "var(--mobile-text-faint)"
      : value > 0
        ? "var(--mobile-up)"
        : value < 0
          ? "var(--mobile-down)"
          : "var(--mobile-text-muted)";
  return (
    <div
      style={{
        background: bg,
        borderRadius: 8,
        padding: "8px 6px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--mobile-text-muted)",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 13,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          color,
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        {fmt(value)}
      </span>
    </div>
  );
}

// ─── CompareRowCard ──────────────────────────────────────────────────────────────

function CompareRowCard({ row, color }: { row: CompRow; color: string }) {
  return (
    <div
      style={{
        padding: "12px 14px",
        borderBottom: "1px solid var(--mobile-divider)",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span
          aria-hidden="true"
          style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }}
        />
        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "var(--mobile-text)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {row.player}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
        <CompareMetric label="MoM" value={row.mom} />
        <CompareMetric label="QTD" value={row.q3m} />
        <CompareMetric label="YoY" value={row.yoy} />
        <CompareMetric label="YTD" value={row.ytd} />
      </div>
    </div>
  );
}

// ─── CheckPills (filter drawer) ──────────────────────────────────────────────────

function CheckPills({
  options,
  value,
  onChange,
  radio = false,
}: {
  options: string[];
  value: string | string[];
  onChange: (v: string | string[]) => void;
  radio?: boolean;
}) {
  const isOn = (opt: string) =>
    radio ? value === opt : (value as string[]).includes(opt);

  const toggle = (opt: string) => {
    if (radio) {
      onChange(opt);
      return;
    }
    const arr = value as string[];
    if (arr.includes(opt)) onChange(arr.filter((v) => v !== opt));
    else onChange([...arr, opt]);
  };

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => toggle(opt)}
          style={{
            minHeight: 36,
            padding: "0 14px",
            borderRadius: 999,
            border: `1px solid ${isOn(opt) ? "var(--mobile-accent)" : "var(--mobile-border)"}`,
            background: isOn(opt) ? "var(--mobile-accent)" : "var(--mobile-surface)",
            color: isOn(opt) ? "#fff" : "var(--mobile-text)",
            fontFamily: "inherit",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            boxShadow: isOn(opt) ? "0 2px 6px rgba(255,80,0,0.25)" : "none",
            transition: "background 0.15s, border-color 0.15s, color 0.15s",
          }}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

// ─── ActiveChipRow ───────────────────────────────────────────────────────────────
// Period info chip + "+ Filters" trigger (no Region/UF chips — LPG has no geo).

function ActiveChipRow({
  periodBadge,
  onOpenFilters,
}: {
  periodBadge: string | null;
  onOpenFilters: () => void;
}) {
  const chipStyle: React.CSSProperties = {
    flexShrink: 0,
    minHeight: 32,
    padding: "0 12px",
    borderRadius: 999,
    border: "1px solid var(--mobile-border)",
    background: "var(--mobile-surface)",
    color: "var(--mobile-text-muted)",
    fontSize: 13,
    fontWeight: 600,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    whiteSpace: "nowrap" as const,
    fontFamily: "Arial, Helvetica, sans-serif",
  };

  return (
    <nav
      aria-label="Active filters"
      style={{
        height: 52,
        background: "var(--mobile-bg)",
        display: "flex",
        alignItems: "center",
        overflowX: "auto",
        overflowY: "hidden",
        gap: 8,
        padding: "0 16px",
        WebkitOverflowScrolling: "touch",
        scrollbarWidth: "none",
      }}
    >
      {periodBadge && <div style={chipStyle}>{periodBadge}</div>}
      <button
        type="button"
        onClick={onOpenFilters}
        style={{
          flexShrink: 0,
          minHeight: 32,
          padding: "0 14px",
          borderRadius: 999,
          border: "1px solid var(--mobile-accent)",
          background: "transparent",
          color: "var(--mobile-accent)",
          fontSize: 13,
          fontWeight: 700,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          cursor: "pointer",
          whiteSpace: "nowrap",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        + Filters
      </button>
    </nav>
  );
}

// ─── Mobile View ──────────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-glp");

  const glp = useAnpGlpData();

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<string>("Individual");

  const openDrawer = () => {
    setDrawerMode(glp.mode);
    setDrawerOpen(true);
  };

  const handleDrawerApply = () => {
    glp.setMode(drawerMode as typeof glp.mode);
    glp.applyFilters();
    setDrawerOpen(false);
  };

  const handleDrawerReset = () => {
    setDrawerMode("Individual");
  };

  const heroTraces = glp.activeChart?.data ?? [];

  if (visLoading || !visible) return <></>;

  // Period badge (year range)
  const periodBadge = (() => {
    if (glp.datas.length === 0) return null;
    const [a, b] = glp.sliderRange;
    const start = glp.datas[a];
    const end = glp.datas[b];
    if (start == null || end == null) return null;
    return start === end ? `${start}` : `${start} – ${end}`;
  })();

  const chartHeading = categoryLabel(glp.selectedProduct);

  const legendEntries = glp.topPlayersForSelected.map((p, i) => ({
    name: p.player,
    color: p.color ?? glp.chartColors[p.player] ?? MOBILE_PALETTE[i % MOBILE_PALETTE.length],
    isLeader: p.isLeader,
  }));

  const visibleCompRows = glp.activeCompRows.filter((r) =>
    glp.compareSet.includes(r.player),
  );

  const productTabs = glp.productKeys.map((p) => ({
    key: p,
    label: categoryLabel(p),
  }));

  return (
    <div
      style={{
        maxWidth: 428,
        margin: "0 auto",
        minHeight: "100dvh",
        background: "var(--mobile-bg)",
        paddingBottom: "calc(80px + var(--mobile-safe-bottom))",
        position: "relative",
      }}
    >
      {/* ── Title block ─────────────────────────────────────────────────────── */}
      <section style={{ padding: "16px 16px 12px" }}>
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 700,
            color: "var(--mobile-text)",
            letterSpacing: "0.005em",
            lineHeight: 1.15,
            fontFamily: "Arial, Helvetica, sans-serif",
          }}
        >
          LPG Market Share
        </h1>
        <p
          style={{
            margin: "4px 0 0",
            fontSize: 13,
            color: "var(--mobile-text-muted)",
            lineHeight: 1.3,
            fontFamily: "Arial, Helvetica, sans-serif",
          }}
        >
          Brazilian LPG (GLP) sales by distributor
        </p>
        {periodBadge && (
          <span
            aria-label="Period"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              marginTop: 10,
              padding: "4px 10px",
              borderRadius: 999,
              background: "var(--mobile-accent-soft)",
              color: "var(--mobile-accent)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              fontFamily: "Arial, Helvetica, sans-serif",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--mobile-accent)",
                display: "inline-block",
              }}
            />
            {periodBadge}
          </span>
        )}
      </section>

      {/* ── 1. Sticky SegmentedToggle (% Share / thousand t) ─────────────────── */}
      <div
        style={{
          position: "sticky",
          top: "var(--mobile-topbar-h)",
          zIndex: 25,
          background: "var(--mobile-glass-bg)",
          WebkitBackdropFilter: "var(--mobile-glass-blur)",
          backdropFilter: "var(--mobile-glass-blur)",
          borderBottom: "1px solid var(--mobile-glass-border)",
          padding: "8px 16px",
        }}
      >
        <SegmentedToggle
          options={UNIT_OPTIONS}
          value={glp.unitMode}
          onChange={glp.setUnitMode}
          variant="full"
          fontSize={13}
        />
      </div>

      {/* ── 2. Product MobileTabBar ──────────────────────────────────────────── */}
      <div style={{ padding: "12px 0 4px" }}>
        <MobileTabBar
          tabs={productTabs}
          activeKey={glp.selectedProduct}
          onChange={(k) => glp.setSelectedProduct(k)}
          variant="container"
          ariaLabel="Category"
        />
      </div>

      {/* ── 3. Hero chart card ───────────────────────────────────────────────── */}
      {glp.seriesLoading ? (
        <div style={{ padding: "24px 16px" }}>
          <BarrelLoading bare />
        </div>
      ) : (
        <div style={{ padding: "16px 16px 0" }}>
          <div
            style={{
              background: "var(--mobile-surface)",
              border: "1px solid var(--mobile-divider)",
              borderRadius: 16,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "14px 14px 6px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: "var(--mobile-text)",
                  fontFamily: "Arial, Helvetica, sans-serif",
                }}
              >
                {chartHeading}
              </div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--mobile-text-muted)",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  fontFamily: "Arial, Helvetica, sans-serif",
                }}
              >
                {glp.unitMode === "share" ? "% Share" : "thousand t"}
              </div>
            </div>

            {heroTraces.length > 0 ? (
              <MobileChart
                data={heroTraces}
                height={320}
                layout={{
                  ...(glp.activeChart?.layout ?? {}),
                  height: 320,
                  margin: { t: 10, b: 60, l: 50, r: 50 },
                  legend: { orientation: "h" as const, y: -0.25, x: 0.5, xanchor: "center" as const },
                  paper_bgcolor: "transparent",
                  plot_bgcolor: "transparent",
                }}
              />
            ) : (
              <div
                style={{
                  height: 320,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--mobile-text-muted)",
                  fontSize: 13,
                  fontFamily: "Arial, Helvetica, sans-serif",
                }}
              >
                No data for the selected filters.
              </div>
            )}

            {legendEntries.length > 0 && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, 1fr)",
                  gap: "4px 12px",
                  padding: "8px 14px 14px",
                }}
              >
                {legendEntries.map((e) => (
                  <div
                    key={e.name}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 12,
                      color: e.isLeader ? "var(--mobile-text)" : "var(--mobile-text-muted)",
                      fontWeight: e.isLeader ? 700 : 400,
                      minHeight: 22,
                      fontFamily: "Arial, Helvetica, sans-serif",
                    }}
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        background: e.color,
                        flexShrink: 0,
                      }}
                    />
                    {e.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 4. Comparison table (inline) ─────────────────────────────────────── */}
      {glp.activeCompRows.length > 0 && (
        <div style={{ padding: "20px 16px 0" }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              paddingBottom: 10,
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: 17,
                fontWeight: 700,
                color: "var(--mobile-text)",
                fontFamily: "Arial, Helvetica, sans-serif",
              }}
            >
              Comparison
            </h2>
            <span
              style={{
                fontSize: 12,
                color: "var(--mobile-text-muted)",
                fontFamily: "Arial, Helvetica, sans-serif",
              }}
            >
              {glp.unitMode === "share" ? "p.p. variation" : "thousand t variation"}
            </span>
          </div>

          <div
            style={{
              fontSize: 13,
              color: "var(--mobile-text-muted)",
              fontFamily: "Arial, Helvetica, sans-serif",
              marginBottom: 10,
            }}
          >
            {categoryLabel(glp.selectedProduct)}
          </div>

          {/* Player picker pills (pick up to 3) */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {glp.activeCompRows.map((r) => {
              const on = glp.compareSet.includes(r.player);
              const disabled = !on && glp.compareSet.length >= 3;
              return (
                <button
                  key={r.player}
                  type="button"
                  onClick={() => glp.toggleCompareMember(r.player)}
                  disabled={disabled}
                  style={{
                    minHeight: 32,
                    padding: "0 12px",
                    borderRadius: 999,
                    border: `1px solid ${on ? "var(--mobile-accent)" : "var(--mobile-border)"}`,
                    background: on ? "var(--mobile-accent)" : "var(--mobile-surface)",
                    color: on ? "#fff" : "var(--mobile-text)",
                    opacity: disabled ? 0.4 : 1,
                    fontFamily: "Arial, Helvetica, sans-serif",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: disabled ? "not-allowed" : "pointer",
                    boxShadow: on ? "0 2px 6px rgba(255,80,0,0.25)" : "none",
                    transition: "all 0.15s ease",
                  }}
                >
                  {r.player}
                </button>
              );
            })}
          </div>

          {visibleCompRows.length === 0 ? (
            <div
              style={{
                padding: 18,
                textAlign: "center",
                color: "var(--mobile-text-muted)",
                fontSize: 13,
                fontFamily: "Arial, Helvetica, sans-serif",
                border: "1px dashed var(--mobile-border)",
                borderRadius: 12,
              }}
            >
              Select up to 3 distributors above to compare their variation.
            </div>
          ) : (
            <div
              style={{
                background: "var(--mobile-surface)",
                border: "1px solid var(--mobile-divider)",
                borderRadius: 16,
                overflow: "hidden",
              }}
            >
              {visibleCompRows.map((row, idx) => (
                <CompareRowCard
                  key={row.player}
                  row={row}
                  color={glp.chartColors[row.player] ?? MOBILE_PALETTE[idx % MOBILE_PALETTE.length]}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 5. Filter chip row ───────────────────────────────────────────────── */}
      <div style={{ paddingTop: 16 }}>
        <ActiveChipRow periodBadge={periodBadge} onOpenFilters={openDrawer} />
      </div>

      {/* ── FilterDrawer ─────────────────────────────────────────────────────── */}
      <FilterDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Filters"
        onReset={handleDrawerReset}
        onApply={handleDrawerApply}
        applyLabel="Apply filters"
        resetLabel="Reset"
      >
        {/* Period */}
        <div style={{ marginBottom: 22 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--mobile-text-muted)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              marginBottom: 10,
              fontFamily: "Arial, Helvetica, sans-serif",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>Period</span>
            {periodBadge && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--mobile-text-faint)",
                  letterSpacing: 0,
                  textTransform: "none",
                }}
              >
                {periodBadge}
              </span>
            )}
          </div>
          {glp.datas.length > 0 && (
            <PeriodSlider
              years={glp.datas}
              value={glp.sliderRange}
              onChange={glp.setSliderRange}
            />
          )}
        </div>

        {/* View Mode */}
        <div style={{ marginBottom: 22 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--mobile-text-muted)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              marginBottom: 10,
              fontFamily: "Arial, Helvetica, sans-serif",
            }}
          >
            View Mode
          </div>
          <CheckPills
            options={["Individual", "Big-3", "Others"]}
            value={drawerMode}
            onChange={(v) => setDrawerMode(v as string)}
            radio
          />
        </div>
      </FilterDrawer>
    </div>
  );
}
