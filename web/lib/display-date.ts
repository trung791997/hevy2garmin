import { normaliseTimeZone } from "./timezone";

/** Keep server-rendered history in the configured zone across hosting providers. */
export function displayDate(date: Date, options: Intl.DateTimeFormatOptions): string {
  const timeZone = normaliseTimeZone(process.env.H2G_DISPLAY_TIMEZONE ?? "");
  return date.toLocaleString(undefined, { ...options, ...(timeZone ? { timeZone } : {}) });
}
