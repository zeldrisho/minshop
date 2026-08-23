export const MAX_SEARCH_QUERY_LENGTH = 200;

/**
 * Normalizes a search query for consistent processing.
 *
 * @param raw - The unnormalized search query
 * @returns The trimmed query with consecutive whitespace collapsed and limited to 200 Unicode characters
 */
export function normalizeSearchQuery(raw: string): string {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  return Array.from(collapsed).slice(0, MAX_SEARCH_QUERY_LENGTH).join("").trim();
}
