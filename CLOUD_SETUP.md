# Vercel dashboard

Project: `trung791997s-projects/hevy2garmin-dashboard`.
The Next.js app uses Root Directory `web` and Node.js 24.

The dedicated Neon database `hevy2garmin-dashboard-db` contains the migrated local
account connections, settings, and sync history. Its production connection is
provided by the Vercel integration. The existing older Vercel projects have their
own database and were not changed.

The dashboard keeps the same login password as the local setup. Signing and cron
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
