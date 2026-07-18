export type AnalyticsParams = Record<string, string | number | boolean | undefined>;

type GtagFn = (...args: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: GtagFn;
  }
}

/** Fire a GA4 custom event. No-ops when gtag is unavailable (tests / offline). */
export const trackEvent = (name: string, params?: AnalyticsParams): void => {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  window.gtag("event", name, params);
};
