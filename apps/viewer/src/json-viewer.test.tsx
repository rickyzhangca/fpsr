// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("./virtualized-json-viewer", () => ({
  VirtualizedJsonViewer: ({ code }: { code: string }) => (
    <div data-testid="virtual-json" data-code-length={code.length} />
  ),
}));

import { JsonViewer } from "./json-viewer";

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

  it("routes the complete large document to the virtualized viewer", async () => {
    const value = { payload: "x".repeat(510_000) };
    const root = createRoot(host);
    act(() => root.render(<JsonViewer value={value} />));

    await act(async () => {
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(host.querySelector('[data-testid="virtual-json"]')).toBeTruthy());
    expect(host.querySelector(".shiki")).toBeNull();
    const virtual = host.querySelector('[data-testid="virtual-json"]');
    expect(Number(virtual?.getAttribute("data-code-length"))).toBeGreaterThan(510_000);

    act(() => root.unmount());
  });
});
