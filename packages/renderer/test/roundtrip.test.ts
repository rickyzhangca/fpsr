import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { decode } from "../src/decode.js";
import { encode } from "../src/encode.js";

const FIXTURES_DIR = join(import.meta.dirname, "../../../fixtures/decode");

const fixtureNames = readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith(".txt"))
  .map((f) => f.replace(/\.txt$/, ""))
  .sort();

describe("roundtrip", () => {
  for (const name of fixtureNames) {
    it(`round-trips fixture ${name}`, () => {
      const txt = readFileSync(join(FIXTURES_DIR, `${name}.txt`), "utf8");
      const original = decode(txt);
      const reencoded = encode(original);
      const roundtripped = decode(reencoded);
      expect(roundtripped).toEqual(original);
    });
  }

  it("preserves unknown extra fields through round trip", () => {
    const doc = decode(readFileSync(join(FIXTURES_DIR, "01-minimal-chest.txt"), "utf8"));
    const bp = doc.blueprint;
    if (!bp) throw new Error("expected blueprint");
    const withExtra = {
      ...doc,
      blueprint: {
        ...bp,
        future_field: { x: 1 },
      },
    };
    const roundtripped = decode(encode(withExtra));
    expect(roundtripped).toEqual(withExtra);
  });
});
