import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mergeSearchRange, type CandidateActivity, type GarminGateway } from "hevy2garmin";
import { withGarminLocalDates } from "./garmin-local-dates";
import { planSync } from "./sync-plan";
import { DEFAULT_SYNC_SETTINGS } from "./sync-settings";

function localCalendarListing(activities: CandidateActivity[]) {
  const list = vi.fn(async (start: string, end: string) => activities.filter((a) => {
    const day = a.startTimeLocal!.slice(0, 10);
    return day >= start && day <= end;
  }));
  return { list, gateway: { activitiesByDate: list } as unknown as GarminGateway };
}

describe("Garmin local-date activity listing", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-01T00:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });
  it.each([
    { name: "an evening session west of UTC", local: "2026-10-28 23:50:11", start: "04:50", end: "06:10" },
    { name: "a morning session east of UTC", local: "2026-10-30 01:50:11", start: "12:50", end: "14:10" },
  ])("finds $name without changing the timestamp match", async ({ local, start, end }) => {
    const workout = { id: "workout", start_time: `2026-10-29T${start}:00Z`, end_time: `2026-10-29T${end}:00Z` };
    const activity = { activityId: 42, activityName: "Strength", manufacturer: "GARMIN", activityType: { typeKey: "strength_training" }, startTimeGMT: `2026-10-29 ${start}:11`, startTimeLocal: local, duration: 4800 };
    const { list, gateway } = localCalendarListing([activity]);
    const range = mergeSearchRange(workout)!;
    const unpadded = await gateway.activitiesByDate(range.start, range.end);
    expect(planSync(workout, unpadded, DEFAULT_SYNC_SETTINGS).action).toBe("waiting");
    const padded = withGarminLocalDates(gateway);
    const plan = planSync(workout, await padded.activitiesByDate(range.start, range.end), DEFAULT_SYNC_SETTINGS);
    expect(list).toHaveBeenLastCalledWith("2026-10-28", "2026-10-30");
    expect(plan.action).toBe("merge");
    expect(plan.selectedId).toBe(42);
    expect(plan.candidates[0].overlapPct).toBe(100);
    expect(plan.candidates[0].start).toBe(`2026-10-29T${start}:11.000Z`);
    // Engine and preview can independently repeat the same lookup.
    await padded.activitiesByDate(range.start, range.end);
    expect(list).toHaveBeenLastCalledWith("2026-10-28", "2026-10-30");
  });

  it("still excludes an unrelated session returned by the wider listing", async () => {
    const workout = { id: "workout", start_time: "2026-10-29T04:50:00Z", end_time: "2026-10-29T06:10:00Z" };
    const other = { activityId: 7, manufacturer: "GARMIN", activityType: { typeKey: "strength_training" }, startTimeGMT: "2026-10-28 04:50:00", startTimeLocal: "2026-10-27 23:50:00", duration: 4800 };
    const { gateway } = localCalendarListing([other]);
    const activities = await withGarminLocalDates(gateway).activitiesByDate("2026-10-28", "2026-10-29");
    expect(activities).toHaveLength(1);
    expect(planSync(workout, activities, DEFAULT_SYNC_SETTINGS)).toMatchObject({ action: "waiting", selectedId: null, candidates: [] });
  });

  it("expands across year boundaries and passes listing failures through", async () => {
    const list = vi.fn().mockRejectedValue(new Error("Garmin unavailable"));
    const gateway = withGarminLocalDates({ activitiesByDate: list } as unknown as GarminGateway);
    await expect(gateway.activitiesByDate("2026-12-31", "2027-01-01")).rejects.toThrow("Garmin unavailable");
    expect(list).toHaveBeenCalledWith("2026-12-30", "2027-01-02");
  });
});
