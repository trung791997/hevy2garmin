"use client";

import { useEffect, useState } from "react";
import type { FeaturedWorkout, ReceiptStep } from "@/lib/dashboard-workout";
import { withBasePath } from "@/lib/base-path";
import { weightFromKg } from "@/lib/weight-units";
import { elapsed, HrTrace } from "./hr-trace";

const integer = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
function duration(seconds: number | null): string {
  if (seconds === null) return "—";
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes} min`;
}
function workoutDate(value: string | null): string {
  return value ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "Workout date unavailable";
}
function ExternalArrow() {
  return <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M7 4h9v9M16 4 4 16" /></svg>;
}
function StepMark({ status }: { status: ReceiptStep["status"] }) {
  return <span className={`receipt-mark receipt-${status}`}><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">{status === "done" ? <path d="m5 10 3.2 3.2L15 6.5" /> : status === "pending" ? <><path d="M10 5v5l3 2" /><circle cx="10" cy="10" r="6.5" /></> : <path d="M6 10h8" />}</svg></span>;
}

export function WorkoutSpotlight({ refreshKey = "", initialData }: { refreshKey?: string; initialData?: FeaturedWorkout | null }) {
  const [workout, setWorkout] = useState<FeaturedWorkout | null>(initialData ?? null);
  const [loading, setLoading] = useState(initialData === undefined);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticePending, setNoticePending] = useState(false);

  async function read(signal?: AbortSignal) {
    const response = await fetch(withBasePath("/api/dashboard/workout"), { signal, cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Your latest workout could not be loaded.");
    return body.workout as FeaturedWorkout | null;
  }
  useEffect(() => {
    if (initialData !== undefined) return;
    const controller = new AbortController();
    read(controller.signal).then(data => {
      if (controller.signal.aborted) return;
      setWorkout(data); setError(""); setNotice(""); setNoticePending(false);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Your latest workout could not be loaded.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refreshKey, initialData]);

  async function reload() {
    setLoading(true); setError("");
    try { setWorkout(await read()); } catch (cause) { setError(cause instanceof Error ? cause.message : "Your latest workout could not be loaded."); }
    finally { setLoading(false); }
  }
  async function refreshHr() {
    if (!workout) return;
    setRefreshing(true); setNotice(""); setError("");
    try {
      const response = await fetch(withBasePath(`/api/workout/${encodeURIComponent(workout.id)}/hr`), { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "HR could not be refreshed.");
      setNotice(body.message ?? "Recording refreshed.");
      setNoticePending(body.pending === true);
      setWorkout(await read());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "HR could not be refreshed."); }
    finally { setRefreshing(false); }
  }

  if (loading && !workout) return <section className="workout-feature" aria-label="Latest workout" aria-busy="true"><div className="workout-spotlight spotlight-loading"><p className="eyebrow">YOUR LATEST WORKOUT</p><p>Loading your workout and recording…</p><div className="spotlight-skeleton" /></div><div className="workout-insights" aria-hidden="true"><div className="insight-card insight-loading"><span className="eyebrow">SYNC RECEIPT</span><div className="spotlight-skeleton" /></div><div className="insight-card insight-loading"><span className="eyebrow">HEART-RATE RECORDING</span><div className="spotlight-skeleton" /></div></div></section>;
  if (!workout) return <section className="workout-spotlight spotlight-empty"><span className="eyebrow">YOUR NEXT SESSION</span><h2>{error ? "Workout unavailable" : "Make your next workout count."}</h2><p role={error ? "alert" : undefined}>{error || "Once your first workout syncs, its summary, sync receipt, and heart-rate recording will appear here."}</p>{error && <button type="button" className="quiet-button" onClick={reload}>Try again</button>}</section>;

  const recording = workout.recording;
  const hasPending = workout.receipt.some(step => step.status === "pending");
  const hasUnknown = workout.receipt.some(step => step.status === "unknown");
  const source = recording.source === "watch_recording" ? "Garmin activity recording" : recording.source === "daily_monitoring" ? "Daily monitoring · sparse readings" : recording.source === "backup" ? "Saved recording" : "Source not identified";
  const showReview = !!workout.attention || hasPending || workout.detailsEdited;
  return (
    <section className="workout-feature" aria-label="Latest synced workout">
      <article className="workout-spotlight">
        <div className="spotlight-topline"><span className="eyebrow"><span className="spotlight-emblem" aria-hidden="true">↗</span> LATEST SYNCED WORKOUT</span><span className={`spotlight-status ${showReview ? "status-attention" : ""}`}><span aria-hidden="true" />{showReview ? "Needs attention" : "On Garmin"}</span></div>
        <div className="spotlight-content"><div className="spotlight-identity"><p className="spotlight-date"><time dateTime={workout.startedAt ?? undefined}>{workoutDate(workout.startedAt)}</time></p><h2>{workout.title}</h2><p className="spotlight-description">Hevy → Garmin Connect</p></div><div className="spotlight-preview"><div><span>HEART RATE</span><strong>{workout.avgHr ?? "—"}<small> bpm avg</small></strong></div><HrTrace points={recording.points} durationS={recording.durationS} medianIntervalS={recording.medianIntervalS} compact /></div></div>
        <dl className="spotlight-metrics"><div><dt>Duration</dt><dd>{duration(workout.durationS)}</dd></div><div><dt>Sets</dt><dd>{workout.totalSets ?? "—"}<small>{workout.exercises !== null ? ` / ${workout.exercises} exercises` : ""}</small></dd></div><div><dt>Weight volume</dt><dd>{workout.volumeKg === null ? "—" : integer(weightFromKg(workout.volumeKg, workout.weightUnit))}<small> {workout.weightUnit === "lb" ? "lbs" : "kg"}</small></dd></div></dl>
        <div className="spotlight-footer"><p>{workout.detailsEdited ? "Edited in Hevy since this sync. Review before resyncing." : workout.detailSource === "saved" ? "Workout details saved at the last note update." : workout.detailSource === null ? "Some workout details are unavailable. Your sync history is intact." : "Weight volume uses logged weight × reps."}</p><div><a className="quiet-button" href={withBasePath(`/workouts#workout-${encodeURIComponent(workout.id)}`)}>Workout details</a>{workout.garminActivityId && <a className="accent-link" href={`https://connect.garmin.com/modern/activity/${encodeURIComponent(workout.garminActivityId)}`} target="_blank" rel="noreferrer">Open Garmin <ExternalArrow /></a>}</div></div>
      </article>

      <div className="workout-insights">
        <article className="sync-receipt insight-card" aria-labelledby="receipt-title"><div className="insight-heading"><div><span className="eyebrow">FROM HEVY TO GARMIN</span><h2 id="receipt-title">Sync receipt</h2></div><span className={`insight-badge ${showReview ? "badge-attention" : ""}`}>{showReview ? "Review" : hasUnknown ? "Linked" : "Complete"}</span></div><ol className="receipt-list">{workout.receipt.map(step => <li key={step.id}><details><summary><StepMark status={step.status} /><span>{step.title}<small>{step.status === "done" ? "Confirmed" : step.status === "pending" ? "Waiting" : step.status === "off" ? "Disabled" : "Not recorded"}</small></span><svg className="receipt-chevron" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m7 4 6 6-6 6" /></svg></summary><div className="receipt-detail"><p>{step.detail}</p>{step.id === "note" && step.status === "pending" && <a href="#recording-quality" className="text-link">Review recording & refresh ↓</a>}</div></details></li>)}</ol><p className="receipt-timestamp">Synced {workout.syncedAt ? workoutDate(workout.syncedAt) : "date unavailable"}</p>{workout.attention && <p className="spotlight-attention" role="status">{workout.attention}</p>}</article>

        <article id="recording-quality" className="recording-quality insight-card" aria-labelledby="recording-title"><div className="insight-heading"><div><span className="eyebrow">RECORDING DETAILS</span><h2 id="recording-title">Heart-rate recording</h2></div><span className="recording-heart" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" /></svg></span></div>
          <div className="recording-source"><span className="source-dot" /><span>{source}</span></div>
          <div className="recording-device"><span>EXTERNAL MONITOR{recording.devices.length ? " DETECTED" : ""}</span><strong>{recording.devices.length ? recording.devices.join(" · ") : "Not identified"}</strong></div>
          <dl className="recording-metrics"><div><dt>Coverage</dt><dd>{recording.coveragePct === null ? "—" : `${integer(recording.coveragePct)}%`}</dd></div><div><dt>Readings</dt><dd>{integer(recording.sampleCount)}</dd></div><div><dt>Longest gap</dt><dd>{recording.longestGapS === null ? "—" : elapsed(recording.longestGapS)}</dd></div></dl>
          <HrTrace points={recording.points} durationS={recording.durationS} medianIntervalS={recording.medianIntervalS} />
          {recording.sampleCount > 0 && recording.points.length === 0 && <p className="recording-caveat">Saved readings have no timestamps. Refresh to load a timed chart.</p>}
          <p className="recording-caveat">{recording.devices.length ? "Device metadata confirms a connected monitor. Individual readings may switch between sensors." : "No external monitor is identified in the saved metadata."}</p>
          <div className="recording-footer"><p>{recording.cachedAt ? `Recording saved ${workoutDate(recording.cachedAt)}` : "No cached recording yet"}</p><button type="button" className="quiet-button" disabled={refreshing} onClick={refreshHr}>{refreshing ? "Refreshing…" : "Refresh HR & note"}</button></div><p className="refresh-explanation">Refresh checks Garmin and updates your managed Hevy HR note when enabled.</p>
          {(notice || error) && <p className={error || noticePending ? "spotlight-attention" : "recording-notice"} role={error ? "alert" : "status"}>{error || notice}</p>}
        </article>
      </div>
    </section>
  );
}
