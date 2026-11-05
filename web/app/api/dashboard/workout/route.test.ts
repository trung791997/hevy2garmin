import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/dashboard-workout", () => ({ loadFeaturedWorkout: h.load }));
import { GET } from "./route";
beforeEach(() => { vi.clearAllMocks(); });
describe("dashboard workout read endpoint", () => {
  it("marks the personalized response private and never cacheable by a shared CDN", async () => {
    h.load.mockResolvedValueOnce(null);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ workout: null });
  });
  it("reports a database outage instead of an empty account", async () => {
    h.load.mockRejectedValueOnce(new Error("Database unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try { expect((await GET()).status).toBe(503); } finally { log.mockRestore(); }
  });
});
