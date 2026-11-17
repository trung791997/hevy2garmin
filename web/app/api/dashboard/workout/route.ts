import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { databaseNotAnswering } from "@/lib/db-down";
import { loadFeaturedWorkout } from "@/lib/dashboard-workout";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Session-protected by proxy.ts, like the other dashboard read endpoints. */
export async function GET() {
  try {
    const workout = await loadFeaturedWorkout(getDb());
    return NextResponse.json({ workout }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return databaseNotAnswering("dashboard/workout", error);
  }
}
