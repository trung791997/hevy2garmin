"use client";

import { useMemo, useState } from "react";

interface Point { time: number; hr: number }
export function elapsed(seconds: number): string {
  const value = Math.max(0, Math.round(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

/** Break the stroke at missing periods instead of drawing invented readings. */
export function traceSegments(points: Point[], medianIntervalS: number | null): Point[][] {
  const gap = Math.max(10, Math.min(180, (medianIntervalS ?? 10) * 3));
  const segments: Point[][] = [];
  for (const point of points) {
    if (!segments.length || point.time - segments.at(-1)!.at(-1)!.time > gap) segments.push([]);
    segments.at(-1)!.push(point);
  }
  return segments;
}

export function HrTrace({ points, durationS, medianIntervalS, compact = false }: {
  points: Point[]; durationS: number | null; medianIntervalS: number | null; compact?: boolean;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const plot = useMemo(() => {
    const min = points.reduce((n, p) => Math.min(n, p.hr), Infinity);
    const max = points.reduce((n, p) => Math.max(n, p.hr), -Infinity);
    const duration = Math.max(1, durationS ?? points.at(-1)?.time ?? 1);
    const x = (p: Point) => 8 + p.time / duration * 584;
    const y = (p: Point) => 140 - (p.hr - (min - 5)) / Math.max(10, max - min + 10) * 120;
    return { min, max, duration, x, y, segments: traceSegments(points, medianIntervalS).map(part => ({ points: part.map(p => `${x(p)},${y(p)}`).join(" "), first: part[0], single: part.length === 1 })) };
  }, [points, durationS, medianIntervalS]);
  const index = Math.min(Math.max(0, selected ?? 0), points.length - 1);
  const point = points[index];
  if (!point) return <div className="trace-empty"><span>No timed readings yet</span><p>Your recording will appear here after HR is available.</p></div>;
  return (
    <div className={compact ? "hr-trace hr-trace-compact" : "hr-trace"}>
      {!compact && <div className="trace-reading" aria-live="off"><span>{selected === null ? "Explore your recording" : `${elapsed(point.time)} into your workout`}</span><strong>{selected === null ? `${plot.min}–${plot.max}` : point.hr}<small> bpm</small></strong></div>}
      <svg viewBox="0 0 600 160" preserveAspectRatio="none" role="img" aria-label="Heart rate over elapsed workout time. Breaks indicate missing readings."
        onPointerMove={compact ? undefined : (event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const target = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * plot.duration;
          let low = 0, high = points.length - 1;
          while (low < high) { const middle = Math.floor((low + high) / 2); if (points[middle].time < target) low = middle + 1; else high = middle; }
          setSelected(low > 0 && Math.abs(points[low - 1].time - target) < Math.abs(points[low].time - target) ? low - 1 : low);
        }}>
        {!compact && [35, 85, 135].map(y => <line key={y} x1="8" x2="592" y1={y} y2={y} className="trace-grid" />)}
        {plot.segments.map((segment, i) => segment.single
          ? <circle key={i} cx={plot.x(segment.first)} cy={plot.y(segment.first)} r="2.5" className="trace-dot" />
          : <polyline key={i} points={segment.points} className="trace-line" vectorEffect="non-scaling-stroke" />)}
        {!compact && selected !== null && <g><line x1={plot.x(point)} x2={plot.x(point)} y1="12" y2="145" className="trace-cursor" /><circle cx={plot.x(point)} cy={plot.y(point)} r="4" className="trace-selected" /></g>}
      </svg>
      {!compact && <><div className="trace-axis"><span>0:00</span><span>{elapsed(plot.duration)} elapsed</span></div><label className="trace-slider">Inspect HR reading<span className="sr-only"> at {elapsed(point.time)}, {point.hr} beats per minute</span><input type="range" min="0" max={points.length - 1} value={index} onChange={event => setSelected(Number(event.target.value))} aria-label="Inspect heart-rate recording" aria-valuetext={`${elapsed(point.time)} elapsed, ${point.hr} beats per minute`} /></label></>}
    </div>
  );
}
