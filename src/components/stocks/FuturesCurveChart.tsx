"use client";

import { useEffect, useRef, useCallback, useState } from "react";

interface FuturesContract {
  contract: string;
  ticker: string;
  price: number;
  month: number;
  year: number;
}

interface FuturesCurveData {
  commodity: string;
  currency: string;
  contracts: FuturesContract[];
  updatedAt: string;
}

interface Props {
  dark?: boolean;
}

const THEMES = {
  dark: { bg: "#000000", grid: "#1a1a1a", text: "#ffffff", line: "#ff5000", dot: "#ff5000", crosshair: "#666666", tooltip: "#1a1a1a", tooltipText: "#ffffff" },
  light: { bg: "#ffffff", grid: "#f0f0f0", text: "#1a1a1a", line: "#ff5000", dot: "#ff5000", crosshair: "#9ca3af", tooltip: "#1f2937", tooltipText: "#ffffff" },
};

const FONT = "13px Arial, Helvetica, sans-serif";
const FONT_BOLD = "bold 13px Arial, Helvetica, sans-serif";
const PAD = { top: 30, right: 72, bottom: 34, left: 48 };

function niceSteps(min: number, max: number, n = 5): number[] {
  const r = max - min; if (r <= 0) return [min];
  const rough = r / n, mag = Math.pow(10, Math.floor(Math.log10(rough)));
  let step = mag; if (rough/mag > 5) step = mag*5; else if (rough/mag > 2) step = mag*2;
  const s: number[] = []; let v = Math.ceil(min/step)*step;
  while (v <= max) { s.push(v); v += step; } return s;
}

export default function FuturesCurveChart({ dark = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const mouseRef = useRef<{x:number;y:number}|null>(null);
  const rafRef = useRef(0);
  const [data, setData] = useState<FuturesCurveData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch("/api/stocks/futures-curve")
      .then((r) => r.json())
      .then((d: FuturesCurveData) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const t = dark ? THEMES.dark : THEMES.light;
  const contracts = data?.contracts ?? [];

  const draw = useCallback(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap || !contracts.length) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(wrap.clientWidth), h = Math.floor(wrap.clientHeight);
    if (w <= 0 || h <= 0) return;
    canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d", { alpha: false })!;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = t.bg; ctx.fillRect(0, 0, w, h);

    const pw = w - PAD.left - PAD.right, ph = h - PAD.top - PAD.bottom;
    if (pw <= 0 || ph <= 0) return;

    const prices = contracts.map((c) => c.price);
    let lo = Math.min(...prices), hi = Math.max(...prices);
    const pr = hi - lo || 1, pp = pr * 0.1; lo -= pp; hi += pp;

    const n = contracts.length;
    const toX = (i: number) => PAD.left + (i / (n - 1 || 1)) * pw;
    const toY = (p: number) => PAD.top + (1 - (p - lo) / (hi - lo)) * ph;

    // Front price label
    ctx.font = FONT; ctx.fillStyle = t.text;
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillText(`Front: ${prices[0].toFixed(2)}`, PAD.left + 4, 4);

    // Grid
    ctx.strokeStyle = t.grid; ctx.lineWidth = 1;
    const ps = niceSteps(lo, hi, 5);
    for (const p of ps) { const y = Math.round(toY(p)) + 0.5; ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(w - PAD.right, y); ctx.stroke(); }

    // X grid — auto-space based on label width to avoid overlap
    ctx.font = FONT;
    const sampleLabelW = ctx.measureText("Sep 2027").width + 16;
    const maxLabels = Math.max(1, Math.floor(pw / sampleLabelW));
    const xStep = Math.max(1, Math.ceil(n / maxLabels));
    for (let i = 0; i < n; i += xStep) { const x = Math.round(toX(i)) + 0.5; ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, h - PAD.bottom); ctx.stroke(); }

    // Line + gradient fill
    ctx.beginPath();
    for (let i = 0; i < n; i++) { const x = toX(i), y = toY(prices[i]); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.strokeStyle = t.line; ctx.lineWidth = 2.5; ctx.stroke();

    // Gradient fill below
    const grad = ctx.createLinearGradient(0, PAD.top, 0, h - PAD.bottom);
    grad.addColorStop(0, dark ? "rgba(255,80,0,0.2)" : "rgba(255,80,0,0.12)");
    grad.addColorStop(1, "rgba(255,80,0,0)");
    ctx.lineTo(toX(n - 1), h - PAD.bottom); ctx.lineTo(toX(0), h - PAD.bottom); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    // Dots
    for (let i = 0; i < n; i++) {
      ctx.beginPath(); ctx.arc(toX(i), toY(prices[i]), 3, 0, Math.PI * 2);
      ctx.fillStyle = t.dot; ctx.fill();
    }

    // Current price label (last contract)
    const lastP = prices[n - 1], lastY = toY(lastP);
    const lastTxt = lastP.toFixed(2); ctx.font = FONT_BOLD;
    const lw = ctx.measureText(lastTxt).width + 12;
    ctx.fillStyle = t.line; ctx.fillRect(w - PAD.right, lastY - 10, lw, 20);
    ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(lastTxt, w - PAD.right + 6, lastY);

    // Y labels
    ctx.fillStyle = t.text; ctx.font = FONT; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    for (const p of ps) { const y = toY(p); if (Math.abs(y - lastY) < 16) continue; if (y > PAD.top + 5 && y < h - PAD.bottom - 5) ctx.fillText(p.toFixed(0), w - PAD.right + 6, y); }

    // X labels
    ctx.textBaseline = "top"; ctx.font = FONT;
    ctx.textAlign = "center";
    for (let i = 0; i < n; i += xStep) {
      ctx.fillText(contracts[i].contract, toX(i), h - PAD.bottom + 8);
    }

    // Crosshair
    const m = mouseRef.current;
    if (m && m.x >= PAD.left && m.x <= w - PAD.right && m.y >= PAD.top && m.y <= h - PAD.bottom) {
      const idx = Math.round(((m.x - PAD.left) / pw) * (n - 1));
      const di = Math.max(0, Math.min(n - 1, idx));
      const c = contracts[di], sx = toX(di), sy = toY(c.price);

      ctx.setLineDash([4, 3]); ctx.strokeStyle = t.crosshair; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(sx, PAD.top); ctx.lineTo(sx, h - PAD.bottom); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(PAD.left, sy); ctx.lineTo(w - PAD.right, sy); ctx.stroke();
      ctx.setLineDash([]);

      // Price tooltip
      const pTxt = c.price.toFixed(2); ctx.font = FONT;
      const tw2 = ctx.measureText(pTxt).width + 10;
      ctx.fillStyle = t.tooltip; ctx.fillRect(w - PAD.right, sy - 10, tw2, 20);
      ctx.fillStyle = t.tooltipText; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(pTxt, w - PAD.right + 5, sy);

      // Contract tooltip
      const dtTxt = c.contract; ctx.font = FONT;
      const dtw = ctx.measureText(dtTxt).width + 10;
      ctx.fillStyle = t.tooltip; ctx.fillRect(sx - dtw / 2, h - PAD.bottom, dtw, 22);
      ctx.fillStyle = t.tooltipText; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText(dtTxt, sx, h - PAD.bottom + 5);

      // Dot highlight
      ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2);
      ctx.fillStyle = t.dot; ctx.fill();
      ctx.strokeStyle = dark ? "#fff" : "#000"; ctx.lineWidth = 2; ctx.stroke();
    }
  }, [contracts, dark, t]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => { const w = wrapRef.current; if (!w) return; const ro = new ResizeObserver(() => { cancelAnimationFrame(rafRef.current); rafRef.current = requestAnimationFrame(draw); }); ro.observe(w); return () => ro.disconnect(); }, [draw]);

  const onMove = useCallback((e: React.MouseEvent) => {
    const r = wrapRef.current?.getBoundingClientRect(); if (!r) return;
    mouseRef.current = { x: e.clientX - r.left, y: e.clientY - r.top };
    cancelAnimationFrame(rafRef.current); rafRef.current = requestAnimationFrame(draw);
  }, [draw]);
  const onLeave = useCallback(() => { mouseRef.current = null; cancelAnimationFrame(rafRef.current); rafRef.current = requestAnimationFrame(draw); }, [draw]);

  if (loading) return <div style={{ textAlign: "center", padding: 30 }}><span className="spinner-border spinner-border-sm" style={{ color: "#8b949e" }} /></div>;
  if (!contracts.length) return <div className="sd-muted" style={{ textAlign: "center", padding: 20, fontSize: 12 }}>No futures data available</div>;

  return (
    <div ref={wrapRef} style={{ width: "100%", height: "100%", minHeight: 60, position: "relative" }}>
      <canvas ref={canvasRef} style={{ position: "absolute", top: 0, left: 0, cursor: "crosshair" }}
        onMouseMove={onMove} onMouseLeave={onLeave} />
    </div>
  );
}
