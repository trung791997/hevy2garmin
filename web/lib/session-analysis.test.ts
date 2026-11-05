import { describe, expect, it } from "vitest";
import { comparisonMetrics, monthCells, previousSession, shiftMonth, trainingDay, type TrainingSession } from "./session-analysis";

const session = (id: string, startedAt: string, overrides: Partial<TrainingSession> = {}): TrainingSession => ({
  id, startedAt, title: "Full Body", durationS: 3600, totalSets: 20, exercises: 2, volumeKg: 1000,
  exerciseKey: '["id:bench","id:squat"]', avgHr: 100, status: "synced", garminActivityId: null, ...overrides,
});

describe("local training calendar", () => {
  it("uses the workout's local day, including late nights and year boundaries", () => {
    expect(trainingDay("2026-11-05T05:30:00Z", "America/Chicago")).toBe("2026-11-04");
    expect(trainingDay("2027-01-01T00:30:00Z", "America/Los_Angeles")).toBe("2026-12-31");
  });
  it("keeps both occurrences of a repeated DST hour on the same day", () => {
    expect(trainingDay("2026-11-01T06:30:00Z", "America/Chicago")).toBe("2026-11-01");
    expect(trainingDay("2026-11-01T07:30:00Z", "America/Chicago")).toBe("2026-11-01");
    expect(trainingDay("2026-03-08T08:30:00Z", "America/Chicago")).toBe("2026-03-08");
  });
  it("builds Monday-first full weeks and handles leap years and month rollovers", () => {
    const cells = monthCells("2028-02");
    expect(cells[0]).toBeNull();
    expect(cells[1]).toBe("2028-02-01");
    expect(cells.filter(Boolean)).toHaveLength(29);
    expect(cells.length % 7).toBe(0);
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
  });
});

describe("session comparisons", () => {
  const current = session("current", "2026-11-05T12:00:00Z");
  it("selects the nearest strictly earlier session with the same name and lineup", () => {
    const previous = session("previous", "2026-11-01T12:00:00Z", { title: " full   BODY " });
    const sessions = [session("old", "2026-10-01T12:00:00Z"), current, session("future", "2026-11-06T12:00:00Z"),
      session("wrong-lineup", "2026-11-04T12:00:00Z", { exerciseKey: '["id:curl"]' }),
      session("wrong-title", "2026-11-04T12:00:00Z", { title: "Leg day" }), previous];
    expect(previousSession(current, sessions)?.id).toBe("previous");
    expect(previousSession({ ...current, exerciseKey: null }, sessions)).toBeNull();
    expect(previousSession(current, [current])).toBeNull();
  });
  it("converts canonical kg for both sessions before calculating imperial deltas", () => {
    const before = session("before", "2026-11-01T12:00:00Z", { volumeKg: 500, durationS: 3000, totalSets: 16, avgHr: 110 });
    const metrics = comparisonMetrics(current, before, "lb");
    expect(metrics[0].current).toBeCloseTo(2204.6226);
    expect(metrics[0].previous).toBeCloseTo(1102.3113);
    expect(metrics[0].delta).toBeCloseTo(1102.3113);
    expect(metrics[0].percent).toBe(100);
    expect(metrics[1]).toMatchObject({ current: 60, previous: 50, delta: 10, unit: "min" });
    expect(metrics[2].delta).toBe(4);
    expect(metrics[3].delta).toBe(-10);
    expect(current.volumeKg).toBe(1000);
  });
  it("never invents missing values or divides by a zero baseline", () => {
    const before = session("zero", "2026-11-01T12:00:00Z", { volumeKg: 0, avgHr: null });
    expect(comparisonMetrics(current, before, "kg")[0]).toMatchObject({ delta: 1000, percent: null });
    expect(comparisonMetrics(current, before, "kg")[3]).toMatchObject({ previous: null, delta: null, percent: null });
    expect(comparisonMetrics(current, null, "kg").every(metric => metric.previous === null && metric.delta === null)).toBe(true);
  });
});
