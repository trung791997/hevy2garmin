"use client";

import { useId } from "react";
import { comparisonMetrics, previousSession, type TrainingSession } from "@/lib/session-analysis";
import type { WeightUnit } from "@/lib/weight-units";

export function sessionDate(iso: string, timeZone: string, long = false) {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric", ...(long ? { hour: "numeric", minute: "2-digit" } : {}) }).format(new Date(iso));
}
export const metricNumber = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);

export function SessionComparison({ current, sessions, unit, timeZone, hasMore }: {
  current: TrainingSession; sessions: TrainingSession[]; unit: WeightUnit; timeZone: string; hasMore: boolean;
}) {
  const titleId = useId();
  const previous = previousSession(current, sessions);
  const metrics = comparisonMetrics(current, previous, unit);
  const lineupKnown = !!current.exerciseKey && !!previous?.exerciseKey;
  const lineupChanged = lineupKnown && current.exerciseKey !== previous?.exerciseKey;
  return <section className="session-comparison" aria-labelledby={titleId}>
    <div className="insight-heading"><div><span className="eyebrow">SESSION COMPARISON</span><h3 id={titleId}>{previous ? "You vs. last time" : "Your starting point"}</h3></div><span className="comparison-emblem" aria-hidden="true">↗</span></div>
    <p className="comparison-session-name">{current.title}</p>
    <p className="comparison-baseline">{sessionDate(current.startedAt, timeZone)}{previous ? ` vs. ${sessionDate(previous.startedAt, timeZone)}` : " · No earlier matching session loaded"}</p>
    {previous && (lineupChanged || !lineupKnown) && <p className="comparison-lineup-note">{lineupChanged ? "Exercise lineup changed. Total volume includes different exercises." : "Exercise lineup could not be verified for both sessions."}</p>}
    <div className="comparison-metrics" key={`${current.id}:${previous?.id ?? "none"}`}>
      {metrics.map(metric => <div className={`comparison-metric metric-${metric.id}`} key={metric.id}>
        <span className="comparison-label">{metric.label}</span>
        <strong>{metric.current === null ? "—" : metricNumber(metric.current)}<small> {metric.unit}</small></strong>
        {previous ? <><span className="comparison-before">Previous {metric.previous === null ? "unavailable" : `${metricNumber(metric.previous)} ${metric.unit}`}</span><span className="comparison-delta">{metric.delta === null ? "Change unavailable" : Math.abs(metric.delta) < .5 ? "About the same" : `${metric.delta > 0 ? "+" : "−"}${metricNumber(Math.abs(metric.delta))} ${metric.unit}${metric.percent === null ? "" : ` (${metric.percent > 0 ? "+" : ""}${metricNumber(metric.percent)}%)`}`}</span>
          <div className="comparison-bars" aria-hidden="true"><span style={{ width: `${metric.previous === null ? 0 : Math.max(2, metric.previous / Math.max(metric.current ?? 0, metric.previous, 1) * 100)}%` }} /><span style={{ width: `${metric.current === null ? 0 : Math.max(2, metric.current / Math.max(metric.current, metric.previous ?? 0, 1) * 100)}%` }} /></div></> : <span className="comparison-before">No baseline yet</span>}
      </div>)}
    </div>
    <p className="comparison-caveat">{previous ? `Matched by workout name.${lineupKnown && !lineupChanged ? " Same exercise lineup." : ""} ` : `A baseline needs an earlier workout with the same name.${hasMore ? " Load older sessions to look further back." : ""} `}Volume is logged weight × reps, including warm-ups. Average HR uses saved sync data. HR and duration changes aren’t performance scores.</p>
  </section>;
}
