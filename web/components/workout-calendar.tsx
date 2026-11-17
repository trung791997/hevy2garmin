"use client";

import { useEffect, useMemo, useState } from "react";
import { withBasePath } from "@/lib/base-path";
import { monthCells, SESSION_STATUS, shiftMonth, trainingDay, type SessionHistory } from "@/lib/session-analysis";
import { metricNumber, SessionComparison, sessionDate } from "./session-comparison";
import { SessionSheet } from "./session-sheet";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
async function readHistory(page: number, signal?: AbortSignal): Promise<SessionHistory> {
  const response = await fetch(withBasePath(`/api/dashboard/sessions?page=${page}`), { cache: "no-store", signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Workout history could not be loaded.");
  return body;
}

export function WorkoutCalendar({ refreshKey = "", initialData }: { refreshKey?: string; initialData?: SessionHistory }) {
  const [history, setHistory] = useState<SessionHistory | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState("");
  const [monthChoice, setMonthChoice] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [comparisonId, setComparisonId] = useState<string | null>(null);
  const [sheetId, setSheetId] = useState<string | null>(null);
  useEffect(() => {
    if (initialData) return;
    const controller = new AbortController();
    readHistory(1, controller.signal).then(data => { if (!controller.signal.aborted) { setHistory(data); setError(""); } })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Workout history could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [initialData, refreshKey]);

  async function loadMore() {
    setLoading(true); setError("");
    try {
      const page = history?.nextPage ?? 1;
      const data = await readHistory(page);
      setHistory(previous => {
        const sessions = new Map((page === 1 ? [] : previous?.sessions ?? []).map(session => [session.id, session]));
        data.sessions.forEach(session => sessions.set(session.id, session));
        return { ...data, sessions: [...sessions.values()].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)) };
      });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Workout history could not be loaded."); }
    finally { setLoading(false); }
  }

  const timeZone = history?.timeZone ?? "UTC";
  const today = trainingDay(new Date().toISOString(), timeZone);
  const month = monthChoice ?? today.slice(0, 7);
  const byDay = useMemo(() => {
    const map = new Map<string, NonNullable<typeof history>["sessions"]>();
    for (const session of history?.sessions ?? []) {
      const date = trainingDay(session.startedAt, timeZone);
      map.set(date, [...(map.get(date) ?? []), session]);
    }
    return map;
  }, [history, timeZone]);
  const inMonth = (history?.sessions ?? []).filter(s => trainingDay(s.startedAt, timeZone).startsWith(month));
  const visible = day ? byDay.get(day) ?? [] : inMonth;
  const trainingDays = new Set(inMonth.map(s => trainingDay(s.startedAt, timeZone))).size;
  const current = history?.sessions.find(s => s.id === comparisonId) ?? history?.sessions[0];
  const sheet = history?.sessions.find(s => s.id === sheetId);
  const monthLabel = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${month}-01T12:00:00Z`));
  function changeMonth(delta: number) { setMonthChoice(shiftMonth(month, delta)); setDay(null); }
  const historyStartsAfterMonth = history?.nextPage != null && history.sessions.length > 0 && trainingDay(history.sessions.at(-1)!.startedAt, timeZone).slice(0, 7) >= month;

  return <section id="training-calendar" className="training-history" aria-labelledby="training-history-title" aria-busy={loading}>
    <div className="training-heading"><div><span className="eyebrow">YOUR TRAINING, OVER TIME</span><h2 id="training-history-title">Training history</h2><p>Browse your workouts and compare matching sessions.</p></div></div>
    {!history && loading ? <div className="insight-card calendar-loading" role="status">Loading your training history…<div className="spotlight-skeleton" /></div> : !history || !history.available ? <div className="insight-card"><p role={error ? "alert" : undefined}>{error || "Connect Hevy to see your workout calendar and session comparisons."}</p>{error ? <button className="quiet-button" onClick={loadMore} disabled={loading}>Try again</button> : <a className="accent-link" href={withBasePath("/setup")}>Connect Hevy →</a>}</div> : <>
      <div className="training-layout">
        <article className="training-calendar insight-card" aria-label="Workout calendar">
          <div className="calendar-toolbar"><h3 aria-live="polite">{monthLabel}</h3><div><button className="calendar-icon-button" aria-label="Previous month" onClick={() => changeMonth(-1)}>‹</button><button className="calendar-today" onClick={() => { setMonthChoice(today.slice(0, 7)); setDay(today); }}>Today</button><button className="calendar-icon-button" aria-label="Next month" disabled={month >= today.slice(0, 7)} onClick={() => changeMonth(1)}>›</button></div></div>
          <p className="calendar-month-summary">{trainingDays} training {trainingDays === 1 ? "day" : "days"}<span> / </span>{inMonth.length} {inMonth.length === 1 ? "session" : "sessions"}{historyStartsAfterMonth ? " loaded" : ""}</p>
          <div className="calendar-weekdays" aria-hidden="true">{WEEKDAYS.map(label => <span key={label}>{label}</span>)}</div>
          <div className="calendar-days" key={month}>{monthCells(month).map((date, index) => {
            if (!date) return <span key={`blank-${index}`} />;
            const sessions = byDay.get(date) ?? [];
            const count = sessions.length;
            const status = sessions.some(s => s.status === "pending") ? "pending" : sessions.every(s => s.status === "synced") ? "synced" : "other";
            return <button key={date} className={`calendar-day ${count ? "has-session" : ""} ${date === today ? "is-today" : ""}`} aria-pressed={date === day} aria-current={date === today ? "date" : undefined}
              aria-label={`${sessionDate(`${date}T12:00:00Z`, "UTC")}, ${count} ${count === 1 ? "session" : "sessions"}${count ? `, ${sessions.map(s => `${s.title}: ${SESSION_STATUS[s.status]}`).join("; ")}` : ""}`}
              onClick={() => { setDay(date === day ? null : date); if (sessions[0]) setComparisonId(sessions[0].id); }}><span>{Number(date.slice(-2))}</span>{count > 0 && <span className={`calendar-indicator indicator-${status}`} aria-hidden="true">{count > 1 ? count : ""}</span>}</button>;
          })}</div>
          <div className="calendar-legend"><span><i className="indicator-synced" />On Garmin</span><span><i className="indicator-pending" />Pending</span><span><i className="indicator-other" />Other status</span></div>
          <div className="calendar-agenda-heading"><h4>{day ? sessionDate(`${day}T12:00:00Z`, "UTC") : "This month"}</h4>{day && <button className="accent-link" onClick={() => setDay(null)}>Show month</button>}</div>
          <div className="calendar-agenda" aria-live="polite">{visible.length ? visible.map(session => <button className="calendar-session" key={session.id} onClick={() => { setComparisonId(session.id); setSheetId(session.id); }} aria-label={`View ${session.title}, ${sessionDate(session.startedAt, timeZone, true)}`}><span className="agenda-date"><strong>{Number(trainingDay(session.startedAt, timeZone).slice(-2))}</strong><small>{new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(new Date(session.startedAt))}</small></span><span className="agenda-identity"><strong>{session.title}</strong><small>{session.totalSets === null ? "Sets unavailable" : `${session.totalSets} sets`}{session.durationS !== null ? ` · ${metricNumber(session.durationS / 60)} min` : ""}</small><span className={`session-state state-${session.status}`}>{SESSION_STATUS[session.status]}</span></span><span className="agenda-arrow" aria-hidden="true">↗</span></button>) : <p className="calendar-empty">{historyStartsAfterMonth ? "No sessions loaded for this date yet. Load older sessions to check this month." : history.sessions.length ? "No logged sessions on these dates." : "Your first Hevy session will appear here after you log it."}</p>}</div>
        </article>
        <article className="training-comparison insight-card">{current ? <><label className="comparison-picker">Compare session<select value={current.id} onChange={event => setComparisonId(event.target.value)}>{history.sessions.map(s => <option key={s.id} value={s.id}>{s.title} · {sessionDate(s.startedAt, timeZone)}</option>)}</select></label><SessionComparison current={current} sessions={history.sessions} unit={history.weightUnit} timeZone={timeZone} hasMore={history.nextPage !== null} /><button className="quiet-button" onClick={() => setSheetId(current.id)}>Open session details ↗</button></> : <><span className="eyebrow">SESSION COMPARISON</span><h3>A baseline starts with one session.</h3><p className="comparison-caveat">Your duration, sets, volume, and saved average HR will appear after a workout is logged.</p></>}</article>
      </div>
      <div className="calendar-history-footer"><p>Workout dates in {timeZone}. {history.nextPage !== null ? `${history.sessions.length} sessions loaded; older history is available.` : "All available Hevy history loaded."} {history.warning}</p>{history.nextPage !== null && <button className="quiet-button" onClick={loadMore} disabled={loading}>{loading ? "Loading older sessions…" : "Load older sessions"}</button>}</div>
      {error && <p className="spotlight-attention" role="alert">{error} <button className="accent-link" onClick={loadMore} disabled={loading}>Try again</button></p>}
      {sheet && <SessionSheet key={sheet.id} session={sheet} history={history} onClose={() => setSheetId(null)} />}
    </>}
  </section>;
}
