import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { databaseNotAnswering } from "@/lib/db-down";
import { HistoryUnavailable, loadSessionHistory } from "@/lib/session-history";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Authenticated by proxy.ts. Opening the calendar never starts a sync. */
export async function GET(request: NextRequest) {
  const value = request.nextUrl.searchParams.get("page") ?? "1";
  if (!/^[1-9]\d{0,3}$/.test(value)) return NextResponse.json({ error: "Invalid history page." }, { status: 400 });
  try {
    return NextResponse.json(await loadSessionHistory(getDb(), Number(value)), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof HistoryUnavailable) return NextResponse.json({ error: error.message }, { status: 502, headers: { "Cache-Control": "private, no-store" } });
    return databaseNotAnswering("dashboard/sessions", error);
  }
}
