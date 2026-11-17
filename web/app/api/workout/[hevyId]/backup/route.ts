import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { looksLikeZip } from "hevy2garmin";
import { getDb } from "@/lib/db";
import { authEnabled, SESSION_COOKIE, verifySession } from "@/lib/auth";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ hevyId: string }> },
) {
  if (
    authEnabled() &&
    !(await verifySession((await cookies()).get(SESSION_COOKIE)?.value ?? ""))
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { hevyId } = await params,
    sql = getDb();
  const [row] =
    await sql`SELECT b.value FROM synced_workouts s LEFT JOIN hr_cache h ON h.hevy_id=s.hevy_id LEFT JOIN app_cache a ON a.key='sync_state_' || s.hevy_id JOIN app_cache b ON b.key='original_fit_backup_' || COALESCE(h.data->'metadata'->>'sourceActivityId',a.value->>'sourceActivityId') WHERE s.hevy_id=${hevyId} LIMIT 1`;
  if (!row?.value?.fitBase64)
    return NextResponse.json(
      { error: "No original-file backup exists for this workout." },
      { status: 404 },
    );
  const bytes = Buffer.from(row.value.fitBase64, "base64"),
    extension = looksLikeZip(bytes) ? "zip" : "fit";
  return new Response(bytes, {
    headers: {
      "Content-Type":
        extension === "zip" ? "application/zip" : "application/octet-stream",
      "Content-Disposition": `attachment; filename="original-garmin-recording.${extension}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
