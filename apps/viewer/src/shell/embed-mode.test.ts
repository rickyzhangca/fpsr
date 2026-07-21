import { readEmbedParam } from "@/shell/embed-mode";
import { describe, expect, it } from "vite-plus/test";

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
