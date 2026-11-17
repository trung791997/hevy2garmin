import { describe, expect, it } from "vitest";
import { generateDescription } from "hevy2garmin";
import { convertWeightEntry, weightFromKg, weightToKg } from "./weight-units";
import { workoutDescription } from "./workout-description";

describe("weight conversion", () => {
  it("converts in both directions without changing the original entry on repeated switches", () => {
    expect(weightToKg(100, "lb")).toBeCloseTo(45.359237, 8);
    expect(weightFromKg(45.359237, "lb")).toBeCloseTo(100, 8);
    const entry = { value: "83.6", unit: "kg" as const };
    expect(convertWeightEntry(entry, "lb")).toBe("184.31");
    expect(convertWeightEntry(entry, "kg")).toBe("83.6");
    expect(convertWeightEntry(entry, "lb")).toBe("184.31");
    expect(entry.value).toBe("83.6");
  });
  it("supports zero and blank input without NaN in the other field", () => {
    expect(convertWeightEntry({ value: "", unit: "lb" }, "kg")).toBe("");
    expect(convertWeightEntry({ value: "0", unit: "lb" }, "kg")).toBe("0");
    expect(convertWeightEntry({ value: "abc", unit: "lb" }, "kg")).toBe("");
  });
});

describe("workout note units", () => {
  const workout = { title: "Strength", start_time: "2026-10-29T04:00:00Z", end_time: "2026-10-29T05:00:00Z", exercises: [
    { title: "Squat (Barbell)", sets: [{ type: "warmup", weight_kg: 20, reps: 8 }, { type: "normal", weight_kg: weightToKg(225, "lb"), reps: 5 }] },
    { title: "Row (50kg machine)", sets: [{ type: "normal", weight: 50, reps: 10 }] },
    { title: "Plank", sets: [{ type: "normal", duration_seconds: 60 }] },
    { title: "Run", sets: [{ type: "normal", distance_meters: 1000, duration_seconds: 300 }] },
  ] };
  it("converts unrounded source weights, preserving exercise names and non-weight measurements", () => {
    const snapshot = structuredClone(workout);
    const note = workoutDescription(workout, 392, 89, "lb");
    expect(note).toContain("225.0 lbs × 5");
    expect(note).toContain("Row (50kg machine): 1 set · 110.2 lbs × 10");
    expect(note).toContain("Plank: 1 set · 1min");
    expect(note).toContain("Run: 1 set · 1.0km · 5min");
    expect(note).toContain("392 kcal");
    expect(note).toContain("avg 89 bpm");
    expect(workout).toEqual(snapshot);
  });
  it("retains the engine's metric output when kilograms are selected", () => {
    expect(workoutDescription(workout, 392, 89, "kg")).toBe(generateDescription(workout, 392, 89));
  });
});
