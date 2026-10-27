import { describe, expect, it } from "vitest";
import { initialLoopState, stepLoop } from "./sync-loop";
describe("HR/watch sync loop outcomes", () => {
  it("shows a failure reason ahead of the original preview plan", () => {
    const output = stepLoop(initialLoopState, { httpStatus: 200, result: { status: "needs_review", error: "The merge failed; original kept.", plan: { message: "Import sets into the watch recording." } } });
    expect(output.state.message).toBe("The merge failed; original kept.");
  });
  it.each(["merge_pending", "needs_review", "processing"])(
    "stops on %s instead of retrying 500 times",
    (status) => {
      const output = stepLoop(initialLoopState, {
        httpStatus: 200,
        result: {
          status,
          remaining: 2,
          plan: { message: "Waiting for the watch recording." },
        },
      });
      expect(output.cont).toBe(false);
      expect(output.state.done).toBe(true);
      expect(output.state.synced).toBe(0);
      expect(output.state.message).toContain("watch");
    },
  );
});
