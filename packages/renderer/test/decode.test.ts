import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { BlueprintDecodeError, decode, decodeWithStats } from "../src/decode.js";

const FIXTURES_DIR = join(import.meta.dirname, "../../../fixtures/decode");

function loadFixture(name: string) {
  const txt = readFileSync(join(FIXTURES_DIR, `${name}.txt`), "utf8");
  const expected = JSON.parse(readFileSync(join(FIXTURES_DIR, `${name}.expected.json`), "utf8"));
  return { txt, expected };
}

const fixtureNames = readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith(".txt"))
  .map((f) => f.replace(/\.txt$/, ""))
  .sort();

function captureError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected function to throw");
}

describe("decode", () => {
  for (const name of fixtureNames) {
    it(`decodes fixture ${name}`, () => {
      const { txt, expected } = loadFixture(name);
      expect(decode(txt)).toEqual(expected);
    });
  }

  it("decodes raw JSON string input", () => {
    const { expected } = loadFixture("01-minimal-chest");
    const raw = JSON.stringify(expected);
    expect(decode(raw)).toEqual(expected);
  });

  it("decodeWithStats reports compressed sizes and timings", () => {
    const { txt, expected } = loadFixture("01-minimal-chest");
    const { doc, stats } = decodeWithStats(txt);
    expect(doc).toEqual(expected);
    expect(stats.mode).toBe("compressed");
    expect(stats.inputChars).toBe(txt.trim().length);
    expect(stats.compressedBytes).toBeGreaterThan(0);
    expect(stats.inflatedBytes).toBeGreaterThan(stats.compressedBytes!);
    expect(stats.compressionRatio).toBeGreaterThan(1);
    expect(stats.timings.totalMs).toBeGreaterThanOrEqual(0);
    expect(stats.timings.base64Ms).toBeGreaterThanOrEqual(0);
    expect(stats.timings.inflateMs).toBeGreaterThanOrEqual(0);
  });

  it("decodeWithStats reports json mode for raw JSON", () => {
    const { expected } = loadFixture("01-minimal-chest");
    const raw = JSON.stringify(expected);
    const { doc, stats } = decodeWithStats(raw);
    expect(doc).toEqual(expected);
    expect(stats.mode).toBe("json");
    expect(stats.jsonChars).toBe(raw.length);
    expect(stats.compressedBytes).toBeUndefined();
  });

  it("throws unsupported-version for bad version byte", () => {
    const error = captureError(() => decode("1AAAA"));
    expect(error).toBeInstanceOf(BlueprintDecodeError);
    expect((error as BlueprintDecodeError).reason).toBe("unsupported-version");
  });

  it("throws invalid-base64 for garbage base64", () => {
    const error = captureError(() => decode("0!!!not-base64!!!"));
    expect(error).toBeInstanceOf(BlueprintDecodeError);
    expect((error as BlueprintDecodeError).reason).toBe("invalid-base64");
  });

  it("throws inflate-failed for valid base64 of garbage bytes", () => {
    const garbage = Buffer.from([0x00, 0x01, 0x02, 0xff]).toString("base64");
    const error = captureError(() => decode(`0${garbage}`));
    expect(error).toBeInstanceOf(BlueprintDecodeError);
    expect((error as BlueprintDecodeError).reason).toBe("inflate-failed");
  });

  it("throws invalid-document when JSON has no known top-level key", () => {
    const error = captureError(() => decode('{"foo":1}'));
    expect(error).toBeInstanceOf(BlueprintDecodeError);
    expect((error as BlueprintDecodeError).reason).toBe("invalid-document");
  });
});
