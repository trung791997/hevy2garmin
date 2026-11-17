"use client";

import { useEffect, useRef } from "react";
import { withBasePath } from "@/lib/base-path";
import { SESSION_STATUS, type SessionHistory, type TrainingSession } from "@/lib/session-analysis";
import { SessionComparison, sessionDate } from "./session-comparison";

export function SessionSheet({ session, history, onClose }: { session: TrainingSession; history: SessionHistory; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => { dialog.close(); document.body.style.overflow = overflow; trigger?.focus({ preventScroll: true }); };
  }, []);

  return <dialog ref={ref} className="session-sheet" aria-labelledby="session-sheet-title" onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="session-sheet-body">
      <header className="session-sheet-header"><span className="eyebrow">SESSION DETAILS</span><button autoFocus type="button" className="calendar-icon-button" aria-label="Close session details" onClick={onClose}>×</button></header>
      <div className="session-sheet-content"><span className={`session-state state-${session.status}`}>{SESSION_STATUS[session.status]}</span><h2 id="session-sheet-title">{session.title}</h2><p className="comparison-baseline">{sessionDate(session.startedAt, history.timeZone, true)}</p>
        <SessionComparison current={session} sessions={history.sessions} unit={history.weightUnit} timeZone={history.timeZone} hasMore={history.nextPage !== null} />
        <div className="session-sheet-actions">{session.garminActivityId && <a className="quiet-button" href={`https://connect.garmin.com/modern/activity/${encodeURIComponent(session.garminActivityId)}`} target="_blank" rel="noreferrer">Open Garmin ↗</a>}<a className="accent-link" href={withBasePath(`/workouts#workout-${encodeURIComponent(session.id)}`)}>Manage workout →</a></div>
      </div>
    </div>
  </dialog>;
}
