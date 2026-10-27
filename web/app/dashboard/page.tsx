import { getDb } from "@/lib/db";
import { loadGarminConnection, loadHevyConnection } from "@/lib/connections";
import { SyncPanel } from "@/components/sync-panel";
import { SyncLoop } from "@/components/sync-loop";
import { BatchSync } from "@/components/batch-sync";
import { AutoSyncToggle } from "@/components/autosync-toggle";
import { ServerSchedule } from "@/components/server-schedule";
import { serverSyncSchedule } from "@/lib/server-schedule";
import { PipelineDiagram } from "@/components/pipeline-diagram";
import { HEVY_TO_GARMIN } from "hevy2garmin";
import { withBasePath } from "@/lib/base-path";
import { UpdateBanner } from "@/components/update-banner";

// Queries the live hevy2garmin Postgres per request — never at build time.
export const dynamic = "force-dynamic";

interface RecentWorkout {
  hevy_id: string;
  title: string;
  synced_at: string | null;
  calories: number;
  avg_hr: number | null;
  garmin_activity_id: string | null;
  status: string;
}

interface SyncLogEntry {
  id: number;
  time: string | null;
  synced: number;
  skipped: number;
  failed: number;
  trigger: string;
}

interface DashboardData {
  dbConfigured: boolean;
  hevyConnected: boolean;
  garminConnected: boolean;
  totalSynced: number;
  syncedThisWeek: number;
  markedSynced: number;
  skipped: number;
  pending: number;
  routinesSynced: number;
  routinesScheduled: number;
  recent: RecentWorkout[];
  syncLog: SyncLogEntry[];
  autoSyncEnabled: boolean;
  autoSyncInterval: number;
}

const EMPTY: DashboardData = {
  dbConfigured: false,
  hevyConnected: false,
  garminConnected: false,
  totalSynced: 0,
  syncedThisWeek: 0,
  markedSynced: 0,
  skipped: 0,
  pending: 0,
  routinesSynced: 0,
  routinesScheduled: 0,
  recent: [],
  syncLog: [],
  autoSyncEnabled: false,
  autoSyncInterval: 120,
};

async function loadDashboard(): Promise<DashboardData> {
  let sql: ReturnType<typeof getDb>;
  try {
    sql = getDb();
  } catch {
    return EMPTY;
  }

  // Every query is guarded so a missing/empty table degrades to a sane default
  // rather than crashing the whole page render.
  const [hevyConn, garminConn, counts, recent, syncLog, autoSync, pendingRow, routinesRow] = await Promise.all([
    loadHevyConnection(sql),
    loadGarminConnection(sql),
    sql`
      SELECT
        count(*) FILTER (WHERE COALESCE(status, 'success') = 'success')::int AS total,
        count(*) FILTER (
          WHERE COALESCE(status, 'success') = 'success'
            AND synced_at >= (now() - interval '7 days')
        )::int AS week,
        count(*) FILTER (WHERE status = 'manual')::int AS marked,
        count(*) FILTER (WHERE status = 'skipped')::int AS skipped
      FROM synced_workouts
    `.catch(() => [] as Array<{ total: number; week: number; marked: number; skipped: number }>),
    sql`
      SELECT hevy_id, title, synced_at, calories, avg_hr,
             garmin_activity_id, COALESCE(status, 'success') AS status
      FROM synced_workouts
      ORDER BY synced_at DESC
      LIMIT 10
    `.catch(() => [] as RecentWorkout[]),
    sql`
      SELECT id, time, synced, skipped, failed, trigger
      FROM sync_log
      ORDER BY id DESC
      LIMIT 10
    `.catch(() => [] as SyncLogEntry[]),
    sql`
      SELECT value FROM app_cache WHERE key = 'auto_sync' LIMIT 1
    `.catch(() => [] as Array<{ value: unknown }>),
    sql`SELECT count(*)::int AS n FROM pending_uploads`.catch(() => [] as Array<{ n: number }>),
    sql`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (
          WHERE hevy_routine_id IN (SELECT DISTINCT hevy_routine_id FROM routine_schedules)
        )::int AS scheduled
      FROM synced_routines
    `.catch(() => [] as Array<{ total: number; scheduled: number }>),
  ]);

  const autoSyncValue =
    autoSync[0]?.value && typeof autoSync[0].value === "object"
      ? (autoSync[0].value as Record<string, unknown>)
      : {};

  return {
    dbConfigured: true,
    // See lib/connections.ts for which row means what. The `recent` fallbacks keep a user who
    // synced under an older build showing as connected even if their credential row is odd.
    hevyConnected: hevyConn.connected || recent.length > 0,
    garminConnected:
      garminConn.connected || recent.some((r) => r.garmin_activity_id != null),
    totalSynced: counts[0]?.total ?? 0,
    syncedThisWeek: counts[0]?.week ?? 0,
    markedSynced: counts[0]?.marked ?? 0,
    skipped: counts[0]?.skipped ?? 0,
    pending: pendingRow[0]?.n ?? 0,
    routinesSynced: routinesRow[0]?.total ?? 0,
    routinesScheduled: routinesRow[0]?.scheduled ?? 0,
    recent: recent.map((r) => ({
      hevy_id: r.hevy_id,
      title: r.title ?? "",
      synced_at: r.synced_at ?? null,
      calories: Number(r.calories) || 0,
      avg_hr: r.avg_hr != null ? Number(r.avg_hr) : null,
      garmin_activity_id: r.garmin_activity_id ?? null,
      status: r.status,
    })),
    syncLog: syncLog.map((r) => ({
      id: Number(r.id),
      time: r.time ?? null,
      synced: Number(r.synced) || 0,
      skipped: Number(r.skipped) || 0,
      failed: Number(r.failed) || 0,
      trigger: r.trigger ?? "manual",
    })),
    autoSyncEnabled: Boolean(autoSyncValue.enabled),
    autoSyncInterval: Number(autoSyncValue.interval_minutes) || 120,
  };
}

function fmtDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ConnectionStatus({ label, connected }: { label: string; connected: boolean }) {
  return (
    <div className="connection-item">
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={connected ? "text-success" : "text-warm"} aria-hidden="true">
        <circle cx="10" cy="10" r="7.5" />
        {connected ? <path d="m6.5 10 2.3 2.3 4.7-4.6" /> : <path d="M10 6v5m0 2v1" />}
      </svg>
      <strong>{label}</strong>
      <span className={connected ? "text-success" : "text-warm"}>{connected ? "Connected" : "Not connected"}</span>
    </div>
  );
}

function WorkoutStatus({ status }: { status: string }) {
  const states: Record<string, { label: string; color: string }> = {
    success: { label: "Synced", color: "text-success" },
    manual: { label: "Marked synced", color: "text-warm" },
    skipped: { label: "Skipped", color: "text-text-muted" },
    failed: { label: "Failed", color: "text-danger" },
  };
  const state = states[status] ?? { label: status, color: "text-text-secondary" };
  return <span className={`status-label ${state.color}`}>{status === "success" && <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="10" cy="10" r="7.5" /><path d="m6.5 10 2.3 2.3 4.7-4.6" /></svg>}{state.label}</span>;
}

export default async function DashboardPage() {
  const data = await loadDashboard();
  const ready = data.hevyConnected && data.garminConnected;
  const schedule = serverSyncSchedule();

  return (
    <main className="dashboard-page mx-auto max-w-5xl px-4 py-8 md:px-6">
      <header className="page-heading">
        <h1>Dashboard</h1>
        <a className="text-link" href={withBasePath("/setup")}>{ready ? "Connections" : "Connect accounts"} <span aria-hidden="true">↗</span></a>
      </header>

      <UpdateBanner />
      {!data.dbConfigured && <div className="mb-6 rounded-lg border border-warm/40 bg-warm/10 p-4 text-sm text-warm">Connect a database to start syncing your workouts.</div>}

      <section className="connection-strip" aria-label="Account connections">
        <ConnectionStatus label="Hevy" connected={data.hevyConnected} />
        <ConnectionStatus label="Garmin Connect" connected={data.garminConnected} />
      </section>

      <dl className="overview-totals" aria-label="Workout totals">
        <div><dt>On Garmin</dt><dd>{data.totalSynced}</dd></div>
        <div className="total-week"><dt>Synced this week</dt><dd>{data.syncedThisWeek}</dd></div>
        <div className={data.pending === 0 ? "total-pending" : ""}><dt>Pending</dt><dd className={data.pending > 0 ? "text-warm" : ""}>{data.pending}</dd></div>
      </dl>

      {!ready && data.dbConfigured && <p className="mb-5 text-sm text-warm">Connect {!data.hevyConnected && !data.garminConnected ? "Hevy and Garmin" : !data.hevyConnected ? "Hevy" : "Garmin"} to start syncing.</p>}
      <section className="sync-section" aria-label="Workout sync">
        <SyncLoop ready={ready} />
        <details className="sync-options">
          <summary><span className="sync-options-label"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 17h16" /><circle cx="8" cy="7" r="2" /><circle cx="16" cy="17" r="2" /></svg>More sync options</span><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m5 8 5 5 5-5" /></svg></summary>
          <SyncPanel ready={ready} />
          <BatchSync ready={ready} onServer={schedule != null} />
        </details>
      </section>

      <section className="recent-section">
        <div className="section-heading">
          <h2>Recent workouts</h2>
          <a className="text-link" href={withBasePath("/workouts")}>View all <span aria-hidden="true">→</span></a>
        </div>
        {data.recent.length === 0 ? (
          <div className="empty-state"><p>No workouts synced yet.</p><p>Your completed syncs will appear here.</p></div>
        ) : (
          <ul className="activity-list">
            {data.recent.map((w) => (
              <li key={w.hevy_id}>
                <div className="min-w-0">
                  <div className="activity-title truncate">{w.title || "Untitled workout"}</div>
                  <div className="activity-meta">{fmtDate(w.synced_at)}{w.calories > 0 && <> · {w.calories} kcal</>}{w.avg_hr != null && <> · {w.avg_hr} bpm</>}</div>
                </div>
                <div className="activity-actions">
                  <WorkoutStatus status={w.status} />
                  {w.garmin_activity_id && <a className="text-link garmin-activity-link inline-flex items-center gap-1.5" href={`https://connect.garmin.com/modern/activity/${encodeURIComponent(w.garmin_activity_id)}`} target="_blank" rel="noreferrer" aria-label={`Open ${w.title || "workout"} in Garmin Connect`}>View in Garmin<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M11 3h6v6m-1-5-8 8m0-8H4v12h12v-4" /></svg></a>}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="secondary-totals">
          <span><strong>{data.markedSynced}</strong> marked synced</span>
          <span><strong>{data.skipped}</strong> skipped</span>
          <a href={withBasePath("/routines")} className="hover:text-text"><strong>{data.routinesSynced}</strong> routines synced{data.routinesScheduled > 0 ? ` · ${data.routinesScheduled} scheduled` : ""}</a>
        </div>
      </section>

      <section>
        <div className="section-heading"><h2>Sync log</h2><a className="text-link" href={withBasePath("/history")}>View history <span aria-hidden="true">→</span></a></div>
        {data.syncLog.length === 0 ? (
          <div className="empty-state"><p>No sync runs recorded yet.</p></div>
        ) : (
          <div className="sync-log-table">
            <table>
              <thead><tr><th scope="col">When</th><th scope="col">Trigger</th><th scope="col">Synced</th><th scope="col">Skipped</th><th scope="col">Failed</th></tr></thead>
              <tbody>{data.syncLog.map((entry) => (
                <tr key={entry.id}>
                  <td className="whitespace-nowrap">{fmtDate(entry.time)}</td>
                  <td>{entry.trigger}</td>
                  <td className="tabular-nums">{entry.synced}</td>
                  <td className="tabular-nums">{entry.skipped}</td>
                  <td className={`tabular-nums ${entry.failed > 0 ? "!text-danger" : ""}`}>{entry.failed}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      {schedule ? <div className="mt-7"><ServerSchedule schedule={schedule} source={process.env.VERCEL ? "vercel" : "server"} /></div> : <AutoSyncToggle enabled={data.autoSyncEnabled} interval={data.autoSyncInterval} available={Boolean(process.env.VERCEL)} />}
      <PipelineDiagram mappingCount={Object.keys(HEVY_TO_GARMIN).length} />
    </main>
  );
}
