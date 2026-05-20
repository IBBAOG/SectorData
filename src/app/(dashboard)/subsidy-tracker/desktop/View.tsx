"use client";

// ─── Desktop view for /subsidy-tracker ────────────────────────────────────────
//
// Verbatim port of the previous single-file page.tsx — the single Plotly chart
// with 4 line traces (IPP / ANP Reference / ANP Commercialization / Petrobras)
// in BRL/Liter. The ANP Reference trace exposes the 5 regional breakdown via
// Plotly `customdata` for a rich hover tooltip.
//
// All data, derivations and chart construction live in useSubsidyTrackerData.
// This View only handles layout, NavBar, header, export panel and the error
// boundary wiring.
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

export default function DesktopView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("subsidy-tracker");
  const {
    rows,
    loading: rpcLoading,
    error: rpcError,
    refetch: rpcRefetch,
    chart,
    exportExcel,
    exportCsv,
    excelLoading,
    csvLoading,
  } = useSubsidyTrackerData();

  // First-load spinner is shown while the very first fetch is in flight AND
  // we have no rows yet. Subsequent refetches keep the existing chart visible.
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
            <div style={{ marginTop: 16 }}>
              <PlotlyChart
                data={chart.data}
                layout={chart.layout}
                config={{ displayModeBar: false }}
              />
            </div>
          )}
        </DataErrorBoundary>
      </div>
    </div>
  );
}
