# Vercel dashboard

Live dashboard: https://hevy2garmin-dashboard.vercel.app

Project: `trung791997s-projects/hevy2garmin-dashboard`.
The Next.js app uses Root Directory `web` and Node.js 24.

The dedicated Neon database `hevy2garmin-dashboard-db` contains the migrated local
account connections, settings, and sync history. Its production connection is
provided by the Vercel integration. The existing older Vercel projects have their
own database and were not changed.

The dashboard keeps the same login password as the local setup.
`H2G_DISPLAY_TIMEZONE=America/Chicago` preserves local dates in server-rendered
history; workout timezone remains the separate saved profile setting. Signing and cron
secrets are separate production secrets stored in Vercel. Do not commit or upload
`.local/`, `.env` files, database dumps, or Vercel authentication state.

## Garmin

`H2G_GARMIN_BROWSER_ONLY=true` keeps Garmin email/password fields out of the app.
On Vercel, `H2G_DIRECT_GARMIN_LOGIN=false` uses the existing Cloudflare sign-in
service to exchange a ticket after signing in on Garmin's own site. The form
explains this exchange. Saved Garmin tokens were migrated with the database.

On the Mac, browser-only sign-in still exchanges directly with Garmin. Local
configuration in `web/.env.local` remains separate from cloud configuration.

## Scheduled sync

`web/vercel.json` schedules `/api/cron/sync` daily at 08:00 UTC. Vercel authenticates
this request using the production `CRON_SECRET`. Manual sync remains available.
`H2G_SERVER_SYNC_SCHEDULE="daily at 08:00 UTC"` shows the actual Vercel schedule
instead of the GitHub Actions toggle. No GitHub token is needed for this schedule.

At cutover, the saved sync start date was set to `2026-10-26` as requested.
The 46 older unsynced workouts are excluded. This setting can be changed in
Settings; clearing it makes the older workouts eligible again. No historical
workouts were uploaded during deployment verification.

## Deploy an update

From the repository root, verify the linked project before deploying:

```sh
npx vercel project inspect --non-interactive --scope trung791997s-projects
npx vercel deploy --dry --json --scope trung791997s-projects
npx vercel deploy --prod --skip-domain --scope trung791997s-projects
```

Check the staged deployment, then promote that same URL with `vercel promote`.
The `.vercelignore` file excludes private local state from uploads. Pull cloud
development variables into `.local/vercel-cloud.env`, not `web/.env.local`, to
preserve the local installation. Production secrets are not returned by env pulls.

Private pre-migration snapshots and the table-comparison report are in `.local/`.

## HR and watch activity improvements

The app prefers the matched activity's original FIT HR over daily monitoring,
including when watch enhancement is disabled. It detects external HR monitors
from FIT device metadata (including CIRQA and HRM 600 when named), not from a
user-selected default. It preserves the watch-recorded stream. Connected-device
metadata cannot prove which sensor supplied every sample; unknown or multiple
monitors are identified honestly in the dashboard and Hevy description.

HR fusion, enhancement and wait-for-watch default on. Merge keeps the original
watch activity and metrics. Preview lists eligible matches, overlap, start drift,
changes and retained data; close matches require a manual selection. A failed
in-place merge cannot fall back to a separate upload. A missing watch activity
stays pending unless the user explicitly chooses a new upload. The existing daily
cron retries waiting workouts and up to three pending HR/note updates per run.

Hevy HR notes use a replaceable managed block, preserve personal and exercise
notes, and back up the current workout before a full-workout update. The user
chose private workouts for these updates because the public Hevy API does not
return current privacy. Two reads check for concurrent edits; Hevy has no
documented conditional-write API. Read-back verifies the returned workout.

Replacement requires a durable full original FIT, original sets and activity
metadata. The backup is checksum-verified after saving. Deletion also requires
reading the new activity and FIT, retaining at least 95% of the original HR
samples when HR fusion is enabled, and checking mapped exercise names. If any
check fails, the original remains and the workout requires review. Recovery uses
the same deletion guard. The original FIT stays downloadable through the signed-in
workout HR panel. A file backup cannot recreate Garmin-only training metrics.

The HR panel uses actual timestamps, displays gaps, source and estimated coverage,
and supports keyboard/touch reading inspection. Refresh HR & note updates its
cache and managed Hevy note without uploading or editing a Garmin activity.
