import { describe, expect, it, vi } from "vitest";
vi.mock("./hevy-sync", () => ({ resolveHevyKey: async () => "test-key" }));
import {
  hevyUpdatePayload,
  hrNote,
  mergeHrNote,
  writeHevyHrNote,
} from "./hevy-hr-note";
import { analyseHr, type HrRecording } from "./hr-analysis";
import type { Sql } from "./pending-store";
const points = [
  { time: 0, hr: 100 },
  { time: 1, hr: 120 },
];
const recording: HrRecording = {
  points,
  metadata: analyseHr(points, 2, "watch_recording", ["Garmin CIRQA"]),
};
const workout = {
  id: "w",
  title: "Workout",
  description: "My personal note ✨",
  start_time: "2026-10-27T10:00:00Z",
  end_time: "2026-10-27T11:00:00Z",
  updated_at: "2026-10-27T11:00:00Z",
  exercises: [
    {
      index: 0,
      title: "Squat",
      exercise_template_id: "ABC",
      notes: "Keep this exercise note",
      superset_id: 0,
      sets: [
        {
          index: 0,
          type: "normal",
          reps: 0,
          weight_kg: 0,
          distance_meters: null,
          duration_seconds: 20,
          custom_metric: null,
          rpe: null,
        },
      ],
    },
  ],
};
function database() {
  const calls: unknown[][] = [];
  const sql = (async (_s: TemplateStringsArray, ...v: unknown[]) => {
    calls.push(v);
    return [];
  }) as unknown as Sql;
  sql.json = (v: unknown) => v;
  return { sql, calls };
}
describe("managed Hevy HR notes", () => {
  it("keeps personal text and updates one managed block idempotently", () => {
    const first = mergeHrNote(workout.description, hrNote(recording));
    expect(first).toContain(workout.description);
    expect(first).toContain("Garmin CIRQA");
    expect(first).toContain("not the source of every reading");
    expect(mergeHrNote(first, hrNote(recording))).toBe(first);
    const changed = mergeHrNote(
      first,
      hrNote({
        ...recording,
        metadata: { ...recording.metadata, devices: ["Garmin HRM 600"] },
      }),
    );
    expect(changed).toContain("HRM 600");
    expect(changed).not.toContain("CIRQA");
    expect(changed.match(/\[hevy2garmin HR\]/g)).toHaveLength(1);
  });
  it("preserves exercise notes, supersets, nulls, zero values and set metrics", () => {
    const payload = hevyUpdatePayload(workout, "HR note", "private").workout;
    expect(payload.is_private).toBe(true);
    expect(payload.exercises[0]).toMatchObject({
      notes: "Keep this exercise note",
      superset_id: 0,
      sets: [
        { reps: 0, weight_kg: 0, custom_metric: null, duration_seconds: 20 },
      ],
    });
    expect(payload.title).toBe(workout.title);
    expect(payload.start_time).toBe(workout.start_time);
    expect(payload.exercises[0]).not.toHaveProperty("title");
  });
  it("backs up first, rechecks for edits and confirms the note after PUT", async () => {
    let saved = structuredClone(workout);
    const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => {
      if (options?.method === "PUT")
        saved = {
          ...saved,
          ...JSON.parse(String(options.body)).workout,
          updated_at: "2026-10-27T12:00:00Z",
        };
      return Response.json(saved);
    });
    const db = database();
    expect(
      await writeHevyHrNote(
        db.sql,
        "w",
        recording,
        "private",
        fetcher as typeof fetch,
      ),
    ).toBe("HR note saved to Hevy");
    expect(fetcher).toHaveBeenCalledTimes(4);
    const put = fetcher.mock.calls.find((c) => c[1]?.method === "PUT")!;
    const payload = JSON.parse(String(put[1]!.body));
    expect(payload.workout.is_private).toBe(true);
    expect(payload.workout.description).toContain(workout.description);
    expect(db.calls[0][0]).toMatch(/^hevy_note_backup_w_/);
    expect(db.calls.at(-1)).toEqual(["2026-10-27T12:00:00Z", "w"]);
  });
  it("never sends a PUT if Hevy changed between reads", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(workout))
      .mockResolvedValueOnce(
        Response.json({ ...workout, description: "Edited on my phone" }),
      );
    await expect(
      writeHevyHrNote(database().sql, "w", recording, "private", fetcher),
    ).rejects.toThrow("changed");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not call Hevy when notes are dashboard-only or privacy is undecided", async () => {
    const fetcher = vi.fn();
    await writeHevyHrNote(
      database().sql,
      "w",
      recording,
      "dashboard_only",
      fetcher,
    );
    await writeHevyHrNote(database().sql, "w", recording, null, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
