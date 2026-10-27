import { afterEach, describe, expect, it, vi } from "vitest";
import { displayDate } from "./display-date";

afterEach(() => vi.unstubAllEnvs());

describe("cloud display dates", () => {
  it("preserves the local calendar day across UTC midnight", () => {
    vi.stubEnv("H2G_DISPLAY_TIMEZONE", "America/Chicago");
    expect(displayDate(new Date("2026-10-26T02:00:00Z"), {
      month: "short", day: "numeric",
    })).toBe("Oct 25");
  });

  it("follows Chicago daylight saving changes", () => {
    vi.stubEnv("H2G_DISPLAY_TIMEZONE", "America/Chicago");
    const options = { hour: "2-digit", hour12: false } as const;
    expect(displayDate(new Date("2026-07-01T12:00:00Z"), options)).toBe("07");
    expect(displayDate(new Date("2026-12-01T12:00:00Z"), options)).toBe("06");
  });

  it("keeps the host default when no valid display zone is configured", () => {
    const date = new Date("2026-10-26T02:00:00Z");
    const options = { month: "short", day: "numeric" } as const;
    for (const value of ["", "invalid/zone"]) {
      vi.stubEnv("H2G_DISPLAY_TIMEZONE", value);
      expect(displayDate(date, options)).toBe(date.toLocaleString(undefined, options));
    }
  });
});
