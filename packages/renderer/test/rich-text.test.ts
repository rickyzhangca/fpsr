import { describe, expect, it } from "vite-plus/test";
import {
  parseRichText,
  richTextIconKeys,
  richTextIconQuality,
  stripRichText,
} from "../src/rich-text.js";

describe("parseRichText", () => {
  it("parses item tag with quality and trailing text", () => {
    const tokens = parseRichText("[item=turbo-transport-belt,quality=epic] test");
    expect(tokens).toEqual([
      {
        kind: "icon",
        type: "item",
        name: "turbo-transport-belt",
        quality: "epic",
        raw: "[item=turbo-transport-belt,quality=epic]",
      },
      { kind: "text", value: " test" },
    ]);
  });

  it("parses entity tag with quality and trailing text", () => {
    const tokens = parseRichText("[entity=elevated-curved-rail-a,quality=rare] test");
    expect(tokens).toEqual([
      {
        kind: "icon",
        type: "entity",
        name: "elevated-curved-rail-a",
        quality: "rare",
        raw: "[entity=elevated-curved-rail-a,quality=rare]",
      },
      { kind: "text", value: " test" },
    ]);
  });

  it("parses item without quality", () => {
    const tokens = parseRichText("[item=iron-plate]");
    expect(tokens).toEqual([
      {
        kind: "icon",
        type: "item",
        name: "iron-plate",
        raw: "[item=iron-plate]",
      },
    ]);
  });

  it("omits normal quality from token", () => {
    const tokens = parseRichText("[item=iron-plate,quality=normal]");
    expect(tokens).toEqual([
      {
        kind: "icon",
        type: "item",
        name: "iron-plate",
        raw: "[item=iron-plate,quality=normal]",
      },
    ]);
  });

  it("parses img tags with slash or dot separators", () => {
    expect(parseRichText("[img=item/iron-plate]")).toEqual([
      { kind: "icon", type: "item", name: "iron-plate", raw: "[img=item/iron-plate]" },
    ]);
    expect(parseRichText("[img=item.iron-plate]")).toEqual([
      { kind: "icon", type: "item", name: "iron-plate", raw: "[img=item.iron-plate]" },
    ]);
  });

  it("parses standalone quality tag", () => {
    expect(parseRichText("[quality=epic]")).toEqual([
      { kind: "icon", type: "quality", name: "epic", raw: "[quality=epic]" },
    ]);
  });

  it("parses multiple icons with text between", () => {
    const tokens = parseRichText("A [item=iron-plate] and [entity=small-biter] B");
    expect(tokens).toEqual([
      { kind: "text", value: "A " },
      { kind: "icon", type: "item", name: "iron-plate", raw: "[item=iron-plate]" },
      { kind: "text", value: " and " },
      { kind: "icon", type: "entity", name: "small-biter", raw: "[entity=small-biter]" },
      { kind: "text", value: " B" },
    ]);
  });

  it("keeps unrecognized tags as literal text", () => {
    expect(parseRichText("[color=red]hello[/color]")).toEqual([
      { kind: "text", value: "[color=red]hello[/color]" },
    ]);
  });

  it("keeps malformed img tags as literal text", () => {
    expect(parseRichText("[img=quantity-time]")).toEqual([
      { kind: "text", value: "[img=quantity-time]" },
    ]);
  });

  it("keeps unclosed brackets as literal text", () => {
    expect(parseRichText("hello [item=foo")).toEqual([{ kind: "text", value: "hello [item=foo" }]);
  });

  it("returns empty array for empty input", () => {
    expect(parseRichText("")).toEqual([]);
  });
});

describe("richTextIconKeys", () => {
  it("returns item fallbacks for item tokens", () => {
    const token = parseRichText("[item=iron-plate]")[0] as Extract<
      ReturnType<typeof parseRichText>[number],
      { kind: "icon" }
    >;
    expect(richTextIconKeys(token)).toEqual([
      "item/iron-plate",
      "entity/iron-plate",
      "recipe/iron-plate",
    ]);
  });

  it("returns entity fallbacks for entity tokens", () => {
    const token = parseRichText("[entity=small-biter]")[0] as Extract<
      ReturnType<typeof parseRichText>[number],
      { kind: "icon" }
    >;
    expect(richTextIconKeys(token)).toEqual(["entity/small-biter", "item/small-biter"]);
  });
});

describe("richTextIconQuality", () => {
  it("returns quality for item with non-normal quality", () => {
    const token = parseRichText("[item=foo,quality=rare]")[0] as Extract<
      ReturnType<typeof parseRichText>[number],
      { kind: "icon" }
    >;
    expect(richTextIconQuality(token)).toBe("rare");
  });

  it("returns undefined for quality-only icon tokens", () => {
    const token = parseRichText("[quality=epic]")[0] as Extract<
      ReturnType<typeof parseRichText>[number],
      { kind: "icon" }
    >;
    expect(richTextIconQuality(token)).toBeUndefined();
  });
});

describe("stripRichText", () => {
  it("removes tags and keeps text", () => {
    expect(stripRichText("[item=turbo-transport-belt,quality=epic] test")).toBe("test");
    expect(stripRichText("prefix [entity=foo] suffix")).toBe("prefix  suffix");
  });

  it("returns empty string for undefined", () => {
    expect(stripRichText(undefined)).toBe("");
  });
});
