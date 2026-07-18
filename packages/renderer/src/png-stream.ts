import { Zlib } from "fflate";

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_MAX_DIMENSION = 0x7fff_ffff;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < table.length; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function writeUint32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function crc32(type: Uint8Array, data: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const bytes of [type, data]) {
    for (const byte of bytes) {
      crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function pngChunk(type: string, data = new Uint8Array()): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(12 + data.length);
  writeUint32(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  writeUint32(chunk, 8 + data.length, crc32(typeBytes, data));
  return chunk;
}

const blobPart = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer;

export interface StreamingPngEncoder {
  readonly width: number;
  readonly height: number;
  readonly rowsWritten: number;
  writeRgbaRows(rgba: Uint8Array, rowCount: number): void;
  finish(): Blob;
}

/**
 * Incremental 8-bit RGBA PNG encoder. Only compressed PNG chunks are retained;
 * callers control raw working memory by choosing how many rows to submit.
 */
export function createStreamingPngEncoder(width: number, height: number): StreamingPngEncoder {
  if (!Number.isInteger(width) || width <= 0 || width > PNG_MAX_DIMENSION) {
    throw new Error(`PNG width must be an integer between 1 and ${PNG_MAX_DIMENSION}`);
  }
  if (!Number.isInteger(height) || height <= 0 || height > PNG_MAX_DIMENSION) {
    throw new Error(`PNG height must be an integer between 1 and ${PNG_MAX_DIMENSION}`);
  }

  const ihdr = new Uint8Array(13);
  writeUint32(ihdr, 0, width);
  writeUint32(ihdr, 4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const chunks: BlobPart[] = [blobPart(PNG_SIGNATURE), blobPart(pngChunk("IHDR", ihdr))];
  let rowsWritten = 0;
  let finished = false;
  const zlib = new Zlib({ level: 6 }, (data) => {
    if (data.length > 0) chunks.push(blobPart(pngChunk("IDAT", data)));
  });

  return {
    width,
    height,
    get rowsWritten() {
      return rowsWritten;
    },
    writeRgbaRows(rgba, rowCount) {
      if (finished) throw new Error("PNG encoder is already finished");
      if (!Number.isInteger(rowCount) || rowCount <= 0 || rowsWritten + rowCount > height) {
        throw new Error("PNG row count exceeds the declared image height");
      }
      const rgbaStride = width * 4;
      if (rgba.length !== rgbaStride * rowCount) {
        throw new Error(
          `Expected ${rgbaStride * rowCount} RGBA bytes for ${rowCount} rows, got ${rgba.length}`,
        );
      }
      const scanlines = new Uint8Array((rgbaStride + 1) * rowCount);
      for (let row = 0; row < rowCount; row++) {
        const sourceStart = row * rgbaStride;
        const targetStart = row * (rgbaStride + 1) + 1;
        scanlines.set(rgba.subarray(sourceStart, sourceStart + rgbaStride), targetStart);
      }
      rowsWritten += rowCount;
      zlib.push(scanlines, rowsWritten === height);
    },
    finish() {
      if (finished) throw new Error("PNG encoder is already finished");
      if (rowsWritten !== height) {
        throw new Error(`PNG is incomplete: wrote ${rowsWritten} of ${height} rows`);
      }
      finished = true;
      chunks.push(blobPart(pngChunk("IEND")));
      return new Blob(chunks, { type: "image/png" });
    },
  };
}
