import { MAX_SOURCE_BYTES } from "@/shell/source-proxy";

export const EMBED_PROTOCOL_VERSION = 1;

export const EMBED_SOURCE_ID = "embed";

/** Cap matches the blueprint proxy (`MAX_SOURCE_BYTES`). */
export const EMBED_MAX_BLUEPRINT_CHARS = MAX_SOURCE_BYTES;

export type EmbedDocKind = "blueprint" | "book" | "upgrade_planner" | "deconstruction_planner";

export type EmbedReadyMessage = {
  type: "fpsr:ready";
  version: typeof EMBED_PROTOCOL_VERSION;
};

export type EmbedLoadMessage = {
  type: "fpsr:load";
  version: typeof EMBED_PROTOCOL_VERSION;
  blueprint: string;
};

export type EmbedLoadedMessage = {
  type: "fpsr:loaded";
  version: typeof EMBED_PROTOCOL_VERSION;
  kind: EmbedDocKind;
};

export type EmbedErrorMessage = {
  type: "fpsr:error";
  version: typeof EMBED_PROTOCOL_VERSION;
  message: string;
};

export type EmbedInboundMessage = EmbedLoadMessage;
export type EmbedOutboundMessage = EmbedReadyMessage | EmbedLoadedMessage | EmbedErrorMessage;

export type ParseEmbedMessageResult =
  | { ok: true; message: EmbedInboundMessage }
  | { ok: false; reason?: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Parse a parent→iframe message. Unknown / invalid payloads return `{ ok: false }`. */
export const parseEmbedMessage = (data: unknown): ParseEmbedMessageResult => {
  if (!isRecord(data)) return { ok: false };
  if (data.type !== "fpsr:load") return { ok: false };
  if (data.version !== EMBED_PROTOCOL_VERSION) return { ok: false };
  if (typeof data.blueprint !== "string") return { ok: false };

  if (data.blueprint.length > EMBED_MAX_BLUEPRINT_CHARS) {
    return { ok: false, reason: "Blueprint string exceeds maximum length." };
  }

  return {
    ok: true,
    message: {
      type: "fpsr:load",
      version: EMBED_PROTOCOL_VERSION,
      blueprint: data.blueprint,
    },
  };
};

export const createReadyMessage = (): EmbedReadyMessage => ({
  type: "fpsr:ready",
  version: EMBED_PROTOCOL_VERSION,
});

export const createLoadedMessage = (kind: EmbedDocKind): EmbedLoadedMessage => ({
  type: "fpsr:loaded",
  version: EMBED_PROTOCOL_VERSION,
  kind,
});

export const createErrorMessage = (message: string): EmbedErrorMessage => ({
  type: "fpsr:error",
  version: EMBED_PROTOCOL_VERSION,
  message,
});

/** Prefer document.referrer origin for the initial ready ping; fall back to `*`. */
export const embedParentTargetOrigin = (): string => {
  try {
    if (document.referrer) return new URL(document.referrer).origin;
  } catch {
    // ignore
  }
  return "*";
};

export const postToEmbedParent = (message: EmbedOutboundMessage, targetOrigin?: string): void => {
  if (typeof window === "undefined" || window.parent === window) return;
  window.parent.postMessage(message, targetOrigin ?? embedParentTargetOrigin());
};

export const replyToEmbedSource = (
  source: MessageEventSource | null,
  origin: string,
  message: EmbedOutboundMessage,
): void => {
  if (!source || typeof (source as Window).postMessage !== "function") return;
  if (!origin || origin === "null") return;
  (source as Window).postMessage(message, origin);
};

export const docKindFromDocument = (doc: {
  blueprint_book?: unknown;
  upgrade_planner?: unknown;
  deconstruction_planner?: unknown;
  blueprint?: unknown;
}): EmbedDocKind => {
  if (doc.blueprint_book) return "book";
  if (doc.upgrade_planner) return "upgrade_planner";
  if (doc.deconstruction_planner) return "deconstruction_planner";
  return "blueprint";
};
