import { describe, expect, it } from "vite-plus/test";
import { updateActiveRenderProgress } from "./renderProgressState";

describe("updateActiveRenderProgress", () => {
  it("replaces the renderer's complete event with the timed completion event", () => {
    const selection = { sourceId: "large", path: null };
    const complete = updateActiveRenderProgress(
      null,
      { value: 100, label: "Complete" },
      selection,
    );
    const timed = updateActiveRenderProgress(
      complete,
      { value: 100, label: "Complete", durationMs: 1_234 },
      selection,
    );

    expect(timed).toEqual({
      ...selection,
      value: 100,
      label: "Complete",
      durationMs: 1_234,
    });
    expect(timed).not.toBe(complete);
  });
});
