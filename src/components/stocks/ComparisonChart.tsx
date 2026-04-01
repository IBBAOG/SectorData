"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { HistoricalDataPoint } from "../../types/stocks";

const COLORS = ["#2962FF", "#FF6D00", "#00C853", "#AA00FF", "#FF1744"];

interface SeriesInput { ticker: string; data: HistoricalDataPoint[]; color?: string; }

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

function toUnix(dateStr: string): number { return Math.floor(new Date(dateStr).getTime() / 1000); }

interface NSeries { ticker: string; color: string; values: { date: number; value: number }[] }

export default function ComparisonChart({ series, height, mode, baseDate, endDate, dark = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const mouseRef = useRef<{x:number;y:number}|null>(null);
  const rafRef = useRef(0);
  const [viewRange, setViewRange] = useState<[number,number]|null>(null);
  const dragRef = useRef<{startX:number; origRange:[number,number]}|null>(null);

  const t = dark ? THEMES.dark : THEMES.light;

  const normalized: NSeries[] = series.map((s, i) => {
    let filtered = s.data;
    if (mode === "base100") {
      const startTs = baseDate ? toUnix(baseDate) : 0;
      const endTs = endDate ? toUnix(endDate) : Infinity;
      filtered = filtered.filter((d) => d.date >= startTs && d.date <= endTs);
    }
    if (!filtered.length) return { ticker: s.ticker, color: s.color ?? COLORS[i % COLORS.length], values: [] };
    const bv = filtered[0].close;
    if (!bv) return { ticker: s.ticker, color: s.color ?? COLORS[i % COLORS.length], values: [] };
    return {
      ticker: s.ticker,
      color: s.color ?? COLORS[i % COLORS.length],
      values: filtered.map((d) => ({ date: d.date, value: mode === "percent" ? ((d.close - bv)/bv)*100 : (d.close/bv)*100 })),
    };
  });

  const activeSeries = normalized.filter((s) => s.values.length > 0);
  let allDates: number[] = [];
  for (const s of activeSeries) if (s.values.length > allDates.length) allDates = s.values.map((v) => v.date);
  const totalLen = allDates.length;

  useEffect(() => { setViewRange(null); }, [series, mode, baseDate, endDate]);

  const getView = useCallback((): [number, number] => {
    if (!totalLen) return [0, 0];
    if (viewRange) return [Math.max(0, viewRange[0]), Math.min(totalLen - 1, viewRange[1])];
    return [0, totalLen - 1];
  }, [totalLen, viewRange]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

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
    if (pw <= 0 || ph <= 0 || !activeSeries.length || !totalLen) return;

    const [vs, ve] = getView();
    const vLen = ve - vs + 1;
    if (vLen <= 0) return;

    const viewDates = allDates.slice(vs, ve + 1);

    // Value range from visible data
    let minV = Infinity, maxV = -Infinity;
    for (const s of activeSeries) {
      for (let i = vs; i <= ve && i < s.values.length; i++) {
        const v = s.values[i]?.value;
        if (v !== undefined) { if (v < minV) minV = v; if (v > maxV) maxV = v; }
      }
    }
    const vr = maxV - minV || 1; const vp = vr * 0.1;
    minV -= vp; maxV += vp;

    const toX = (i: number) => PAD.left + (i / (vLen - 1 || 1)) * pw;
    const toY = (val: number) => PAD.top + (1 - (val - minV) / (maxV - minV)) * ph;

    // Grid
    ctx.strokeStyle = t.grid; ctx.lineWidth = 1;
    const valSteps = niceSteps(minV, maxV, 5);
    for (const v of valSteps) { const y = Math.round(toY(v)) + 0.5; ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(w - PAD.right, y); ctx.stroke(); }
    const xn = Math.max(1, Math.floor(pw / 80));
    const xs = Math.max(1, Math.floor(vLen / xn));
    const x0 = Math.max(1, xs);
    for (let i = x0; i < vLen; i += xs) { const x = Math.round(toX(i)) + 0.5; ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, h - PAD.bottom); ctx.stroke(); }

    // Zero line
    if (mode === "percent" && minV < 0 && maxV > 0) {
      ctx.strokeStyle = t.border; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(PAD.left, Math.round(toY(0)) + 0.5); ctx.lineTo(w - PAD.right, Math.round(toY(0)) + 0.5); ctx.stroke(); ctx.setLineDash([]);
    }

    // Lines
    for (const s of activeSeries) {
      ctx.beginPath(); ctx.strokeStyle = s.color; ctx.lineWidth = 2;
      for (let vi = 0; vi < vLen; vi++) {
        const globalI = vs + vi;
        if (globalI >= s.values.length) break;
        const x = toX(vi), y = toY(s.values[globalI].value);
        vi === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Current value labels
    const suffix = mode === "percent" ? "%" : "";
    for (const s of activeSeries) {
      const lastI = Math.min(ve, s.values.length - 1);
      if (lastI < 0) continue;
      const lv = s.values[lastI].value, ly = toY(lv);
      const lt = lv.toFixed(1) + suffix;
      ctx.font = "bold 9px Arial"; const lw = ctx.measureText(lt).width + 8;
      ctx.setLineDash([2, 2]); ctx.strokeStyle = s.color; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(PAD.left, ly); ctx.lineTo(w - PAD.right, ly); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = s.color; ctx.fillRect(w - PAD.right, ly - 7, lw, 14);
      ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(lt, w - PAD.right + 4, ly);
    }

    // Y labels
    ctx.fillStyle = t.text; ctx.font = "10px Arial"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    for (const v of valSteps) {
      const y = toY(v);
      const overlaps = activeSeries.some((s) => { const li = Math.min(ve, s.values.length - 1); return li >= 0 && Math.abs(y - toY(s.values[li].value)) < 12; });
      if (overlaps) continue;
      if (y > PAD.top + 5 && y < h - PAD.bottom - 5) ctx.fillText(v.toFixed(1) + suffix, w - PAD.right + 6, y);
    }

    // X labels
    ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillStyle = t.text; ctx.font = "10px Arial";
    for (let i = x0; i < vLen; i += xs) ctx.fillText(fmtDate(viewDates[i], true), toX(i), h - PAD.bottom + 6);

    // Crosshair
    const m = mouseRef.current;
    if (m && m.x >= PAD.left && m.x <= w - PAD.right && m.y >= PAD.top && m.y <= h - PAD.bottom) {
      const idx = Math.round(((m.x - PAD.left) / pw) * (vLen - 1));
      const di = Math.max(0, Math.min(vLen - 1, idx));
      const sx = toX(di), sDate = viewDates[di];
      ctx.setLineDash([4, 3]); ctx.strokeStyle = t.crosshair; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(sx, PAD.top); ctx.lineTo(sx, h - PAD.bottom); ctx.stroke(); ctx.setLineDash([]);

      const dtTxt = fmtDate(sDate), dtw2 = ctx.measureText(dtTxt).width + 8;
      ctx.fillStyle = t.tooltip; ctx.fillRect(sx - dtw2/2, h - PAD.bottom, dtw2, 18);
      ctx.fillStyle = t.tooltipText; ctx.font = "10px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText(dtTxt, sx, h - PAD.bottom + 4);

      ctx.textAlign = "left"; ctx.textBaseline = "top"; let ty = PAD.top + 2;
      for (const s of activeSeries) {
        const gi = vs + di;
        if (gi >= s.values.length) continue;
        const sv = s.values[gi];
        ctx.fillStyle = s.color; ctx.fillRect(PAD.left + 4, ty + 1, 8, 8);
        ctx.fillStyle = t.text; ctx.font = "10px Arial"; ctx.fillText(`${s.ticker}: ${sv.value.toFixed(2)}${suffix}`, PAD.left + 16, ty);
        ty += 14;
      }
    }
  }, [normalized, activeSeries, allDates, totalLen, mode, dark, t, getView]);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const wrap = wrapRef.current; if (!wrap) return;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(rafRef.current); rafRef.current = requestAnimationFrame(draw); });
    ro.observe(wrap); return () => ro.disconnect();
  }, [draw]);

  const onMove = useCallback((e: React.MouseEvent) => {
    const r = wrapRef.current?.getBoundingClientRect(); if (!r) return;
    mouseRef.current = { x: e.clientX - r.left, y: e.clientY - r.top };
    const drag = dragRef.current;
    if (drag && totalLen > 1) {
      const dx = e.clientX - drag.startX;
      const pw2 = (wrapRef.current?.clientWidth ?? 1) - PAD.left - PAD.right;
      const vl = drag.origRange[1] - drag.origRange[0];
      const shift = Math.round(-dx / pw2 * vl);
      let ns = drag.origRange[0] + shift, ne = drag.origRange[1] + shift;
      if (ns < 0) { ne -= ns; ns = 0; }
      if (ne >= totalLen) { ns -= (ne - totalLen + 1); ne = totalLen - 1; }
      setViewRange([Math.max(0, ns), Math.min(totalLen - 1, ne)]);
    }
    cancelAnimationFrame(rafRef.current); rafRef.current = requestAnimationFrame(draw);
  }, [draw, totalLen]);

  const onLeave = useCallback(() => { mouseRef.current = null; dragRef.current = null; cancelAnimationFrame(rafRef.current); rafRef.current = requestAnimationFrame(draw); }, [draw]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault(); if (totalLen < 2) return;
    const [vs2, ve2] = getView(); const vl = ve2 - vs2;
    const zd = Math.sign(e.deltaY) * Math.max(1, Math.round(vl * 0.1));
    let ns = vs2 + zd, ne = ve2 - zd;
    if (ne - ns < 5) { const mid = Math.round((vs2 + ve2) / 2); ns = mid - 2; ne = mid + 2; }
    setViewRange([Math.max(0, ns), Math.min(totalLen - 1, ne)]);
  }, [getView, totalLen]);

  const onDown = useCallback((e: React.MouseEvent) => { const [vs2, ve2] = getView(); dragRef.current = { startX: e.clientX, origRange: [vs2, ve2] }; }, [getView]);
  const onUp = useCallback(() => { dragRef.current = null; }, []);

  const mutedColor = dark ? "#8b949e" : "#888";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: height ?? "100%", minHeight: 60 }}>
      <div ref={wrapRef} style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <canvas
          ref={canvasRef}
          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", cursor: "crosshair" }}
          onMouseMove={onMove}
          onMouseLeave={onLeave}
          onWheel={onWheel}
          onMouseDown={onDown}
          onMouseUp={onUp}
        />
      </div>
      <div style={{ display: "flex", gap: 12, padding: "4px 0", flexWrap: "wrap", flexShrink: 0 }}>
        {series.map((s, i) => (
          <span key={s.ticker} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: mutedColor }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: s.color ?? COLORS[i % COLORS.length], display: "inline-block" }} />
            {s.ticker}
          </span>
        ))}
      </div>
    </div>
  );
}
