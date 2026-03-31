"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  LineSeries,
  ColorType,
  CrosshairMode,
} from "lightweight-charts";
import type { HistoricalDataPoint } from "../../types/stocks";

const COLORS = ["#2962FF", "#FF6D00", "#00C853", "#AA00FF", "#FF1744"];

interface SeriesInput {
  ticker: string;
  data: HistoricalDataPoint[];
  color?: string;
}

interface Props {
  series: SeriesInput[];
  height?: number;
  mode: "percent" | "base100";
  baseDate?: string; // YYYY-MM-DD
  endDate?: string;  // YYYY-MM-DD
}

function toChartTime(unix: number) {
  const d = new Date(unix * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toUnix(dateStr: string): number {
  return Math.floor(new Date(dateStr).getTime() / 1000);
}

export default function ComparisonChart({
  series,
  height = 400,
  mode,
  baseDate,
  endDate,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const addedSeriesRef = useRef<ISeriesApi<SeriesType>[]>([]);

  // Create chart once
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
      rightPriceScale: {
        borderColor: "#e5e7eb",
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
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
      addedSeriesRef.current = [];
    };
  }, [height]);

  // Update series
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Remove previously added series
    for (const s of addedSeriesRef.current) {
      try { chart.removeSeries(s); } catch { /* already removed */ }
    }
    addedSeriesRef.current = [];

    series.forEach((s, i) => {
      let filteredData = s.data;

      if (mode === "base100") {
        const startTs = baseDate ? toUnix(baseDate) : 0;
        const endTs = endDate ? toUnix(endDate) : Infinity;
        filteredData = filteredData.filter(
          (d) => d.date >= startTs && d.date <= endTs,
        );
      }

      if (!filteredData.length) return;

      const baseValue = filteredData[0].close;
      if (!baseValue) return;

      const color = s.color ?? COLORS[i % COLORS.length];

      const lineSeries = chart.addSeries(LineSeries, {
        color,
        lineWidth: 2,
        title: s.ticker,
      });

      lineSeries.setData(
        filteredData.map((d) => ({
          time: toChartTime(d.date),
          value:
            mode === "percent"
              ? ((d.close - baseValue) / baseValue) * 100
              : (d.close / baseValue) * 100,
        })),
      );

      addedSeriesRef.current.push(lineSeries);
    });

    chart.timeScale().fitContent();
  }, [series, mode, baseDate, endDate]);

  return (
    <div>
      <div ref={containerRef} style={{ width: "100%", height }} />
      {/* Legend */}
      <div style={{ display: "flex", gap: 16, padding: "8px 0", flexWrap: "wrap" }}>
        {series.map((s, i) => (
          <span key={s.ticker} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 2,
                backgroundColor: s.color ?? COLORS[i % COLORS.length],
                display: "inline-block",
              }}
            />
            {s.ticker}
          </span>
        ))}
      </div>
    </div>
  );
}
