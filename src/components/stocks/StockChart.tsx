"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { HistoricalDataPoint, ChartMode } from "../../types/stocks";

interface Props {
  data: HistoricalDataPoint[];
  mode: ChartMode;
  height?: number;
  dark?: boolean;
  intraday?: boolean; // true for 15m, 30m, 1h intervals — show time on x-axis
}

const THEMES = {
  dark: { bg: "#000000", grid: "#1a1a1a", text: "#ffffff", border: "#333333", up: "#3fb950", down: "#f85149", line: "#ff5000", crosshair: "#666666", tooltip: "#1a1a1a", tooltipText: "#ffffff", priceLine: "#ff5000", priceLabel: "#ff5000", priceLabelText: "#fff" },
  light: { bg: "#ffffff", grid: "#f0f0f0", text: "#1a1a1a", border: "#e0e0e0", up: "#16a34a", down: "#dc2626", line: "#ff5000", crosshair: "#9ca3af", tooltip: "#1f2937", tooltipText: "#ffffff", priceLine: "#ff5000", priceLabel: "#ff5000", priceLabelText: "#fff" },
};

const FONT_BOLD = "bold 13px Arial, Helvetica, sans-serif";
const FONT_SM = "13px Arial, Helvetica, sans-serif";
const PAD = { top: 14, right: 78, bottom: 34, left: 8 };
const MIN_BARS = 10;

function fmtDateShort(unix: number, intraday: boolean): string {
  const d = new Date(unix * 1000);
  const M = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  if (intraday) {
    return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  }
  return `${M[d.getMonth()]} ${String(d.getDate()).padStart(2,"0")}`;
}

function fmtDateFull(unix: number, intraday: boolean): string {
  const d = new Date(unix * 1000);
  const M = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const date = `${M[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  if (intraday) return `${date} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  return date;
}

function niceSteps(min: number, max: number, n = 5): number[] {
  const r = max - min; if (r <= 0) return [min];
  const rough = r / n, mag = Math.pow(10, Math.floor(Math.log10(rough)));
  let step = mag; if (rough/mag > 5) step = mag*5; else if (rough/mag > 2) step = mag*2;
  const s: number[] = []; let v = Math.ceil(min/step)*step;
  while (v <= max) { s.push(v); v += step; } return s;
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

export default function StockChart({ data, mode, height, dark = true, intraday = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const mouseRef = useRef<{x:number;y:number}|null>(null);
  const rafRef = useRef(0);
  const [viewRange, setViewRange] = useState<[number,number]|null>(null);
  const dragRef = useRef<{startX:number;origRange:[number,number]}|null>(null);

  const t = dark ? THEMES.dark : THEMES.light;
  const len = data.length;

  useEffect(() => { setViewRange(null); }, [data]);

  const getView = useCallback((): [number, number] => {
    if (!len) return [0, 0];
    if (viewRange) return [clamp(viewRange[0], 0, len-1), clamp(viewRange[1], 0, len-1)];
    return [0, len - 1];
  }, [len, viewRange]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap || !len) return;
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (w <= 0 || h <= 0) return;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext("2d", { alpha: false })!;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = t.bg; ctx.fillRect(0, 0, w, h);
    const pw = w - PAD.left - PAD.right, ph = h - PAD.top - PAD.bottom;
    if (pw <= 0 || ph <= 0) return;
    const [vs, ve] = getView(); const vLen = ve - vs + 1; if (vLen <= 0) return;
    const slice = data.slice(vs, ve + 1);

    let lo = Infinity, hi = -Infinity;
    for (const d of slice) { const dl = mode==="candlestick"?d.low:d.close, dh = mode==="candlestick"?d.high:d.close; if(dl<lo)lo=dl; if(dh>hi)hi=dh; }
    const pr = hi-lo||1, pp = pr*0.1; lo -= pp; hi += pp;
    const toX = (i: number) => PAD.left + (i/(vLen-1||1))*pw;
    const toY = (p: number) => PAD.top + (1-(p-lo)/(hi-lo))*ph;

    // Grid
    ctx.strokeStyle = t.grid; ctx.lineWidth = 1;
    const ps = niceSteps(lo, hi, 5);
    for (const p of ps) { const y = Math.round(toY(p))+0.5; ctx.beginPath(); ctx.moveTo(PAD.left,y); ctx.lineTo(w-PAD.right,y); ctx.stroke(); }
    const xn = Math.max(1,Math.floor(pw/90)), xs = Math.max(1,Math.floor(vLen/xn));
    for (let i=0;i<vLen;i+=xs) { const x=Math.round(toX(i))+0.5; ctx.beginPath(); ctx.moveTo(x,PAD.top); ctx.lineTo(x,h-PAD.bottom); ctx.stroke(); }

    // Data
    if (mode==="candlestick") {
      const cw = Math.max(1,(pw/vLen)*0.6);
      for (let i=0;i<vLen;i++) {
        const d=slice[i],x=toX(i),up=d.close>=d.open;
        ctx.strokeStyle=up?t.up:t.down; ctx.fillStyle=up?t.up:t.down; ctx.lineWidth=1;
        ctx.beginPath(); ctx.moveTo(x,toY(d.high)); ctx.lineTo(x,toY(d.low)); ctx.stroke();
        const top=toY(Math.max(d.open,d.close)),bot=toY(Math.min(d.open,d.close)),bh=Math.max(1,bot-top);
        up ? ctx.strokeRect(x-cw/2,top,cw,bh) : ctx.fillRect(x-cw/2,top,cw,bh);
      }
    } else {
      ctx.beginPath();
      for (let i=0;i<vLen;i++) { const x=toX(i),y=toY(slice[i].close); i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); }
      ctx.strokeStyle=t.line; ctx.lineWidth=2; ctx.stroke();
      const grad=ctx.createLinearGradient(0,PAD.top,0,h-PAD.bottom);
      grad.addColorStop(0,dark?"rgba(255,80,0,0.15)":"rgba(255,80,0,0.1)"); grad.addColorStop(1,"rgba(255,80,0,0)");
      ctx.lineTo(toX(vLen-1),h-PAD.bottom); ctx.lineTo(toX(0),h-PAD.bottom); ctx.closePath(); ctx.fillStyle=grad; ctx.fill();
    }

    // Current price label
    const lp=slice[vLen-1].close,ly=toY(lp);
    ctx.setLineDash([3,3]); ctx.strokeStyle=t.priceLine; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(PAD.left,ly); ctx.lineTo(w-PAD.right,ly); ctx.stroke(); ctx.setLineDash([]);
    const pt=lp.toFixed(2); ctx.font=FONT_BOLD; const plw=ctx.measureText(pt).width+12;
    ctx.fillStyle=t.priceLabel; ctx.fillRect(w-PAD.right,ly-10,plw,20);
    ctx.fillStyle=t.priceLabelText; ctx.textAlign="left"; ctx.textBaseline="middle"; ctx.fillText(pt,w-PAD.right+6,ly);

    // Y labels
    ctx.fillStyle=t.text; ctx.font=FONT_SM; ctx.textAlign="left"; ctx.textBaseline="middle";
    for (const p of ps) { const y=toY(p); if(Math.abs(y-ly)<16)continue; if(y>PAD.top+5&&y<h-PAD.bottom-5) ctx.fillText(p.toFixed(2),w-PAD.right+6,y); }

    // X labels
    ctx.textBaseline="top"; ctx.fillStyle=t.text; ctx.font=FONT_SM;
    for (let i=0;i<vLen;i+=xs) {
      const lx = toX(i);
      ctx.textAlign = i === 0 ? "left" : "center";
      ctx.fillText(fmtDateShort(slice[i].date, intraday), i === 0 ? Math.max(2, lx - 4) : lx, h-PAD.bottom+8);
    }

    // Crosshair
    const m=mouseRef.current;
    if (m && m.x>=PAD.left && m.x<=w-PAD.right && m.y>=PAD.top && m.y<=h-PAD.bottom) {
      const idx=Math.round(((m.x-PAD.left)/pw)*(vLen-1));
      const di=clamp(idx,0,vLen-1),dp=slice[di],sx=toX(di),sy=toY(dp.close);
      ctx.setLineDash([4,3]); ctx.strokeStyle=t.crosshair; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(sx,PAD.top); ctx.lineTo(sx,h-PAD.bottom); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(PAD.left,sy); ctx.lineTo(w-PAD.right,sy); ctx.stroke(); ctx.setLineDash([]);

      const pTxt=dp.close.toFixed(2); ctx.font=FONT_SM; const tw2=ctx.measureText(pTxt).width+10;
      ctx.fillStyle=t.tooltip; ctx.fillRect(w-PAD.right,sy-10,tw2+4,20);
      ctx.fillStyle=t.tooltipText; ctx.textAlign="left"; ctx.textBaseline="middle"; ctx.fillText(pTxt,w-PAD.right+5,sy);

      const dtTxt=fmtDateFull(dp.date, intraday); ctx.font=FONT_SM; const dtw2=ctx.measureText(dtTxt).width+10;
      ctx.fillStyle=t.tooltip; ctx.fillRect(sx-dtw2/2,h-PAD.bottom,dtw2,20);
      ctx.fillStyle=t.tooltipText; ctx.textAlign="center"; ctx.textBaseline="top"; ctx.fillText(dtTxt,sx,h-PAD.bottom+4);

      if (mode==="candlestick") { ctx.fillStyle=t.text; ctx.font=FONT_SM; ctx.textAlign="left"; ctx.textBaseline="top"; ctx.fillText(`O ${dp.open.toFixed(2)}  H ${dp.high.toFixed(2)}  L ${dp.low.toFixed(2)}  C ${dp.close.toFixed(2)}`,PAD.left+4,PAD.top+2); }
    }
  }, [data,mode,dark,t,getView,len,intraday]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => { const w=wrapRef.current; if(!w)return; const ro=new ResizeObserver(()=>{ cancelAnimationFrame(rafRef.current); rafRef.current=requestAnimationFrame(draw); }); ro.observe(w); return ()=>ro.disconnect(); }, [draw]);

  const onMove = useCallback((e: React.MouseEvent) => {
    const r=wrapRef.current?.getBoundingClientRect(); if(!r)return;
    mouseRef.current = {x:e.clientX-r.left,y:e.clientY-r.top};
    const drag=dragRef.current;
    if(drag&&len>1) {
      const pw2=(wrapRef.current?.clientWidth??1)-PAD.left-PAD.right;
      const vl=drag.origRange[1]-drag.origRange[0];
      const shift=Math.round(-((e.clientX-drag.startX)/pw2)*vl);
      let ns=drag.origRange[0]+shift,ne=drag.origRange[1]+shift;
      if(ns<0){ne-=ns;ns=0;} if(ne>=len){ns-=(ne-len+1);ne=len-1;}
      setViewRange([Math.max(0,ns),Math.min(len-1,ne)]);
    }
    cancelAnimationFrame(rafRef.current); rafRef.current=requestAnimationFrame(draw);
  }, [draw,len]);

  const onLeave = useCallback(()=>{ mouseRef.current=null; dragRef.current=null; cancelAnimationFrame(rafRef.current); rafRef.current=requestAnimationFrame(draw); },[draw]);
  const onDown = useCallback((e:React.MouseEvent)=>{ const[vs2,ve2]=getView(); dragRef.current={startX:e.clientX,origRange:[vs2,ve2]}; },[getView]);
  const onUp = useCallback(()=>{ dragRef.current=null; },[]);

  useEffect(() => {
    const canvas=canvasRef.current; if(!canvas)return;
    const handler=(e:WheelEvent)=>{
      e.preventDefault(); e.stopPropagation();
      if(len<2)return;
      const[vs2,ve2]=getView(); const vLen=ve2-vs2;
      const rect=canvas.getBoundingClientRect(); const mx=e.clientX-rect.left;
      const ratio=clamp((mx-PAD.left)/(rect.width-PAD.left-PAD.right),0,1);
      const zoomAmt=Math.sign(e.deltaY)*Math.max(1,Math.round(vLen*0.15));
      const shrinkL=Math.round(zoomAmt*ratio),shrinkR=zoomAmt-shrinkL;
      let ns=vs2+shrinkL,ne=ve2-shrinkR;
      if(ne-ns<MIN_BARS){const mid=Math.round(vs2+vLen*ratio);ns=mid-Math.floor(MIN_BARS/2);ne=mid+Math.ceil(MIN_BARS/2);}
      setViewRange([clamp(ns,0,len-1),clamp(ne,0,len-1)]);
    };
    canvas.addEventListener("wheel",handler,{passive:false});
    return()=>canvas.removeEventListener("wheel",handler);
  }, [getView,len]);

  return (
    <div ref={wrapRef} style={{width:"100%",height:height??"100%",minHeight:60,position:"relative"}}>
      <canvas ref={canvasRef} style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",cursor:"crosshair",imageRendering:"auto"}}
        onMouseMove={onMove} onMouseLeave={onLeave} onMouseDown={onDown} onMouseUp={onUp} />
    </div>
  );
}
