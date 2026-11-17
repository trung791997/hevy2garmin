import type { Sql } from "./pending-store";
import { ifNoTable } from "./missing-table";
import { resolveHevyKey } from "./hevy-sync";
import { workoutMetrics } from "./dashboard-workout";
import { weightUnit } from "./weight-units";
import { normaliseTimeZone } from "./timezone";
import type { SessionHistory, TrainingSession } from "./session-analysis";

type Obj = Record<string, unknown>;
const object = (value: unknown): Obj => value && typeof value === "object" && !Array.isArray(value) ? value as Obj : {};
interface HevyPage { workouts: unknown[]; page_count?: number }
export type PageReader = (page: number) => Promise<HevyPage>;

export class HistoryUnavailable extends Error {}

/** No notes, credentials, serial numbers, or raw exercise payloads reach the browser. */
export function trainingSession(raw: unknown, ledger: Obj = {}, pending = false): TrainingSession | null {
  const workout = object(raw), metrics = workoutMetrics(workout);
  if (typeof workout.id !== "string" || !workout.id || !metrics.startedAt) return null;
  const exercises = Array.isArray(workout.exercises) ? workout.exercises.map(object) : [];
  const identities = exercises.map(e => typeof e.exercise_template_id === "string" && e.exercise_template_id
    ? `id:${e.exercise_template_id}` : typeof e.title === "string" && e.title.trim() ? `name:${e.title.trim().toLowerCase()}` : "");
  const avgHr = ledger.avg_hr == null ? null : Number(ledger.avg_hr);
  const status: TrainingSession["status"] = pending ? "pending" : ledger.status === "skipped" ? "skipped"
    : ledger.status === "manual" ? "marked" : ledger.garmin_activity_id != null && (ledger.status == null || ledger.status === "success") ? "synced" : "not_synced";
  return {
    id: workout.id, title: typeof workout.title === "string" && workout.title.trim() ? workout.title : "Untitled workout",
    ...metrics, startedAt: metrics.startedAt,
    // Sorted IDs allow exercise reordering, but preserve duplicates and substitutions.
    exerciseKey: identities.length && identities.every(Boolean) ? JSON.stringify(identities.sort()) : null,
    avgHr: avgHr !== null && Number.isFinite(avgHr) && avgHr > 0 && avgHr < 256 ? avgHr : null,
    status, garminActivityId: ledger.garmin_activity_id == null ? null : String(ledger.garmin_activity_id),
  };
}

/** At most 30 workouts per request; older pages are loaded explicitly. Reads only. */
export async function loadSessionHistory(sql: Sql, startPage = 1, reader?: PageReader): Promise<SessionHistory> {
  const [preferences, key] = await Promise.all([
    sql`SELECT key, value FROM app_cache WHERE key IN ('display_units', 'user_profile')`.catch(ifNoTable([])),
    reader ? Promise.resolve(null) : resolveHevyKey(),
  ]);
  const pref = (name: string) => object(preferences.find(p => p.key === name)?.value);
  const timeZone = normaliseTimeZone(String(pref("user_profile").timezone ?? ""))
    ?? normaliseTimeZone(process.env.H2G_DISPLAY_TIMEZONE ?? "") ?? "UTC";
  const result: SessionHistory = { sessions: [], timeZone, weightUnit: weightUnit(pref("display_units").weight), nextPage: null, available: !!reader || !!key, warning: null };
  if (!result.available) return result;
  const read: PageReader = reader ?? (async page => {
    const response = await fetch(`https://api.hevyapp.com/v1/workouts?page=${page}&pageSize=10`, {
      headers: { "api-key": key! }, next: { revalidate: 300 }, signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new HistoryUnavailable("Hevy history is temporarily unavailable. Try again shortly.");
    const body = object(await response.json());
    if (!Array.isArray(body.workouts)) throw new HistoryUnavailable("Hevy returned an incomplete history response. Try again shortly.");
    return { workouts: body.workouts.slice(0, 10), page_count: typeof body.page_count === "number" ? body.page_count : undefined };
  });
  const raw: unknown[] = [];
  for (let page = startPage; page < startPage + 3; page++) {
    let batch: HevyPage;
    try { batch = await read(page); }
    catch {
      if (!raw.length) throw new HistoryUnavailable("Hevy history is temporarily unavailable. Try again shortly.");
      result.warning = "Some history could not be loaded. Your loaded sessions are still available.";
      result.nextPage = page;
      break;
    }
    raw.push(...batch.workouts);
    if (!batch.workouts.length || (batch.page_count != null && page >= batch.page_count)) { result.nextPage = null; break; }
    result.nextPage = page + 1;
  }
  const ids = raw.map(w => object(w).id).filter((id): id is string => typeof id === "string");
  if (!ids.length) return result;
  const [ledger, pending] = await Promise.all([
    sql`SELECT hevy_id, status, garmin_activity_id, avg_hr FROM synced_workouts WHERE hevy_id = ANY(${ids})`.catch(ifNoTable([])),
    sql`SELECT hevy_id FROM pending_uploads WHERE hevy_id = ANY(${ids})`.catch(ifNoTable([])),
  ]);
  const byId = new Map(ledger.map(row => [String(row.hevy_id), row]));
  const pendingIds = new Set(pending.map(row => String(row.hevy_id)));
  const sessions = new Map<string, TrainingSession>();
  for (const workout of raw) {
    const id = String(object(workout).id ?? "");
    const session = trainingSession(workout, byId.get(id), pendingIds.has(id));
    if (session) sessions.set(session.id, session);
  }
  result.sessions = [...sessions.values()].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  if (result.sessions.length < raw.length) result.warning ??= "Some entries had duplicate IDs or no valid workout date and were omitted.";
  return result;
}
