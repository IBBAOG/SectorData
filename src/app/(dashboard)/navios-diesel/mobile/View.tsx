"use client";

// ─── Mobile view — /navios-diesel ───────────────────────────────────────────
//
// Mobile-first redesign of the Diesel Vessels tracker. Visual source of truth:
//   mockups/navios-diesel-mobile.html (approved 2026-05-20).
//
// Structure:
//   MobileTopBar (sticky, liquid glass)
//   Title block + last-collected badge
//   Status segmented control (Active / Recent / Expected)
//   Port summary horizontal scroller (snap, 140px cards) ← key mobile element
//   Filter chip row (sticky)
//   Vessel list (MobileDataCard with status prop)
//   ExportFAB
//   MobileBottomTabBar (Vessels / Ports / Map / Profile)
//   BottomSheet — vessel expanded detail (IMO/MMSI/flag/voyage timeline)
//   BottomSheet — filters
//
// AIS map tab: placeholder only (Map tab shown but map content deferred
// to a future iteration — [mobile-only] divergence from desktop's AIS feature).
//
// Binding sync rule: meaningful changes to this view must land in desktop/View.tsx
// in the same commit, or the commit message must declare [mobile-only] with reason.

import { useCallback, useMemo, useState } from "react";
import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import {
  MobileTopBar,
  MobileBottomTabBar,
  type MobileBottomTab,
  BottomSheet,
  MobileDataCard,
  ExportFAB,
  UserIcon,
  PlusIcon,
} from "../../../../components/dashboard/mobile";
import { downloadCsv } from "../../../../lib/exportCsv";
import { downloadGenericExcel } from "../../../../lib/exportExcel";
import {
  useNaviosDieselData,
  statusToTone,
  STATUS_LABELS,
  type NavioDieselRow,
  type PortSummary,
} from "../useNaviosDieselData";

// ─── Icons ────────────────────────────────────────────────────────────────────

function VesselsIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 21h20" />
      <path d="M3 18l1-8h16l1 8" />
      <path d="M5 10V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4" />
      <path d="M10 14h4" />
    </svg>
  );
}

function PortsIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 21h18" />
      <path d="M5 21V10l7-4 7 4v11" />
      <path d="M9 21v-6h6v6" />
    </svg>
  );
}

function MapIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="3 6 9 4 15 6 21 4 21 18 15 20 9 18 3 20 3 6" />
      <line x1="9" y1="4" x2="9" y2="18" />
      <line x1="15" y1="6" x2="15" y2="20" />
    </svg>
  );
}

// ProfileIcon / FilterIcon — sourced from canonical mobile design-system
// icon set (UserIcon / PlusIcon). The "FilterIcon" label was a misnomer here:
// the inline path rendered a plus sign, not a funnel; PlusIcon preserves the
// visual exactly.
const ProfileIcon = UserIcon;
const FilterIcon = (p: { size?: number; strokeWidth?: number }) => (
  <PlusIcon size={p.size ?? 14} strokeWidth={p.strokeWidth ?? 2.5} />
);

function ArrowRightIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <polyline points="13 6 19 12 13 18" />
    </svg>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtVolume(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function hoursAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "< 1h ago";
  return `${h}h ago`;
}

// ─── Status segmented tab type ────────────────────────────────────────────────

type VesselTab = "active" | "recent" | "expected";

// ─── Port summary scroller ────────────────────────────────────────────────────

function PortCard({
  summary,
  isActive,
  onClick,
}: {
  summary: PortSummary;
  isActive: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      style={{
        flex: "0 0 auto",
        width: 140,
        minHeight: 110,
        padding: 12,
        background: "var(--mobile-surface)",
        border: `1px solid ${isActive ? "var(--mobile-accent)" : "var(--mobile-divider)"}`,
        borderRadius: 14,
        scrollSnapAlign: "start",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        transition: "transform 0.12s ease, border-color 0.15s ease",
        boxShadow: isActive ? "0 0 0 2px rgba(255,80,0,0.10)" : "none",
        textAlign: "left",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).style.transform = "scale(0.98)";
      }}
      onPointerUp={(e) => {
        (e.currentTarget as HTMLElement).style.transform = "scale(1)";
      }}
      onPointerLeave={(e) => {
        (e.currentTarget as HTMLElement).style.transform = "scale(1)";
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--mobile-text)", lineHeight: 1.15 }}>
        {summary.label}
      </div>
      <div style={{
        fontSize: 20,
        fontWeight: 700,
        color: "var(--mobile-text)",
        lineHeight: 1.1,
        letterSpacing: "-0.005em",
        fontVariantNumeric: "tabular-nums",
      }}>
        {fmtVolume(summary.totalVolume)}
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--mobile-text-muted)", marginLeft: 2 }}>m³</span>
      </div>
      <div style={{
        fontSize: 11,
        color: "var(--mobile-text-muted)",
        marginTop: "auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 6,
      }}>
        <span>{summary.totalNavios} vessel{summary.totalNavios !== 1 ? "s" : ""}</span>
        <span style={{ display: "inline-flex", gap: 3 }}>
          {summary.counts.unloading > 0 && Array.from({ length: Math.min(summary.counts.unloading, 3) }).map((_, i) => (
            <span key={`u${i}`} style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--mobile-status-unloading)", display: "inline-block" }} />
          ))}
          {summary.counts.anchored > 0 && Array.from({ length: Math.min(summary.counts.anchored, 3) }).map((_, i) => (
            <span key={`a${i}`} style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--mobile-status-anchored)", display: "inline-block" }} />
          ))}
          {summary.counts.enroute > 0 && Array.from({ length: Math.min(summary.counts.enroute, 3) }).map((_, i) => (
            <span key={`e${i}`} style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--mobile-status-enroute)", display: "inline-block" }} />
          ))}
          {summary.counts.completed > 0 && Array.from({ length: Math.min(summary.counts.completed, 2) }).map((_, i) => (
            <span key={`c${i}`} style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--mobile-status-completed)", display: "inline-block" }} />
          ))}
        </span>
      </div>
    </button>
  );
}

// ─── Vessel expanded detail bottom sheet ─────────────────────────────────────

function VesselDetail({ vessel, onClose }: { vessel: NavioDieselRow; onClose: () => void }): React.ReactElement {
  const tone = statusToTone(vessel.status);
  const statusLabel = STATUS_LABELS[vessel.status] ?? vessel.status;

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={vessel.navio}
      height="70vh"
    >
      {/* Status pill */}
      <div style={{ marginBottom: 16, textAlign: "center" }}>
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "5px 14px",
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          background: `var(--mobile-status-${tone}-bg)`,
          color: `var(--mobile-status-${tone})`,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: `var(--mobile-status-${tone})`, display: "inline-block" }} />
          {statusLabel}
        </span>
      </div>

      {/* Identity grid */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--mobile-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
          Vessel details
        </div>
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 1,
          background: "var(--mobile-divider)",
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid var(--mobile-divider)",
        }}>
          {[
            { label: "IMO",    value: vessel.imo ?? "—" },
            { label: "MMSI",   value: vessel.mmsi ?? "—" },
            { label: "Flag",   value: vessel.flag ?? "—" },
            { label: "Origin", value: vessel.origem ?? "—" },
            { label: "Port",   value: vessel.porto.replace("Porto de ", "") },
            { label: "Product", value: vessel.produto ?? "—" },
          ].map(({ label, value }) => (
            <div key={label} style={{ background: "var(--mobile-surface)", padding: "10px 12px" }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "var(--mobile-text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                {label}
              </div>
              <div style={{ marginTop: 3, fontSize: 13, fontWeight: 700, color: "var(--mobile-text)", fontVariantNumeric: "tabular-nums", wordBreak: "break-word" }}>
                {value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Volume */}
      {vessel.quantidade_convertida != null && (
        <div style={{ marginBottom: 16, padding: "12px 16px", background: "var(--mobile-surface-2)", borderRadius: 12, border: "1px solid var(--mobile-divider)" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--mobile-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
            Volume
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--mobile-text)", fontVariantNumeric: "tabular-nums" }}>
            {vessel.quantidade_convertida.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--mobile-text-muted)", marginLeft: 4 }}>m³</span>
          </div>
        </div>
      )}

      {/* Voyage timeline */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--mobile-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
          Voyage timeline
        </div>
        <div style={{ position: "relative", paddingLeft: 22 }}>
          {/* Vertical line */}
          <div style={{ position: "absolute", left: 6, top: 6, bottom: 6, width: 2, background: "var(--mobile-divider)", borderRadius: 2 }} />

          {/* Timeline steps */}
          {[
            {
              label: vessel.origem ? `Loaded at ${vessel.origem}` : "Origin",
              time: null as string | null,
              state: "done" as const,
            },
            {
              label: "ETA",
              time: vessel.eta,
              state: (vessel.inicio_descarga ? "done" : "future") as "done" | "current" | "future",
            },
            {
              label: "Unloading started",
              time: vessel.inicio_descarga,
              state: (vessel.inicio_descarga ? (vessel.fim_descarga ? "done" : "current") : "future") as "done" | "current" | "future",
            },
            {
              label: "Unloading complete",
              time: vessel.fim_descarga,
              state: (vessel.fim_descarga ? "done" : "future") as "done" | "current" | "future",
            },
          ].map(({ label, time, state }, idx) => {
            const dotColor =
              state === "done"    ? "var(--mobile-status-unloading)" :
              state === "current" ? "var(--mobile-accent)" :
              "var(--mobile-surface)";
            const dotBorder =
              state === "done"    ? "var(--mobile-status-unloading)" :
              state === "current" ? "var(--mobile-accent)" :
              "var(--mobile-divider)";
            return (
              <div key={idx} style={{ position: "relative", padding: "6px 0", fontSize: 12 }}>
                {/* Step dot */}
                <span style={{
                  position: "absolute",
                  left: -22,
                  top: 9,
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  background: dotColor,
                  border: `2px solid ${dotBorder}`,
                  boxSizing: "border-box",
                  boxShadow: state === "current" ? "0 0 0 4px rgba(255,80,0,0.12)" : "none",
                  display: "inline-block",
                }} />
                <div style={{ fontWeight: 600, color: state === "future" ? "var(--mobile-text-faint)" : "var(--mobile-text)" }}>
                  {label}
                </div>
                {time && (
                  <div style={{ color: "var(--mobile-text-muted)", fontSize: 11, marginTop: 1 }}>
                    {fmtDate(time)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </BottomSheet>
  );
}

// ─── Filter bottom sheet ──────────────────────────────────────────────────────

function FilterSheet({
  open,
  onClose,
  portFilter,
  setPortFilter,
  availablePorts,
}: {
  open: boolean;
  onClose: () => void;
  portFilter: string | null;
  setPortFilter: (p: string | null) => void;
  availablePorts: string[];
}): React.ReactElement {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Filters"
      height="70vh"
      footer={
        <button
          type="button"
          onClick={onClose}
          style={{
            width: "100%",
            height: 50,
            border: 0,
            borderRadius: 12,
            background: "var(--mobile-accent)",
            color: "#fff",
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 15,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Apply
        </button>
      }
    >
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--mobile-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
          Port
        </div>
        {/* "All" option */}
        <button
          type="button"
          onClick={() => setPortFilter(null)}
          style={{
            display: "block",
            width: "100%",
            padding: "10px 14px",
            marginBottom: 4,
            border: `1px solid ${portFilter === null ? "var(--mobile-accent)" : "var(--mobile-divider)"}`,
            borderRadius: 10,
            background: portFilter === null ? "rgba(255,80,0,0.06)" : "var(--mobile-surface)",
            color: portFilter === null ? "var(--mobile-accent)" : "var(--mobile-text)",
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 14,
            fontWeight: portFilter === null ? 700 : 400,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          All ports
        </button>
        {availablePorts.map((porto) => (
          <button
            key={porto}
            type="button"
            onClick={() => setPortFilter(porto)}
            style={{
              display: "block",
              width: "100%",
              padding: "10px 14px",
              marginBottom: 4,
              border: `1px solid ${portFilter === porto ? "var(--mobile-accent)" : "var(--mobile-divider)"}`,
              borderRadius: 10,
              background: portFilter === porto ? "rgba(255,80,0,0.06)" : "var(--mobile-surface)",
              color: portFilter === porto ? "var(--mobile-accent)" : "var(--mobile-text)",
              fontFamily: "Arial, Helvetica, sans-serif",
              fontSize: 14,
              fontWeight: portFilter === porto ? 700 : 400,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            {porto.replace("Porto de ", "")}
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("navios-diesel");

  const {
    naviosDisplay,
    naviosDescarregados,
    portSummaries,
    selectedColeta,
    loading,
    newVesselSet,
    errorPorts,
  } = useNaviosDieselData();

  // ── Local UI state ────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"vessels" | "ports" | "map" | "profile">("vessels");
  const [vesselTab, setVesselTab] = useState<VesselTab>("active");
  const [activePortFilter, setActivePortFilter] = useState<string | null>(null);
  const [selectedVessel, setSelectedVessel] = useState<NavioDieselRow | null>(null);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);

  // ── Derived: all distinct ports ───────────────────────────────────────────────
  const availablePorts = useMemo(
    () => Array.from(new Set(naviosDisplay.map((n) => n.porto))).sort(),
    [naviosDisplay],
  );

  // ── Derived: vessels by segment + port filter ─────────────────────────────────
  const filteredByPort = useMemo(() => {
    if (!activePortFilter) return naviosDisplay;
    return naviosDisplay.filter((n) => n.porto === activePortFilter);
  }, [naviosDisplay, activePortFilter]);

  const vesselsByTab = useMemo((): NavioDieselRow[] => {
    switch (vesselTab) {
      case "active":
        // Active = currently at port (Atracado / Ao Largo / Fundeado / Iniciada Descarga)
        return filteredByPort.filter((n) =>
          ["Atracado", "Fundeado", "Ao Largo", "Iniciada Descarga"].includes(n.status),
        );
      case "recent":
        // Recent = Esperado arriving within 3 days (by ETA) + Despachado recently
        return filteredByPort.filter((n) => n.status === "Esperado").slice(0, 20);
      case "expected":
        return filteredByPort.filter((n) => n.status === "Esperado");
      default:
        return filteredByPort;
    }
  }, [filteredByPort, vesselTab]);

  // ── Bottom tab bar config ─────────────────────────────────────────────────────
  const bottomTabs: MobileBottomTab[] = [
    { key: "vessels", label: "Vessels", icon: <VesselsIcon />, active: activeTab === "vessels" },
    { key: "ports",   label: "Ports",   icon: <PortsIcon />,   active: activeTab === "ports" },
    { key: "map",     label: "Map",     icon: <MapIcon />,     active: activeTab === "map" },
    { key: "profile", label: "Profile", icon: <ProfileIcon size={22} />, active: activeTab === "profile" },
  ];

  // ── Export handler ────────────────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    if (exportBusy || naviosDisplay.length === 0) return;
    setExportBusy(true);
    try {
      await downloadGenericExcel<NavioDieselRow>({
        rows: naviosDisplay,
        filename: "Navios-Diesel-Lineup",
        title: "Diesel Imports Line-Up",
        sheetName: "Line-Up",
        columns: [
          { key: "porto",                 header: "Port",        width: 22 },
          { key: "status",                header: "Status",      width: 14 },
          { key: "navio",                 header: "Vessel",      width: 26 },
          { key: "produto",               header: "Product",     width: 18 },
          { key: "quantidade_convertida", header: "Volume (m³)", format: "#,##0" },
          { key: "eta",                   header: "ETA" },
          { key: "inicio_descarga",       header: "Unload Start" },
          { key: "fim_descarga",          header: "Unload End" },
          { key: "origem",                header: "Origin",      width: 18 },
          { key: "imo",                   header: "IMO" },
          { key: "mmsi",                  header: "MMSI" },
          { key: "flag",                  header: "Flag" },
        ],
      });
    } catch (e) {
      // Fallback to CSV on Excel failure
      downloadCsv({
        rows: naviosDisplay as unknown as Record<string, unknown>[],
        filename: "Navios-Diesel-Lineup",
      });
    } finally {
      setExportBusy(false);
    }
  }, [naviosDisplay, exportBusy]);

  if (visLoading || !visible) return <></>;

  return (
    <div
      style={{
        maxWidth: 428,
        margin: "0 auto",
        minHeight: "100dvh",
        background: "var(--mobile-bg)",
        paddingBottom: "calc(72px + var(--mobile-safe-bottom))",
        position: "relative",
        fontFamily: "Arial, Helvetica, sans-serif",
        color: "var(--mobile-text)",
      }}
    >
      {/* Top bar */}
      <MobileTopBar
        title={<span style={{ fontWeight: 700, fontSize: 17, letterSpacing: "0.04em" }}>SECTORDATA<span style={{ color: "var(--mobile-accent)" }}>.</span></span>}
        showAvatar
        avatarInitials="SD"
        avatarLabel="SectorData"
      />

      {/* ── Vessels tab ── */}
      {activeTab === "vessels" && (
        <>
          {/* Title block */}
          <section style={{ padding: "14px 16px 12px" }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: "0.005em", color: "var(--mobile-text)" }}>
              Diesel Vessels
            </h1>
            <div style={{ marginTop: 2, fontSize: 13, color: "var(--mobile-text-muted)" }}>
              Imports tracker
            </div>
            {selectedColeta && (
              <div style={{
                marginTop: 8,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                borderRadius: 999,
                background: "rgba(255,80,0,0.10)",
                color: "var(--mobile-accent)",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.02em",
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: "var(--mobile-accent)",
                  display: "inline-block",
                  boxShadow: "0 0 0 3px rgba(255,80,0,0.15)",
                  animation: "mobile-pulse-dot 2.2s ease-out infinite",
                }} />
                Last collected: {hoursAgo(selectedColeta)}
              </div>
            )}
          </section>

          {/* Status segmented control */}
          <div style={{
            display: "flex",
            gap: 6,
            margin: "0 16px 14px",
            padding: 4,
            background: "var(--mobile-surface)",
            border: "1px solid var(--mobile-divider)",
            borderRadius: 12,
          }} role="tablist" aria-label="Vessel status filter">
            {(["active", "recent", "expected"] as VesselTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={vesselTab === tab}
                onClick={() => setVesselTab(tab)}
                style={{
                  flex: "1 1 0",
                  minHeight: 36,
                  border: 0,
                  background: vesselTab === tab ? "var(--mobile-accent)" : "transparent",
                  color: vesselTab === tab ? "#fff" : "var(--mobile-text-muted)",
                  fontFamily: "inherit",
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 8,
                  cursor: "pointer",
                  transition: "background 0.15s ease, color 0.15s ease",
                  boxShadow: vesselTab === tab ? "0 2px 8px rgba(255,80,0,0.25)" : "none",
                }}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {/* Port summary horizontal scroller */}
          <section aria-label="Port summary" style={{ paddingBottom: 8 }}>
            <div style={{ padding: "0 16px 8px", fontSize: 11, fontWeight: 600, color: "var(--mobile-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              By port
            </div>
            <div style={{
              display: "flex",
              gap: 10,
              overflowX: "auto",
              overflowY: "hidden",
              padding: "0 16px 6px",
              scrollSnapType: "x mandatory",
              WebkitOverflowScrolling: "touch",
              scrollbarWidth: "none",
            } as React.CSSProperties}>
              {loading ? (
                <div style={{ color: "var(--mobile-text-faint)", fontSize: 12, padding: "12px 0" }}>Loading ports…</div>
              ) : portSummaries.map((ps) => (
                <PortCard
                  key={ps.porto}
                  summary={ps}
                  isActive={activePortFilter === ps.porto}
                  onClick={() => setActivePortFilter(activePortFilter === ps.porto ? null : ps.porto)}
                />
              ))}
            </div>
          </section>

          {/* Filter chip row (sticky below segmented control) */}
          <div style={{
            position: "sticky",
            top: "var(--mobile-topbar-h)",
            zIndex: 22,
            background: "var(--mobile-glass-bg)",
            WebkitBackdropFilter: "var(--mobile-glass-blur)",
            backdropFilter: "var(--mobile-glass-blur)",
            borderBottom: "1px solid var(--mobile-glass-border)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            overflowX: "auto",
            overflowY: "hidden",
            padding: "10px 16px",
            WebkitOverflowScrolling: "touch",
            scrollbarWidth: "none",
          } as React.CSSProperties} aria-label="Active filters">
            {/* Add filter chip */}
            <button
              type="button"
              onClick={() => setFilterSheetOpen(true)}
              style={{
                flex: "0 0 auto",
                minHeight: 32,
                padding: "0 12px",
                borderRadius: 999,
                border: 0,
                background: "rgba(255,80,0,0.10)",
                color: "var(--mobile-accent)",
                fontSize: 12,
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                whiteSpace: "nowrap",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
              aria-label="Open filters"
            >
              <FilterIcon />
              Filters
            </button>

            {/* Active port filter chip */}
            {activePortFilter && (
              <button
                type="button"
                onClick={() => setActivePortFilter(null)}
                style={{
                  flex: "0 0 auto",
                  minHeight: 32,
                  padding: "0 12px",
                  borderRadius: 999,
                  border: "1px solid var(--mobile-divider)",
                  background: "var(--mobile-surface)",
                  color: "var(--mobile-text)",
                  fontSize: 12,
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {activePortFilter.replace("Porto de ", "")}
                <span style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  background: "rgba(0,0,0,0.08)",
                  color: "var(--mobile-text-muted)",
                  fontSize: 10,
                  fontWeight: 700,
                }}>×</span>
              </button>
            )}

            {/* Snapshot time chip */}
            {selectedColeta && (
              <span style={{
                flex: "0 0 auto",
                minHeight: 32,
                padding: "0 12px",
                borderRadius: 999,
                border: "1px solid var(--mobile-divider)",
                background: "var(--mobile-surface)",
                color: "var(--mobile-text-muted)",
                fontSize: 12,
                fontWeight: 400,
                display: "inline-flex",
                alignItems: "center",
                whiteSpace: "nowrap",
              }}>
                {new Date(selectedColeta).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
            )}
          </div>

          {/* Vessel list */}
          <main style={{ paddingBottom: 24 }}>
            {loading ? (
              <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--mobile-text-muted)", fontSize: 13 }}>
                Loading vessels…
              </div>
            ) : vesselsByTab.length === 0 ? (
              <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--mobile-text-muted)", fontSize: 13 }}>
                No vessels found.
              </div>
            ) : vesselsByTab.map((v) => {
              const tone = statusToTone(v.status);
              const statusLabel = STATUS_LABELS[v.status] ?? v.status;
              const isNew = newVesselSet.has(`${v.navio}__${v.porto}`);

              const subtitle = (
                <span>
                  {v.origem ? `${v.origem} ` : ""}
                  {v.origem && <span style={{ color: "var(--mobile-text-faint)", fontWeight: 700 }}>→ </span>}
                  {v.porto.replace("Porto de ", "")}
                  {" · "}
                  {v.produto}
                  {v.quantidade_convertida != null && ` · ${v.quantidade_convertida.toLocaleString("en-US", { maximumFractionDigits: 0 })} m³`}
                </span>
              );

              const rightSlot = (
                <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                  {isNew && (
                    <span style={{
                      fontSize: 9,
                      fontWeight: 700,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: "var(--mobile-accent)",
                      color: "#fff",
                      textTransform: "uppercase",
                    }}>New</span>
                  )}
                  {v.eta ? (
                    <span style={{ fontSize: 11, color: "var(--mobile-text-muted)" }}>
                      ETA {fmtDate(v.eta)}
                    </span>
                  ) : v.flag ? (
                    <span style={{ fontSize: 11, color: "var(--mobile-text-muted)" }}>{v.flag}</span>
                  ) : null}
                  <ArrowRightIcon />
                </div>
              );

              return (
                <MobileDataCard
                  key={v.id}
                  title={v.navio}
                  subtitle={subtitle}
                  status={{ label: statusLabel, tone }}
                  rightSlot={rightSlot}
                  dim={tone === "completed"}
                  variant="expanded"
                  onClick={() => setSelectedVessel(v)}
                />
              );
            })}

            {/* Error ports notice */}
            {errorPorts.length > 0 && (
              <div style={{ margin: "8px 16px 0", fontSize: 11, color: "var(--mobile-text-faint)", padding: "8px 12px", background: "var(--mobile-surface)", borderRadius: 8, border: "1px solid var(--mobile-divider)" }}>
                Data unavailable for: {errorPorts.map(p => p.replace("Porto de ", "")).join(", ")}
              </div>
            )}
          </main>
        </>
      )}

      {/* ── Ports tab ── */}
      {activeTab === "ports" && (
        <div style={{ padding: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--mobile-text)", marginBottom: 12 }}>Port Summary</h2>
          {loading ? (
            <div style={{ color: "var(--mobile-text-muted)", fontSize: 13 }}>Loading…</div>
          ) : portSummaries.map((ps) => (
            <div key={ps.porto} style={{
              marginBottom: 10,
              padding: "14px 16px",
              background: "var(--mobile-surface)",
              border: "1px solid var(--mobile-divider)",
              borderRadius: 14,
            }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--mobile-text)", marginBottom: 4 }}>{ps.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "var(--mobile-text)", marginBottom: 6, fontVariantNumeric: "tabular-nums" }}>
                {fmtVolume(ps.totalVolume)}<span style={{ fontSize: 12, color: "var(--mobile-text-muted)", marginLeft: 4, fontWeight: 600 }}>m³</span>
              </div>
              <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--mobile-text-muted)" }}>
                <span>{ps.totalNavios} vessel{ps.totalNavios !== 1 ? "s" : ""}</span>
                {ps.counts.unloading > 0 && <span style={{ color: "var(--mobile-status-unloading)" }}>↓ {ps.counts.unloading} unloading</span>}
                {ps.counts.anchored > 0 && <span style={{ color: "var(--mobile-status-anchored)" }}>⚓ {ps.counts.anchored} anchored</span>}
                {ps.counts.enroute > 0 && <span style={{ color: "var(--mobile-status-enroute)" }}>→ {ps.counts.enroute} en-route</span>}
              </div>
            </div>
          ))}

          {/* Delivered vessels summary */}
          {naviosDescarregados.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--mobile-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
                Recently delivered
              </div>
              {naviosDescarregados.slice(0, 10).map((r) => (
                <MobileDataCard
                  key={`${r.navio}-${r.porto}`}
                  title={r.navio}
                  subtitle={`${r.porto.replace("Porto de ", "")} · ${r.last_volume.toLocaleString("en-US", { maximumFractionDigits: 0 })} m³`}
                  status={{ label: "Delivered", tone: "completed" }}
                  dim
                  variant="compact"
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Map tab (placeholder) [mobile-only] ── */}
      {activeTab === "map" && (
        <div style={{ padding: "32px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🗺️</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--mobile-text)", marginBottom: 8 }}>Map view</div>
          <div style={{ fontSize: 13, color: "var(--mobile-text-muted)", maxWidth: 280, margin: "0 auto" }}>
            Interactive port map is available on the desktop version. Switch to a larger screen to view vessel positions and AIS tracking.
          </div>
        </div>
      )}

      {/* ── Profile tab (placeholder) ── */}
      {activeTab === "profile" && (
        <div style={{ padding: "32px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 13, color: "var(--mobile-text-muted)" }}>
            Profile settings are available on the desktop version.
          </div>
        </div>
      )}

      {/* Export FAB */}
      {activeTab === "vessels" && (
        <ExportFAB
          icon="download"
          onClick={handleExport}
          disabled={exportBusy || naviosDisplay.length === 0}
          ariaLabel="Export vessel data"
        />
      )}

      {/* Bottom tab bar */}
      <MobileBottomTabBar
        tabs={bottomTabs}
        onChange={(key) => setActiveTab(key as "vessels" | "ports" | "map" | "profile")}
      />

      {/* Vessel detail sheet */}
      {selectedVessel && (
        <VesselDetail
          vessel={selectedVessel}
          onClose={() => setSelectedVessel(null)}
        />
      )}

      {/* Filter sheet */}
      <FilterSheet
        open={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        portFilter={activePortFilter}
        setPortFilter={setActivePortFilter}
        availablePorts={availablePorts}
      />
    </div>
  );
}
