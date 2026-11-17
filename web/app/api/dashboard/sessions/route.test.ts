import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const h = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/session-history", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/session-history")>(), loadSessionHistory: h.load }));
import { HistoryUnavailable } from "@/lib/session-history";
import { GET } from "./route";
beforeEach(() => { vi.clearAllMocks(); });
describe("private calendar endpoint", () => {
  it("serves bounded history privately", async () => {
    h.load.mockResolvedValueOnce({ sessions: [], nextPage: 4 });
    const response = await GET(new NextRequest("http://localhost/api/dashboard/sessions?page=1"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(h.load).toHaveBeenCalledWith({}, 1);
  });
  it.each(["0", "-1", "1.5", "1e2", "10000", "abc"])("rejects invalid page %s before reading data", async page => {
    expect((await GET(new NextRequest(`http://localhost/api/dashboard/sessions?page=${page}`))).status).toBe(400);
    expect(h.load).not.toHaveBeenCalled();
  });
  it("reports Hevy failures as an unavailable upstream, not zero sessions", async () => {
    h.load.mockRejectedValueOnce(new HistoryUnavailable("Please retry"));
    const response = await GET(new NextRequest("http://localhost/api/dashboard/sessions"));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Please retry" });
  });
});
