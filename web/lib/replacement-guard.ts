import { createHash } from "node:crypto";
import type { GarminGateway, DedupWorkout } from "hevy2garmin";
import type { Sql } from "./pending-store";
import { readHrRecording } from "./hr-analysis";

type Backup = {
  activityId: string;
  start: string;
  end: string;
  fitBase64: string;
  sha256: string;
  exerciseSets: unknown;
  activity: unknown;
  hrRequired: boolean;
  createdAt: string;
};
const keyOf = (id: number | string) => `original_fit_backup_${id}`;
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

export async function saveOriginalBackup(
  sql: Sql,
  gateway: GarminGateway,
  id: number,
  workout: DedupWorkout,
  bytes: Uint8Array,
  hrRequired: boolean,
): Promise<void> {
  const recording = readHrRecording(
    bytes,
    String(workout.start_time),
    String(workout.end_time),
    String(id),
  );
  if (hrRequired && !recording.points.length)
    throw new Error(
      "Original activity has no readable HR. Keep the watch activity or use Merge.",
    );
  const [exerciseSets, activity] = await Promise.all([
    gateway.exerciseSets(id),
    gateway.activity?.(id),
  ]);
  if (!activity)
    throw new Error("Original activity could not be backed up completely.");
  const backup: Backup = {
    activityId: String(id),
    start: String(workout.start_time),
    end: String(workout.end_time),
    fitBase64: Buffer.from(bytes).toString("base64"),
    sha256: sha(bytes),
    exerciseSets,
    activity,
    hrRequired,
    createdAt: new Date().toISOString(),
  };
  await sql`INSERT INTO app_cache (key,value) VALUES (${keyOf(id)},${sql.json(backup)}) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`;
  const [stored] =
    await sql`SELECT value FROM app_cache WHERE key=${keyOf(id)} LIMIT 1`;
  if (
    !stored?.value ||
    stored.value.sha256 !== backup.sha256 ||
    sha(Buffer.from(stored.value.fitBase64, "base64")) !== backup.sha256
  )
    throw new Error("Backup read-back failed; original activity will be kept.");
}

/** Applies to normal sync AND recovery; no delete can bypass the read-back gate. */
export function protectReplacements(
  sql: Sql,
  gateway: GarminGateway,
  onBlocked?: (message: string) => void,
): GarminGateway {
  let uploadedId: number | null = null;
  return {
    ...gateway,
    upload: async (...args) => {
      const result = await gateway.upload(...args);
      if (result.activityId != null) uploadedId = Number(result.activityId);
      return result;
    },
    deleteActivity: async (originalId) => {
      try {
        const [row] =
          await sql`SELECT value FROM app_cache WHERE key=${keyOf(originalId)} LIMIT 1`;
        const backup = row?.value as Backup | undefined;
        if (!backup || backup.activityId !== String(originalId))
          throw new Error("A verified original-file backup is required.");
        const original = Buffer.from(backup.fitBase64, "base64");
        if (sha(original) !== backup.sha256)
          throw new Error("Original-file backup checksum failed.");
        const before = readHrRecording(original, backup.start, backup.end);
        if (!uploadedId) {
          const [pending] =
            await sql`SELECT garmin_activity_id FROM pending_uploads WHERE watch_activity_id=${String(originalId)} AND garmin_activity_id IS NOT NULL LIMIT 1`;
          uploadedId = Number(pending?.garmin_activity_id) || null;
        }
        if (!uploadedId || uploadedId === originalId)
          throw new Error(
            "Replacement activity could not be identified safely.",
          );
        if (!(await gateway.activity?.(uploadedId)))
          throw new Error("Replacement activity is not readable yet.");
        const bytes = await gateway.activityFit?.(uploadedId);
        if (!bytes)
          throw new Error(
            "Replacement file is not ready for verification. Both activities were kept.",
          );
        const after = readHrRecording(bytes, backup.start, backup.end);
        if (backup.hrRequired) {
          if (
            !before.points.length ||
            after.points.length < before.points.length * 0.95
          )
            throw new Error(
              "Replacement is missing heart-rate samples. Both activities were kept.",
            );
          const bySecond = new Map(
            after.points.map((p) => [Math.round(p.time), p.hr]),
          );
          const retained = before.points.filter(
            (p) =>
              Math.abs((bySecond.get(Math.round(p.time)) ?? -999) - p.hr) <= 1,
          ).length;
          if (retained < before.points.length * 0.95)
            throw new Error(
              "Replacement HR does not match the original recording. Both activities were kept.",
            );
        }
        const sets = await gateway.exerciseSets(uploadedId);
        const active = Array.isArray(sets.exerciseSets)
          ? sets.exerciseSets.filter(
              (s: Record<string, unknown>) => s.setType === "ACTIVE",
            )
          : [];
        if (
          !active.length ||
          !active.some((s: { exercises?: Array<{ category?: string }> }) =>
            s.exercises?.some((e) => e.category && e.category !== "UNKNOWN"),
          )
        )
          throw new Error(
            "Replacement exercise names could not be verified. Both activities were kept.",
          );
        await gateway.deleteActivity(originalId);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Replacement verification failed.";
        onBlocked?.(message);
        throw new Error(message);
      }
    },
  };
}
