import { generateDescription } from "hevy2garmin";
import { weightFromKg, type WeightUnit } from "./weight-units";

/** Only the presentation copy is converted. FIT/Hevy sets stay in canonical kg. */
export function workoutDescription(workout: Record<string, unknown>, calories: number | null, avgHr: number | null, unit: WeightUnit = "kg"): string {
  if (unit === "kg") return generateDescription(workout, calories, avgHr);
  const convert = (value: unknown) => value != null && Number.isFinite(Number(value)) ? weightFromKg(Number(value), unit) : value;
  const display = {
    ...workout,
    exercises: Array.isArray(workout.exercises) ? workout.exercises.map((exercise: Record<string, unknown>) => ({
      ...exercise,
      sets: Array.isArray(exercise.sets) ? exercise.sets.map((set: Record<string, unknown>) => ({
        ...set,
        ...(set.weight_kg != null ? { weight_kg: convert(set.weight_kg) } : {}),
        ...(set.weight != null ? { weight: convert(set.weight) } : {}),
      })) : [],
    })) : [],
  };
  // Only the generated weight suffix changes; exercise names and distance units are preserved.
  return generateDescription(display, calories, avgHr)
    .replace(/^(• .+ · -?\d+(?:\.\d+)?)kg( × \d+)$/gm, "$1 lbs$2");
}
