import {
  listCandidates,
  generateFit,
  dailyHrToPoints,
  type SyncDeps,
  type SyncOneOptions,
  type SyncOneResult,
  type GarminGateway,
  type DedupWorkout,
  type HrPoint,
} from "hevy2garmin";
import type { Sql } from "./pending-store";
import type { SyncSettings } from "./sync-settings";
import { analyseHr, readHrRecording, type HrRecording } from "./hr-analysis";
import { mergeSearchRange, planSync, type SyncPlan } from "./sync-plan";
import { saveOriginalBackup } from "./replacement-guard";
import { writeHevyHrNote } from "./hevy-hr-note";
import { workoutDescription } from "./workout-description";

export interface EnhancedOptions extends SyncOneOptions {
  selectedActivityId?: number;
  createNew?: boolean;
}
export type EnhancedResult = SyncOneResult & {
  plan?: SyncPlan;
  hr?: HrRecording["metadata"];
  noteStatus?: string;
  warnings?: string[];
};
export async function saveRecording(
  sql: Sql,
  hevyId: string,
  recording: HrRecording,
  notePending = true,
) {
  const data = {
    hr_samples: recording.points,
    samples: recording.points.map((p) => p.hr),
    metadata: recording.metadata,
    notePending,
  };
  await sql`INSERT INTO hr_cache (hevy_id,data,cached_at) VALUES (${hevyId},${sql.json(data)},NOW()) ON CONFLICT (hevy_id) DO UPDATE SET data=EXCLUDED.data,cached_at=NOW()`;
}
export async function saveSyncState(
  sql: Sql,
  hevyId: string,
  state: Record<string, unknown>,
) {
  await sql`INSERT INTO app_cache (key,value) VALUES (${`sync_state_${hevyId}`},${sql.json({ ...state, updatedAt: new Date().toISOString() })}) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`;
}
function stopped(
  workout: DedupWorkout,
  plan: SyncPlan,
  dryRun: boolean,
  remaining: number,
): EnhancedResult {
  return {
    status: dryRun
      ? "dry_run"
      : plan.action === "review"
        ? "needs_review"
        : "merge_pending",
    dryRun,
    wouldUpload: false,
    dedupDecision: "would_upload",
    workout: {
      hevy_id: workout.id,
      title: workout.title ?? null,
      start_time: workout.start_time ?? null,
    },
    fitStats: null,
    existingGarminActivityId: plan.selectedId,
    garminActivityId: null,
    remaining,
    syncMethod: null,
    error: plan.action === "review" ? plan.message : null,
    plan,
  };
}

/** Read-only planning first; the existing engine still owns upload claims and dedup. */
export async function runEnhancedSync(
  deps: SyncDeps,
  sql: Sql,
  settings: SyncSettings,
  options: EnhancedOptions,
  run: (deps: SyncDeps, options: SyncOneOptions) => Promise<SyncOneResult>,
): Promise<EnhancedResult> {
  const dryRun = options.dryRun !== false;
  // Sharing this promise avoids repeated full Hevy pagination while planning.
  const fetchOriginal = deps.fetchWorkouts;
  let fetched: ReturnType<typeof fetchOriginal> | undefined;
  deps.fetchWorkouts = () => (fetched ??= fetchOriginal());
  const candidates = await listCandidates(deps);
  const selected = options.targetHevyId
    ? candidates.find((c) => c.hevy_id === options.targetHevyId)
    : candidates[0];
  const id =
    options.targetActivityId != null ? options.targetHevyId : selected?.hevy_id;
  const workout = id
    ? (await deps.fetchWorkouts()).find((w) => String(w.id) === id)
    : null;
  if (!workout || !mergeSearchRange(workout)) return run(deps, options);
  const gateway = await deps.gateway();
  let plan: SyncPlan | undefined;
  if (options.targetActivityId == null) {
    const range = mergeSearchRange(workout)!;
    // A failed lookup must never turn into an upload. Let the caller retry.
    const activities =
      settings.merge.enabled || settings.hrFusion
        ? await gateway.activitiesByDate(range.start, range.end)
        : [];
    plan = planSync(
      workout,
      activities,
      settings,
      options.selectedActivityId,
      options.createNew,
    );
    if (!settings.merge.enabled && settings.hrFusion && activities.length) {
      const hrPlan = planSync(
        workout,
        activities,
        { ...settings, merge: { ...settings.merge, enabled: true } },
        options.selectedActivityId,
        options.createNew,
      );
      if (hrPlan.action === "review") plan = hrPlan;
      else if (hrPlan.selectedId)
        plan = {
          ...plan,
          selectedId: hrPlan.selectedId,
          message:
            "Use HR from the selected watch recording. Existing Garmin activities are kept.",
        };
    }
    if (plan.action === "waiting" || plan.action === "review") {
      if (!dryRun)
        await saveSyncState(sql, workout.id, {
          status: plan.action,
          message: plan.message,
        });
      return stopped(workout, plan, dryRun, candidates.length);
    }
  }
  const activityId = options.targetActivityId ?? plan?.selectedId;
  let recording: HrRecording | null = null,
    bytes: Uint8Array | null = null;
  const warnings: string[] = [];
  let blockedUpload = false;
  if (activityId && (settings.hrFusion || plan?.action === "replace")) {
    try {
      bytes = (await gateway.activityFit?.(activityId)) ?? null;
      if (bytes)
        recording = readHrRecording(
          bytes,
          String(workout.start_time),
          String(workout.end_time),
          String(activityId),
        );
    } catch {
      warnings.push(
        "The watch recording is not readable yet; its original HR remains in Garmin.",
      );
    }
  }
  if (recording?.metadata.source === "unknown") {
    const [cache] =
      await sql`SELECT data FROM hr_cache WHERE hevy_id=${workout.id} LIMIT 1`;
    const previous = cache?.data?.metadata;
    if (previous)
      recording.metadata = {
        ...recording.metadata,
        source: previous.source,
        devices: previous.devices,
        attribution: previous.attribution,
        sourceActivityId:
          previous.sourceActivityId ?? recording.metadata.sourceActivityId,
      };
  }
  if (plan?.action === "replace" && !dryRun) {
    try {
      if (!bytes)
        throw new Error(
          "The original recording must be available before replacement.",
        );
      await saveOriginalBackup(
        sql,
        gateway,
        activityId!,
        workout,
        bytes,
        settings.hrFusion,
      );
    } catch (error) {
      const review = {
        ...plan,
        action: "review" as const,
        message:
          error instanceof Error
            ? error.message
            : "Original-file backup failed.",
      };
      await saveSyncState(sql, workout.id, {
        status: "review",
        message: review.message,
      });
      return stopped(workout, review, false, candidates.length);
    }
  }
  const originalHr = deps.hr ?? {};
  const actualFit = () =>
    recording?.points.length && settings.hrFusion
      ? generateFit(
          workout as unknown as Parameters<typeof generateFit>[0],
          recording.points,
          { profile: settings.profile },
        )
      : null;
  const originalStore = deps.store;
  deps.store = {
    ...originalStore,
    markSynced: async (id, opts) => {
      const fit = actualFit();
      return originalStore.markSynced(
        id,
        fit ? { ...opts, calories: fit.calories, avgHr: fit.avg_hr } : opts,
      );
    },
  };
  const wrappedGateway: GarminGateway = {
    ...gateway,
    describe: async (id) => {
      const fit = actualFit() ?? generateFit(workout as unknown as Parameters<typeof generateFit>[0], null, { profile: settings.profile });
      return gateway.describe(
        id,
        workoutDescription(workout as unknown as Record<string, unknown>, fit.calories, fit.avg_hr, settings.weightUnit),
      );
    },
    activityFit: async (id) =>
      String(id) === String(activityId) && bytes
        ? bytes
        : ((await gateway.activityFit?.(id)) ?? null),
    activitiesByDate: async (s, e) => {
      const activities = await gateway.activitiesByDate(s, e);
      return plan?.selectedId
        ? activities.filter((a) => a.activityId === plan!.selectedId)
        : activities;
    },
  };
  deps.gateway = async () => wrappedGateway;
  if (plan?.action === "merge" || plan?.action === "describe") {
    const store = deps.store;
    deps.store = {
      ...store,
      claimPending: async () => {
        blockedUpload = true;
        return false;
      },
    };
  }
  deps.hr = {
    ...originalHr,
    loadBackup: async (hevyId) => {
      const points = (await originalHr.loadBackup?.(hevyId)) ?? null;
      if (points?.length && !recording?.points.length)
        recording = {
          points,
          metadata: analyseHr(
            points,
            (Date.parse(String(workout.end_time)) -
              Date.parse(String(workout.start_time))) /
              1000,
            "backup",
          ),
        };
      return points;
    },
    cachedHr: async (hevyId) => {
      if (recording?.points.length) return recording.points;
      const points = (await originalHr.cachedHr?.(hevyId)) ?? null;
      if (points?.length) {
        const [cache] =
          await sql`SELECT data FROM hr_cache WHERE hevy_id=${hevyId} LIMIT 1`;
        recording = {
          points,
          metadata:
            cache?.data?.metadata ??
            analyseHr(
              points,
              (Date.parse(String(workout.end_time)) -
                Date.parse(String(workout.start_time))) /
                1000,
              "unknown",
            ),
        };
      }
      return points;
    },
    dailyHr: async (start, end) => {
      const points = dailyHrToPoints(
        (await gateway.dailyHeartRate?.(start.toISOString().slice(0, 10))) ??
          [],
        start,
        end,
      );
      if (points.length)
        recording = {
          points,
          metadata: analyseHr(
            points,
            (end.getTime() - start.getTime()) / 1000,
            "daily_monitoring",
          ),
        };
      return points;
    },
    saveCache: async (hevyId, points: HrPoint[]) => {
      if (dryRun) return;
      if (!recording?.points.length)
        recording = {
          points,
          metadata: analyseHr(
            points,
            (Date.parse(String(workout.end_time)) -
              Date.parse(String(workout.start_time))) /
              1000,
            "unknown",
          ),
        };
      await saveRecording(sql, hevyId, recording, settings.hevyHrNotes);
    },
  };
  if (recording?.points.length && !dryRun && settings.hrFusion)
    await saveRecording(sql, workout.id, recording, settings.hevyHrNotes);
  if (dryRun) {
    const result = await run(deps, options);
    if (plan?.action === "upload" && result.existingGarminActivityId)
      plan = {
        ...plan,
        action: "describe",
        selectedId: result.existingGarminActivityId,
        message:
          "Garmin already has this start time. Update the existing title and summary without uploading a duplicate.",
        changes: ["Update title and workout summary"],
        preserves: ["Existing activity, exercise sets and HR"],
      };
    const fit = generateFit(
      workout as unknown as Parameters<typeof generateFit>[0],
      settings.hrFusion ? (recording?.points ?? null) : null,
      { profile: settings.profile },
    );
    return {
      ...result,
      ...(plan
        ? {
            wouldUpload: plan.action === "upload" || plan.action === "replace",
            existingGarminActivityId: plan.selectedId,
          }
        : {}),
      fitStats: {
        exercises: fit.exercises,
        totalSets: fit.total_sets,
        calories: fit.calories,
        avgHr: fit.avg_hr,
        durationS: fit.duration_s,
      },
      plan,
      ...(recording ? { hr: recording.metadata } : {}),
      warnings,
    };
  }
  const engineOptions = {
    ...options,
    mergeOnly: settings.waitForWatch && !options.createNew,
    ...(plan?.action === "upload"
      ? { merge: { ...settings.merge, enabled: false } }
      : {}),
  };
  const result: EnhancedResult = {
    ...(await run(deps, engineOptions)),
    plan,
    warnings,
  };
  const fit = actualFit();
  if (fit && result.fitStats)
    result.fitStats = {
      exercises: fit.exercises,
      totalSets: fit.total_sets,
      calories: fit.calories,
      avgHr: fit.avg_hr,
      durationS: fit.duration_s,
    };
  if (blockedUpload) {
    result.status = "needs_review";
    result.error =
      "The watch merge did not complete. No separate activity was uploaded; review the original before retrying.";
    warnings.push(result.error);
    await saveSyncState(sql, workout.id, {
      status: "review",
      message: result.error,
    });
  }
  if (recording) result.hr = recording.metadata;
  if (result.status === "synced") {
    if (plan?.action === "replace" && result.syncMethod === "merge")
      warnings.push(
        "Replacement did not run. The original watch activity was kept and Hevy sets were merged into it instead.",
      );
    if (plan?.action === "upload" && result.syncMethod === "match")
      result.plan = {
        ...plan,
        action: "describe",
        selectedId: result.garminActivityId,
        message:
          "Garmin already has an activity at this start time. It was kept; the title and summary were updated without a new upload.",
        changes: ["Update title and workout summary"],
        preserves: ["Existing activity, exercise sets and HR"],
      };
    if (settings.hrFusion && !recording?.points.length && activityId)
      warnings.push(
        "Watch HR is pending. Refresh HR after Garmin finishes processing the recording.",
      );
    if (settings.hrFusion && settings.hevyHrNotes && recording?.points.length) {
      try {
        result.noteStatus = await writeHevyHrNote(
          sql,
          workout.id,
          recording,
          settings.hevyNotePrivacy,
        );
        await saveRecording(sql, workout.id, recording, false);
      } catch (error) {
        result.noteStatus =
          error instanceof Error
            ? error.message
            : "Hevy note is pending; retry HR refresh.";
        warnings.push(result.noteStatus);
      }
    }
    if (result.mergeFallbackReason?.includes("could not be deleted"))
      warnings.push(
        "Replacement needs review: the original was retained. No automatic deletion will be retried.",
      );
    await saveSyncState(sql, workout.id, {
      status: warnings.length ? "review" : "synced",
      message: warnings.join(" ") || "Synced",
      noteStatus: result.noteStatus,
      sourceActivityId:
        recording?.metadata.sourceActivityId ??
        activityId ??
        result.garminActivityId,
      hrPending: settings.hrFusion && !recording?.points.length,
    });
  }
  return result;
}
