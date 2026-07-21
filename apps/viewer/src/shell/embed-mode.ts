/** True when `?embed=1` or `?embed=true` (case-insensitive). */
export const readEmbedParam = (search: string = window.location.search): boolean => {
  const value = new URLSearchParams(search).get("embed");
  if (value == null) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
};
