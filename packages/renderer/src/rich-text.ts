/** Parsed segment of a Factorio rich-text string. */
export type RichTextToken =
  | { kind: "text"; value: string }
  | {
      kind: "icon";
      type: string;
      name: string;
      quality?: string;
      raw: string;
    };

const ICON_TAG_TYPES = new Set([
  "item",
  "entity",
  "recipe",
  "fluid",
  "virtual-signal",
  "quality",
  "space-location",
  "asteroid-chunk",
  "img",
]);

const RICH_TEXT_PREFIX: Record<string, string> = {
  item: "item",
  entity: "entity",
  recipe: "recipe",
  fluid: "fluid",
  "virtual-signal": "virtual-signal",
  quality: "quality",
  "space-location": "space-location",
  "asteroid-chunk": "asteroid-chunk",
};

function parsePayload(payload: string): { name: string; quality?: string } | undefined {
  const parts = payload.split(",");
  const namePart = parts[0]?.trim();
  if (!namePart) return undefined;

  let quality: string | undefined;
  for (let i = 1; i < parts.length; i++) {
    const segment = parts[i]?.trim();
    if (!segment) continue;
    const eq = segment.indexOf("=");
    if (eq === -1) continue;
    const key = segment.slice(0, eq).trim();
    const value = segment.slice(eq + 1).trim();
    if (key === "quality" && value) quality = value;
  }

  return quality ? { name: namePart, quality } : { name: namePart };
}

function parseImgPayload(payload: string): { type: string; name: string } | undefined {
  const slash = payload.indexOf("/");
  const dot = payload.indexOf(".");
  const sep = slash !== -1 ? slash : dot !== -1 ? dot : -1;
  if (sep === -1) return undefined;
  const type = payload.slice(0, sep).trim();
  const name = payload.slice(sep + 1).trim();
  if (!type || !name) return undefined;
  return { type, name };
}

function parseTagContent(content: string): RichTextToken | undefined {
  const eq = content.indexOf("=");
  if (eq === -1) return undefined;

  const tag = content.slice(0, eq).trim();
  const payload = content.slice(eq + 1).trim();
  if (!tag || !payload) return undefined;
  if (!ICON_TAG_TYPES.has(tag)) return undefined;

  const raw = `[${content}]`;

  if (tag === "img") {
    const img = parseImgPayload(payload);
    if (!img) return undefined;
    return { kind: "icon", type: img.type, name: img.name, raw };
  }

  const parsed = parsePayload(payload);
  if (!parsed) return undefined;

  if (tag === "quality") {
    return { kind: "icon", type: "quality", name: parsed.name, raw };
  }

  const token: RichTextToken = { kind: "icon", type: tag, name: parsed.name, raw };
  if (parsed.quality && parsed.quality !== "normal") {
    return { ...token, quality: parsed.quality };
  }
  return token;
}

/**
 * Parse Factorio rich-text icon tags into text and icon tokens.
 * Unrecognized bracket sequences are kept as literal text.
 */
export function parseRichText(text: string): RichTextToken[] {
  if (!text) return [];

  const tokens: RichTextToken[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const open = text.indexOf("[", cursor);
    if (open === -1) {
      tokens.push({ kind: "text", value: text.slice(cursor) });
      break;
    }

    if (open > cursor) {
      tokens.push({ kind: "text", value: text.slice(cursor, open) });
    }

    const close = text.indexOf("]", open + 1);
    if (close === -1) {
      tokens.push({ kind: "text", value: text.slice(open) });
      break;
    }

    const content = text.slice(open + 1, close);
    const parsed = parseTagContent(content);
    if (parsed) {
      tokens.push(parsed);
      cursor = close + 1;
    } else {
      tokens.push({ kind: "text", value: text.slice(open, close + 1) });
      cursor = close + 1;
    }
  }

  return mergeAdjacentText(tokens);
}

function mergeAdjacentText(tokens: RichTextToken[]): RichTextToken[] {
  const merged: RichTextToken[] = [];
  for (const token of tokens) {
    const last = merged.at(-1);
    if (token.kind === "text" && last?.kind === "text") {
      last.value += token.value;
    } else {
      merged.push(token);
    }
  }
  return merged;
}

/** Ordered render-db icon keys for a parsed rich-text icon token. */
export function richTextIconKeys(token: Extract<RichTextToken, { kind: "icon" }>): string[] {
  const prefix = RICH_TEXT_PREFIX[token.type] ?? token.type;
  const primary = `${prefix}/${token.name}`;

  switch (token.type) {
    case "item":
      return [primary, `entity/${token.name}`, `recipe/${token.name}`];
    case "entity":
      return [primary, `item/${token.name}`];
    case "recipe":
      return [primary, `item/${token.name}`];
    default:
      return [primary];
  }
}

/** Whether a quality badge should be drawn on top of this icon token. */
export function richTextIconQuality(
  token: Extract<RichTextToken, { kind: "icon" }>,
): string | undefined {
  if (token.type === "quality") return undefined;
  if (!token.quality || token.quality === "normal") return undefined;
  return token.quality;
}

/** Strip rich-text tags, keeping only literal text segments. */
export function stripRichText(text: string | undefined): string {
  if (!text) return "";
  return parseRichText(text)
    .filter((token): token is Extract<RichTextToken, { kind: "text" }> => token.kind === "text")
    .map((token) => token.value)
    .join("")
    .trim();
}
