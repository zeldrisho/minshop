import { normalizeSearchQuery } from "../search/query";

export const DEFAULT_CATALOG_LIMIT = 24;
export const MAX_CATALOG_LIMIT = 100;

/**
 * Parses an integer from a string and constrains it to the specified bounds.
 *
 * @param raw - The value to parse, or `null`
 * @param fallback - The value to return when `raw` is missing, blank, or invalid
 * @param min - The minimum allowed value
 * @param max - The maximum allowed value
 * @returns The parsed integer constrained between `min` and `max`, or `fallback` when parsing fails
 */
function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

export interface CatalogListQuery {
  query: string;
  limit: number;
  offset: number;
}

/**
 * Parses and normalizes catalog list query parameters.
 *
 * @param params - The URL search parameters to parse
 * @returns Normalized search, limit, and offset values for catalog listing
 */
export function parseCatalogListQuery(params: URLSearchParams): CatalogListQuery {
  return {
    query: normalizeSearchQuery(params.get("q") ?? ""),
    limit: clampInt(params.get("limit"), DEFAULT_CATALOG_LIMIT, 1, MAX_CATALOG_LIMIT),
    offset: clampInt(params.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER),
  };
}
