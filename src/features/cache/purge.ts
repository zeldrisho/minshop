import { cache } from "cloudflare:workers";
import { normalizeCacheTags, productCacheTags } from "./tags";

export interface CachePurger {
  purge(options: CachePurgeOptions): Promise<CachePurgeResult>;
}

/**
 * Logs a structured event when cache purging fails.
 *
 * @param mode - The cache purge mode that failed
 * @param errors - The errors associated with the failed purge
 */
function purgeFailure(
  mode: "tags" | "stock-tags" | "everything",
  errors: CachePurgeError[] | unknown,
): void {
  console.error(
    JSON.stringify({
      event: "workers_cache_purge_failed",
      mode,
      errors,
    }),
  );
}

/**
 * Purges cache entries associated with the specified tags.
 *
 * Falls back to purging the entire cache when the tag purge fails.
 *
 * @param tags - Cache tags identifying the entries to purge
 * @throws If both the tag purge and full-cache purge fail
 */
export async function purgeCacheTags(
  tags: Iterable<string>,
  purger: CachePurger = cache,
): Promise<void> {
  const normalized = normalizeCacheTags(tags);
  if (normalized.length === 0) return;

  try {
    const result = await purger.purge({ tags: normalized });
    if (result.success) return;
    purgeFailure("tags", result.errors);
  } catch (error) {
    purgeFailure("tags", error instanceof Error ? error.message : String(error));
  }

  try {
    const fallback = await purger.purge({ purgeEverything: true });
    if (fallback.success) return;
    purgeFailure("everything", fallback.errors);
  } catch (error) {
    purgeFailure("everything", error instanceof Error ? error.message : String(error));
  }

  throw new Error("The data was saved, but the Workers cache could not be invalidated.");
}

/**
 * Purges cache entries associated with the specified products.
 *
 * @param productPublicIds - Public IDs of the products whose cache entries should be purged
 * @param purger - Optional cache purger to use
 * @returns Resolves when the product cache purge completes
 */
export function purgeProductCache(
  productPublicIds: Iterable<string | null | undefined>,
  purger?: CachePurger,
): Promise<void> {
  return purgeCacheTags(productCacheTags(productPublicIds), purger);
}

/**
 * Purges the complete cache for the owning Worker.
 *
 * @throws If the cache purge fails.
 */
export async function purgeEntireCache(purger: CachePurger = cache): Promise<void> {
  try {
    const result = await purger.purge({ purgeEverything: true });
    if (result.success) return;
    purgeFailure("everything", result.errors);
  } catch (error) {
    purgeFailure("everything", error instanceof Error ? error.message : String(error));
  }
  throw new Error("The Workers cache could not be purged.");
}

/**
 * Attempts to purge cache entries associated with inventory products.
 *
 * Purge failures are logged without throwing an error or purging the entire cache.
 *
 * @param productPublicIds - Public IDs of the products whose cache entries should be purged
 */
export async function purgeStockProductCache(
  productPublicIds: Iterable<string | null | undefined>,
  purger: CachePurger = cache,
): Promise<void> {
  const tags = productCacheTags(productPublicIds);
  if (tags.length === 0) return;

  try {
    const result = await purger.purge({ tags });
    if (result.success) return;
    purgeFailure("stock-tags", result.errors);
  } catch (error) {
    purgeFailure("stock-tags", error instanceof Error ? error.message : String(error));
  }
}
