import { weightFromKg, type WeightUnit } from "./weight-units";

export interface TrainingSession {
  id: string;
  title: string;
  startedAt: string;
  durationS: number | null;
  totalSets: number | null;
  exercises: number | null;
  volumeKg: number | null;
  exerciseKey: string | null;
  avgHr: number | null;
  status: "synced" | "pending" | "skipped" | "marked" | "not_synced";
  garminActivityId: string | null;
}

export interface SessionHistory {
  sessions: TrainingSession[];
  weightUnit: WeightUnit;
  timeZone: string;
  nextPage: number | null;
  available: boolean;
  warning: string | null;
}

/** The calendar follows the profile's local training day, including DST. */
export function trainingDay(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

export function monthCells(month: string): Array<string | null> {
  const [year, m] = month.split("-").map(Number);
  const offset = (new Date(Date.UTC(year, m - 1, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const length = Math.ceil((offset + days) / 7) * 7;
  return Array.from({ length }, (_, i) => i < offset || i >= offset + days ? null : `${month}-${String(i - offset + 1).padStart(2, "0")}`);
}

const normalizedTitle = (title: string) => title.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");

/** Require both the same name and exercise lineup; never compare unrelated sessions. */
export function previousSession(current: TrainingSession, sessions: TrainingSession[]): TrainingSession | null {
  if (!current.exerciseKey) return null;
  return sessions.filter(s => s.id !== current.id && Date.parse(s.startedAt) < Date.parse(current.startedAt)
    && normalizedTitle(s.title) === normalizedTitle(current.title) && s.exerciseKey === current.exerciseKey)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0] ?? null;
}

export interface ComparisonMetric {
  id: string;
  label: string;
  current: number | null;
  previous: number | null;
  delta: number | null;
  percent: number | null;
  unit: string;
}

export function comparisonMetrics(current: TrainingSession, previous: TrainingSession | null, unit: WeightUnit): ComparisonMetric[] {
  const volume = (s: TrainingSession | null) => s?.volumeKg == null ? null : weightFromKg(s.volumeKg, unit);
  const values: Array<[string, string, number | null, number | null, string]> = [
    ["volume", "Weight volume", volume(current), volume(previous), unit === "lb" ? "lbs" : "kg"],
    ["duration", "Duration", current.durationS === null ? null : current.durationS / 60, previous?.durationS == null ? null : previous.durationS / 60, "min"],
    ["sets", "Logged sets", current.totalSets, previous?.totalSets ?? null, "sets"],
    ["hr", "Average HR", current.avgHr, previous?.avgHr ?? null, "bpm"],
  ];
  return values.map(([id, label, now, before, suffix]) => ({ id, label, current: now, previous: before,
    delta: now === null || before === null ? null : now - before,
    percent: now === null || before === null || before === 0 ? null : (now - before) / before * 100, unit: suffix }));
}

export const SESSION_STATUS: Record<TrainingSession["status"], string> = {
  synced: "On Garmin", pending: "Pending sync", skipped: "Skipped", marked: "Marked synced", not_synced: "Not synced",
};
