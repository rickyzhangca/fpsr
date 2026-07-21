import {
  EMBED_PROTOCOL_VERSION,
  createReadyMessage,
  type EmbedLoadMessage,
} from "@/shell/embed-protocol";

/**
 * Open the full viewer and hand off a blueprint via `postMessage`.
 * Uses `?import=1` so the new tab signals `fpsr:ready` to `window.opener`
 * (IndexedDB/localStorage are partitioned for third-party embeds).
 */
export const openViewerWithBlueprint = (blueprint: string): Window | null => {
  const url = new URL("/", window.location.origin);
  url.searchParams.set("import", "1");
  const child = window.open(url.href, "_blank");
  if (!child) return null;

  const onMessage = (event: MessageEvent) => {
    if (event.source !== child) return;
    if (
      typeof event.data !== "object" ||
      event.data === null ||
      (event.data as { type?: unknown }).type !== "fpsr:ready"
    ) {
      return;
    }
    const load: EmbedLoadMessage = {
      type: "fpsr:load",
      version: EMBED_PROTOCOL_VERSION,
      blueprint,
    };
    child.postMessage(load, window.location.origin);
    window.removeEventListener("message", onMessage);
  };

  window.addEventListener("message", onMessage);
  return child;
};

/** Re-export for callers that only need the ready shape. */
export { createReadyMessage };
