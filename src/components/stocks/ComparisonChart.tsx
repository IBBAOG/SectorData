"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { HistoricalDataPoint } from "../../types/stocks";

const COLORS = ["#2962FF","#FF6D00","#00C853","#AA00FF","#FF1744"];
interface SeriesInput { ticker: string; data: HistoricalDataPoint[]; color?: string; }
interface Props { series: SeriesInput[]; height?: number; mode: "percent"|"base100"; baseDate?: string; endDate?: string; dark?: boolean; }

const THEMES = {
  dark: { bg:"#030814",grid:"#161d33",text:"#ffffff",border:"#1f2747",crosshair:"#4a5578",tooltip:"#0a1124",tooltipText:"#ffffff" },
  light: { bg:"#ffffff",grid:"#f0f0f0",text:"#1a1a1a",border:"#e0e0e0",crosshair:"#9ca3af",tooltip:"#1f2937",tooltipText:"#ffffff" },
};
const FONT_SM = "11px Arial, Helvetica, sans-serif";
const FONT_BOLD = "bold 11px Arial, Helvetica, sans-serif";
const PAD = {top:14,right:72,bottom:34,left:48};
const MIN_BARS = 10;

function fmtDate(unix:number,short=false):string { const d=new Date(unix*1000); const M=["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"]; return short?`${M[d.getMonth()]} ${String(d.getDate()).padStart(2,"0")}`:`${M[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; }
function niceSteps(min:number,max:number,n=5):number[] { const r=max-min; if(r<=0)return[min]; const rough=r/n,mag=Math.pow(10,Math.floor(Math.log10(rough))); let step=mag; if(rough/mag>5)step=mag*5; else if(rough/mag>2)step=mag*2; const s:number[]=[]; let v=Math.ceil(min/step)*step; while(v<=max){s.push(v);v+=step;} return s; }
function clamp(v:number,lo:number,hi:number){return Math.max(lo,Math.min(hi,v));}
function toUnix(s:string):number{return Math.floor(new Date(s).getTime()/1000);}
function resolveOverlaps(ys:number[],boxH:number,minY:number,maxY:number):number[]{
  if(ys.length<=1)return[...ys];
  const items=ys.map((y,i)=>({y,i})).sort((a,b)=>a.y-b.y);
  for(let i=1;i<items.length;i++){if(items[i].y<items[i-1].y+boxH)items[i].y=items[i-1].y+boxH;}
  if(items[items.length-1].y>maxY-boxH/2)items[items.length-1].y=maxY-boxH/2;
  for(let i=items.length-2;i>=0;i--){if(items[i].y>items[i+1].y-boxH)items[i].y=items[i+1].y-boxH;}
  if(items[0].y<minY+boxH/2)items[0].y=minY+boxH/2;
  const res=new Array<number>(ys.length);for(const{y,i}of items)res[i]=y;return res;
}

interface NSeries { ticker:string; color:string; values:{date:number;day:number;value:number}[] }

// Bucket a unix-seconds timestamp into a UTC calendar-day key (unix-seconds
// for 00:00:00 UTC of that day). Tickers from different markets quote close
// prices with different intraday timestamps (PETR4.SA → ~13:00 UTC market
// close, BZ=F → ~01:00 UTC ICE settlement). Without bucketing, every
// PETR4 bar sits on its own unified-axis index and every BZ=F bar sits on
// a different one — each series ends up with values on only half the
// indices, so the line drawing loop lifts the pen between every pair of
// points and the chart renders as isolated dots, not a continuous line.
// Bucketing collapses both quotes for the same calendar day onto a single
// shared index so the lines connect.
function toDayKey(unix:number):number{
  return Math.floor(unix/86400)*86400;
}

export default function ComparisonChart({series,height,mode,baseDate,endDate,dark=true}:Props) {
  const canvasRef=useRef<HTMLCanvasElement>(null);
  const wrapRef=useRef<HTMLDivElement>(null);
  const mouseRef=useRef<{x:number;y:number}|null>(null);
  const rafRef=useRef(0);
  const [viewRange,setViewRange]=useState<[number,number]|null>(null);
  const dragRef=useRef<{startX:number;origRange:[number,number]}|null>(null);
  const t=dark?THEMES.dark:THEMES.light;

  const normalized:NSeries[]=series.map((s,i)=>{
    let f=s.data;
    const st=baseDate?toUnix(baseDate):0,en=endDate?toUnix(endDate):Infinity;
    if(baseDate||endDate){f=f.filter(d=>d.date>=st&&d.date<=en);}
    if(!f.length)return{ticker:s.ticker,color:s.color??COLORS[i%COLORS.length],values:[]};
    const bv=f[0].close;
    if(!bv||!isFinite(bv))return{ticker:s.ticker,color:s.color??COLORS[i%COLORS.length],values:[]};
    // Guard against Yahoo Finance unadjusted history returning an
    // implausible base price (e.g. UGPA3.SA at range=max returns a 2006
    // close of 6,068,052 due to pre-split data). The resulting baseline
    // would normalize the current price to ~-100% and render as a flat
    // line at the chart bottom. Detect via base/last ratio and skip.
    const lastClose=f[f.length-1].close;
    if(lastClose>0&&isFinite(lastClose)){
      const ratio=bv/lastClose;
      if(ratio>100||ratio<0.01)return{ticker:s.ticker,color:s.color??COLORS[i%COLORS.length],values:[]};
    }
    return{ticker:s.ticker,color:s.color??COLORS[i%COLORS.length],values:f.map(d=>({date:d.date,day:toDayKey(d.date),value:mode==="percent"?((d.close-bv)/bv)*100:(d.close/bv)*100}))};
  });
  const active=normalized.filter(s=>s.values.length>0);
  const skipped=normalized.filter(s=>s.values.length===0&&series.some(o=>o.ticker===s.ticker&&o.data.length>0)).map(s=>s.ticker);
  // Build a unified, sorted, deduplicated CALENDAR-DAY axis from the UNION
  // of all active series. We bucket each sample's intraday timestamp into
  // a day key (UTC 00:00) so PETR4 (closes ~13 UTC) and BZ=F (settles ~01
  // UTC) on the same calendar day share the same axis position.
  // Previously the unified set used raw timestamps, which never overlapped
  // across markets — every other index was undefined for a given series
  // and the line drawing loop lifted the pen on every step, rendering the
  // chart as isolated dots.
  const daySet=new Set<number>(); for(const s of active)for(const v of s.values)daySet.add(v.day);
  const allDates:number[]=Array.from(daySet).sort((a,b)=>a-b);
  const totalLen=allDates.length;
  // Map each ticker's values to a dense lookup keyed by the unified day
  // index. If a series has multiple samples on the same day (e.g. the
  // appended live-quote point from useStockQuote), keep the LAST one — it
  // represents the most recent close / live price for that day.
  const dayIndexById=new Map<number,number>(); for(let i=0;i<allDates.length;i++)dayIndexById.set(allDates[i],i);
  const seriesByIndex:(number|undefined)[][]=active.map(s=>{
    const arr=new Array<number|undefined>(totalLen);
    for(const v of s.values){const idx=dayIndexById.get(v.day);if(idx!==undefined)arr[idx]=v.value;}
    return arr;
  });

  useEffect(()=>{setViewRange(null);},[series,mode,baseDate,endDate]);

  const getView=useCallback(():[number,number]=>{
    if(!totalLen)return[0,0];
    if(viewRange)return[clamp(viewRange[0],0,totalLen-1),clamp(viewRange[1],0,totalLen-1)];
    return[0,totalLen-1];
  },[totalLen,viewRange]);

  const draw=useCallback(()=>{
    const canvas=canvasRef.current,wrap=wrapRef.current;
    if(!canvas||!wrap)return;
    const dpr=window.devicePixelRatio||1;
    const w=Math.floor(wrap.clientWidth),h=Math.floor(wrap.clientHeight);
    if(w<=0||h<=0)return;
    canvas.width=Math.floor(w*dpr);canvas.height=Math.floor(h*dpr);
    canvas.style.width=w+"px";canvas.style.height=h+"px";
    const ctx=canvas.getContext("2d",{alpha:false})!;ctx.scale(dpr,dpr);
    ctx.fillStyle=t.bg;ctx.fillRect(0,0,w,h);
    const pw=w-PAD.left-PAD.right,ph=h-PAD.top-PAD.bottom;
    if(pw<=0||ph<=0||!active.length||!totalLen)return;
    const[vs,ve]=getView();const vLen=ve-vs+1;if(vLen<=0)return;
    const viewDates=allDates.slice(vs,ve+1);

    let minV=Infinity,maxV=-Infinity;
    for(const arr of seriesByIndex){for(let i=vs;i<=ve;i++){const v=arr[i];if(v!==undefined&&isFinite(v)){if(v<minV)minV=v;if(v>maxV)maxV=v;}}}
    if(!isFinite(minV)||!isFinite(maxV))return;
    const vr=maxV-minV||1,vp=vr*0.1;minV-=vp;maxV+=vp;
    const toX=(i:number)=>PAD.left+(i/(vLen-1||1))*pw;
    const toY=(val:number)=>PAD.top+(1-(val-minV)/(maxV-minV))*ph;

    // Grid
    ctx.strokeStyle=t.grid;ctx.lineWidth=1;
    const valSteps=niceSteps(minV,maxV,5);
    for(const v of valSteps){const y=Math.round(toY(v))+0.5;ctx.beginPath();ctx.moveTo(PAD.left,y);ctx.lineTo(w-PAD.right,y);ctx.stroke();}
    const xn=Math.max(1,Math.floor(pw/90)),xs=Math.max(1,Math.floor(vLen/xn));
    for(let i=0;i<vLen;i+=xs){const x=Math.round(toX(i))+0.5;ctx.beginPath();ctx.moveTo(x,PAD.top);ctx.lineTo(x,h-PAD.bottom);ctx.stroke();}

    // Zero line
    if(mode==="percent"&&minV<0&&maxV>0){ctx.strokeStyle=t.border;ctx.lineWidth=1;ctx.setLineDash([4,3]);ctx.beginPath();ctx.moveTo(PAD.left,Math.round(toY(0))+0.5);ctx.lineTo(w-PAD.right,Math.round(toY(0))+0.5);ctx.stroke();ctx.setLineDash([]);}

    // Lines — iterate through the unified time axis. To avoid visual gaps
    // on cross-market holidays (e.g. BZ=F has no settlement on a UK/US
    // holiday but B3 traded that day, or vice versa), forward-fill the
    // last known value within the drawing loop only. This is financially
    // correct from a BR-investor perspective: when ICE is closed, BZ=F's
    // "current" value is the prior settlement (the market literally did
    // not move), so a horizontal segment is the truthful representation.
    // The underlying `seriesByIndex` stays sparse so tooltip + end-of-line
    // value badge keep showing real datapoints only (no fake values).
    // We still lift the pen at the LEADING edge — i.e. before a series
    // has its first sample (so a ticker that starts mid-range doesn't get
    // a horizontal line dragged back to the y-axis).
    for(let si=0;si<active.length;si++){
      const s=active[si],arr=seriesByIndex[si];
      ctx.beginPath();ctx.strokeStyle=s.color;ctx.lineWidth=2;
      let drawing=false;
      let lastVal:number|undefined=undefined;
      for(let vi=0;vi<vLen;vi++){
        const gi=vs+vi,val=arr[gi];
        const eff=val!==undefined?val:lastVal;
        if(eff===undefined){continue;} // still before this series' first sample
        const x=toX(vi),y=toY(eff);
        if(!drawing){ctx.moveTo(x,y);drawing=true;}else{ctx.lineTo(x,y);}
        if(val!==undefined)lastVal=val;
      }
      ctx.stroke();
    }

    // Current value labels — stacked to avoid overlap.
    // Use the last defined value within the visible window (skip undefined
    // gaps at the tail) so the badge always reflects a real datapoint.
    const suffix=mode==="percent"?"%":"";
    const LH=20;
    ctx.font=FONT_BOLD;
    const lblData=active.map((s,si)=>{
      const arr=seriesByIndex[si];
      let li=-1,lv=NaN;
      for(let i=ve;i>=vs;i--){const v=arr[i];if(v!==undefined&&isFinite(v)){li=i;lv=v;break;}}
      if(li<0)return null;
      const ly=toY(lv),lt=lv.toFixed(1)+suffix,lw=ctx.measureText(lt).width+12;
      return{s,ly,lt,lw};
    }).filter((x):x is NonNullable<typeof x>=>x!==null);
    const adjYs=resolveOverlaps(lblData.map(l=>l.ly),LH,PAD.top,h-PAD.bottom);
    for(let i=0;i<lblData.length;i++){const{s,ly,lt,lw}=lblData[i];const ay=adjYs[i];ctx.setLineDash([2,2]);ctx.strokeStyle=s.color;ctx.lineWidth=0.5;ctx.beginPath();ctx.moveTo(PAD.left,ly);ctx.lineTo(w-PAD.right,ly);ctx.stroke();if(Math.abs(ay-ly)>1){ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(w-PAD.right,ly);ctx.lineTo(w-PAD.right,ay);ctx.stroke();}ctx.setLineDash([]);ctx.fillStyle=s.color;ctx.fillRect(w-PAD.right,ay-LH/2,lw,LH);ctx.fillStyle="#fff";ctx.textAlign="left";ctx.textBaseline="middle";ctx.fillText(lt,w-PAD.right+6,ay);}

    // Y labels — skip positions near dashed lines or stacked label boxes
    ctx.fillStyle=t.text;ctx.font=FONT_SM;ctx.textAlign="left";ctx.textBaseline="middle";
    for(const v of valSteps){const y=toY(v);const ov=lblData.some((l,i)=>Math.abs(y-l.ly)<12||Math.abs(y-adjYs[i])<12);if(ov)continue;if(y>PAD.top+5&&y<h-PAD.bottom-5)ctx.fillText(v.toFixed(1)+suffix,w-PAD.right+6,y);}

    // X labels
    ctx.textBaseline="top";ctx.fillStyle=t.text;ctx.font=FONT_SM;
    ctx.textAlign="center";for(let i=0;i<vLen;i+=xs){ctx.fillText(fmtDate(viewDates[i],true),toX(i),h-PAD.bottom+8);}

    // Crosshair
    const m=mouseRef.current;
    if(m&&m.x>=PAD.left&&m.x<=w-PAD.right&&m.y>=PAD.top&&m.y<=h-PAD.bottom){
      const idx=Math.round(((m.x-PAD.left)/pw)*(vLen-1));const di=clamp(idx,0,vLen-1);const sx=toX(di),sDate=viewDates[di];
      ctx.setLineDash([4,3]);ctx.strokeStyle=t.crosshair;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(sx,PAD.top);ctx.lineTo(sx,h-PAD.bottom);ctx.stroke();ctx.setLineDash([]);
      const dtTxt=fmtDate(sDate),dtw2=ctx.measureText(dtTxt).width+8;ctx.fillStyle=t.tooltip;ctx.fillRect(sx-dtw2/2,h-PAD.bottom,dtw2,18);ctx.fillStyle=t.tooltipText;ctx.font=FONT_SM;ctx.textAlign="center";ctx.textBaseline="top";ctx.fillText(dtTxt,sx,h-PAD.bottom+4);
      ctx.textAlign="left";ctx.textBaseline="top";let ty=PAD.top+2;
      for(let si=0;si<active.length;si++){
        const s=active[si],val=seriesByIndex[si][vs+di];
        if(val===undefined||!isFinite(val))continue;
        ctx.fillStyle=s.color;ctx.fillRect(PAD.left+4,ty+1,8,8);
        ctx.fillStyle=t.text;ctx.font=FONT_SM;
        ctx.fillText(`${s.ticker}: ${val.toFixed(2)}${suffix}`,PAD.left+16,ty);
        ty+=14;
      }
    }
  },[active,seriesByIndex,allDates,totalLen,mode,dark,t,getView]);

  useEffect(()=>{draw();},[draw]);
  useEffect(()=>{const w=wrapRef.current;if(!w)return;const ro=new ResizeObserver(()=>{cancelAnimationFrame(rafRef.current);rafRef.current=requestAnimationFrame(draw);});ro.observe(w);return()=>ro.disconnect();},[draw]);

  const onMove=useCallback((e:React.MouseEvent)=>{
    const r=wrapRef.current?.getBoundingClientRect();if(!r)return;
    mouseRef.current={x:e.clientX-r.left,y:e.clientY-r.top};
    const drag=dragRef.current;
    if(drag&&totalLen>1){const pw2=(wrapRef.current?.clientWidth??1)-PAD.left-PAD.right;const vl=drag.origRange[1]-drag.origRange[0];const shift=Math.round(-((e.clientX-drag.startX)/pw2)*vl);let ns=drag.origRange[0]+shift,ne=drag.origRange[1]+shift;if(ns<0){ne-=ns;ns=0;}if(ne>=totalLen){ns-=(ne-totalLen+1);ne=totalLen-1;}setViewRange([Math.max(0,ns),Math.min(totalLen-1,ne)]);}
    cancelAnimationFrame(rafRef.current);rafRef.current=requestAnimationFrame(draw);
  },[draw,totalLen]);

  const onLeave=useCallback(()=>{mouseRef.current=null;dragRef.current=null;cancelAnimationFrame(rafRef.current);rafRef.current=requestAnimationFrame(draw);},[draw]);
  const onDown=useCallback((e:React.MouseEvent)=>{const[vs2,ve2]=getView();dragRef.current={startX:e.clientX,origRange:[vs2,ve2]};},[getView]);
  const onUp=useCallback(()=>{dragRef.current=null;},[]);

  // Native wheel zoom with passive:false
  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const handler=(e:WheelEvent)=>{
      e.preventDefault();e.stopPropagation();
      if(totalLen<2)return;
      const[vs2,ve2]=getView();const vLen=ve2-vs2;
      const rect=canvas.getBoundingClientRect();const mx=e.clientX-rect.left;
      const ratio=clamp((mx-PAD.left)/(rect.width-PAD.left-PAD.right),0,1);
      const zoomAmt=Math.sign(e.deltaY)*Math.max(1,Math.round(vLen*0.15));
      const shrinkL=Math.round(zoomAmt*ratio),shrinkR=zoomAmt-shrinkL;
      let ns=vs2+shrinkL,ne=ve2-shrinkR;
      if(ne-ns<MIN_BARS){const mid=Math.round(vs2+vLen*ratio);ns=mid-Math.floor(MIN_BARS/2);ne=mid+Math.ceil(MIN_BARS/2);}
      setViewRange([clamp(ns,0,totalLen-1),clamp(ne,0,totalLen-1)]);
    };
    canvas.addEventListener("wheel",handler,{passive:false});
    return()=>canvas.removeEventListener("wheel",handler);
  },[getView,totalLen]);

  const mutedColor=dark?"#8b949e":"#888";
  const warnColor=dark?"#ffb04a":"#b86b00";
  const skippedSet=new Set(skipped);
  return(
    <div style={{display:"flex",flexDirection:"column",height:height??"100%",minHeight:60}}>
      <div ref={wrapRef} style={{flex:1,minHeight:0,position:"relative"}}>
        <canvas ref={canvasRef} style={{position:"absolute",top:0,left:0,cursor:"crosshair"}}
          onMouseMove={onMove} onMouseLeave={onLeave} onMouseDown={onDown} onMouseUp={onUp} />
        {!active.length&&series.length>0&&(
          <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none",fontSize:11,color:mutedColor,textAlign:"center",padding:8}}>
            No comparable price data in the selected range.
          </div>
        )}
      </div>
      <div style={{display:"flex",gap:12,padding:"4px 0",flexWrap:"wrap",flexShrink:0}}>
        {series.map((s,i)=>{
          const isSkipped=skippedSet.has(s.ticker);
          return(
            <span key={s.ticker} title={isSkipped?`${s.ticker}: no comparable data in the selected range`:undefined} style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:isSkipped?warnColor:mutedColor,opacity:isSkipped?0.85:1}}>
              <span style={{width:10,height:10,borderRadius:2,backgroundColor:s.color??COLORS[i%COLORS.length],display:"inline-block",opacity:isSkipped?0.4:1}} />
              {s.ticker}{isSkipped?" (no data)":""}
            </span>
          );
        })}
      </div>
    </div>
  );
}
