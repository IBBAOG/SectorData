"use client";

// Desktop view for /home.
//
// Layout: 3-column grid — ModuleGallery (left, glass card matching the
// NewsHunterPanel/DataSourcesTable chrome), News Hunter live panel (center,
// 2× width — focal point), TeamPanel + DataSourcesTable (right).
//
// The gallery (ModuleGallery) is a self-contained glass card with a black
// header bar, category sections with colored dots + count badges, and
// per-category accent treatment on the rows (icon tile pre-tinted, hover
// lift + accent left-bar + chevron slide). All visuals live in
// src/components/home/ModuleGallery/ModuleGallery.module.css.

import { useRouter } from "next/navigation";
import NavBar from "../../../../components/NavBar";
import { useHomeData } from "../useHomeData";
import DataSourcesTable from "../../../../components/home/DataSourcesTable";
import TeamPanel from "../../../../components/home/TeamPanel";
import NewsHunterPanel from "../../../../components/home/NewsHunterPanel";
import ModuleGallery from "../../../../components/home/ModuleGallery";

const BG = "#f5f5f5";

// ── Main component ─────────────────────────────────────────────────────────

export default function DesktopView(): React.ReactElement {
  const router = useRouter();
  const { cardsByCategory } = useHomeData();

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

      {/* 3-column split: gallery (left, 1fr) · News Hunter (center, 2fr) ·
          Team + Data Sources (right, 1fr). News Hunter is the visual
          focal point — given twice the width of the side columns so the
          live headline feed has room to breathe. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 2fr 1fr",
          gap: 0,
          alignItems: "start",
          padding: "32px 24px 80px",
        }}
      >
        {/* ── Left column: module gallery (glass card) ────────────────── */}
        <section style={{ paddingRight: 12, paddingLeft: 12, paddingTop: 2 }}>
          <ModuleGallery
            variant="desktop"
            cardsByCategory={cardsByCategory}
            onNavigate={(href) => router.push(href)}
          />
        </section>

        {/* ── Center column: News Hunter live panel ───────────────────── */}
        <section
          style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 2 }}
          aria-label="Latest news"
        >
          <NewsHunterPanel />
        </section>

        {/* ── Right column: Team + Data Sources ────────────────────────── */}
        <section style={{ paddingLeft: 12, paddingTop: 2 }}>
          <TeamPanel />
          <div style={{ marginBottom: 12 }} />
          <DataSourcesTable />
        </section>
      </div>
    </main>
  );
}
