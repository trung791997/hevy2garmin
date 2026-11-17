import { describe, expect, it, vi } from "vitest";
import { featuredWorkout, loadFeaturedWorkout, syncReceipt, workoutMetrics } from "./dashboard-workout";
import type { Sql } from "./pending-store";

const workout = { id: "sample", title: "Full Body", start_time: "2026-06-10T14:00:00Z", end_time: "2026-06-10T15:00:00Z", exercises: [
  { sets: [{ weight_kg: 50, reps: 5 }, { weight_kg: 60, reps: 5 }] },
  { sets: [{ weight_kg: null, duration_seconds: 60 }] },
] };
const row = { hevy_id: "sample", title: "Full Body", garmin_activity_id: "42", sync_method: "merge", synced_at: "2026-06-10T15:05:00Z", hr_data: { hr_samples: [{ time: 0, hr: 90 }, { time: 5, hr: 100 }], metadata: { source: "watch_recording", devices: ["Garmin HRM 600"], coveragePct: 99, longestGapS: 5, durationS: 3600, serialNumber: "never expose" } }, sync_state: { noteStatus: "HR note saved to Hevy" } };

describe("featured workout data", () => {
  it("counts actual logged sets and external-load volume without changing canonical weights", () => {
    const before = structuredClone(workout);
    expect(workoutMetrics(workout)).toMatchObject({ totalSets: 3, exercises: 2, volumeKg: 550, durationS: 3600 });
    expect(workout).toEqual(before);
    expect(workoutMetrics(null)).toMatchObject({ totalSets: null, volumeKg: null, durationS: null });
  });
  it("preserves device caveats and does not expose raw recording metadata", () => {
    const data = featuredWorkout(row, workout, "lb", "hevy");
    expect(data.weightUnit).toBe("lb");
    expect(data.avgHr).toBe(95);
    expect(data.recording.devices).toEqual(["Garmin HRM 600"]);
    expect(data.recording.coveragePct).toBe(99);
    expect(JSON.stringify(data)).not.toContain("serialNumber");
    expect(data.receipt.every(step => step.status === "done")).toBe(true);
  });
  it("keeps legacy HR readings without inventing timestamps or coverage", () => {
    const data = featuredWorkout({ ...row, hr_data: { samples: [80, 90, 100] } }, null, "kg", null);
    expect(data.recording.points).toEqual([]);
    expect(data.recording.sampleCount).toBe(3);
    expect(data.recording.coveragePct).toBeNull();
    expect(data.durationS).toBeNull();
    expect(data.avgHr).toBe(90);
  });
  it("flags Hevy edits without pretending the saved sync receipt covers those edits", () => {
    const data = featuredWorkout({ ...row, hevy_updated_at: "2026-06-10T15:00:00Z" }, { ...workout, updated_at: "2026-06-11T15:00:00Z" }, "lb", "hevy");
    expect(data.detailsEdited).toBe(true);
  });
});

describe("evidence-based sync receipt", () => {
  it("does not label an activity match as a sets merge or an unconfirmed note as saved", () => {
    const steps = syncReceipt("match", {}, {});
    expect(steps.find(step => step.id === "details")?.status).toBe("unknown");
    expect(steps.find(step => step.id === "note")?.status).toBe("unknown");
    expect(JSON.stringify(steps)).not.toContain("Exercise sets merged");
  });
  it("shows an upload, pending note, and disabled notes distinctly", () => {
    expect(syncReceipt("upload", {}, { notePending: true }).find(step => step.id === "details")?.title).toBe("Workout details uploaded");
    expect(syncReceipt("merge", {}, { notePending: true }).at(-1)?.status).toBe("pending");
    expect(syncReceipt("merge", { noteStatus: "Dashboard only" }, { notePending: true }).at(-1)?.status).toBe("off");
    expect(syncReceipt("merge", { noteStatus: "Hevy note is current" }, {}).at(-1)?.status).toBe("done");
  });
});

function sqlFixture({ empty = false, fail = false, backupId = "sample" } = {}): Sql {
  return (async (strings: TemplateStringsArray) => {
    const query = strings.join("?");
    if (fail) throw Object.assign(new Error("Database unavailable"), { code: "ECONNREFUSED" });
    if (query.includes("FROM synced_workouts")) return empty ? [] : [row];
    if (query.includes("starts_with")) return [{ value: { workout: { ...workout, id: backupId } } }];
    return [{ value: { weight: "lb" } }];
  }) as unknown as Sql;
}

describe("read-only featured workout loader", () => {
  it("reads one selected workout and falls back to its note backup if Hevy is unavailable", async () => {
    const read = vi.fn(async () => { throw new Error("Hevy offline"); });
    const data = await loadFeaturedWorkout(sqlFixture(), read);
    expect(read).toHaveBeenCalledExactlyOnceWith("sample");
    expect(data).toMatchObject({ id: "sample", totalSets: 3, detailSource: "saved", weightUnit: "lb" });
  });
  it("ignores a mismatched Hevy response rather than attributing another workout's details", async () => {
    expect(await loadFeaturedWorkout(sqlFixture(), async () => ({ ...workout, id: "different" }))).toMatchObject({ detailSource: "saved", id: "sample" });
  });
  it("does not use an incorrectly associated saved workout either", async () => {
    expect(await loadFeaturedWorkout(sqlFixture({ backupId: "different" }), async () => null)).toMatchObject({ detailSource: null, totalSets: null, id: "sample" });
  });
  it("does not contact Hevy on an empty account and propagates real database outages", async () => {
    const read = vi.fn(async () => workout);
    expect(await loadFeaturedWorkout(sqlFixture({ empty: true }), read)).toBeNull();
    expect(read).not.toHaveBeenCalled();
    await expect(loadFeaturedWorkout(sqlFixture({ fail: true }), read)).rejects.toThrow("Database unavailable");
  });
});
