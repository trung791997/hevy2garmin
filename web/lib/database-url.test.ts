import { describe, it, expect } from "vitest";
import { resolveDatabaseUrl, DATABASE_URL_VARS, pgConnectionString } from "./database-url";

/**
 * The web read `DATABASE_URL` and nothing else, while Python reads four names
 * with `POSTGRES_URL` first, and this project's own error message tells users
 * to attach Neon through Vercel Storage "so DATABASE_URL / POSTGRES_URL is
 * set". Follow that, end up with only `POSTGRES_URL`, and every route answers
 * 503 naming a variable nobody mentioned (#615).
 */

const PG = "postgres://u:p@host/db";
const NEON = "postgresql://u:p@ep-cool.neon.tech/db";

describe("resolveDatabaseUrl", () => {
  it("accepts DATABASE_URL, as it always did", () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: PG })).toBe(PG);
  });

  it("accepts POSTGRES_URL, which is what Vercel Storage actually sets", () => {
    expect(resolveDatabaseUrl({ POSTGRES_URL: PG })).toBe(PG);
  });

  it("accepts the other two Python names", () => {
    expect(resolveDatabaseUrl({ STORAGE_URL: PG })).toBe(PG);
    expect(resolveDatabaseUrl({ NEON_DATABASE_URL: NEON })).toBe(NEON);
  });

  it("prefers POSTGRES_URL when several are set", () => {
    // Not arbitrary. On Vercel that one is the POOLED endpoint, and pooled is
    // what a serverless function wants. Python puts it first for the same
    // reason and says so.
    const chosen = resolveDatabaseUrl({
      DATABASE_URL: "postgres://direct/db",
      POSTGRES_URL: "postgres://pooled/db",
    });
    expect(chosen).toBe("postgres://pooled/db");
  });

  it("falls through a value that is not a Postgres URL", () => {
    // `postgres(url)` accepts any string and fails later with something
    // unhelpful, so a leftover value here would turn "not configured" into a
    // connection error pointing nowhere.
    expect(
      resolveDatabaseUrl({ POSTGRES_URL: "redis://cache", DATABASE_URL: PG }),
    ).toBe(PG);
  });

  it("returns null when none of them is set", () => {
    expect(resolveDatabaseUrl({})).toBeNull();
  });

  it("ignores an empty or whitespace value", () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: "   " })).toBeNull();
  });

  it("keeps Python's order exactly", () => {
    // The order is the fix. If it drifts, a deployment with both set silently
    // starts using the direct endpoint from a serverless function.
    expect([...DATABASE_URL_VARS]).toEqual([
      "POSTGRES_URL",
      "DATABASE_URL",
      "STORAGE_URL",
      "NEON_DATABASE_URL",
    ]);
  });
});

describe("pgConnectionString", () => {
  const base = "postgres://u:p@ep-x.neon.tech/db";

  it.each(["require", "prefer", "verify-ca"])("makes sslmode=%s explicit verify-full", (mode) => {
    expect(pgConnectionString(`${base}?sslmode=${mode}`)).toBe(`${base}?sslmode=verify-full`);
  });

  it("keeps the other query parameters, in place", () => {
    expect(pgConnectionString(`${base}?connect_timeout=10&sslmode=require&channel_binding=require`)).toBe(
      `${base}?connect_timeout=10&sslmode=verify-full&channel_binding=require`,
    );
  });

  it("leaves verify-full, disable and a missing sslmode alone", () => {
    expect(pgConnectionString(`${base}?sslmode=verify-full`)).toBe(`${base}?sslmode=verify-full`);
    expect(pgConnectionString(`${base}?sslmode=disable`)).toBe(`${base}?sslmode=disable`);
    expect(pgConnectionString(base)).toBe(base);
  });

  it("respects an explicit opt-in to libpq semantics", () => {
    const url = `${base}?sslmode=require&uselibpqcompat=true`;
    expect(pgConnectionString(url)).toBe(url);
  });

  it("does not touch a password that happens to contain the words", () => {
    const url = "postgres://u:sslmode=require@host/db";
    expect(pgConnectionString(url)).toBe(url);
  });

  it("parses to the same ssl option pg already used, so behavior is unchanged", async () => {
    const { parse } = await import("pg-connection-string");
    expect(parse(pgConnectionString(`${base}?sslmode=require`)).ssl).toEqual(parse(`${base}?sslmode=require`).ssl);
  });
});
