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
}

function toChartTime(unix: number) {
  const d = new Date(unix * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function StockChart({ data, mode, height = 400 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null);

  // Create chart
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#374151",
        fontFamily: "Arial, sans-serif",
      },
      grid: {
        vertLines: { color: "#f3f4f6" },
        horzLines: { color: "#f3f4f6" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#e5e7eb" },
      timeScale: { borderColor: "#e5e7eb" },
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
  }, [height]);

  // Update series when data or mode changes
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !data.length) return;

    // Remove old series
    if (seriesRef.current) {
      chart.removeSeries(seriesRef.current);
      seriesRef.current = null;
    }

    if (mode === "candlestick") {
      const series = chart.addSeries(CandlestickSeries, {
        upColor: "#16a34a",
        downColor: "#dc2626",
        borderUpColor: "#16a34a",
        borderDownColor: "#dc2626",
        wickUpColor: "#16a34a",
        wickDownColor: "#dc2626",
      });
      series.setData(
        data.map((d) => ({
          time: toChartTime(d.date),
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
        })),
      );
      seriesRef.current = series;
    } else {
      const series = chart.addSeries(LineSeries, {
        color: "#ff5000",
        lineWidth: 2,
      });
      series.setData(
        data.map((d) => ({
          time: toChartTime(d.date),
          value: d.close,
        })),
      );
      seriesRef.current = series;
    }

    chart.timeScale().fitContent();
  }, [data, mode]);

  return <div ref={containerRef} style={{ width: "100%", height }} />;
}
