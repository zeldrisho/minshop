import type { D1Database } from "@cloudflare/workers-types";
import { slugify } from "../products/slug";

/**
 * Page slugs live under /pages/, their own namespace, so they cannot collide
 * with /products/, /categories/, or any future top-level route. That is why
 * there is no reserved-slug list to maintain here.
 */

/**
 * Generates a page slug from the provided input.
 *
 * @returns The generated slug, using `page` when the result would be `product` without the input containing "product".
 */
export function pageSlugify(input: string): string {
  const slug = slugify(input);
  return slug === "product" && !/product/i.test(input) ? "page" : slug;
}

/**
 * Generates a page slug that is unique in the `pages` table.
 *
 * @param base - The text from which to generate the initial slug
 * @param excludeId - The page ID to exclude when checking for collisions
 * @returns A unique page slug, appending `-2`, `-3`, and so on when needed
 */
export async function uniquePageSlug(
  db: D1Database,
  base: string,
  excludeId?: number,
): Promise<string> {
  const slug = pageSlugify(base);
  let candidate = slug;
  let n = 1;
  while (true) {
    const row = await db
      .prepare(`SELECT id FROM pages WHERE slug = ?${excludeId ? " AND id != ?" : ""} LIMIT 1`)
      .bind(...(excludeId ? [candidate, excludeId] : [candidate]))
      .first<{ id: number }>();
    if (!row) return candidate;
    n += 1;
    candidate = `${slug}-${n}`;
  }
}
