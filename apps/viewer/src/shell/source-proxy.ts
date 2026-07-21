/** Hosts allowed for `?source=` URL imports (proxied server-side). */
export const ALLOWED_SOURCE_HOSTS = new Set(["www.factorio.school", "factorio.school"]);

/** Max upstream response size (bytes). */
export const MAX_SOURCE_BYTES = 4 * 1024 * 1024;

/** Upstream fetch timeout (ms). */
export const SOURCE_FETCH_TIMEOUT_MS = 15_000;

export type ParseSourceUrlResult = { ok: true; url: URL } | { ok: false; error: string };

export const parseSourceUrl = (raw: string): ParseSourceUrlResult => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "Missing source URL." };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: "Invalid source URL." };
  }

  if (url.protocol !== "https:") {
    return { ok: false, error: "Source URL must use HTTPS." };
  }

  if (url.username || url.password) {
    return { ok: false, error: "Source URL must not include credentials." };
  }

  if (!ALLOWED_SOURCE_HOSTS.has(url.hostname)) {
    return { ok: false, error: `Host not allowed: ${url.hostname}` };
  }

  return { ok: true, url };
};

export type FetchUpstreamResult =
  | { ok: true; body: string }
  | { ok: false; status: number; error: string };

/**
 * Fetch a blueprint string from an already-validated upstream URL.
 * Shared by the Cloudflare Pages Function and Vite dev middleware.
 */
export const fetchUpstreamBlueprint = async (
  url: URL,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchUpstreamResult> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOURCE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: "text/plain, */*" },
    });

    if (!response.ok) {
      return {
        ok: false,
        status: 502,
        error: `Upstream returned ${response.status}.`,
      };
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength != null) {
      const length = Number(contentLength);
      if (Number.isFinite(length) && length > MAX_SOURCE_BYTES) {
        return {
          ok: false,
          status: 502,
          error: "Upstream response too large.",
        };
      }
    }

    const body = await response.text();
    if (body.length > MAX_SOURCE_BYTES) {
      return {
        ok: false,
        status: 502,
        error: "Upstream response too large.",
      };
    }

    const trimmed = body.trim();
    if (!trimmed) {
      return {
        ok: false,
        status: 502,
        error: "Upstream returned an empty body.",
      };
    }

    return { ok: true, body: trimmed };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, status: 502, error: "Upstream request timed out." };
    }
    return {
      ok: false,
      status: 502,
      error: e instanceof Error ? e.message : "Upstream fetch failed.",
    };
  } finally {
    clearTimeout(timer);
  }
};

/** Handle a proxy request: validate `url` query param and fetch upstream. */
export const handleFetchBlueprintRequest = async (
  requestUrl: string | URL,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> => {
  const incoming = typeof requestUrl === "string" ? new URL(requestUrl) : requestUrl;
  const raw = incoming.searchParams.get("url");
  if (raw == null || raw === "") {
    return new Response("Missing url query parameter.", { status: 400 });
  }

  const parsed = parseSourceUrl(raw);
  if (!parsed.ok) {
    return new Response(parsed.error, { status: 400 });
  }

  const result = await fetchUpstreamBlueprint(parsed.url, fetchImpl);
  if (!result.ok) {
    return new Response(result.error, { status: result.status });
  }

  return new Response(result.body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
};

/** Client helper: fetch blueprint text via the same-origin proxy. */
export const fetchBlueprintViaProxy = async (sourceUrl: string): Promise<string> => {
  const parsed = parseSourceUrl(sourceUrl);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }

  const proxyUrl = `/api/fetch-blueprint?url=${encodeURIComponent(parsed.url.href)}`;
  const response = await fetch(proxyUrl);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text.trim() || `Proxy returned ${response.status}.`);
  }
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Proxy returned an empty body.");
  }
  return trimmed;
};

/** Read `?source=` from the current location (or a provided search string). */
export const readSourceParam = (search: string = location.search): string | null => {
  const value = new URLSearchParams(search).get("source");
  if (value == null || value.trim() === "") return null;
  return value.trim();
};

/** Drop `source` from the address bar without a navigation. */
export const stripSourceParam = (
  href: string = location.href,
  replaceState: History["replaceState"] = history.replaceState.bind(history),
): void => {
  const url = new URL(href);
  if (!url.searchParams.has("source")) return;
  url.searchParams.delete("source");
  const next = `${url.pathname}${url.search}${url.hash}`;
  replaceState(null, "", next);
};
