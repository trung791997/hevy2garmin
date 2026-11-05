import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { featuredWorkout } from "@/lib/dashboard-workout";
import { WorkoutSpotlight } from "./workout-spotlight";
import { traceSegments } from "./hr-trace";

const data = featuredWorkout({ hevy_id: "example", title: "Full Body", garmin_activity_id: "42", sync_method: "merge", sync_state: { noteStatus: "HR note saved to Hevy" }, hr_data: { hr_samples: [{ time: 0, hr: 90 }, { time: 5, hr: 100 }, { time: 120, hr: 110 }], metadata: { durationS: 1800, coveragePct: 85, source: "watch_recording", devices: ["Garmin HRM 600"], medianIntervalS: 5, longestGapS: 115 } } }, { start_time: "2026-06-10T15:00:00Z", end_time: "2026-06-10T15:30:00Z", exercises: [{ sets: [{ weight_kg: 45.359237, reps: 10 }] }] }, "lb", "hevy");

describe("workout spotlight presentation", () => {
  it("renders all three panels with imperial metrics, readable receipts and sensor caveats", () => {
    const html = renderToStaticMarkup(<WorkoutSpotlight initialData={data} />);
    expect(html).toContain("Full Body");
    expect(html).toContain("1,000");
    expect(html).toContain("lbs");
    expect(html).toContain("Exercise sets merged");
    expect(html).toContain("HR note updated");
    expect(html).toContain("Garmin HRM 600");
    expect(html).toContain("Individual readings may switch between sensors");
    expect(html).toContain('aria-label="Inspect heart-rate recording"');
    expect(html).toContain("/workouts#workout-example");
    expect(html).not.toContain("serialNumber");
  });
  it("shows pending and unknown steps without a complete badge", () => {
    const pending = featuredWorkout({ hevy_id: "example", sync_method: "match", hr_data: { notePending: true } }, null, "kg", null);
    const html = renderToStaticMarkup(<WorkoutSpotlight initialData={pending} />);
    expect(html).toContain("Needs attention");
    expect(html).toContain("Not recorded");
    expect(html).toContain("Hevy HR note pending");
    expect(html).not.toContain(">Complete<");
  });
  it("shows an honest empty state instead of sample workout data", () => {
    const html = renderToStaticMarkup(<WorkoutSpotlight initialData={null} />);
    expect(html).toContain("Once your first workout syncs");
    expect(html).not.toContain("Full Body");
    expect(html).not.toContain("100%");
  });
  it("leaves actual recording gaps in the plotted line", () => {
    const segments = traceSegments(data.recording.points, 5);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toHaveLength(2);
    expect(segments[1]).toHaveLength(1);
  });
});
