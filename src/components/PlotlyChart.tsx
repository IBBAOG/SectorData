"use client";

import dynamic from "next/dynamic";
import type { Layout, PlotData, Config } from "plotly.js";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

export default function PlotlyChart(props: {
  data: PlotData[];
  layout: Partial<Layout>;
  config?: Partial<Config>;
  style?: React.CSSProperties;
}) {
  return (
    <Plot
      data={props.data as any}
      layout={props.layout as any}
      config={props.config as any}
      style={props.style}
    />
  );
}

