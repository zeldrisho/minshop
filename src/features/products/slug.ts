import type { D1Database } from "@cloudflare/workers-types";

const DIACRITICS = /[̀-ͯ]/g;

/**
 * Converts text into a URL-safe, lowercase slug.
 *
 * @param input - The text to convert.
 * @returns A hyphen-separated slug limited to 80 characters, or `"product"` when no slug can be produced.
 */
export function slugify(input: string): string {
  const base = input
    .normalize("NFKD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(/['’`]/g, "") // drop apostrophes so "mom's" → "moms", not "mom-s"
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || "product";
}

/**
 * Generates a product slug that is unique in the database.
 *
 * @param base - The text from which to generate the slug
 * @param excludeId - The product ID to exclude when checking for collisions
 * @returns A unique product slug
 */
export async function uniqueSlug(
  db: D1Database,
  base: string,
  excludeId?: number,
): Promise<string> {
  const slug = slugify(base);
  let candidate = slug;
  let n = 1;
  while (true) {
    const row = await db
      .prepare(`SELECT id FROM products WHERE slug = ?${excludeId ? " AND id != ?" : ""} LIMIT 1`)
      .bind(...(excludeId ? [candidate, excludeId] : [candidate]))
      .first<{ id: number }>();
    if (!row) return candidate;
    n += 1;
    candidate = `${slug}-${n}`;
  }
}
