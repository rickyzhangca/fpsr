// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { trackEvent } from "./analytics";

describe("trackEvent", () => {
  afterEach(() => {
    delete window.gtag;
    vi.restoreAllMocks();
  });

  it("no-ops when gtag is missing", () => {
    expect(() => trackEvent("blueprint_load", { kind: "blueprint" })).not.toThrow();
  });

  it("forwards events to gtag when available", () => {
    const gtag = vi.fn<(...args: unknown[]) => void>();
    window.gtag = gtag;
    trackEvent("export_download", { format: "png" });
    expect(gtag).toHaveBeenCalledWith("event", "export_download", { format: "png" });
  });
});
