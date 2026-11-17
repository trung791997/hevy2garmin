/**
 * H2G_DIRECT_GARMIN_LOGIN: Garmin sign-in runs on this server, and the login Worker is never
 * contacted (#685). For a self-hosted server that can reach Garmin itself; Garmin blocks the
 * sign-in from cloud IPs, so a Vercel deploy keeps the Worker. Off unless set to a true value.
 */
export function directGarminLogin(): boolean {
  const explicit = /^(1|true|yes|on)$/i.test((process.env.H2G_DIRECT_GARMIN_LOGIN ?? "").trim());
  // Browser-only is a form preference. Cloud sign-ins still need the Worker;
  // only a local host should implicitly exchange tickets directly with Garmin.
  return explicit || (browserGarminLogin() && !process.env.VERCEL);
}

/** Hide password inputs on every host; local hosts also exchange tickets directly. */
export function browserGarminLogin(): boolean {
  return /^(1|true|yes|on)$/i.test((process.env.H2G_GARMIN_BROWSER_ONLY ?? "").trim());
}
