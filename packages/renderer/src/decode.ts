import { unzlibSync } from "fflate";
import { base64Decode, utf8Decode } from "./base64.js";
import { nowMs, type DecodeStats } from "./profile.js";
import type { BlueprintDocument } from "./types/blueprint.js";

export type BlueprintDecodeReason =
  | "unsupported-version"
  | "invalid-base64"
  | "inflate-failed"
  | "invalid-json"
  | "invalid-document";

export class BlueprintDecodeError extends Error {
  readonly reason: BlueprintDecodeReason;

  constructor(reason: BlueprintDecodeReason, message?: string) {
    super(message ?? reason);
    this.name = "BlueprintDecodeError";
    this.reason = reason;
  }
}

const TOP_LEVEL_KEYS = [
  "blueprint",
  "blueprint_book",
  "upgrade_planner",
  "deconstruction_planner",
] as const;

function validateDocument(doc: unknown): BlueprintDocument {
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    throw new BlueprintDecodeError("invalid-document", "Document must be an object");
  }
  const keys = TOP_LEVEL_KEYS.filter((k) => k in doc);
  if (keys.length !== 1) {
    throw new BlueprintDecodeError(
      "invalid-document",
      `Expected exactly one top-level key, found ${keys.length}`,
    );
  }
  return doc as BlueprintDocument;
}

function decodeCompressed(source: string): BlueprintDocument {
  return decodeCompressedWithStats(source).doc;
}

function decodeCompressedWithStats(source: string): { doc: BlueprintDocument; stats: DecodeStats } {
  const tTotal = nowMs();
  const versionByte = source[0];
  if (versionByte !== "0") {
    throw new BlueprintDecodeError(
      "unsupported-version",
      `Unsupported blueprint string version byte: ${versionByte}`,
    );
  }

  let t = nowMs();
  let bytes: Uint8Array;
  try {
    bytes = base64Decode(source.slice(1));
  } catch {
    throw new BlueprintDecodeError("invalid-base64", "Invalid base64 payload");
  }
  const base64Ms = nowMs() - t;

  t = nowMs();
  let inflated: Uint8Array;
  try {
    inflated = unzlibSync(bytes);
  } catch {
    throw new BlueprintDecodeError("inflate-failed", "zlib inflate failed");
  }
  const inflateMs = nowMs() - t;

  t = nowMs();
  let text: string;
  try {
    text = utf8Decode(inflated);
  } catch {
    throw new BlueprintDecodeError("invalid-json", "Invalid UTF-8 after inflate");
  }
  const utf8Ms = nowMs() - t;

  t = nowMs();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BlueprintDecodeError("invalid-json", "Invalid JSON after inflate");
  }
  const jsonParseMs = nowMs() - t;

  t = nowMs();
  const doc = validateDocument(parsed);
  const validateMs = nowMs() - t;

  const compressedBytes = bytes.length;
  const inflatedBytes = inflated.length;
  const stats: DecodeStats = {
    mode: "compressed",
    inputChars: source.length,
    compressedBytes,
    inflatedBytes,
    jsonChars: text.length,
    compressionRatio: compressedBytes > 0 ? inflatedBytes / compressedBytes : undefined,
    timings: {
      totalMs: nowMs() - tTotal,
      base64Ms,
      inflateMs,
      utf8Ms,
      jsonParseMs,
      validateMs,
    },
  };
  return { doc, stats };
}

function decodeJsonWithStats(source: string): { doc: BlueprintDocument; stats: DecodeStats } {
  const tTotal = nowMs();

  let t = nowMs();
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new BlueprintDecodeError("invalid-json", "Invalid raw JSON");
  }
  const jsonParseMs = nowMs() - t;

  t = nowMs();
  const doc = validateDocument(parsed);
  const validateMs = nowMs() - t;

  const stats: DecodeStats = {
    mode: "json",
    inputChars: source.length,
    jsonChars: source.length,
    timings: {
      totalMs: nowMs() - tTotal,
      jsonParseMs,
      validateMs,
    },
  };
  return { doc, stats };
}

/**
 * Decode a Factorio blueprint string (compressed or raw JSON) into a BlueprintDocument.
 */
export function decode(source: string): BlueprintDocument {
  return decodeWithStats(source).doc;
}

/**
 * Decode a blueprint string and collect size + timing stats for profiling.
 */
export function decodeWithStats(source: string): { doc: BlueprintDocument; stats: DecodeStats } {
  const trimmed = source.trim();
  if (trimmed.length === 0) {
    throw new BlueprintDecodeError("invalid-document", "Empty input");
  }

  if (trimmed.startsWith("{")) {
    return decodeJsonWithStats(trimmed);
  }

  return decodeCompressedWithStats(trimmed);
}
