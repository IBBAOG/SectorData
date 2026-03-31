"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  LineSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
} from "lightweight-charts";
import type { HistoricalDataPoint, ChartMode } from "../../types/stocks";

interface Props {
  data: HistoricalDataPoint[];
  mode: ChartMode;
  height?: number;
  dark?: boolean;
}

function toChartTime(unix: number) {
  const d = new Date(unix * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const THEMES = {
  dark: { bg: "#161b22", grid: "#21262d", text: "#8b949e", border: "#30363d", up: "#3fb950", down: "#f85149" },
  light: { bg: "#ffffff", grid: "#f3f4f6", text: "#374151", border: "#e5e7eb", up: "#16a34a", down: "#dc2626" },
};

export default function StockChart({ data, mode, height = 400, dark = true }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null);

  const t = dark ? THEMES.dark : THEMES.light;

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: t.bg },
        textColor: t.text,
        fontFamily: "Arial, sans-serif",
      },
      grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: t.border },
      timeScale: { borderColor: t.border },
    });

    chartRef.current = chart;

    const ro = new ResizeObserver((entries) => {
      const { width } = entries[0].contentRect;
      chart.applyOptions({ width });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height, t.bg, t.text, t.grid, t.border]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !data.length) return;

    if (seriesRef.current) {
      chart.removeSeries(seriesRef.current);
      seriesRef.current = null;
    }

    if (mode === "candlestick") {
      const series = chart.addSeries(CandlestickSeries, {
        upColor: t.up, downColor: t.down,
        borderUpColor: t.up, borderDownColor: t.down,
        wickUpColor: t.up, wickDownColor: t.down,
      });
      series.setData(data.map((d) => ({ time: toChartTime(d.date), open: d.open, high: d.high, low: d.low, close: d.close })));
      seriesRef.current = series;
    } else {
      const series = chart.addSeries(LineSeries, { color: "#ff5000", lineWidth: 2 });
      series.setData(data.map((d) => ({ time: toChartTime(d.date), value: d.close })));
      seriesRef.current = series;
    }

    chart.timeScale().fitContent();
  }, [data, mode, t.up, t.down]);

  return <div ref={containerRef} style={{ width: "100%", height, borderRadius: 6, overflow: "hidden" }} />;
}
