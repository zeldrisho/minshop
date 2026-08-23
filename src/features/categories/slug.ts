import type { D1Database } from "@cloudflare/workers-types";
import { slugify } from "../products/slug";

/**
 * Generates a category slug that is available in the `categories` table.
 *
 * @param base - The text to convert into a slug
 * @param excludeId - The category ID to exclude when checking for an existing slug
 * @returns The first available slug, appending numeric suffixes when necessary
 */
export async function uniqueCategorySlug(
  db: D1Database,
  base: string,
  excludeId?: number,
): Promise<string> {
  const slug = slugify(base);
  let candidate = slug;
  let n = 1;
  while (true) {
    const row = await db
      .prepare(`SELECT id FROM categories WHERE slug = ?${excludeId ? " AND id != ?" : ""} LIMIT 1`)
      .bind(...(excludeId ? [candidate, excludeId] : [candidate]))
      .first<{ id: number }>();
    if (!row) return candidate;
    n += 1;
    candidate = `${slug}-${n}`;
  }
}
