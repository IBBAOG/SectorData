"use client";

// ─── Desktop view for /subsidy-tracker ────────────────────────────────────────
//
// Dual-agent layout: two Plotly charts side-by-side on ≥lg viewports, stacked
// on <lg. Each chart shows the 4-trace analysis (IPP / ANP Reference /
// ANP Commercialization / Petrobras) for its respective agent type, followed
// by a WoW table with the latest reading and week-on-week % change.
//
//   Left column  — Importer Reference Prices
//   Right column — Producer Reference Prices
//
// All data, derivations and chart construction live in useSubsidyTrackerData.
// This View only handles layout, NavBar, header, export panel, and error wiring.
//
// Binding sync rule: any new filter, chart, or KPI added here must also land
// in mobile/View.tsx in the same commit, or declare [desktop-only] with reason.

import NavBar from "../../../../components/NavBar";
import PlotlyChart from "../../../../components/PlotlyChart";
import DashboardHeader from "../../../../components/dashboard/DashboardHeader";
import ExportPanel from "../../../../components/dashboard/ExportPanel";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import DataErrorBoundary from "../../../../components/dashboard/DataErrorBoundary";
import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import { useSubsidyTrackerData } from "../useSubsidyTrackerData";
import WowTable from "./WowTable";

export default function DesktopView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("subsidy-tracker");
  const {
    rows,
    loading: rpcLoading,
    error: rpcError,
    refetch: rpcRefetch,
    chartImporter,
    chartProducer,
    currentValuesImporter,
    currentValuesProducer,
    exportExcel,
    exportCsv,
    excelLoading,
    csvLoading,
  } = useSubsidyTrackerData();

  // First-load spinner is shown while the very first fetch is in flight AND
  // we have no rows yet. Subsequent refetches keep the existing charts visible.
  const initialLoading = rpcLoading && rows.length === 0 && rpcError == null;

  if (visLoading || !visible) return <></>;

  return (
    <div>
      <NavBar />

      <div className="container-fluid g-0 p-4">
        <DashboardHeader
          title="Subsidy Tracker"
          sub="Diesel — ANP Reference & Commercialization Price vs IPP & Petrobras (BRL/Liter)"
          lang="en"
          rightSlot={
            <ExportPanel
              actions={[
                {
                  kind: "excel",
                  label: "formatted data .xl",
                  busy: excelLoading,
                  loadingLabel: "Generating Excel...",
                  disabled: rows.length === 0 || initialLoading || excelLoading,
                  onClick: exportExcel,
                },
                {
                  kind: "csv",
                  label: "all data .csv",
                  busy: csvLoading,
                  loadingLabel: "Downloading CSV...",
                  disabled: rows.length === 0 || initialLoading || csvLoading,
                  onClick: exportCsv,
                },
              ]}
            />
          }
        />

        <DataErrorBoundary
          error={rpcError}
          loading={rpcLoading}
          retry={rpcRefetch}
        >
          {initialLoading ? (
            <BarrelLoading />
          ) : (
            <div className="row g-4" style={{ marginTop: 16 }}>
              {/* ── Importer Reference Prices ─────────────────────────────── */}
              <div className="col-12 col-lg-6">
                <h6
                  className="mb-2"
                  style={{
                    fontWeight: 600,
                    fontFamily: "Arial, Helvetica, sans-serif",
                    fontSize: 14,
                    color: "#333",
                  }}
                >
                  Importer Reference Prices
                </h6>
                <PlotlyChart
                  data={chartImporter.data}
                  layout={chartImporter.layout}
                  config={{ displayModeBar: false }}
                />
                <WowTable rows={currentValuesImporter} />
              </div>

              {/* ── Producer Reference Prices ─────────────────────────────── */}
              <div className="col-12 col-lg-6">
                <h6
                  className="mb-2"
                  style={{
                    fontWeight: 600,
                    fontFamily: "Arial, Helvetica, sans-serif",
                    fontSize: 14,
                    color: "#333",
                  }}
                >
                  Producer Reference Prices
                </h6>
                <PlotlyChart
                  data={chartProducer.data}
                  layout={chartProducer.layout}
                  config={{ displayModeBar: false }}
                />
                <WowTable rows={currentValuesProducer} />
              </div>
            </div>
          )}
        </DataErrorBoundary>
      </div>
    </div>
  );
}
