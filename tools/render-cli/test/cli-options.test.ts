import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { parseArgs } from "../src/cli-options.js";

describe("render CLI options", () => {
  const cwd = path.resolve("/tmp/fpsr-cli-test");

  it("resolves user paths from the invocation directory", () => {
    const options = parseArgs(
      ["fixtures/sample.bp.txt", "--out", "renders/sample.png", "--assets", "assets"],
      cwd,
    );

    expect(options.input).toBe(path.join(cwd, "fixtures/sample.bp.txt"));
    expect(options.out).toBe(path.join(cwd, "renders/sample.png"));
    expect(options.assets).toBe(path.join(cwd, "assets"));
  });

  it("preserves stdin and parses rendering options", () => {
    const options = parseArgs(["-", "--ppt", "32", "--path", "2, 0", "--profile", "--warmup"], cwd);

    expect(options.input).toBe("-");
    expect(options.ppt).toBe(32);
    expect(options.blueprintPath).toEqual([2, 0]);
    expect(options.profile).toBe(true);
    expect(options.warmup).toBe(true);
  });

  it.each([
    [["sample.bp.txt", "--ppt", "0"], "Invalid --ppt"],
    [["sample.bp.txt", "--path", "1,-1"], "Invalid path index"],
    [["sample.bp.txt", "--unknown"], "Unknown option"],
    [["first.bp.txt", "second.bp.txt"], "Unexpected extra argument"],
  ] as const)("rejects invalid arguments", (args, message) => {
    expect(() => parseArgs([...args], cwd)).toThrow(message);
  });
});
