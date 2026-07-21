/** True when `?embed=1` or `?embed=true` (case-insensitive). */
export const readEmbedParam = (search: string = window.location.search): boolean => {
  const value = new URLSearchParams(search).get("embed");
  if (value == null) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
};

/** True when `?import=1` / `?import=true` — full viewer awaiting opener blueprint handoff. */
export const readImportParam = (search: string = window.location.search): boolean => {
  const value = new URLSearchParams(search).get("import");
  if (value == null) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
};

/** Remove `import` from the address bar after a handoff (or if opener is missing). */
export const stripImportParam = (
  replaceState: (data: unknown, unused: string, url?: string | null) => void = (...args) =>
    window.history.replaceState(...args),
  href: string = window.location.href,
): void => {
  const url = new URL(href);
  if (!url.searchParams.has("import")) return;
  url.searchParams.delete("import");
  const next = `${url.pathname}${url.search}${url.hash}`;
  replaceState(null, "", next);
};
