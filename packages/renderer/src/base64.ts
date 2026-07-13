/**
 * Cross-environment base64 helpers (browser + Node) without relying on Buffer alone.
 */

const hasAtob = typeof globalThis.atob === "function";
const hasBtoa = typeof globalThis.btoa === "function";

function bytesToBinary(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte === undefined) continue;
    binary += String.fromCharCode(byte);
  }
  return binary;
}

function binaryToBytes(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function base64Encode(bytes: Uint8Array): string {
  if (hasBtoa) {
    return globalThis.btoa(bytesToBinary(bytes));
  }
  // Node fallback
  const { Buffer } = globalThis as {
    Buffer?: { from(data: Uint8Array): { toString(enc: string): string } };
  };
  if (Buffer) {
    return Buffer.from(bytes).toString("base64");
  }
  throw new Error("No base64 encoder available");
}

export function base64Decode(b64: string): Uint8Array {
  if (hasAtob) {
    return binaryToBytes(globalThis.atob(b64));
  }
  const { Buffer } = globalThis as { Buffer?: { from(data: string, enc: string): Uint8Array } };
  if (Buffer) {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  throw new Error("No base64 decoder available");
}

export function utf8Encode(text: string): Uint8Array {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(text);
  }
  const { Buffer } = globalThis as { Buffer?: { from(data: string, enc: string): Uint8Array } };
  if (Buffer) {
    return new Uint8Array(Buffer.from(text, "utf8"));
  }
  throw new Error("No UTF-8 encoder available");
}

export function utf8Decode(bytes: Uint8Array): string {
  if (typeof TextDecoder !== "undefined") {
    return new TextDecoder().decode(bytes);
  }
  const { Buffer } = globalThis as {
    Buffer?: { from(data: Uint8Array): { toString(enc: string): string } };
  };
  if (Buffer) {
    return Buffer.from(bytes).toString("utf8");
  }
  throw new Error("No UTF-8 decoder available");
}
