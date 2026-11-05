import type { Sql } from "./pending-store";
import { ifNoTable } from "./missing-table";
import { resolveHevyKey } from "./hevy-sync";
import { cleanPoints } from "./hr-analysis";
import { weightUnit, type WeightUnit } from "./weight-units";

type Obj = Record<string, unknown>;
const object = (value: unknown): Obj => value && typeof value === "object" && !Array.isArray(value) ? value as Obj : {};
const finite = (value: unknown): number | null => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value : null;
const timestamp = (value: unknown): string | null => {
  if (!(typeof value === "string" || value instanceof Date)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

export interface ReceiptStep {
  id: string;
  title: string;
  detail: string;
  status: "done" | "pending" | "unknown" | "off";
}
export interface FeaturedWorkout {
  id: string;
  title: string;
  startedAt: string | null;
  syncedAt: string | null;
  garminActivityId: string | null;
  durationS: number | null;
  exercises: number | null;
  totalSets: number | null;
  volumeKg: number | null;
  weightUnit: WeightUnit;
  avgHr: number | null;
  detailSource: "hevy" | "saved" | null;
  detailsEdited: boolean;
  attention: string | null;
  receipt: ReceiptStep[];
  recording: {
    points: Array<{ time: number; hr: number }>;
    source: "watch_recording" | "daily_monitoring" | "backup" | "unknown";
    devices: string[];
    coveragePct: number | null;
    sampleCount: number;
    longestGapS: number | null;
    medianIntervalS: number | null;
    durationS: number | null;
    cachedAt: string | null;
  };
}

export function workoutMetrics(raw: unknown) {
  const workout = object(raw);
  const exercises = Array.isArray(workout.exercises) ? workout.exercises : null;
  const start = timestamp(workout.start_time), end = timestamp(workout.end_time);
  const duration = start && end ? (Date.parse(end) - Date.parse(start)) / 1000 : null;
  let totalSets = 0, volumeKg = 0;
  for (const exercise of exercises ?? []) {
    for (const rawSet of Array.isArray(object(exercise).sets) ? object(exercise).sets as unknown[] : []) {
      const set = object(rawSet);
      totalSets++;
      const weight = finite(set.weight_kg ?? set.weight), reps = finite(set.reps);
      if (weight !== null && weight >= 0 && reps !== null && reps > 0) volumeKg += weight * reps;
    }
  }
  return {
    startedAt: start,
    durationS: duration !== null && duration > 0 ? duration : null,
    exercises: exercises?.length ?? null,
    totalSets: exercises ? totalSets : null,
    volumeKg: exercises ? volumeKg : null,
  };
}

/** A ledger match is not proof that exercise sets were merged or a note was saved. */
export function syncReceipt(method: unknown, rawState: unknown, rawHr: unknown): ReceiptStep[] {
  const state = object(rawState), hr = object(rawHr);
  const note = text(state.noteStatus);
  const noteSaved = note === "HR note saved to Hevy" || note === "Hevy note is current";
  const noteOff = note === "Dashboard only" || note === "Hevy notes disabled";
  const notePending = !noteSaved && !noteOff && (hr.notePending === true || state.hrPending === true || !!note);
  return [
    { id: "hevy", title: "Hevy imported", detail: "This workout has a completed entry in your sync history.", status: "done" },
    {
      id: "garmin", title: method === "upload" ? "Garmin activity uploaded" : "Garmin activity linked",
      detail: method === "upload" ? "The sync created a Garmin activity from your Hevy workout." : method === "merge" || method === "match" ? "The sync linked this workout to an existing Garmin activity." : "A Garmin activity ID is saved in your sync history.", status: "done",
    },
    {
      id: "details", title: method === "merge" ? "Exercise sets merged" : method === "upload" ? "Workout details uploaded" : "Workout details",
      detail: method === "merge" ? "The sync recorded a completed merge of Hevy sets, reps, and weights into the watch activity." : method === "upload" ? "Your Hevy workout details were included in the uploaded activity." : "An activity link is recorded. A separate sets-merge confirmation is not available for this sync.",
      status: method === "merge" || method === "upload" ? "done" : "unknown",
    },
    {
      id: "note", title: noteSaved ? "Hevy HR note updated" : noteOff ? "Hevy HR note off" : notePending ? "Hevy HR note pending" : "Hevy HR note",
      detail: note ?? (notePending ? "Heart-rate data or its note is waiting for another refresh." : "No note confirmation was saved for this workout."),
      status: noteSaved ? "done" : noteOff ? "off" : notePending ? "pending" : "unknown",
    },
  ];
}

export function featuredWorkout(row: Obj, rawWorkout: unknown, unit: WeightUnit, detailSource: FeaturedWorkout["detailSource"]): FeaturedWorkout {
  const workout = object(rawWorkout), hr = object(row.hr_data), metadata = object(hr.metadata), state = object(row.sync_state);
  const metrics = workoutMetrics(workout);
  const durationS = metrics.durationS ?? finite(metadata.durationS);
  const points = cleanPoints(hr.hr_samples, durationS ?? Infinity);
  const legacy = Array.isArray(hr.samples) ? hr.samples.map(finite).filter((n): n is number => n !== null && n > 0 && n < 256) : [];
  const rates = points.length ? points.map(p => p.hr) : legacy;
  const recordedSource = metadata.source;
  const source = recordedSource === "watch_recording" || recordedSource === "daily_monitoring" || recordedSource === "backup" ? recordedSource : "unknown";
  const coverage = finite(metadata.coveragePct);
  const hevyUpdated = timestamp(workout.updated_at), syncedVersion = timestamp(row.hevy_updated_at);
  return {
    id: String(row.hevy_id), title: text(workout.title) ?? text(row.title) ?? "Untitled workout",
    ...metrics, durationS: durationS !== null && durationS > 0 ? durationS : null,
    syncedAt: timestamp(row.synced_at), garminActivityId: text(row.garmin_activity_id == null ? null : String(row.garmin_activity_id)),
    weightUnit: unit, avgHr: rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : finite(row.avg_hr),
    detailSource, detailsEdited: detailSource === "hevy" && !!hevyUpdated && !!syncedVersion && Date.parse(hevyUpdated) > Date.parse(syncedVersion),
    attention: state.status === "review" ? text(state.message) : null,
    receipt: syncReceipt(row.sync_method, state, hr),
    recording: {
      points, source,
      devices: Array.isArray(metadata.devices) ? metadata.devices.filter((d): d is string => typeof d === "string" && !!d.trim()).slice(0, 8) : [],
      coveragePct: coverage === null ? null : Math.max(0, Math.min(100, coverage)),
      sampleCount: rates.length, longestGapS: finite(metadata.longestGapS), medianIntervalS: finite(metadata.medianIntervalS),
      durationS, cachedAt: timestamp(row.cached_at),
    },
  };
}

/** One bounded read of Hevy; never read Garmin, alter a workout, or start a sync. */
async function readWorkout(id: string): Promise<unknown> {
  const key = await resolveHevyKey();
  if (!key) return null;
  const response = await fetch(`https://api.hevyapp.com/v1/workouts/${encodeURIComponent(id)}`, {
    headers: { "api-key": key }, next: { revalidate: 300 }, signal: AbortSignal.timeout(4000),
  });
  return response.ok ? response.json() : null;
}

export async function loadFeaturedWorkout(sql: Sql, read: (id: string) => Promise<unknown> = readWorkout): Promise<FeaturedWorkout | null> {
  const [rows, preferences] = await Promise.all([
    sql`
      SELECT s.hevy_id, s.title, s.synced_at, s.hevy_updated_at, s.garmin_activity_id,
             s.sync_method, s.avg_hr, h.data AS hr_data, h.cached_at, a.value AS sync_state
      FROM synced_workouts s
      LEFT JOIN hr_cache h ON h.hevy_id = s.hevy_id
      LEFT JOIN app_cache a ON a.key = 'sync_state_' || s.hevy_id
      WHERE COALESCE(s.status, 'success') = 'success' AND s.garmin_activity_id IS NOT NULL
      ORDER BY s.synced_at DESC LIMIT 1
    `.catch(ifNoTable([])),
    sql`SELECT value FROM app_cache WHERE key = 'display_units' LIMIT 1`.catch(ifNoTable([])),
  ]);
  if (!rows[0]) return null;
  const row = rows[0];
  const [current, backups] = await Promise.all([
    read(String(row.hevy_id)).catch(() => null),
    sql`SELECT value FROM app_cache WHERE starts_with(key, ${`hevy_note_backup_${row.hevy_id}_`}) ORDER BY updated_at DESC LIMIT 1`.catch(ifNoTable([])),
  ]);
  const saved = object(backups[0]?.value).workout;
  const live = object(current);
  const useLive = String(live.id ?? "") === String(row.hevy_id) && Array.isArray(live.exercises);
  return featuredWorkout(row, useLive ? live : saved, weightUnit(object(preferences[0]?.value).weight), useLive ? "hevy" : saved ? "saved" : null);
}
