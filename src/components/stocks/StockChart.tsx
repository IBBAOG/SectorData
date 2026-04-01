"use client";

import { useEffect, useRef, useCallback } from "react";
import type { HistoricalDataPoint, ChartMode } from "../../types/stocks";

interface Props {
  data: HistoricalDataPoint[];
  mode: ChartMode;
  height?: number;
  dark?: boolean;
}

const THEMES = {
  dark: { bg: "#161b22", grid: "#21262d", text: "#8b949e", border: "#30363d", up: "#3fb950", down: "#f85149", line: "#ff5000", crosshair: "#8b949e", tooltip: "#2d333b", tooltipText: "#e6edf3", priceLine: "#ff5000", priceLabel: "#ff5000", priceLabelText: "#fff" },
  light: { bg: "#ffffff", grid: "#f3f4f6", text: "#374151", border: "#e5e7eb", up: "#16a34a", down: "#dc2626", line: "#ff5000", crosshair: "#9ca3af", tooltip: "#1f2937", tooltipText: "#ffffff", priceLine: "#ff5000", priceLabel: "#ff5000", priceLabelText: "#fff" },
};

const PADDING = { top: 10, right: 64, bottom: 28, left: 48 };

function fmtDate(unix: number, short = false): string {
  const d = new Date(unix * 1000);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (short) return `${months[d.getMonth()]} ${String(d.getDate()).padStart(2, "0")}`;
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

export default function StockChart({ data, mode, height, dark = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number>(0);

  const t = dark ? THEMES.dark : THEMES.light;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !data.length) return;

    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w <= 0 || h <= 0) return;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, w, h);

    const plotW = w - PADDING.left - PADDING.right;
    const plotH = h - PADDING.top - PADDING.bottom;
    if (plotW <= 0 || plotH <= 0) return;

    // Price range
    let minPrice = Infinity, maxPrice = -Infinity;
    for (const d of data) {
      const lo = mode === "candlestick" ? d.low : d.close;
      const hi = mode === "candlestick" ? d.high : d.close;
      if (lo < minPrice) minPrice = lo;
      if (hi > maxPrice) maxPrice = hi;
    }
    const priceRange = maxPrice - minPrice || 1;
    const pricePad = priceRange * 0.1;
    minPrice -= pricePad;
    maxPrice += pricePad;

    const toX = (i: number) => PADDING.left + (i / (data.length - 1 || 1)) * plotW;
    const toY = (price: number) => PADDING.top + (1 - (price - minPrice) / (maxPrice - minPrice)) * plotH;

    // Grid lines
    ctx.strokeStyle = t.grid;
    ctx.lineWidth = 1;
    const priceSteps = niceSteps(minPrice, maxPrice, 5);
    for (const p of priceSteps) {
      const y = Math.round(toY(p)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(PADDING.left, y);
      ctx.lineTo(w - PADDING.right, y);
      ctx.stroke();
    }

    // X grid — skip first label to avoid cutoff
    const xStepCount = Math.max(1, Math.floor(plotW / 80));
    const xStep = Math.max(1, Math.floor(data.length / xStepCount));
    const xStart = Math.max(1, xStep); // skip index 0 to avoid left cutoff
    for (let i = xStart; i < data.length; i += xStep) {
      const x = Math.round(toX(i)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, PADDING.top);
      ctx.lineTo(x, h - PADDING.bottom);
      ctx.stroke();
    }

    // Draw data
    if (mode === "candlestick") {
      const candleW = Math.max(1, (plotW / data.length) * 0.6);
      for (let i = 0; i < data.length; i++) {
        const d = data[i];
        const x = toX(i);
        const isUp = d.close >= d.open;
        ctx.strokeStyle = isUp ? t.up : t.down;
        ctx.fillStyle = isUp ? t.up : t.down;

        ctx.beginPath();
        ctx.moveTo(x, toY(d.high));
        ctx.lineTo(x, toY(d.low));
        ctx.lineWidth = 1;
        ctx.stroke();

        const top = toY(Math.max(d.open, d.close));
        const bottom = toY(Math.min(d.open, d.close));
        const bodyH = Math.max(1, bottom - top);
        if (isUp) {
          ctx.strokeRect(x - candleW / 2, top, candleW, bodyH);
        } else {
          ctx.fillRect(x - candleW / 2, top, candleW, bodyH);
        }
      }
    } else {
      ctx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = toX(i);
        const y = toY(data[i].close);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = t.line;
      ctx.lineWidth = 2;
      ctx.stroke();

      const grad = ctx.createLinearGradient(0, PADDING.top, 0, h - PADDING.bottom);
      grad.addColorStop(0, dark ? "rgba(255,80,0,0.15)" : "rgba(255,80,0,0.1)");
      grad.addColorStop(1, "rgba(255,80,0,0)");
      ctx.lineTo(toX(data.length - 1), h - PADDING.bottom);
      ctx.lineTo(toX(0), h - PADDING.bottom);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // ── Current price label (like TradingView) ──
    const lastPrice = data[data.length - 1].close;
    const lastY = toY(lastPrice);
    const isUp = data.length > 1 ? lastPrice >= data[data.length - 2].close : true;

    // Dashed line across chart at current price
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = t.priceLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PADDING.left, lastY);
    ctx.lineTo(w - PADDING.right, lastY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Price label box on the right
    const priceText = lastPrice.toFixed(2);
    ctx.font = "bold 10px Arial";
    const plw = ctx.measureText(priceText).width + 10;
    ctx.fillStyle = t.priceLabel;
    ctx.fillRect(w - PADDING.right, lastY - 9, plw, 18);
    ctx.fillStyle = t.priceLabelText;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(priceText, w - PADDING.right + 5, lastY);

    // Y-axis labels
    ctx.fillStyle = t.text;
    ctx.font = "10px Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (const p of priceSteps) {
      const y = toY(p);
      // Don't draw if it overlaps with current price label
      if (Math.abs(y - lastY) < 14) continue;
      if (y > PADDING.top + 5 && y < h - PADDING.bottom - 5) {
        ctx.fillText(p.toFixed(2), w - PADDING.right + 6, y);
      }
    }

    // X-axis labels — skip first to avoid left cutoff
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = t.text;
    ctx.font = "10px Arial";
    for (let i = xStart; i < data.length; i += xStep) {
      const x = toX(i);
      ctx.fillText(fmtDate(data[i].date, true), x, h - PADDING.bottom + 6);
    }

    // Crosshair
    const mouse = mouseRef.current;
    if (mouse && mouse.x >= PADDING.left && mouse.x <= w - PADDING.right && mouse.y >= PADDING.top && mouse.y <= h - PADDING.bottom) {
      const idx = Math.round(((mouse.x - PADDING.left) / plotW) * (data.length - 1));
      const di = Math.max(0, Math.min(data.length - 1, idx));
      const dp = data[di];
      const snapX = toX(di);
      const snapY = toY(dp.close);

      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = t.crosshair;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(snapX, PADDING.top);
      ctx.lineTo(snapX, h - PADDING.bottom);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(PADDING.left, snapY);
      ctx.lineTo(w - PADDING.right, snapY);
      ctx.stroke();
      ctx.setLineDash([]);

      const ptText = dp.close.toFixed(2);
      const tw = ctx.measureText(ptText).width + 8;
      ctx.fillStyle = t.tooltip;
      ctx.fillRect(w - PADDING.right, snapY - 9, tw + 4, 18);
      ctx.fillStyle = t.tooltipText;
      ctx.font = "10px Arial";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(ptText, w - PADDING.right + 4, snapY);

      const dateText = fmtDate(dp.date);
      const dtw = ctx.measureText(dateText).width + 8;
      ctx.fillStyle = t.tooltip;
      ctx.fillRect(snapX - dtw / 2, h - PADDING.bottom, dtw, 18);
      ctx.fillStyle = t.tooltipText;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(dateText, snapX, h - PADDING.bottom + 4);

      if (mode === "candlestick") {
        const ohlc = `O ${dp.open.toFixed(2)}  H ${dp.high.toFixed(2)}  L ${dp.low.toFixed(2)}  C ${dp.close.toFixed(2)}`;
        ctx.fillStyle = t.text;
        ctx.font = "10px Arial";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(ohlc, PADDING.left + 4, PADDING.top + 2);
      }
    }
  }, [data, mode, dark, t]);

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

  return (
    <div ref={containerRef} style={{ width: "100%", height: height ?? "100%", minHeight: 80 }}>
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
    </div>
  );
}
