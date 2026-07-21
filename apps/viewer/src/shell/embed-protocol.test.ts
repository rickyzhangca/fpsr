import {
  EMBED_MAX_BLUEPRINT_CHARS,
  EMBED_PROTOCOL_VERSION,
  createErrorMessage,
  createLoadedMessage,
  createReadyMessage,
  docKindFromDocument,
  parseEmbedMessage,
} from "@/shell/embed-protocol";
import { describe, expect, it } from "vite-plus/test";

describe("parseEmbedMessage", () => {
  it("accepts a valid fpsr:load message", () => {
    expect(
      parseEmbedMessage({
        type: "fpsr:load",
        version: EMBED_PROTOCOL_VERSION,
        blueprint: "0eN...",
      }),
    ).toEqual({
      ok: true,
      message: {
        type: "fpsr:load",
        version: EMBED_PROTOCOL_VERSION,
        blueprint: "0eN...",
      },
    });
  });

  it("rejects non-objects, unknown types, bad version, and non-string blueprints", () => {
    expect(parseEmbedMessage(null).ok).toBe(false);
    expect(parseEmbedMessage("fpsr:load").ok).toBe(false);
    expect(parseEmbedMessage({ type: "fpsr:ready", version: 1 }).ok).toBe(false);
    expect(parseEmbedMessage({ type: "fpsr:load", version: 2, blueprint: "x" }).ok).toBe(false);
    expect(parseEmbedMessage({ type: "fpsr:load", version: 1, blueprint: 1 }).ok).toBe(false);
  });

  it("rejects blueprint strings over the length cap", () => {
    const result = parseEmbedMessage({
      type: "fpsr:load",
      version: EMBED_PROTOCOL_VERSION,
      blueprint: "x".repeat(EMBED_MAX_BLUEPRINT_CHARS + 1),
    });
    expect(result).toEqual({
      ok: false,
      reason: "Blueprint string exceeds maximum length.",
    });
  });

  it("accepts a blueprint at the length cap", () => {
    const blueprint = "x".repeat(EMBED_MAX_BLUEPRINT_CHARS);
    const result = parseEmbedMessage({
      type: "fpsr:load",
      version: EMBED_PROTOCOL_VERSION,
      blueprint,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message.blueprint).toHaveLength(EMBED_MAX_BLUEPRINT_CHARS);
  });
});

describe("embed outbound helpers", () => {
  it("builds ready / loaded / error messages", () => {
    expect(createReadyMessage()).toEqual({ type: "fpsr:ready", version: 1 });
    expect(createLoadedMessage("book")).toEqual({
      type: "fpsr:loaded",
      version: 1,
      kind: "book",
    });
    expect(createErrorMessage("nope")).toEqual({
      type: "fpsr:error",
      version: 1,
      message: "nope",
    });
  });

  it("maps document shapes to embed kinds", () => {
    expect(docKindFromDocument({ blueprint: {} })).toBe("blueprint");
    expect(docKindFromDocument({ blueprint_book: {} })).toBe("book");
    expect(docKindFromDocument({ upgrade_planner: {} })).toBe("upgrade_planner");
    expect(docKindFromDocument({ deconstruction_planner: {} })).toBe("deconstruction_planner");
  });
});
