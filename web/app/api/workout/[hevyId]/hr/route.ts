import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { cookies } from "next/headers";
import { authEnabled, SESSION_COOKIE, verifySession } from "@/lib/auth";
import { refreshWorkoutHr } from "@/lib/hr-refresh";

// Reads the live hevy2garmin Postgres per request — never at build time.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/workout/[hevyId]/hr
 *
 * Returns the cached heart-rate timeline for a workout's matched Garmin
 * activity from the `hr_cache` table (data.samples) — mirroring
 * db.get_cached_hr. Read-only: it never calls Garmin.
 *
 * The sync populates the cache whenever it resolves heart rate from a source
 * other than the cache itself, so this returns `{ samples: null }` for workouts
 * that have not been synced yet, or synced without any HR being found.
 *
 * That was not true until #612: nothing wrote this table outside the demo seed,
 * so on a real install the chart was always empty and this comment claimed
 * otherwise.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ hevyId: string }> },
) {
  const { hevyId } = await params;
  if (!hevyId) {
    return NextResponse.json({ error: "hevyId is required." }, { status: 400 });
  }

  let sql: ReturnType<typeof getDb>;
  try {
    sql = getDb();
  } catch {
    return NextResponse.json({ error: "DATABASE_URL not configured." }, { status: 503 });
  }

  try {
    const [state] = await sql`SELECT value FROM app_cache WHERE key=${`sync_state_${hevyId}`} LIMIT 1`;
    const rows = (await sql`
      SELECT data, cached_at FROM hr_cache WHERE hevy_id = ${hevyId} LIMIT 1
    `) as { data: unknown; cached_at: string | null }[];

    if (rows.length === 0) {
      const sourceId = state?.value?.sourceActivityId;
      const backups = sourceId ? await sql`SELECT key FROM app_cache WHERE key=${`original_fit_backup_${sourceId}`} LIMIT 1` : [];
      return NextResponse.json({ samples: null, cached_at: null, syncState: state?.value ?? null, backupAvailable: backups.length > 0 });
    }

    const data = rows[0].data;
    const raw = data && typeof data === "object" ? (data as Record<string, unknown>).samples : null;
    const samples = Array.isArray(raw)
      ? raw.map((v) => Number(v)).filter((v) => Number.isFinite(v))
      : null;

    const metadata = data && typeof data === "object" ? (data as Record<string, unknown>).metadata as { sourceActivityId?: string } | undefined : undefined;
    const sourceId = metadata?.sourceActivityId ?? state?.value?.sourceActivityId;
    const backups = sourceId ? await sql`SELECT key FROM app_cache WHERE key=${`original_fit_backup_${sourceId}`} LIMIT 1` : [];
    return NextResponse.json({
      samples: samples && samples.length > 0 ? samples : null,
      points: data && typeof data === "object" ? (data as Record<string, unknown>).hr_samples ?? null : null,
      metadata: data && typeof data === "object" ? (data as Record<string, unknown>).metadata ?? null : null,
      cached_at: rows[0].cached_at ?? null,
      backupAvailable: backups.length > 0,
      syncState: state?.value ?? null,
    });
  } catch (err) {
    console.error("hr read failed:", err);
    return NextResponse.json({ error: "Failed to read HR." }, { status: 500 });
  }
}

export async function POST(_request: Request, { params }: { params: Promise<{ hevyId: string }> }) {
  if (authEnabled() && !await verifySession((await cookies()).get(SESSION_COOKIE)?.value ?? "")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { hevyId } = await params;
    return NextResponse.json(await refreshWorkoutHr(getDb(), hevyId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "HR refresh failed." }, { status: 502 });
  }
}
