import { unzlibSync } from "fflate";
import { describe, expect, it } from "vite-plus/test";
import { createStreamingPngEncoder } from "../src/png-stream.js";

const readUint32 = (bytes: Uint8Array, offset: number): number => {
  return (
    bytes[offset]! * 0x1_000000 +
    bytes[offset + 1]! * 0x1_0000 +
    bytes[offset + 2]! * 0x100 +
    bytes[offset + 3]!
  );
};

describe("createStreamingPngEncoder", () => {
  it("encodes incrementally supplied RGBA rows into one PNG", async () => {
    const encoder = createStreamingPngEncoder(2, 2);
    encoder.writeRgbaRows(new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]), 1);
    encoder.writeRgbaRows(new Uint8Array([0, 0, 255, 255, 255, 255, 255, 128]), 1);

    const encoded = new Uint8Array(await encoder.finish().arrayBuffer());
    expect([...encoded.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

    const idatParts: Uint8Array[] = [];
    let offset = 8;
    while (offset < encoded.length) {
      const length = readUint32(encoded, offset);
      const type = new TextDecoder().decode(encoded.subarray(offset + 4, offset + 8));
      if (type === "IDAT") idatParts.push(encoded.slice(offset + 8, offset + 8 + length));
      offset += 12 + length;
    }
    const compressedLength = idatParts.reduce((total, part) => total + part.length, 0);
    const compressed = new Uint8Array(compressedLength);
    let writeOffset = 0;
    for (const part of idatParts) {
      compressed.set(part, writeOffset);
      writeOffset += part.length;
    }

    expect([...unzlibSync(compressed)]).toEqual([
      0, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 128,
    ]);
  });

  it("rejects incomplete images", () => {
    const encoder = createStreamingPngEncoder(1, 2);
    encoder.writeRgbaRows(new Uint8Array([0, 0, 0, 0]), 1);
    expect(() => encoder.finish()).toThrow("wrote 1 of 2 rows");
  });
});
