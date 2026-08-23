import { env } from "cloudflare:workers";
import { getConfig } from "../../config";
import type { Product } from "../products/db";
import { getProductsByIds, setRelatedIds, parseRelatedIds } from "../products/db";
import type { SearchProvider } from "./provider";
import { createFtsSearch } from "./fts";
import { createVectorSearch, embedText, productEmbedText, relatedByVector } from "./vector";
import type { SearchResult } from "./provider";
import { categoriesForProduct } from "../categories/db";
import { getSetting } from "../settings/db";

export type { SearchProvider, SearchResult } from "./provider";

/**
 * Selects the active search provider from the runtime setting or configured default.
 *
 * @returns The configured search provider, either `"fts"` or `"vector"`
 */
async function effectiveProvider(): Promise<"fts" | "vector"> {
  try {
    const runtime = await getSetting(env.DB, "search_provider");
    if (runtime === "fts" || runtime === "vector") return runtime;
  } catch {
    // settings table absent (pre-migration) → use the build-time default
  }
  return getConfig().search.provider;
}

/**
 * Determines whether vector search is available in the current environment.
 *
 * @returns `true` if the vector provider is selected, the application is not running in development mode, and the required bindings are available, `false` otherwise.
 */
async function vectorReady(): Promise<boolean> {
  return (
    (await effectiveProvider()) === "vector" && !import.meta.env.DEV && !!env.AI && !!env.VECTORIZE
  );
}

/**
 * The active search provider. Falls back to FTS when 'vector' is selected but
 * unavailable — at selection time (bindings absent / local dev) AND at query time
 * (a Vectorize/AI failure is caught), so search degrades to keyword instead of
 * breaking the storefront.
 */
/**
 * Vector-similarity "you may also like" for a product. Returns [] when semantic
 * search isn't available (the product page falls back to category-based related).
 * Reuses the stored embedding — a cheap index lookup, no re-embedding.
 */
export async function getRelatedByVector(productId: number, limit = 4): Promise<Product[]> {
  if (!(await vectorReady())) return [];
  try {
    return await relatedByVector(env.VECTORIZE!, env.DB, productId, limit);
  } catch {
    return []; // Vectorize hiccup → fall back to category-based related
  }
}

/**
 * Computes and stores vector-related product IDs for a product.
 *
 * @param productId - The product whose related IDs are updated
 * @param limit - The maximum number of related products to store
 */
async function storeRelatedIdsReady(productId: number, limit: number): Promise<void> {
  try {
    const related = await relatedByVector(env.VECTORIZE!, env.DB, productId, limit);
    await setRelatedIds(
      env.DB,
      productId,
      related.map((p) => p.id),
    );
  } catch {
    // Leave the column as-is; the page still renders with the category fallback.
  }
}

export async function storeRelatedIds(productId: number, limit = 4): Promise<void> {
  if (!(await vectorReady())) return;
  await storeRelatedIdsReady(productId, limit);
}

/**
 * Retrieves a product's stored related products in similarity order.
 *
 * @param product - The product whose stored related IDs are read
 * @param limit - The maximum number of stored related IDs to retrieve
 * @returns The matching active products, an empty array when no related products are stored, or `null` when related products have not been computed
 */
export async function getRelatedStored(
  product: Pick<Product, "id" | "related_ids">,
  limit = 4,
): Promise<Product[] | null> {
  const ids = parseRelatedIds(product.related_ids);
  if (ids === null) return null; // never computed → caller decides to backfill
  if (ids.length === 0) return [];
  const found = await getProductsByIds(env.DB, ids.slice(0, limit));
  // Preserve similarity order; getProductsByIds returns rows in id order.
  const byId = new Map(found.map((p) => [p.id, p]));
  return ids.map((id) => byId.get(id)).filter((p): p is Product => p !== undefined);
}

/**
 * Selects the configured search provider and enables hybrid semantic and keyword search when vector search is available.
 *
 * @returns A search provider that combines semantic results with full-text results and falls back to full-text search if vector search is unavailable or fails.
 */
export async function getSearchProvider(): Promise<SearchProvider> {
  const cfg = getConfig().search;
  if (!(await vectorReady())) return createFtsSearch(env.DB);

  const vector = createVectorSearch({
    db: env.DB,
    ai: env.AI!,
    index: env.VECTORIZE!,
    model: cfg.embeddingModel,
    topK: cfg.topK,
  });
  const fts = createFtsSearch(env.DB);
  return {
    // HYBRID: semantic + keyword. Run both and merge — semantic catches meaning
    // (no shared words), FTS catches exact/prefix/typo ("leathe" → "leather"). A
    // vector failure degrades to FTS-only rather than breaking search.
    async search(query, options = {}) {
      const limit = Math.max(0, Math.trunc(options.limit ?? 50));
      const offset = Math.max(0, Math.trunc(options.offset ?? 0));
      let vectorRes: SearchResult = { products: [], total: 0, correctedTo: null };
      try {
        // Semantic results are deliberately bounded by config.topK. Load that
        // complete, small set so pagination can put every semantic match before
        // keyword matches without materializing the whole FTS result set.
        vectorRes = await vector.search(query, {
          limit: cfg.topK,
          excludeIds: options.excludeIds,
        });
      } catch (err) {
        console.error("Vector search failed; FTS only:", err);
      }

      const semantic = vectorRes.products;
      const semanticIds = semantic.map((p) => p.id);
      const semanticPage = semantic.slice(offset, offset + limit);
      const remaining = Math.max(0, limit - semanticPage.length);
      const ftsOffset = Math.max(0, offset - semantic.length);
      const ftsRes = await fts.search(query, {
        limit: remaining,
        offset: ftsOffset,
        excludeIds: [...(options.excludeIds ?? []), ...semanticIds],
      });

      return {
        products: [...semanticPage, ...ftsRes.products],
        total: semantic.length + ftsRes.total,
        correctedTo: semantic.length === 0 ? ftsRes.correctedTo : null,
      };
    },
  };
}

/**
 * Indexes a product for semantic search and refreshes its related products.
 *
 * Does nothing when vector search is unavailable.
 */
export async function indexProduct(p: Product): Promise<void> {
  if (!(await vectorReady())) return;
  const cats = await categoriesForProduct(env.DB, p.id);
  const text = productEmbedText(
    p,
    cats.map((c) => c.name),
  );
  const values = await embedText(env.AI!, getConfig().search.embeddingModel, text);
  await env.VECTORIZE!.upsert([{ id: String(p.id), values }]);
  // Refresh this product's neighbours now that its vector changed. Neighbours of
  // OTHER products drift until the next reindex; "you may also like" tolerates
  // that, and the page tops up from category-based related when short.
  await storeRelatedIdsReady(p.id, 4);
}

/** Remove a product's embedding. No-op unless semantic search is on. */
export async function unindexProduct(id: number): Promise<void> {
  if (!(await vectorReady())) return;
  await env.VECTORIZE!.deleteByIds([String(id)]);
}

/**
 * Indexes a batch of products and updates their stored related-product IDs.
 *
 * @param products - Products to embed and index
 * @returns The number of products indexed, or `0` when vector search is unavailable or the batch is empty
 */
export async function indexProducts(products: Product[]): Promise<number> {
  if (!(await vectorReady()) || products.length === 0) return 0;
  const model = getConfig().search.embeddingModel;
  const vectors = await Promise.all(
    products.map(async (p) => {
      const cats = await categoriesForProduct(env.DB, p.id);
      const values = await embedText(
        env.AI!,
        model,
        productEmbedText(
          p,
          cats.map((c) => c.name),
        ),
      );
      return { id: String(p.id), values };
    }),
  );
  await env.VECTORIZE!.upsert(vectors);
  // Second pass: neighbours can only be computed once every vector is in the
  // index, so this runs after the upsert rather than inside the map above. Keep
  // concurrency deliberately small: Vectorize latency is variable, while an
  // unbounded Promise.all would create a binding burst for a large batch.
  const RELATED_CONCURRENCY = 3;
  for (let i = 0; i < products.length; i += RELATED_CONCURRENCY) {
    await Promise.all(
      products
        .slice(i, i + RELATED_CONCURRENCY)
        .map((product) => storeRelatedIdsReady(product.id, 4)),
    );
  }
  return vectors.length;
}
