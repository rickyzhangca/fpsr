import { readEmbedParam, readImportParam, stripImportParam } from "@/shell/embed-mode";
import { describe, expect, it, vi } from "vite-plus/test";

describe("readEmbedParam", () => {
  it("is true for embed=1 and embed=true", () => {
    expect(readEmbedParam("?embed=1")).toBe(true);
    expect(readEmbedParam("?embed=true")).toBe(true);
    expect(readEmbedParam("?embed=TRUE")).toBe(true);
    expect(readEmbedParam("?foo=1&embed=1")).toBe(true);
  });

  it("is false when absent or set to other values", () => {
    expect(readEmbedParam("")).toBe(false);
    expect(readEmbedParam("?")).toBe(false);
    expect(readEmbedParam("?embed=0")).toBe(false);
    expect(readEmbedParam("?embed=false")).toBe(false);
    expect(readEmbedParam("?embed=")).toBe(false);
  });
});

describe("readImportParam / stripImportParam", () => {
  it("detects import=1 and import=true", () => {
    expect(readImportParam("?import=1")).toBe(true);
    expect(readImportParam("?import=true")).toBe(true);
    expect(readImportParam("")).toBe(false);
    expect(readImportParam("?import=0")).toBe(false);
  });

  it("strips import from the URL", () => {
    const replaceState = vi.fn();
    stripImportParam(replaceState, "https://fpsr.fprints.xyz/?import=1&x=1");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/?x=1");
  });
});
