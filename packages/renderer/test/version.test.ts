import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { decode } from "../src/decode.js";
import { decodeVersion } from "../src/types/blueprint.js";

const FIXTURES_DIR = join(import.meta.dirname, "../../../fixtures/decode");

describe("decodeVersion", () => {
  it("parses 2.1.9 from fixture version field", () => {
    const doc = decode(readFileSync(join(FIXTURES_DIR, "01-minimal-chest.txt"), "utf8"));
    const version = doc.blueprint?.version ?? 0;
    expect(decodeVersion(version)).toEqual({ major: 2, minor: 1, patch: 9 });
  });
});
