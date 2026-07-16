import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { OFFICIAL_MODS, configurePipelinePaths } from "../src/paths.js";

describe("asset profile paths", () => {
  it("isolates Base-only dumps and bundles from the default official profile", () => {
    const base = configurePipelinePaths({ mods: ["base"] });
    expect(base.profileId).toBe("base");
    expect(path.basename(base.versionOut)).toBe(`${base.install.version}-base`);
    expect(path.basename(base.dumpPath)).toBe("data-raw-dump.base.json");
    expect(base.mods).toEqual(["base"]);

    const official = configurePipelinePaths({ mods: OFFICIAL_MODS });
    expect(official.profileId).toBe("official");
    expect(path.basename(official.versionOut)).toBe(official.install.version);
    expect(path.basename(official.dumpPath)).toBe("data-raw-dump.json");
  });

  it("requires Base and unique mod names", () => {
    expect(() => configurePipelinePaths({ mods: ["space-age"] })).toThrow(/include "base"/);
    expect(() => configurePipelinePaths({ mods: ["base", "base"] })).toThrow(/duplicates/);
  });
});
