import { readEmbedParam } from "@/shell/embed-mode";

/**
 * Capture `fpsr:load` messages that arrive before React wires the real handler
 * (parent race vs iframe boot). Only active in `?embed=1`.
 */

let listening = false;
let buffered: MessageEvent | null = null;
let consumer: ((event: MessageEvent) => void) | null = null;

const isLoadAttempt = (data: unknown): boolean => {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  return (data as { type?: unknown }).type === "fpsr:load";
};

const onWindowMessage = (event: MessageEvent) => {
  if (consumer) {
    consumer(event);
    return;
  }
  if (!isLoadAttempt(event.data)) return;
  // Keep the latest early load attempt.
  buffered = event;
};

/** Start buffering as soon as the App module loads in embed mode. */
export const ensureEmbedMessageCapture = (): void => {
  if (listening || typeof window === "undefined") return;
  if (!readEmbedParam()) return;
  listening = true;
  window.addEventListener("message", onWindowMessage);
};

/** Attach the real handler and flush at most one buffered early load. */
export const subscribeEmbedMessages = (handler: (event: MessageEvent) => void): (() => void) => {
  ensureEmbedMessageCapture();
  consumer = handler;
  if (buffered) {
    const event = buffered;
    buffered = null;
    handler(event);
  }
  return () => {
    if (consumer === handler) consumer = null;
  };
};

/** Test helper: reset module state between cases. */
export const resetEmbedMessageCaptureForTests = (): void => {
  if (listening && typeof window !== "undefined") {
    window.removeEventListener("message", onWindowMessage);
  }
  listening = false;
  buffered = null;
  consumer = null;
};
