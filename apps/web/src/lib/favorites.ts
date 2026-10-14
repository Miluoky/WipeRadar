export const FAV_COOKIE = "fav";

/** "12.7.31" → [12, 7, 31]; ignores garbage. Dots, because commas need cookie escaping. */
export function parseFavorites(raw: string | undefined | null): number[] {
  if (!raw) return [];
  return decodeURIComponent(raw)
    .split(/[.,]/)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 50);
}
