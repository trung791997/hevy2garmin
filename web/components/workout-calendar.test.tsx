import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionHistory, TrainingSession } from "@/lib/session-analysis";
import { WorkoutCalendar } from "./workout-calendar";
import { SessionComparison } from "./session-comparison";

const current: TrainingSession = { id: "current", title: "Full Body", startedAt: "2026-11-05T05:30:00Z", durationS: 3600, totalSets: 20, exercises: 2, volumeKg: 1000, exerciseKey: "bench+squat", avgHr: 100, status: "synced", garminActivityId: "123" };
const previous: TrainingSession = { ...current, id: "previous", startedAt: "2026-10-29T04:30:00Z", volumeKg: 900, avgHr: null };
const history: SessionHistory = { sessions: [current, previous], timeZone: "America/Chicago", weightUnit: "lb", nextPage: 4, available: true, warning: null };

describe("training history presentation", () => {
  it("renders pounds, actual local dates, matching criteria, and incomplete-history disclosure", () => {
    const html = renderToStaticMarkup(<WorkoutCalendar initialData={history} />);
    expect(html).toContain("2,205");
    expect(html).toContain("Nov 4, 2026");
    expect(html).toContain("Oct 28, 2026");
    expect(html).toContain("You vs. last time");
    expect(html).toContain("Load older sessions");
    expect(html).toContain("HR and duration changes aren’t performance scores");
    expect(html).toContain("Change unavailable");
    expect(html).not.toContain("NaN");
  });
  it("keeps a missing baseline honest and offers a way to search older history", () => {
    const html = renderToStaticMarkup(<SessionComparison current={current} sessions={[current]} unit="kg" timeZone="America/Chicago" hasMore />);
    expect(html).toContain("Your starting point");
    expect(html).toContain("No earlier matching session loaded");
    expect(html).toContain("Load older sessions to look further back");
    expect(html).not.toContain("comparison-bars");
  });
  it("shows a useful connection state rather than zero-data metrics", () => {
    const html = renderToStaticMarkup(<WorkoutCalendar initialData={{ ...history, available: false, sessions: [] }} />);
    expect(html).toContain("Connect Hevy");
    expect(html).not.toContain("calendar-days");
  });
});
