import {
  ALLOWED_SOURCE_HOSTS,
  fetchBlueprintViaProxy,
  handleFetchBlueprintRequest,
  parseSourceUrl,
  readSourceParam,
  stripSourceParam,
} from "@/shell/source-proxy";
import { describe, expect, it, vi } from "vite-plus/test";

describe("parseSourceUrl", () => {
  it("accepts allowlisted HTTPS URLs", () => {
    for (const host of ALLOWED_SOURCE_HOSTS) {
      const result = parseSourceUrl(`https://${host}/api/blueprintData/abc/`);
      expect(result).toEqual({
        ok: true,
        url: new URL(`https://${host}/api/blueprintData/abc/`),
      });
    }
  });

  it("rejects http, credentials, invalid URLs, and non-allowlisted hosts", () => {
    expect(parseSourceUrl("").ok).toBe(false);
    expect(parseSourceUrl("not a url").ok).toBe(false);
    expect(parseSourceUrl("http://www.factorio.school/api/blueprintData/abc/").ok).toBe(false);
    expect(parseSourceUrl("https://user:pass@www.factorio.school/api/blueprintData/abc/").ok).toBe(
      false,
    );
    expect(parseSourceUrl("https://example.com/blueprint").ok).toBe(false);
    expect(parseSourceUrl("https://evil.factorio.school/api/blueprintData/abc/").ok).toBe(false);
  });
});

describe("handleFetchBlueprintRequest", () => {
  it("returns 400 for missing or disallowed urls", async () => {
    const missing = await handleFetchBlueprintRequest(
      "http://localhost/api/fetch-blueprint",
      vi.fn<typeof fetch>(),
    );
    expect(missing.status).toBe(400);

    const badHost = await handleFetchBlueprintRequest(
      "http://localhost/api/fetch-blueprint?url=" + encodeURIComponent("https://example.com/bp"),
      vi.fn<typeof fetch>(),
    );
    expect(badHost.status).toBe(400);
  });

  it("proxies an allowlisted upstream body", async () => {
    const upstream = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("0eNrtTestBlueprint", { status: 200 }));
    const response = await handleFetchBlueprintRequest(
      "http://localhost/api/fetch-blueprint?url=" +
        encodeURIComponent("https://www.factorio.school/api/blueprintData/abc/"),
      upstream,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("0eNrtTestBlueprint");
    expect(upstream).toHaveBeenCalledOnce();
    const calledUrl = upstream.mock.calls[0]?.[0];
    expect(calledUrl).toBeInstanceOf(URL);
    expect((calledUrl as URL).href).toBe("https://www.factorio.school/api/blueprintData/abc/");
  });

  it("returns 502 when upstream fails", async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(new Response("nope", { status: 404 }));
    const response = await handleFetchBlueprintRequest(
      "http://localhost/api/fetch-blueprint?url=" +
        encodeURIComponent("https://factorio.school/api/blueprintData/abc/"),
      upstream,
    );
    expect(response.status).toBe(502);
    expect(await response.text()).toContain("404");
  });
});

describe("fetchBlueprintViaProxy", () => {
  it("calls the same-origin proxy and returns the body", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("0eNrtFromProxy", { status: 200 }));
    await expect(
      fetchBlueprintViaProxy("https://www.factorio.school/api/blueprintData/abc/"),
    ).resolves.toBe("0eNrtFromProxy");
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/fetch-blueprint?url=" +
        encodeURIComponent("https://www.factorio.school/api/blueprintData/abc/"),
    );
    fetchSpy.mockRestore();
  });

  it("throws before fetch when the host is not allowlisted", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(fetchBlueprintViaProxy("https://example.com/bp")).rejects.toThrow(
      "Host not allowed: example.com",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("readSourceParam / stripSourceParam", () => {
  it("reads and strips the source query param", () => {
    expect(readSourceParam("?source=https%3A%2F%2Fwww.factorio.school%2Fx")).toBe(
      "https://www.factorio.school/x",
    );
    expect(readSourceParam("")).toBeNull();

    const replaceState = vi.fn<History["replaceState"]>();
    stripSourceParam(
      "https://fpsr.fprints.xyz/?source=https%3A%2F%2Fwww.factorio.school%2Fx&tab=preview",
      replaceState,
    );
    expect(replaceState).toHaveBeenCalledWith(null, "", "/?tab=preview");
  });
});
