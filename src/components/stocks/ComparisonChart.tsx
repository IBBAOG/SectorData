"use client";

import { useEffect, useRef, useCallback } from "react";
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
  baseDate?: string;
  endDate?: string;
  dark?: boolean;
}

const THEMES = {
  dark: { bg: "#161b22", grid: "#21262d", text: "#8b949e", border: "#30363d", crosshair: "#8b949e", tooltip: "#2d333b", tooltipText: "#e6edf3" },
  light: { bg: "#ffffff", grid: "#f3f4f6", text: "#374151", border: "#e5e7eb", crosshair: "#9ca3af", tooltip: "#1f2937", tooltipText: "#ffffff" },
};

const PADDING = { top: 10, right: 60, bottom: 24, left: 6 };

function fmtDate(unix: number, short = false): string {
  const d = new Date(unix * 1000);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (short) return `${months[d.getMonth()]} ${d.getDate()}`;
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function niceSteps(min: number, max: number, targetCount = 5): number[] {
  const range = max - min;
  if (range <= 0) return [min];
  const rough = range / targetCount;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  let step = mag;
  if (rough / mag > 5) step = mag * 5;
  else if (rough / mag > 2) step = mag * 2;
  const steps: number[] = [];
  let v = Math.ceil(min / step) * step;
  while (v <= max) { steps.push(v); v += step; }
  return steps;
}

function toUnix(dateStr: string): number {
  return Math.floor(new Date(dateStr).getTime() / 1000);
}

interface NormalizedSeries {
  ticker: string;
  color: string;
  values: { date: number; value: number }[];
}

export default function ComparisonChart({ series, height = 400, mode, baseDate, endDate, dark = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number>(0);

  const t = dark ? THEMES.dark : THEMES.light;

  // Normalize series data
  const normalized: NormalizedSeries[] = series.map((s, i) => {
    let filtered = s.data;
    if (mode === "base100") {
      const startTs = baseDate ? toUnix(baseDate) : 0;
      const endTs = endDate ? toUnix(endDate) : Infinity;
      filtered = filtered.filter((d) => d.date >= startTs && d.date <= endTs);
    }
    if (!filtered.length) return { ticker: s.ticker, color: s.color ?? COLORS[i % COLORS.length], values: [] };
    const baseValue = filtered[0].close;
    if (!baseValue) return { ticker: s.ticker, color: s.color ?? COLORS[i % COLORS.length], values: [] };

    return {
      ticker: s.ticker,
      color: s.color ?? COLORS[i % COLORS.length],
      values: filtered.map((d) => ({
        date: d.date,
        value: mode === "percent"
          ? ((d.close - baseValue) / baseValue) * 100
          : (d.close / baseValue) * 100,
      })),
    };
  });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, w, h);

    const plotW = w - PADDING.left - PADDING.right;
    const plotH = h - PADDING.top - PADDING.bottom;
    if (plotW <= 0 || plotH <= 0) return;

    const activeSeries = normalized.filter((s) => s.values.length > 0);
    if (!activeSeries.length) return;

    // Find global min/max and date range
    let minVal = Infinity, maxVal = -Infinity;
    let allDates: number[] = [];
    for (const s of activeSeries) {
      for (const v of s.values) {
        if (v.value < minVal) minVal = v.value;
        if (v.value > maxVal) maxVal = v.value;
      }
      if (s.values.length > allDates.length) allDates = s.values.map((v) => v.date);
    }

    const valRange = maxVal - minVal || 1;
    const valPad = valRange * 0.1;
    minVal -= valPad;
    maxVal += valPad;

    const toX = (i: number) => PADDING.left + (i / (allDates.length - 1 || 1)) * plotW;
    const toY = (val: number) => PADDING.top + (1 - (val - minVal) / (maxVal - minVal)) * plotH;

    // Grid
    ctx.strokeStyle = t.grid;
    ctx.lineWidth = 1;
    const valSteps = niceSteps(minVal, maxVal, 5);
    for (const v of valSteps) {
      const y = Math.round(toY(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(PADDING.left, y);
      ctx.lineTo(w - PADDING.right, y);
      ctx.stroke();
    }

    const xStepCount = Math.max(1, Math.floor(plotW / 80));
    const xStep = Math.max(1, Math.floor(allDates.length / xStepCount));
    for (let i = 0; i < allDates.length; i += xStep) {
      const x = Math.round(toX(i)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, PADDING.top);
      ctx.lineTo(x, h - PADDING.bottom);
      ctx.stroke();
    }

    // Zero line for percent mode
    if (mode === "percent" && minVal < 0 && maxVal > 0) {
      ctx.strokeStyle = t.border;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      const zy = Math.round(toY(0)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(PADDING.left, zy);
      ctx.lineTo(w - PADDING.right, zy);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw lines
    for (const s of activeSeries) {
      ctx.beginPath();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      for (let i = 0; i < s.values.length; i++) {
        // Map this series' index to the global x scale
        const xi = allDates.indexOf(s.values[i].date);
        const x = xi >= 0 ? toX(xi) : toX(i * (allDates.length - 1) / (s.values.length - 1 || 1));
        const y = toY(s.values[i].value);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Y-axis labels
    ctx.fillStyle = t.text;
    ctx.font = "10px Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const suffix = mode === "percent" ? "%" : "";
    for (const v of valSteps) {
      const y = toY(v);
      if (y > PADDING.top + 5 && y < h - PADDING.bottom - 5) {
        ctx.fillText(v.toFixed(1) + suffix, w - PADDING.right + 6, y);
      }
    }

    // X-axis labels
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = 0; i < allDates.length; i += xStep) {
      ctx.fillText(fmtDate(allDates[i], true), toX(i), h - PADDING.bottom + 4);
    }

    // Crosshair
    const mouse = mouseRef.current;
    if (mouse && mouse.x >= PADDING.left && mouse.x <= w - PADDING.right && mouse.y >= PADDING.top && mouse.y <= h - PADDING.bottom) {
      const idx = Math.round(((mouse.x - PADDING.left) / plotW) * (allDates.length - 1));
      const di = Math.max(0, Math.min(allDates.length - 1, idx));
      const snapX = toX(di);
      const snapDate = allDates[di];

      // Vertical dashed line
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = t.crosshair;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(snapX, PADDING.top);
      ctx.lineTo(snapX, h - PADDING.bottom);
      ctx.stroke();
      ctx.setLineDash([]);

      // Date tooltip (bottom)
      const dateText = fmtDate(snapDate);
      const dtw = ctx.measureText(dateText).width + 8;
      ctx.fillStyle = t.tooltip;
      ctx.fillRect(snapX - dtw / 2, h - PADDING.bottom, dtw, 18);
      ctx.fillStyle = t.tooltipText;
      ctx.font = "10px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(dateText, snapX, h - PADDING.bottom + 4);

      // Series value tooltips (top-left stack)
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      let ty = PADDING.top + 2;
      for (const s of activeSeries) {
        // Find value at this date
        const sv = s.values.find((v) => v.date === snapDate);
        if (!sv) continue;
        ctx.fillStyle = s.color;
        ctx.fillRect(PADDING.left + 4, ty + 1, 8, 8);
        ctx.fillStyle = t.text;
        ctx.font = "10px Arial";
        ctx.fillText(`${s.ticker}: ${sv.value.toFixed(2)}${suffix}`, PADDING.left + 16, ty);
        ty += 14;
      }
    }
  }, [normalized, mode, dark, t]);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(draw);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [draw]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  }, [draw]);

  const handleMouseLeave = useCallback(() => {
    mouseRef.current = null;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  }, [draw]);

  const mutedColor = dark ? "#8b949e" : "#888";

  return (
    <div>
      <div ref={containerRef} style={{ width: "100%", height }}>
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%", display: "block" }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />
      </div>
      <div style={{ display: "flex", gap: 16, padding: "8px 0", flexWrap: "wrap" }}>
        {series.map((s, i) => (
          <span key={s.ticker} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: mutedColor }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: s.color ?? COLORS[i % COLORS.length], display: "inline-block" }} />
            {s.ticker}
          </span>
        ))}
      </div>
    </div>
  );
}
