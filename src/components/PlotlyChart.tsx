"use client";

import dynamic from "next/dynamic";
import type { Layout, PlotData, Config, PlotMouseEvent } from "plotly.js";
import { useRef, useEffect } from "react";
import { validateTraces } from "@/lib/charts/validateTraces";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

export default function PlotlyChart(props: {
  data: PlotData[];
  layout: Partial<Layout>;
  config?: Partial<Config>;
  style?: React.CSSProperties;
  /** Optional Plotly click handler — receives the PlotMouseEvent payload. */
  onClick?: (e: PlotMouseEvent) => void;
  /** Stable chart identifier (e.g. "imports-exports:by-importer") used by the
   *  trace lock to name violations and decide dev-throw vs. warn. */
  ctx?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Trace lock: dev/CI throws on color collision / inverted stacked legend for
  // migrated charts; production auto-corrects + console.error (never breaks).
  const { data: safeData, layout: safeLayout } = validateTraces(
    props.data,
    props.layout,
    props.ctx,
  );

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

  return (
    <div ref={containerRef} style={props.style}>
      <Plot
        data={safeData as any}
        layout={safeLayout as any}
        config={props.config as any}
        style={{ width: "100%", height: "100%" }}
        useResizeHandler
        onClick={props.onClick as any}
      />
    </div>
  );
}
