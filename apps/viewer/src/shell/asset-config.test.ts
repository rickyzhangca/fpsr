// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  CDN_ASSETS_BASE,
  cdnDebugFetchFor,
  canUseLocalAssets,
  defaultUseCdnAssets,
} from "./asset-config";

describe("asset-config host detection", () => {
  const originalHostname = window.location.hostname;

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { hostname: originalHostname },
    });
  });

  const setHostname = (hostname: string) => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { hostname },
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

  it("adds a scoped short-lived Bunny token only to matching CDN requests", async () => {
    vi.stubEnv(
      "VITE_FPSR_CDN_TOKEN_QUERY",
      "token=HS256-signed&expires=1999999999&token_path=%2F2.1.11%2F",
    );
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
    const debugFetch = cdnDebugFetchFor(CDN_ASSETS_BASE);

    expect(debugFetch).toBeDefined();
    await debugFetch?.(`${CDN_ASSETS_BASE}/manifest.json`);

    const input = fetchMock.mock.calls[0]?.[0];
    if (input == null) throw new Error("expected a fetch request");
    const requested = new URL(
      input instanceof Request ? input.url : typeof input === "string" ? input : input.href,
    );
    expect(requested.searchParams.get("token")).toBe("HS256-signed");
    expect(requested.searchParams.get("expires")).toBe("1999999999");
    expect(requested.searchParams.get("token_path")).toBe("/2.1.11/");
  });

  it("rejects malformed local debug token queries", () => {
    vi.stubEnv("VITE_FPSR_CDN_TOKEN_QUERY", "token=not-signed&expires=1999999999");
    expect(() => cdnDebugFetchFor(CDN_ASSETS_BASE)).toThrow("Invalid VITE_FPSR_CDN_TOKEN_QUERY");
  });
});
