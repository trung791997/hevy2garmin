import {
  findMergeMatch,
  isWatchRecorded,
  mergeSearchRange,
  toUtcDate,
  type CandidateActivity,
  type DedupWorkout,
} from "hevy2garmin";
import type { SyncSettings } from "./sync-settings";

export interface SyncPlan {
  action: "merge" | "describe" | "replace" | "upload" | "waiting" | "review";
  message: string;
  candidates: Array<{
    id: number;
    title: string;
    start: string;
    overlapPct: number;
    driftMinutes: number;
    score: number;
  }>;
  selectedId: number | null;
  changes: string[];
  preserves: string[];
}
export { mergeSearchRange };
export function planSync(
  workout: DedupWorkout,
  activities: CandidateActivity[],
  settings: SyncSettings,
  selectedId?: number,
  createNew = false,
): SyncPlan {
  const matches = activities
    .filter(isWatchRecorded)
    .flatMap((a) => {
      const match = findMergeMatch(workout, [a], settings.merge);
      return match
        ? [
            {
              id: a.activityId,
              title: String(
                (a as unknown as Record<string, unknown>).activityName ??
                  "Garmin watch activity",
              ),
              // Garmin's GMT string has no suffix. Send an explicit UTC
              // timestamp so the browser displays it in the user's timezone.
              start: toUtcDate(a.startTimeGMT || a.startTimeLocal || "")?.toISOString() ?? "",
              overlapPct: Math.round(match.overlapPct * 100),
              driftMinutes: Math.round(match.driftMinutes * 10) / 10,
              score: match.score,
            },
          ]
        : [];
    })
    .sort((a, b) => b.score - a.score);
  const choice =
    selectedId == null ? matches[0] : matches.find((m) => m.id === selectedId);
  const base = {
    candidates: matches,
    selectedId: choice?.id ?? null,
    changes: [] as string[],
    preserves: [] as string[],
  };
  if (!settings.merge.enabled)
    return {
      ...base,
      selectedId: null,
      action: "upload",
      message: "Create a separate Garmin activity from Hevy.",
      changes: ["Upload exercises, sets, reps and weights"],
      preserves: ["Existing Garmin activities"],
    };
  if (selectedId != null && !choice)
    return {
      ...base,
      action: "review",
      message: "That activity is no longer an eligible match. Preview again.",
    };
  if (!choice)
    return {
      ...base,
      action: settings.waitForWatch && !createNew ? "waiting" : "upload",
      message:
        settings.waitForWatch && !createNew
          ? "Waiting for your watch activity to reach Garmin. No new activity will be uploaded."
          : "No eligible watch recording found. Create a new activity.",
      changes:
        settings.waitForWatch && !createNew
          ? []
          : ["Upload a new strength activity"],
      preserves: ["Existing Garmin activities"],
    };
  if (
    selectedId == null &&
    matches[1] &&
    matches[0].score - matches[1].score < 5
  )
    return {
      ...base,
      action: "review",
      selectedId: null,
      message:
        "Two watch activities match closely. Choose the correct recording before syncing.",
    };
  const strategy = settings.merge.watchStrategy ?? "merge";
  return {
    ...base,
    action: strategy,
    message:
      strategy === "merge"
        ? "Keep the watch activity and replace its exercise sets with Hevy's sets."
        : strategy === "describe"
          ? "Keep the watch activity and update its title and workout notes."
          : "Upload a replacement, verify its data, then remove the original watch activity.",
    changes:
      strategy === "merge"
        ? [
            "Replace existing sets, reps and weights",
            "Update title and workout summary",
            "Exercise names may appear as Unknown in Garmin",
          ]
        : strategy === "describe"
          ? ["Update title and workout summary"]
          : [
              "Upload mapped exercise names and Hevy sets",
              "Delete the original only after backup and read-back checks",
              "Watch-only training and recovery metrics do not transfer",
            ],
    preserves:
      strategy === "replace"
        ? [
            "HR samples when HR fusion is on",
            "Downloadable original file backup",
          ]
        : [
            "Original activity and heart-rate recording",
            "Garmin training and recovery metrics",
            ...(strategy === "describe" ? ["Original exercise sets"] : []),
          ],
  };
}
