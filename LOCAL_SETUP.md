# Local Mac setup

The repository is cloned from `https://github.com/trung791997/hevy2garmin.git`.
The Next.js dashboard uses a private Postgres 17 database on this Mac.

From this repository folder, start it with:

```sh
./scripts/start-local.sh
```

Open <http://localhost:8096/setup>. Your generated **dashboard password** is in
`.local/dashboard-login.txt`. It is separate from your Garmin password.
Both the dashboard (8096) and Postgres (55432) listen only on `127.0.0.1`.
The dashboard runs in its own background session; you can close the terminal.

To stop the dashboard and database:

```sh
./scripts/stop-local.sh
```

## Access through Tailscale

From another device connected to your tailnet, open:

<https://peters-macbook-air.tail0ddd37.ts.net:8443/setup>

Tailscale Serve runs in the background and proxies this private HTTPS address
to `http://127.0.0.1:8096`. Port 8443 avoids another local app using port 443.
Your Mac must be awake, Tailscale connected, and the dashboard running. The
dashboard password is the same as for local access.

If a phone cannot resolve the Tailscale hostname, this private IP route is also
configured and does not require DNS:

<http://100.64.196.81:8080/setup>

It forwards TCP over Tailscale to the same local dashboard. The phone must have
an active Tailscale connection. To recreate or disable this route:

```sh
tailscale serve --bg --tcp=8080 tcp://127.0.0.1:8096
tailscale serve --tcp=8080 off
```

To recreate this proxy if needed:

```sh
tailscale serve --bg --https=8443 http://127.0.0.1:8096
```

To disable only this proxy:

```sh
tailscale serve --https=8443 off
```

## Connect your accounts

1. Sign in to the dashboard using the password in `.local/dashboard-login.txt`.
2. Paste your Hevy API key into the Hevy section of Setup. Hevy Pro is required
   for API access; create a key at <https://hevy.com/settings>.
3. In the Garmin section, click **Sign in to Garmin**. Enter your credentials
   and complete any verification on Garmin's own site.
4. Copy the full address from the Garmin tab after sign-in. It should contain
   `ticket=ST-…`. Paste it into **Garmin ticket URL** and click **Connect** promptly;
   a ticket is short-lived and can only be exchanged once.
5. Your timezone is already set to `America/Chicago`; change it if needed.
6. Open Workouts and sync a recent workout to verify the connection before
   syncing your full history.

`H2G_GARMIN_BROWSER_ONLY=true` shows the browser sign-in form without Garmin
email or password inputs. This flag also enables direct ticket exchange: the
local server exchanges the ticket with Garmin rather than using the shared
Cloudflare login worker. Garmin session and refresh tokens are stored in the
local database and allow subsequent uploads without repeating browser sign-in
until the session needs reconnecting. This uses the repository's existing
unofficial Garmin Connect integration.

Browser sign-in does not require a Personal API key. Garmin's currently published
[Personal API reference](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/)
has 26 GET endpoints and no activity upload, edit, or delete endpoints. It cannot
replace the authentication used for workout uploads in this app.

No recurring background sync job has been installed. The dashboard's **Sync**
controls upload workouts automatically when run. The upstream Auto-sync control
uses GitHub Actions and needs a GitHub token and fork; it does not create a local
scheduler. No workouts have been uploaded as part of installation.

## Local files

- `web/.env.local`: database connection, dashboard password, signing/cron secrets,
  and local browser sign-in flags. File permissions are `0600`.
- `.local/dashboard-login.txt`: dashboard login instructions, permissions `0600`.
- `.local/postgres/`: persistent local database, including saved account tokens.
- `.local/postgres.log`: database log.
- `.local/web.log`: dashboard log.

`.local/` is excluded through `.git/info/exclude`; `.env.local` is ignored by the
repository. Keep these private files when moving this installation. No macOS
login service was installed. Postgres was installed with Homebrew, and `npm ci`
installed the dashboard dependencies. The dashboard runs on Node; the startup
script uses the Mac's existing Python 3 to launch an independent background process.

These start/stop scripts reuse this Mac's prepared configuration. On another
Mac, install Node and Postgres, create a database and `web/.env.local` using
`web/.env.example`, then install dependencies with `cd web && npm ci`.
