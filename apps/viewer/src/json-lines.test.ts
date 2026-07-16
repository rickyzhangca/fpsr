import { describe, expect, it } from "vite-plus/test";
import { buildLineStarts, jsonLineAt, jsonPageCode, jsonPagesForRange } from "./json-lines";

describe("JSON line indexing", () => {
  it("indexes lines without retaining split string copies", () => {
    const code = '{\r\n  "value": 1\r\n}';
    const starts = buildLineStarts(code);

    expect(starts).toEqual([0, 3, 17]);
    expect(jsonLineAt(code, starts, 0)).toBe("{");
    expect(jsonLineAt(code, starts, 1)).toBe('  "value": 1');
    expect(jsonLineAt(code, starts, 2)).toBe("}");
  });

  it("extracts pages and prioritizes visible pages before adjacent prefetches", () => {
    const code = ["zero", "one", "two", "three", "four"].join("\n");
    const starts = buildLineStarts(code);

    expect(jsonPageCode(code, starts, 1, 2)).toBe("two\nthree");
    expect(jsonPagesForRange(300, 320, 1_000, 256)).toEqual([1, 0, 2]);
  });
});
