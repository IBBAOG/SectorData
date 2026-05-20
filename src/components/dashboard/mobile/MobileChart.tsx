"use client";

// Plotly wrapper tuned for mobile viewports.
//
// Differences from src/components/PlotlyChart.tsx (desktop):
//   • No modebar
//   • scrollZoom disabled (we don't want to hijack the page's pan/scroll)
//   • doubleClick disabled (touch users misfire)
//   • fixedrange:true on both axes (consumer can override layout to opt out)
//   • Smaller default margins (right side gutter for y-axis tick labels)
//   • Touch-friendly hovermode: "closest"
//   • Same dynamic-import + rounded-tooltip MutationObserver pattern as the
//     desktop wrapper so both surfaces stay visually consistent.
//
// The font / paper / plot colours pick up from CSS variables set by the
// mobile design system (`--mobile-text-muted`, `--mobile-surface`,
// `--mobile-chart-gridline`) — consumers do NOT need to pass colours.
//
// Visual source of truth: mockups/stocks-mobile.html (line + area chart),
// mockups/market-share-mobile.html (stacked area), mockups/anp-cdp-mobile.html
// (hero chart with annotation).

import dynamic from "next/dynamic";
import type { Layout, PlotData, Config } from "plotly.js";
import { useRef, useEffect, useMemo } from "react";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

export interface MobileChartProps {
  data: PlotData[];
  /** Optional layout override. Merged on top of the mobile defaults. */
  layout?: Partial<Layout>;
  /** Optional config override. Merged on top of the mobile defaults. */
  config?: Partial<Config>;
  /** Fixed pixel height. Defaults to 280 (mockup baseline). */
  height?: number;
  className?: string;
  style?: React.CSSProperties;
}

function readCssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

export default function MobileChart(
  props: MobileChartProps,
): React.ReactElement {
  const { data, layout, config, height = 280, className, style } = props;
  const containerRef = useRef<HTMLDivElement>(null);

  // Mirror desktop PlotlyChart.tsx: keep hover tooltips rounded (8px).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const applyRoundedCorners = () => {
      container
        .querySelectorAll<SVGRectElement>(".hoverlayer .hovertext rect")
        .forEach((rect) => {
          rect.setAttribute("rx", "8");
          rect.setAttribute("ry", "8");
        });
    };

    const observer = new MutationObserver(applyRoundedCorners);
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  // Compute merged layout / config. Memoised so Plotly receives stable refs.
  const mergedLayout = useMemo<Partial<Layout>>(() => {
    const muted = readCssVar("--mobile-text-muted", "#6b6b73");
    const surface = readCssVar("--mobile-surface", "#ffffff");
    const grid = readCssVar("--mobile-chart-gridline", "rgba(0,0,0,0.04)");
    const accent = readCssVar("--mobile-accent", "#ff5000");
    const text = readCssVar("--mobile-text", "#1a1a1a");

    const base: Partial<Layout> = {
      margin: { l: 32, r: 8, t: 8, b: 28 },
      paper_bgcolor: surface,
      plot_bgcolor: surface,
      font: {
        family: "Arial, Helvetica, sans-serif",
        size: 11,
        color: muted,
      },
      showlegend: false,
      hovermode: "closest",
      hoverlabel: {
        bgcolor: surface,
        bordercolor: accent,
        font: {
          family: "Arial, Helvetica, sans-serif",
          size: 12,
          color: text,
        },
      },
      xaxis: {
        showgrid: false,
        zeroline: false,
        showline: false,
        tickfont: { size: 10, color: muted },
        nticks: 5,
        fixedrange: true,
      },
      yaxis: {
        showgrid: true,
        gridcolor: grid,
        zeroline: false,
        showline: false,
        tickfont: { size: 10, color: muted },
        nticks: 4,
        fixedrange: true,
      },
    };

    if (!layout) return base;

    // Deep-merge axes so consumers can override partial fields without
    // wiping our defaults.
    return {
      ...base,
      ...layout,
      xaxis: { ...base.xaxis, ...(layout.xaxis ?? {}) },
      yaxis: { ...base.yaxis, ...(layout.yaxis ?? {}) },
      hoverlabel: { ...base.hoverlabel, ...(layout.hoverlabel ?? {}) },
      font: { ...base.font, ...(layout.font ?? {}) },
    } as Partial<Layout>;
  }, [layout]);

  const mergedConfig = useMemo<Partial<Config>>(() => {
    const base: Partial<Config> = {
      displayModeBar: false,
      responsive: true,
      scrollZoom: false,
      doubleClick: false,
      staticPlot: false,
    };
    return { ...base, ...(config ?? {}) };
  }, [config]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: "100%", height, ...style }}
    >
      <Plot
        data={data as unknown as Plotly.Data[]}
        layout={mergedLayout as Layout}
        config={mergedConfig as Config}
        style={{ width: "100%", height: "100%" }}
        useResizeHandler
      />
    </div>
  );
}
