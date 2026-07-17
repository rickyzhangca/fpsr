export const ASSETS_MISSING_HINT = "Assets not found — run: pnpm assets:build";

export const isMissingAssetsError = (message: string): boolean => {
  return ["Failed to fetch", "404", "Not found", "ENOENT"].some((part) => message.includes(part));
};
