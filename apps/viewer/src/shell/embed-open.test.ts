// @vitest-environment jsdom
import { openViewerWithBlueprint } from "@/shell/embed-open";
import { EMBED_PROTOCOL_VERSION } from "@/shell/embed-protocol";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

describe("openViewerWithBlueprint", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens ?import=1 and posts fpsr:load after ready", () => {
    const postMessage = vi.fn();
    const child = { postMessage } as unknown as Window;
    const open = vi.spyOn(window, "open").mockReturnValue(child);

    openViewerWithBlueprint("0eN...");

    expect(open).toHaveBeenCalledWith(expect.stringMatching(/\/\?import=1$/), "_blank");

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "fpsr:ready", version: EMBED_PROTOCOL_VERSION },
        source: child as unknown as MessageEventSource,
      }),
    );

    expect(postMessage).toHaveBeenCalledWith(
      { type: "fpsr:load", version: EMBED_PROTOCOL_VERSION, blueprint: "0eN..." },
      window.location.origin,
    );
  });

  it("returns null when the pop-up is blocked", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    expect(openViewerWithBlueprint("0eN...")).toBeNull();
  });
});
