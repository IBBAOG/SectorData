"use client";

import { useEffect, useRef, useCallback, useState } from "react";
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

const PAD = { top: 10, right: 64, bottom: 28, left: 48 };

function fmtDate(unix: number, short = false): string {
  const d = new Date(unix * 1000);
  const M = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return short ? `${M[d.getMonth()]} ${String(d.getDate()).padStart(2,"0")}` : `${M[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function niceSteps(min: number, max: number, n = 5): number[] {
  const r = max - min; if (r <= 0) return [min];
  const rough = r / n, mag = Math.pow(10, Math.floor(Math.log10(rough)));
  let step = mag; if (rough/mag > 5) step = mag*5; else if (rough/mag > 2) step = mag*2;
  const s: number[] = []; let v = Math.ceil(min/step)*step;
  while (v <= max) { s.push(v); v += step; } return s;
}

export default function StockChart({ data, mode, height, dark = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const mouseRef = useRef<{x:number;y:number}|null>(null);
  const rafRef = useRef(0);

  // Zoom/pan state: viewStart..viewEnd are data indices
  const [viewRange, setViewRange] = useState<[number,number]|null>(null);
  const dragRef = useRef<{startX:number; origRange:[number,number]}|null>(null);

  const t = dark ? THEMES.dark : THEMES.light;
  const len = data.length;

  // Reset view when data changes
  useEffect(() => { setViewRange(null); }, [data]);

  const getView = useCallback((): [number, number] => {
    if (!len) return [0, 0];
    if (viewRange) return [Math.max(0, viewRange[0]), Math.min(len - 1, viewRange[1])];
    return [0, len - 1];
  }, [len, viewRange]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !len) return;

    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w <= 0 || h <= 0) return;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, w, h);

    const pw = w - PAD.left - PAD.right;
    const ph = h - PAD.top - PAD.bottom;
    if (pw <= 0 || ph <= 0) return;

    const [vs, ve] = getView();
    const vLen = ve - vs + 1;
    if (vLen <= 0) return;

    const slice = data.slice(vs, ve + 1);

    // Price range
    let lo = Infinity, hi = -Infinity;
    for (const d of slice) {
      const dlo = mode === "candlestick" ? d.low : d.close;
      const dhi = mode === "candlestick" ? d.high : d.close;
      if (dlo < lo) lo = dlo; if (dhi > hi) hi = dhi;
    }
    const pr = hi - lo || 1; const pp = pr * 0.1;
    lo -= pp; hi += pp;

    const toX = (i: number) => PAD.left + (i / (vLen - 1 || 1)) * pw;
    const toY = (p: number) => PAD.top + (1 - (p - lo) / (hi - lo)) * ph;

    // Grid
    ctx.strokeStyle = t.grid; ctx.lineWidth = 1;
    const ps = niceSteps(lo, hi, 5);
    for (const p of ps) { const y = Math.round(toY(p)) + 0.5; ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(w - PAD.right, y); ctx.stroke(); }
    const xn = Math.max(1, Math.floor(pw / 80));
    const xs = Math.max(1, Math.floor(vLen / xn));
    const x0 = Math.max(1, xs);
    for (let i = x0; i < vLen; i += xs) { const x = Math.round(toX(i)) + 0.5; ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, h - PAD.bottom); ctx.stroke(); }

    // Data
    if (mode === "candlestick") {
      const cw = Math.max(1, (pw / vLen) * 0.6);
      for (let i = 0; i < vLen; i++) {
        const d = slice[i], x = toX(i), up = d.close >= d.open;
        ctx.strokeStyle = up ? t.up : t.down; ctx.fillStyle = up ? t.up : t.down;
        ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, toY(d.high)); ctx.lineTo(x, toY(d.low)); ctx.stroke();
        const top = toY(Math.max(d.open, d.close)), bot = toY(Math.min(d.open, d.close)), bh = Math.max(1, bot - top);
        if (up) ctx.strokeRect(x - cw/2, top, cw, bh); else ctx.fillRect(x - cw/2, top, cw, bh);
      }
    } else {
      ctx.beginPath();
      for (let i = 0; i < vLen; i++) { const x = toX(i), y = toY(slice[i].close); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      ctx.strokeStyle = t.line; ctx.lineWidth = 2; ctx.stroke();
      const grad = ctx.createLinearGradient(0, PAD.top, 0, h - PAD.bottom);
      grad.addColorStop(0, dark ? "rgba(255,80,0,0.15)" : "rgba(255,80,0,0.1)"); grad.addColorStop(1, "rgba(255,80,0,0)");
      ctx.lineTo(toX(vLen - 1), h - PAD.bottom); ctx.lineTo(toX(0), h - PAD.bottom); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
    }

    // Current price label
    const lp = slice[vLen - 1].close, ly = toY(lp);
    ctx.setLineDash([3, 3]); ctx.strokeStyle = t.priceLine; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD.left, ly); ctx.lineTo(w - PAD.right, ly); ctx.stroke(); ctx.setLineDash([]);
    const pt = lp.toFixed(2); ctx.font = "bold 10px Arial"; const plw = ctx.measureText(pt).width + 10;
    ctx.fillStyle = t.priceLabel; ctx.fillRect(w - PAD.right, ly - 9, plw, 18);
    ctx.fillStyle = t.priceLabelText; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(pt, w - PAD.right + 5, ly);

    // Y labels
    ctx.fillStyle = t.text; ctx.font = "10px Arial"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    for (const p of ps) { const y = toY(p); if (Math.abs(y - ly) < 14) continue; if (y > PAD.top + 5 && y < h - PAD.bottom - 5) ctx.fillText(p.toFixed(2), w - PAD.right + 6, y); }

    // X labels
    ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillStyle = t.text; ctx.font = "10px Arial";
    for (let i = x0; i < vLen; i += xs) ctx.fillText(fmtDate(slice[i].date, true), toX(i), h - PAD.bottom + 6);

    // Crosshair
    const m = mouseRef.current;
    if (m && m.x >= PAD.left && m.x <= w - PAD.right && m.y >= PAD.top && m.y <= h - PAD.bottom) {
      const idx = Math.round(((m.x - PAD.left) / pw) * (vLen - 1));
      const di = Math.max(0, Math.min(vLen - 1, idx));
      const dp = slice[di], sx = toX(di), sy = toY(dp.close);
      ctx.setLineDash([4, 3]); ctx.strokeStyle = t.crosshair; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(sx, PAD.top); ctx.lineTo(sx, h - PAD.bottom); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(PAD.left, sy); ctx.lineTo(w - PAD.right, sy); ctx.stroke(); ctx.setLineDash([]);

      const pTxt = dp.close.toFixed(2), tw2 = ctx.measureText(pTxt).width + 8;
      ctx.fillStyle = t.tooltip; ctx.fillRect(w - PAD.right, sy - 9, tw2 + 4, 18);
      ctx.fillStyle = t.tooltipText; ctx.font = "10px Arial"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(pTxt, w - PAD.right + 4, sy);

      const dtTxt = fmtDate(dp.date), dtw2 = ctx.measureText(dtTxt).width + 8;
      ctx.fillStyle = t.tooltip; ctx.fillRect(sx - dtw2/2, h - PAD.bottom, dtw2, 18);
      ctx.fillStyle = t.tooltipText; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText(dtTxt, sx, h - PAD.bottom + 4);

      if (mode === "candlestick") {
        ctx.fillStyle = t.text; ctx.font = "10px Arial"; ctx.textAlign = "left"; ctx.textBaseline = "top";
        ctx.fillText(`O ${dp.open.toFixed(2)}  H ${dp.high.toFixed(2)}  L ${dp.low.toFixed(2)}  C ${dp.close.toFixed(2)}`, PAD.left + 4, PAD.top + 2);
      }
    }
  }, [data, mode, dark, t, getView, len]);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const wrap = wrapRef.current; if (!wrap) return;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(rafRef.current); rafRef.current = requestAnimationFrame(draw); });
    ro.observe(wrap); return () => ro.disconnect();
  }, [draw]);

  // Mouse: crosshair
  const onMove = useCallback((e: React.MouseEvent) => {
    const r = wrapRef.current?.getBoundingClientRect(); if (!r) return;
    mouseRef.current = { x: e.clientX - r.left, y: e.clientY - r.top };

    // Drag pan
    const drag = dragRef.current;
    if (drag && len > 1) {
      const dx = e.clientX - drag.startX;
      const pw = (wrapRef.current?.clientWidth ?? 1) - PAD.left - PAD.right;
      const vLen = drag.origRange[1] - drag.origRange[0];
      const shift = Math.round(-dx / pw * vLen);
      let ns = drag.origRange[0] + shift, ne = drag.origRange[1] + shift;
      if (ns < 0) { ne -= ns; ns = 0; }
      if (ne >= len) { ns -= (ne - len + 1); ne = len - 1; }
      setViewRange([Math.max(0, ns), Math.min(len - 1, ne)]);
    }

    cancelAnimationFrame(rafRef.current); rafRef.current = requestAnimationFrame(draw);
  }, [draw, len]);

  const onLeave = useCallback(() => { mouseRef.current = null; dragRef.current = null; cancelAnimationFrame(rafRef.current); rafRef.current = requestAnimationFrame(draw); }, [draw]);

  // Wheel zoom
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (len < 2) return;
    const [vs, ve] = getView();
    const vLen = ve - vs;
    const zoomDelta = Math.sign(e.deltaY) * Math.max(1, Math.round(vLen * 0.1));
    let ns = vs + zoomDelta, ne = ve - zoomDelta;
    if (ne - ns < 5) { const mid = Math.round((vs + ve) / 2); ns = mid - 2; ne = mid + 2; }
    ns = Math.max(0, ns); ne = Math.min(len - 1, ne);
    setViewRange([ns, ne]);
  }, [getView, len]);

  // Drag to pan
  const onDown = useCallback((e: React.MouseEvent) => {
    const [vs, ve] = getView();
    dragRef.current = { startX: e.clientX, origRange: [vs, ve] };
  }, [getView]);

  const onUp = useCallback(() => { dragRef.current = null; }, []);

  return (
    <div ref={wrapRef} style={{ width: "100%", height: height ?? "100%", minHeight: 60, position: "relative" }}>
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", cursor: dragRef.current ? "grabbing" : "crosshair" }}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        onWheel={onWheel}
        onMouseDown={onDown}
        onMouseUp={onUp}
      />
    </div>
  );
}
