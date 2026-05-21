"use client";

// ─── Mobile view for /subsidy-tracker ─────────────────────────────────────────
//
// Archetype: chart-heavy single-product (closest neighbour: market-share-mobile,
// price-bands-mobile). The same 4-trace analysis as the desktop, adapted UX:
//
//   MobileTopBar           — title + filter trigger button
//   Date chip strip        — 30 D / 90 D / 6 M / 1 Y / All shortcuts
//   Section: chart         — MobileChart, 4 traces, brand colours
//   Section: latest values — MobileDataCard per trace + active-subsidy badge
//   ExportFAB              — Excel + CSV (Tier 1)
//   FilterDrawer           — period slider + per-trace visibility toggles
//
// [mobile-only] divergence vs. desktop:
//   • Regional ANP Reference breakdown is exposed as a TAP-TO-SHOW card under
//     the "Latest values" section instead of a hover tooltip — touch
//     devices have no hover.
//
// Binding sync rule: any new filter / chart / KPI added here must also land in
// desktop/View.tsx in the same commit, or declare [mobile-only] with reason.

import { useCallback, useMemo, useState } from "react";
import type { Layout } from "plotly.js";

import {
  MobileTopBar,
  FilterDrawer,
  MobileChart,
  MobileDataCard,
  ExportFAB,
  FunnelIcon,
  ChevronDownIcon,
} from "@/components/dashboard/mobile";
import BarrelLoading from "@/components/dashboard/BarrelLoading";
import PeriodSlider from "@/components/dashboard/PeriodSlider";
import { useModuleVisibilityGuard } from "@/hooks/useModuleVisibilityGuard";
import {
  useSubsidyTrackerData,
  fmtDateLabel,
  formatRegions,
  SERIES,
  REGION_ORDER,
  type SeriesField,
  type SubsidyTrackerRow,
} from "../useSubsidyTrackerData";

// ─── Date-range chip helpers ──────────────────────────────────────────────────

interface DateChip {
  label: string;
  /** Days to go back from the latest data point. null = full window. */
  days: number | null;
}

const DATE_CHIPS: DateChip[] = [
  { label: "30 D", days: 30 },
  { label: "90 D", days: 90 },
  { label: "6 M",  days: 180 },
  { label: "1 Y",  days: 365 },
  { label: "All",  days: null },
];

function chipSliderRange(
  datas: string[],
  days: number | null,
): [number, number] {
  if (datas.length === 0) return [0, 0];
  const end = datas.length - 1;
  if (days == null) return [0, end];
  const latestDate = new Date(datas[end] + "T00:00:00Z");
  latestDate.setUTCDate(latestDate.getUTCDate() - days);
  const cutoff = latestDate.toISOString().slice(0, 10);
  const startIdx = Math.max(0, datas.findIndex((d) => d >= cutoff));
  return [startIdx, end];
}

function activeChipDays(
  datas: string[],
  sliderRange: [number, number],
): number | null | "none" {
  for (const chip of DATE_CHIPS) {
    const [s, e] = chipSliderRange(datas, chip.days);
    if (s === sliderRange[0] && e === sliderRange[1]) {
      return chip.days;
    }
  }
  return "none";
}

// ─── Color-dot helper ─────────────────────────────────────────────────────────

function ColorDot({ color }: { color: string }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
      }}
    />
  );
}

// ─── Thin mobile-chart layout override ───────────────────────────────────────

function mobileChartLayout(height: number): Partial<Layout> {
  return {
    height,
    showlegend: false,
    hovermode: "x unified",
    legend: {
      orientation: "h",
      x: 0,
      y: -0.22,
      font: { size: 10 },
    },
    margin: { l: 44, r: 12, t: 8, b: 40 },
    xaxis: {
      type: "date",
      tickformat: "%b %d",
      hoverformat: "%b %d, %Y",
      nticks: 4,
      tickangle: 0,
      tickfont: { size: 10 },
    },
    yaxis: {
      title: { text: "BRL/L", font: { size: 10 } },
      tickformat: ".2f",
      nticks: 4,
      tickfont: { size: 10 },
    },
  };
}

// ─── Section label ───────────────────────────────────────────────────────────

function SectionLabel({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      style={{
        padding: "12px 16px 6px",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.07em",
        textTransform: "uppercase",
        color: "var(--mobile-text-muted)",
        fontFamily: "Arial, Helvetica, sans-serif",
        background: "var(--mobile-bg)",
      }}
    >
      {children}
    </div>
  );
}

// ─── Regional breakdown card ─────────────────────────────────────────────────
// Replaces the desktop hover tooltip ([mobile-only] divergence).

function RegionalBreakdownCard({
  rows,
  xMax,
}: {
  rows: SubsidyTrackerRow[];
  xMax: string | null;
}): React.ReactElement | null {
  const latestWithRegions = useMemo(() => {
    const scoped = xMax ? rows.filter((r) => r.date <= xMax) : rows;
    const sorted = [...scoped].sort((a, b) => b.date.localeCompare(a.date));
    return sorted.find((r) => r.regions != null) ?? null;
  }, [rows, xMax]);

  if (!latestWithRegions || !latestWithRegions.regions) return null;

  return (
    <>
      <SectionLabel>
        Regional breakdown
        <span style={{ fontWeight: 400, marginLeft: 6, textTransform: "none", letterSpacing: 0 }}>
          · {fmtDateLabel(latestWithRegions.date)}
        </span>
      </SectionLabel>
      <div
        style={{
          background: "var(--mobile-surface)",
          borderTop: "1px solid var(--mobile-divider)",
        }}
      >
        {REGION_ORDER.map((region) => {
          const value = latestWithRegions.regions?.[region];
          return (
            <MobileDataCard
              key={region}
              variant="compact"
              title={region}
              rightSlot={
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: "var(--mobile-text)",
                    fontFamily: "Arial",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {value != null && Number.isFinite(value)
                    ? `R$ ${value.toFixed(2)}`
                    : "—"}
                </div>
              }
            />
          );
        })}
      </div>
    </>
  );
}

// ─── Mobile View ──────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("subsidy-tracker");
  const {
    rows,
    loading,
    filters,
    setFilters,
    resetFilters,
    datas,
    xMin,
    xMax,
    chart,
    currentValues,
    activeSubsidy,
    exportExcel,
    exportCsv,
    excelLoading,
    csvLoading,
  } = useSubsidyTrackerData();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [showRegional, setShowRegional] = useState(false);

  // Active date chip
  const activeDays = useMemo(
    () => activeChipDays(datas, filters.sliderRange),
    [datas, filters.sliderRange],
  );

  const handleChip = useCallback(
    (days: number | null) => {
      setFilters({ sliderRange: chipSliderRange(datas, days) });
    },
    [datas, setFilters],
  );

  const toggleTrace = useCallback(
    (field: SeriesField) => {
      setFilters({
        traces: { ...filters.traces, [field]: !filters.traces[field] },
      });
    },
    [filters.traces, setFilters],
  );

  // Chart layout — merge mobile defaults on top of the hook's chart layout,
  // but drop the desktop end-of-line annotations (they overflow on phones).
  const chartLayout = useMemo<Partial<Layout>>(() => {
    const base = mobileChartLayout(300);
    return {
      ...base,
      // Discard the heavy desktop annotations; mobile shows latest values in cards below.
      annotations: [],
    };
  }, []);

  // Sub-PRD requires the regional breakdown to appear on the ANP Reference
  // trace. On desktop it's a hover tooltip; on mobile we expose it as a
  // tap-to-show card under the chart ([mobile-only] divergence).
  const hasRegions = useMemo(
    () => rows.some((r) => r.regions != null),
    [rows],
  );

  if (visLoading || !visible) return <></>;

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "var(--mobile-bg)",
        paddingBottom: "calc(80px + var(--mobile-safe-bottom))",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <MobileTopBar
        title="Subsidy Tracker"
        rightSlot={
          <button
            type="button"
            aria-label="Open filters"
            onClick={() => setDrawerOpen(true)}
            style={{
              width: 44,
              height: 44,
              border: 0,
              background: "transparent",
              color: "var(--mobile-text-muted)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              borderRadius: 12,
            }}
          >
            <FunnelIcon size={22} />
          </button>
        }
      />

      {/* ── Subtitle ──────────────────────────────────────────────────────── */}
      <div
        style={{
          padding: "10px 16px 0",
          fontSize: 12,
          color: "var(--mobile-text-muted)",
          fontFamily: "Arial",
          lineHeight: 1.3,
        }}
      >
        Diesel — ANP Reference & Commercialization vs IPP & Petrobras (BRL/L)
      </div>

      {/* ── Date chip strip ───────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "12px 16px",
          overflowX: "auto",
          scrollbarWidth: "none",
        }}
      >
        {DATE_CHIPS.map((chip) => {
          const isActive = activeDays === chip.days;
          return (
            <button
              key={chip.label}
              type="button"
              onClick={() => handleChip(chip.days)}
              style={{
                flexShrink: 0,
                padding: "6px 14px",
                borderRadius: 20,
                border: "1px solid",
                borderColor: isActive
                  ? "var(--mobile-accent)"
                  : "var(--mobile-divider)",
                background: isActive
                  ? "var(--mobile-accent)"
                  : "var(--mobile-surface)",
                color: isActive ? "#fff" : "var(--mobile-text-muted)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                minHeight: 36,
                fontFamily: "inherit",
                transition: "background 0.15s ease, color 0.15s ease",
              }}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div style={{ padding: "32px 0" }}>
          <BarrelLoading bare />
        </div>
      ) : (
        <>
          {/* ── Chart ──────────────────────────────────────────────────────── */}
          <SectionLabel>Subsidy timeline</SectionLabel>
          <div
            style={{
              background: "var(--mobile-surface)",
              borderTop: "1px solid var(--mobile-divider)",
              borderBottom: "1px solid var(--mobile-divider)",
              padding: "0 8px 12px",
            }}
          >
            <MobileChart
              data={chart.data}
              layout={chartLayout}
              height={300}
            />
            {/* Color-key legend (4 traces) */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "4px 12px",
                padding: "4px 8px 0",
              }}
            >
              {SERIES.filter((s) => filters.traces[s.field]).map((s) => (
                <div
                  key={s.field}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11,
                    color: "var(--mobile-text-muted)",
                    minHeight: 22,
                  }}
                >
                  <ColorDot color={s.color} />
                  {s.label}
                </div>
              ))}
            </div>
          </div>

          {/* ── Active subsidy badge ───────────────────────────────────────── */}
          {activeSubsidy != null && (
            <div style={{ padding: "12px 16px 0" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 14px",
                  borderRadius: 12,
                  background: "rgba(255, 80, 0, 0.08)",
                  border: "1px solid rgba(255, 80, 0, 0.3)",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--mobile-accent)",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Active subsidy
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--mobile-text-muted)",
                      marginTop: 2,
                    }}
                  >
                    Reference − Commercialization
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    color: "var(--mobile-accent)",
                    fontFamily: "Arial",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  R$ {activeSubsidy.toFixed(2)}
                </div>
              </div>
            </div>
          )}

          {/* ── Latest values ─────────────────────────────────────────────── */}
          <SectionLabel>
            Latest values
            {(() => {
              const anyDate = currentValues.find((c) => c.date)?.date;
              return anyDate ? (
                <span
                  style={{
                    fontWeight: 400,
                    marginLeft: 6,
                    textTransform: "none",
                    letterSpacing: 0,
                  }}
                >
                  · {fmtDateLabel(anyDate)}
                </span>
              ) : null;
            })()}
          </SectionLabel>

          <div
            style={{
              background: "var(--mobile-surface)",
              borderTop: "1px solid var(--mobile-divider)",
            }}
          >
            {currentValues.map((cv) => {
              const hidden = !filters.traces[cv.field];
              return (
                <MobileDataCard
                  key={cv.field}
                  variant="compact"
                  leftIcon={<ColorDot color={cv.color} />}
                  title={cv.label}
                  rightSlot={
                    <div style={{ textAlign: "right" }}>
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 700,
                          color: hidden
                            ? "var(--mobile-text-faint)"
                            : "var(--mobile-text)",
                          fontFamily: "Arial",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {cv.value != null
                          ? `R$ ${cv.value.toFixed(2)}`
                          : "—"}
                      </div>
                      {hidden && (
                        <div
                          style={{
                            fontSize: 10,
                            color: "var(--mobile-text-faint)",
                            fontFamily: "Arial",
                          }}
                        >
                          Hidden
                        </div>
                      )}
                    </div>
                  }
                />
              );
            })}
          </div>

          {/* ── Tap to show regional breakdown (mobile-only divergence) ──── */}
          {hasRegions && (
            <>
              <div style={{ padding: "12px 16px 0" }}>
                <button
                  type="button"
                  onClick={() => setShowRegional((v) => !v)}
                  style={{
                    width: "100%",
                    minHeight: 44,
                    padding: "0 16px",
                    borderRadius: 12,
                    border: "1px solid var(--mobile-divider)",
                    background: "var(--mobile-surface)",
                    color: "var(--mobile-text)",
                    fontFamily: "Arial",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span>ANP Reference — regional breakdown</span>
                  <ChevronDownIcon
                    size={16}
                    style={{
                      transition: "transform 0.15s ease",
                      transform: showRegional ? "rotate(180deg)" : "rotate(0deg)",
                    }}
                  />
                </button>
              </div>
              {showRegional && (
                <RegionalBreakdownCard rows={rows} xMax={xMax} />
              )}
            </>
          )}
        </>
      )}

      {/* ── Filter drawer ────────────────────────────────────────────────── */}
      <FilterDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Filters"
        onReset={() => {
          resetFilters();
        }}
        onApply={() => setDrawerOpen(false)}
        applyLabel="Apply"
      >
        {/* Period slider */}
        <div style={{ marginBottom: 20 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "var(--mobile-text)",
              marginBottom: 10,
              fontFamily: "Arial",
            }}
          >
            Period
          </div>
          {datas.length > 0 && (
            <PeriodSlider
              dates={datas}
              value={filters.sliderRange}
              onChange={(v) => setFilters({ sliderRange: v })}
              sliderId="subsidy-slider-mobile"
            />
          )}
          {xMin && xMax && (
            <div
              style={{
                marginTop: 8,
                fontSize: 12,
                color: "var(--mobile-text-muted)",
                fontFamily: "Arial",
              }}
            >
              {fmtDateLabel(xMin)} – {fmtDateLabel(xMax)}
            </div>
          )}
        </div>

        {/* Trace visibility toggles */}
        <div
          style={{
            paddingTop: 12,
            borderTop: "1px solid var(--mobile-divider)",
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "var(--mobile-text)",
              marginBottom: 12,
              fontFamily: "Arial",
            }}
          >
            Series
          </div>
          {SERIES.map((s) => {
            const on = filters.traces[s.field];
            return (
              <div
                key={s.field}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 0",
                  borderBottom: "1px solid var(--mobile-divider)",
                }}
              >
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <ColorDot color={s.color} />
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: "var(--mobile-text)",
                      fontFamily: "Arial",
                    }}
                  >
                    {s.label}
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  onClick={() => toggleTrace(s.field)}
                  style={{
                    width: 48,
                    height: 28,
                    borderRadius: 14,
                    border: 0,
                    background: on
                      ? "var(--mobile-accent)"
                      : "var(--mobile-divider)",
                    position: "relative",
                    cursor: "pointer",
                    transition: "background 0.2s ease",
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: 3,
                      left: on ? 22 : 3,
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: "#fff",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
                      transition: "left 0.18s ease",
                    }}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </FilterDrawer>

      {/* ── Export FAB with mini-menu ─────────────────────────────────────── */}
      {exportMenuOpen && (
        <div
          onClick={() => setExportMenuOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 34,
            background: "rgba(0,0,0,0.18)",
          }}
        />
      )}
      {exportMenuOpen && (
        <div
          style={{
            position: "fixed",
            right: "max(16px, calc((100vw - 428px) / 2 + 16px))",
            bottom: "calc(72px + var(--mobile-safe-bottom) + 72px)",
            zIndex: 36,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            alignItems: "flex-end",
          }}
        >
          {[
            {
              label: "Excel",
              busy: excelLoading,
              onClick: () => {
                exportExcel();
                setExportMenuOpen(false);
              },
            },
            {
              label: "CSV",
              busy: csvLoading,
              onClick: () => {
                exportCsv();
                setExportMenuOpen(false);
              },
            },
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={item.onClick}
              disabled={item.busy || rows.length === 0 || loading}
              style={{
                minHeight: 44,
                padding: "0 20px",
                borderRadius: 22,
                border: 0,
                background: "var(--mobile-surface)",
                color: "var(--mobile-text)",
                fontFamily: "Arial",
                fontSize: 14,
                fontWeight: 700,
                cursor: item.busy ? "default" : "pointer",
                boxShadow: "0 2px 12px rgba(0,0,0,0.12)",
                opacity:
                  item.busy || rows.length === 0 || loading ? 0.6 : 1,
              }}
            >
              {item.busy ? "..." : item.label}
            </button>
          ))}
        </div>
      )}

      <ExportFAB
        icon="download"
        ariaLabel={exportMenuOpen ? "Close export menu" : "Export data"}
        onClick={() => setExportMenuOpen((v) => !v)}
        disabled={rows.length === 0 || loading}
      />
    </div>
  );
}
