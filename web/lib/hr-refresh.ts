import { garminGateway } from "hevy2garmin";
import { getGarminClient } from "./garmin-upload";
import { resolveHevyKey } from "./hevy-sync";
import { readHrRecording, type HrRecording } from "./hr-analysis";
import { saveRecording, saveSyncState } from "./enhanced-sync";
import { loadSyncSettings, loadSyncStartDate } from "./sync-settings";
import { writeHevyHrNote } from "./hevy-hr-note";
import type { Sql } from "./pending-store";

/** Fetch HR and update the managed note. Never upload, delete or rewrite a Garmin activity. */
export async function refreshWorkoutHr(
  sql: Sql,
  hevyId: string,
  scheduled = false,
) {
  const [settings, rows, caches, states, key] = await Promise.all([
    loadSyncSettings(sql),
    sql`SELECT garmin_activity_id FROM synced_workouts WHERE hevy_id=${hevyId} AND status='success' LIMIT 1`,
    sql`SELECT data FROM hr_cache WHERE hevy_id=${hevyId} LIMIT 1`,
    sql`SELECT value FROM app_cache WHERE key=${`sync_state_${hevyId}`} LIMIT 1`,
    resolveHevyKey(),
  ]);
  if (!settings.hrFusion)
    return { pending: false, message: "HR fusion is disabled." };
  if (!rows[0]?.garmin_activity_id || !key)
    throw new Error(
      "This workout needs a synced Garmin activity and a Hevy connection.",
    );
  const response = await fetch(
    `https://api.hevyapp.com/v1/workouts/${encodeURIComponent(hevyId)}`,
    { headers: { "api-key": key }, cache: "no-store" },
  );
  if (!response.ok)
    throw new Error(`Hevy workout is unavailable (${response.status}).`);
  const workout = await response.json();
  if (scheduled) {
    const cutoff = await loadSyncStartDate(sql);
    if (
      cutoff &&
      Date.parse(workout.start_time) < Date.parse(cutoff + "T00:00:00Z")
    )
      return { pending: false, message: "Before the sync start date." };
  }
  const sourceId = String(
    states[0]?.value?.sourceActivityId ??
      caches[0]?.data?.metadata?.sourceActivityId ??
      rows[0].garmin_activity_id,
  );
  const gateway = garminGateway(await getGarminClient());
  let recording: HrRecording | null = null;
  try {
    const bytes = await gateway.activityFit?.(sourceId);
    if (bytes)
      recording = readHrRecording(
        bytes,
        workout.start_time,
        workout.end_time,
        sourceId,
      );
  } catch {
    /* Original may have been replaced; try its durable backup. */
  }
  if (!recording?.points.length) {
    const [backup] =
      await sql`SELECT value FROM app_cache WHERE key=${`original_fit_backup_${sourceId}`} LIMIT 1`;
    if (backup?.value?.fitBase64)
      recording = readHrRecording(
        Buffer.from(backup.value.fitBase64, "base64"),
        workout.start_time,
        workout.end_time,
        sourceId,
      );
  }
  if (recording?.metadata.source === "unknown" && caches[0]?.data?.metadata) {
    const previous = caches[0].data.metadata;
    recording.metadata = {
      ...recording.metadata,
      source: previous.source,
      devices: previous.devices,
      attribution: previous.attribution,
    };
  }
  if (!recording?.points.length) {
    await saveSyncState(sql, hevyId, {
      status: "waiting_hr",
      message:
        "Watch HR is not available yet. Refresh later; no activity was uploaded.",
      sourceActivityId: sourceId,
      hrPending: true,
    });
    return {
      pending: true,
      message: "Watch HR is not available yet. Retry after your watch syncs.",
    };
  }
  await saveRecording(sql, hevyId, recording, settings.hevyHrNotes);
  let noteStatus = "Hevy notes disabled";
  if (settings.hevyHrNotes)
    noteStatus = await writeHevyHrNote(
      sql,
      hevyId,
      recording,
      settings.hevyNotePrivacy,
    );
  await saveRecording(sql, hevyId, recording, false);
  const unresolved = states[0]?.value?.status === "review";
  await saveSyncState(sql, hevyId, {
    status: unresolved ? "review" : "synced",
    message: unresolved
      ? states[0].value.message
      : "HR refreshed without uploading an activity.",
    noteStatus,
    sourceActivityId: sourceId,
    hrPending: false,
  });
  return { pending: false, message: noteStatus, metadata: recording.metadata };
}

/** Bounded retries on the existing daily schedule; historical workouts stay excluded. */
export async function retryPendingHr(sql: Sql) {
  const rows =
    await sql`SELECT s.hevy_id FROM synced_workouts s LEFT JOIN hr_cache h ON h.hevy_id=s.hevy_id LEFT JOIN app_cache a ON a.key='sync_state_' || s.hevy_id WHERE s.status='success' AND (h.data->>'notePending'='true' OR a.value->>'hrPending'='true') ORDER BY s.synced_at DESC LIMIT 3`;
  for (const row of rows) {
    try {
      await refreshWorkoutHr(sql, row.hevy_id, true);
    } catch {
      /* Preserve pending state and retry on a later run. */
    }
  }
}
