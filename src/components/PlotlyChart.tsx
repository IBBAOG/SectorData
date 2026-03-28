"use client";

import dynamic from "next/dynamic";
import type { Layout, PlotData, Config } from "plotly.js";
import { useRef, useEffect } from "react";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

export default function PlotlyChart(props: {
  data: PlotData[];
  layout: Partial<Layout>;
  config?: Partial<Config>;
  style?: React.CSSProperties;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

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
        data={props.data as any}
        layout={props.layout as any}
        config={props.config as any}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
