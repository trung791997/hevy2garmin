import { createHash } from "node:crypto";
import { resolveHevyKey } from "./hevy-sync";
import type { HrRecording } from "./hr-analysis";
import type { Sql } from "./pending-store";

const BEGIN = "[hevy2garmin HR]",
  END = "[/hevy2garmin HR]";
type Obj = Record<string, unknown>;

export function hrNote(recording: HrRecording): string {
  const { metadata: m, points } = recording;
  const rates = points.map((p) => p.hr);
  const source =
    m.source === "watch_recording"
      ? "Garmin activity recording"
      : m.source === "daily_monitoring"
        ? "Garmin daily monitoring (sparse readings)"
        : "Saved heart-rate recording";
  return [
    BEGIN,
    `Heart rate: ${source}`,
    ...(m.devices.length
      ? [
          `External HR monitor detected: ${m.devices.join(", ")}`,
          "Device metadata identifies connected monitors, not the source of every reading.",
        ]
      : ["External HR monitor: not identified in the recording"]),
    `Recording coverage: approximately ${m.coveragePct}% · ${m.sampleCount} readings`,
    ...(rates.length
      ? [
          `Average ${Math.round(rates.reduce((a, b) => a + b, 0) / rates.length)} bpm · Maximum ${Math.max(...rates)} bpm`,
        ]
      : []),
    END,
  ].join("\n");
}
export function mergeHrNote(description: unknown, note: string): string {
  const original = typeof description === "string" ? description : "";
  const pattern = /\[hevy2garmin HR\][\s\S]*?\[\/hevy2garmin HR\]/g;
  if (pattern.test(original)) {
    let used = false;
    return original.replace(pattern, () => {
      if (used) return "";
      used = true;
      return note;
    });
  }
  return original + (original ? "\n\n" : "") + note;
}

/** Project the documented write shape; never edit the exercise notes or set values. */
export function hevyUpdatePayload(
  workout: Obj,
  description: string,
  privacy: "private" | "public",
) {
  if (
    typeof workout.title !== "string" ||
    !workout.start_time ||
    !workout.end_time ||
    !Array.isArray(workout.exercises)
  )
    throw new Error("Hevy workout is incomplete; note update skipped.");
  const pick = (object: Obj, keys: string[]) =>
    Object.fromEntries(
      keys.filter((k) => k in object).map((k) => [k, object[k]]),
    );
  return {
    workout: {
      title: workout.title,
      description,
      start_time: workout.start_time,
      end_time: workout.end_time,
      is_private: privacy === "private",
      exercises: (workout.exercises as Obj[]).map((exercise) => {
        if (!exercise.exercise_template_id || !Array.isArray(exercise.sets))
          throw new Error("Hevy exercise is incomplete; note update skipped.");
        return {
          ...pick(exercise, ["exercise_template_id", "superset_id", "notes"]),
          sets: (exercise.sets as Obj[]).map((set) =>
            pick(set, [
              "type",
              "weight_kg",
              "reps",
              "distance_meters",
              "duration_seconds",
              "custom_metric",
              "rpe",
            ]),
          ),
        };
      }),
    },
  };
}

export async function writeHevyHrNote(
  sql: Sql,
  hevyId: string,
  recording: HrRecording,
  privacy: "private" | "public" | "dashboard_only" | null,
  fetchImpl = fetch,
): Promise<string> {
  if (privacy === "dashboard_only") return "Dashboard only";
  if (!privacy)
    return "Choose workout privacy in Settings to enable Hevy notes.";
  const key = await resolveHevyKey();
  if (!key) throw new Error("Connect Hevy before writing HR notes.");
  const url = `https://api.hevyapp.com/v1/workouts/${encodeURIComponent(hevyId)}`;
  const headers = { "api-key": key, "Content-Type": "application/json" };
  const read = async () => {
    const response = await fetchImpl(url, { headers, cache: "no-store" });
    if (!response.ok)
      throw new Error(`Hevy note read failed (${response.status}).`);
    return (await response.json()) as Obj;
  };
  const current = await read();
  const description = mergeHrNote(current.description, hrNote(recording));
  if (description === current.description) {
    if (typeof current.updated_at === "string")
      await sql`UPDATE synced_workouts SET hevy_updated_at = ${current.updated_at} WHERE hevy_id = ${hevyId}`;
    return "Hevy note is current";
  }
  // Check again immediately before a whole-workout PUT. Hevy has no documented
  // conditional-update API; a detected edit is deferred rather than overwritten.
  const digest = (v: Obj) =>
    createHash("sha256").update(JSON.stringify(v)).digest("hex");
  const backupKey = `hevy_note_backup_${hevyId}_${digest(current).slice(0, 16)}`;
  await sql`INSERT INTO app_cache (key,value) VALUES (${backupKey},${sql.json({ workout: current, savedAt: new Date().toISOString() })}) ON CONFLICT (key) DO NOTHING`;
  const fresh = await read();
  if (digest(current) !== digest(fresh))
    throw new Error(
      "Workout changed while preparing its HR note; retry later.",
    );
  const payload = hevyUpdatePayload(fresh, description, privacy);
  const response = await fetchImpl(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok)
    throw new Error(
      `Hevy note update failed (${response.status}); Garmin sync is unchanged.`,
    );
  const after = await read();
  if (after.description !== description)
    throw new Error(
      "Hevy did not confirm the HR note; review the workout before retrying.",
    );
  if (
    JSON.stringify(hevyUpdatePayload(after, description, privacy)) !==
    JSON.stringify(payload)
  )
    throw new Error(
      "Hevy returned different workout details. A pre-update backup was retained for review.",
    );
  if (typeof after.updated_at === "string")
    await sql`UPDATE synced_workouts SET hevy_updated_at = ${after.updated_at} WHERE hevy_id = ${hevyId}`;
  return "HR note saved to Hevy";
}
