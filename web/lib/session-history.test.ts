import { afterEach, describe, expect, it, vi } from "vitest";
import type { Sql } from "./pending-store";
vi.mock("./hevy-sync", () => ({ resolveHevyKey: vi.fn(async () => "test-only-key") }));
import { resolveHevyKey } from "./hevy-sync";
import { HistoryUnavailable, loadSessionHistory, trainingSession } from "./session-history";

const workout = { id: "example", title: "Full Body", start_time: "2026-11-05T05:30:00Z", end_time: "2026-11-05T06:30:00Z",
  description: "private note must not be returned", exercises: [{ exercise_template_id: "bench", sets: [{ weight_kg: 60, reps: 5 }] }] };
const sql = (async (strings: TemplateStringsArray) => {
  const query = strings.join("?");
  if (query.includes("app_cache")) return [{ key: "display_units", value: { weight: "lb" } }, { key: "user_profile", value: { timezone: "America/Chicago" } }];
  if (query.includes("pending_uploads")) return [];
  return [{ hevy_id: "example", status: "success", garmin_activity_id: "123", avg_hr: 99 }];
}) as unknown as Sql;
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("read-only session history", () => {
  it("returns only presentation fields with actual workout dates and saved preferences", async () => {
    const result = await loadSessionHistory(sql, 1, async () => ({ workouts: [workout], page_count: 1 }));
    expect(result).toMatchObject({ weightUnit: "lb", timeZone: "America/Chicago", nextPage: null, available: true });
    expect(result.sessions[0]).toMatchObject({ startedAt: new Date(workout.start_time).toISOString(), volumeKg: 300, totalSets: 1, avgHr: 99, status: "synced" });
    expect(JSON.stringify(result)).not.toContain("private note");
    expect(JSON.stringify(result)).not.toContain("sets\"");
  });
  it("limits each request to three consecutive pages and exposes the continuation", async () => {
    const read = vi.fn(async (page: number) => ({ workouts: [{ ...workout, id: `sample-${page}` }], page_count: 20 }));
    const result = await loadSessionHistory(sql, 4, read);
    expect(read.mock.calls.map(call => call[0])).toEqual([4, 5, 6]);
    expect(result.nextPage).toBe(7);
    expect(result.sessions).toHaveLength(3);
  });
  it("distinguishes a partial page failure from a complete or empty history", async () => {
    const read = vi.fn(async (page: number) => { if (page === 2) throw new Error("Rate limited"); return { workouts: [workout], page_count: 5 }; });
    const result = await loadSessionHistory(sql, 1, read);
    expect(result.nextPage).toBe(2);
    expect(result.warning).toContain("Some history could not be loaded");
    expect(result.sessions).toHaveLength(1);
    await expect(loadSessionHistory(sql, 1, async () => { throw new Error("Offline"); })).rejects.toBeInstanceOf(HistoryUnavailable);
  });
  it("caches bounded GET requests and fails visibly on malformed upstream data", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ workouts: [workout], page_count: 1 })));
    vi.stubGlobal("fetch", fetcher);
    await loadSessionHistory(sql);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]).toEqual(["https://api.hevyapp.com/v1/workouts?page=1&pageSize=10", expect.objectContaining({ next: { revalidate: 300 } })]);
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ wrong: [] })));
    await expect(loadSessionHistory(sql)).rejects.toBeInstanceOf(HistoryUnavailable);
  });
  it("keeps the calendar distinct from sync eligibility and status", () => {
    expect(trainingSession(workout)?.status).toBe("not_synced");
    expect(trainingSession(workout, { status: "skipped" })?.status).toBe("skipped");
    expect(trainingSession(workout, { status: "manual" })?.status).toBe("marked");
    expect(trainingSession(workout, { status: "success", garmin_activity_id: "123" }, true)?.status).toBe("pending");
    expect(trainingSession({ ...workout, start_time: "invalid" })).toBeNull();
    expect(trainingSession({ ...workout, exercises: [{ sets: [] }] })?.exerciseKey).toBeNull();
  });
  it("does not fetch or present an empty account when Hevy is disconnected", async () => {
    vi.mocked(resolveHevyKey).mockResolvedValueOnce(null);
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect(await loadSessionHistory(sql)).toMatchObject({ available: false, sessions: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
