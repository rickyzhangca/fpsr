// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { JsonViewer } from "./JsonViewer";

describe("JsonViewer large values", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
  });

  afterEach(() => {
    host.remove();
  });

  it("skips the highlighted DOM and truncates initial output", async () => {
    const value = { payload: "x".repeat(510_000) };
    const root = createRoot(host);
    act(() => root.render(<JsonViewer value={value} />));

    await act(async () => {
      await Promise.resolve();
    });

    expect(host.textContent).toContain("Showing 500K/510K chars");
    expect(host.querySelector(".shiki")).toBeNull();
    const preview = host.querySelector("pre");
    expect(preview?.textContent?.length).toBeLessThan(501_000);

    const showFull = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Show full",
    );
    act(() => showFull?.click());
    expect(host.querySelector("pre")?.textContent?.length).toBeGreaterThan(510_000);

    act(() => root.unmount());
  });
});
