// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vite-plus/test";
import { canUseLocalAssets, defaultUseCdnAssets } from "./asset-config";

describe("asset-config host detection", () => {
  const originalHostname = window.location.hostname;

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, hostname: originalHostname },
    });
  });

  const setHostname = (hostname: string) => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, hostname },
    });
  };

  it("allows local assets on localhost and loopback hosts", () => {
    for (const hostname of ["localhost", "127.0.0.1", "[::1]", ""]) {
      setHostname(hostname);
      expect(canUseLocalAssets()).toBe(true);
      expect(defaultUseCdnAssets()).toBe(false);
    }
  });

  it("requires CDN assets on deployed hosts", () => {
    setHostname("fpsr.fprints.xyz");
    expect(canUseLocalAssets()).toBe(false);
    expect(defaultUseCdnAssets()).toBe(true);
  });
});
