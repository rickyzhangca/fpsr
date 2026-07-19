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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ENTRY_WRAPPER_KEYS = [
  "blueprint",
  "blueprint_book",
  "upgrade_planner",
  "deconstruction_planner",
] as const;

function validateBlueprint(bp: Record<string, unknown>, path: string): void {
  if (bp.item !== "blueprint") {
    throw new BlueprintDecodeError("invalid-document", `${path}.item must be "blueprint"`);
  }
  if (typeof bp.version !== "number" || !Number.isFinite(bp.version)) {
    throw new BlueprintDecodeError("invalid-document", `${path}.version must be a finite number`);
  }
}

function validatePlannerPayload(value: Record<string, unknown>, path: string): void {
  // Upgrade / deconstruction planners are opaque Record payloads; only require
  // a plain object (already checked by the caller).
  void value;
  void path;
}

function validateBookEntry(entry: unknown, path: string): void {
  if (!isPlainObject(entry)) {
    throw new BlueprintDecodeError("invalid-document", `${path} must be an object`);
  }
  if (!("index" in entry) || typeof entry.index !== "number" || !Number.isFinite(entry.index)) {
    throw new BlueprintDecodeError("invalid-document", `${path}.index must be a finite number`);
  }
  const keys = ENTRY_WRAPPER_KEYS.filter((k) => k in entry);
  if (keys.length !== 1) {
    throw new BlueprintDecodeError(
      "invalid-document",
      `${path} expected exactly one content key, found ${keys.length}`,
    );
  }
  const key = keys[0]!;
  const value = entry[key];
  if (value === null || value === undefined) {
    throw new BlueprintDecodeError(
      "invalid-document",
      `${path}.${key} must be an object, got ${value === null ? "null" : "undefined"}`,
    );
  }
  if (!isPlainObject(value)) {
    throw new BlueprintDecodeError("invalid-document", `${path}.${key} must be an object`);
  }
  if (key === "blueprint") {
    validateBlueprint(value, `${path}.blueprint`);
  } else if (key === "blueprint_book") {
    validateBlueprintBook(value, `${path}.blueprint_book`);
  } else {
    validatePlannerPayload(value, `${path}.${key}`);
  }
}

function validateBlueprintBook(book: Record<string, unknown>, path: string): void {
  if (book.item !== "blueprint-book") {
    throw new BlueprintDecodeError("invalid-document", `${path}.item must be "blueprint-book"`);
  }
  if (typeof book.version !== "number" || !Number.isFinite(book.version)) {
    throw new BlueprintDecodeError("invalid-document", `${path}.version must be a finite number`);
  }
  const entries = book.blueprints;
  if (entries === undefined) return;
  if (!Array.isArray(entries)) {
    throw new BlueprintDecodeError("invalid-document", `${path}.blueprints must be an array`);
  }
  for (let i = 0; i < entries.length; i++) {
    validateBookEntry(entries[i], `${path}.blueprints[${i}]`);
  }
}

function validateWrapperValue(
  doc: Record<string, unknown>,
  key: (typeof TOP_LEVEL_KEYS)[number],
): void {
  const value = doc[key];
  if (value === null || value === undefined) {
    throw new BlueprintDecodeError(
      "invalid-document",
      `Top-level "${key}" must be an object, got ${value === null ? "null" : "undefined"}`,
    );
  }
  if (!isPlainObject(value)) {
    throw new BlueprintDecodeError("invalid-document", `Top-level "${key}" must be an object`);
  }
  if (key === "blueprint") {
    validateBlueprint(value, "blueprint");
  } else if (key === "blueprint_book") {
    validateBlueprintBook(value, "blueprint_book");
  } else {
    validatePlannerPayload(value, key);
  }
}

function validateDocument(doc: unknown): BlueprintDocument {
  if (!isPlainObject(doc)) {
    throw new BlueprintDecodeError("invalid-document", "Document must be an object");
  }
  const keys = TOP_LEVEL_KEYS.filter((k) => k in doc);
  if (keys.length !== 1) {
    throw new BlueprintDecodeError(
      "invalid-document",
      `Expected exactly one top-level key, found ${keys.length}`,
    );
  }
  const key = keys[0]!;
  validateWrapperValue(doc, key);
  return doc as BlueprintDocument;
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
