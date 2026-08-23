import type { D1Database } from "@cloudflare/workers-types";
import { withPublicId } from "../ids/publicId.ts";

export interface Media {
  id: number;
  public_id: string | null;
  image_key: string;
  original_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  /** Pixel dimensions, so <img> can reserve its space. NULL for rows created
   *  before migration 0029, and for anything whose header could not be read. */
  width: number | null;
  height: number | null;
  created_at: string;
}

/** Grid/picker page size. Bounds both the admin page and the JSON API. */
export const MEDIA_PAGE_SIZE = 48;

/**
 * Retrieves media by its numeric identifier.
 *
 * @param id - The media record identifier
 * @returns The matching media record, or `null` if no record exists
 */
export async function getMedia(db: D1Database, id: number): Promise<Media | null> {
  return db.prepare("SELECT * FROM media WHERE id = ?").bind(id).first<Media>();
}

/**
 * Finds media by its image key.
 *
 * @param key - The image key to search for
 * @returns The matching media record, or `null` if no record exists
 */
export async function getMediaByKey(db: D1Database, key: string): Promise<Media | null> {
  return db.prepare("SELECT * FROM media WHERE image_key = ?").bind(key).first<Media>();
}

/** Media by its prefixed public ID (boundary resolution; null if missing). */
export async function getMediaByPublicId(db: D1Database, publicId: string): Promise<Media | null> {
  return db.prepare("SELECT * FROM media WHERE public_id = ?").bind(publicId).first<Media>();
}

/**
 * Lists media records in descending creation order with pagination.
 *
 * @param limit - Maximum number of records to return
 * @param offset - Number of records to skip
 * @returns The matching media records
 */
export async function listMedia(db: D1Database, limit: number, offset: number): Promise<Media[]> {
  const { results } = await db
    .prepare("SELECT * FROM media ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?")
    .bind(limit, offset)
    .all<Media>();
  return results ?? [];
}

/**
 * Counts all media records.
 *
 * @returns The total number of media records.
 */
export async function countMedia(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS c FROM media").first<{ c: number }>();
  return row?.c ?? 0;
}

/**
 * D1 rejects a statement with more than 100 bound parameters ("too many SQL
 * variables"), so anything driven by user content — a page body can reference
 * any number of images — has to be chunked rather than trusted to be small.
 */
const MAX_BOUND_PARAMS = 90; // headroom under D1's hard limit of 100

/**
 * Finds media records matching the specified image keys.
 *
 * @param keys - The image keys to resolve.
 * @returns The matching media records.
 */
export async function findMediaByKeys(db: D1Database, keys: string[]): Promise<Media[]> {
  if (keys.length === 0) return [];
  const found: Media[] = [];
  for (let i = 0; i < keys.length; i += MAX_BOUND_PARAMS) {
    const chunk = keys.slice(i, i + MAX_BOUND_PARAMS);
    const placeholders = chunk.map(() => "?").join(", ");
    const { results } = await db
      .prepare(`SELECT * FROM media WHERE image_key IN (${placeholders})`)
      .bind(...chunk)
      .all<Media>();
    if (results) found.push(...results);
  }
  return found;
}

/**
 * Creates a media record with a generated public ID.
 *
 * @param fields - The media metadata and optional dimensions to store
 * @returns The created media record
 */
export async function createMediaRecord(
  db: D1Database,
  fields: {
    image_key: string;
    original_name: string;
    mime_type: string | null;
    size_bytes: number | null;
    width?: number | null;
    height?: number | null;
  },
): Promise<Media> {
  return withPublicId("media", async (publicId) => {
    const row = await db
      .prepare(
        `INSERT INTO media (image_key, original_name, mime_type, size_bytes, width, height, public_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .bind(
        fields.image_key,
        fields.original_name,
        fields.mime_type,
        fields.size_bytes,
        fields.width ?? null,
        fields.height ?? null,
        publicId,
      )
      .first<Media>();
    if (!row) throw new Error("media insert returned no row");
    return row;
  });
}

/**
 * Deletes a media record when it has no product, page, or logo references.
 *
 * @param id - The numeric ID of the media record
 * @returns The deleted media image key, or `null` if the record does not exist or is referenced
 */
export async function deleteMediaRecord(db: D1Database, id: number): Promise<string | null> {
  const row = await db
    .prepare(
      `DELETE FROM media
        WHERE id = ?1
          AND NOT EXISTS (
            SELECT 1 FROM product_images WHERE product_images.image_key = media.image_key
          )
          AND NOT EXISTS (
            SELECT 1 FROM products WHERE products.image_key = media.image_key
          )
          AND NOT EXISTS (
            SELECT 1 FROM page_media WHERE page_media.media_id = media.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM settings
             WHERE settings.key = 'logo_image_key' AND settings.value = media.image_key
          )
        RETURNING image_key`,
    )
    .bind(id)
    .first<{ image_key: string }>();
  return row?.image_key ?? null;
}

export type AttachResult = { ok: true; imageKey: string } | { ok: false; error: string };

/**
 * Adds a media item to a product's gallery when the media exists and is not already attached.
 *
 * @returns The attached image key on success, or an error describing why the attachment failed.
 */
export async function attachMediaToProduct(
  db: D1Database,
  productId: number,
  mediaId: number,
): Promise<AttachResult> {
  const row = await withPublicId("productImage", (publicId) =>
    db
      .prepare(
        `INSERT INTO product_images (product_id, image_key, position, public_id)
         SELECT ?1,
                m.image_key,
                (SELECT COALESCE(MAX(position), -1) + 1
                   FROM product_images WHERE product_id = ?1),
                ?3
           FROM media m
          WHERE m.id = ?2
            AND NOT EXISTS (
              SELECT 1 FROM product_images pi
               WHERE pi.product_id = ?1 AND pi.image_key = m.image_key
            )
         RETURNING image_key`,
      )
      .bind(productId, mediaId, publicId)
      .first<{ image_key: string }>(),
  );

  if (row) return { ok: true, imageKey: row.image_key };

  // Nothing inserted — say which of the two guards refused.
  const media = await getMedia(db, mediaId);
  return media
    ? { ok: false, error: "That image is already in this product’s gallery." }
    : { ok: false, error: "That image is no longer in the media library." };
}

/**
 * Statements that replace a page's media associations. Returned rather than
 * executed so the caller can put them in the SAME batch as the page update:
 * D1 batches are atomic, so the claims and the publish decision either both
 * land or neither does. Executing them separately leaves a window where media
 * is deleted after the claim check but before the page is published.
 */
/**
 * Dimensions for the media a page embeds, keyed by image_key.
 *
 * Joined through page_media rather than parsing the body again: the claim rows
 * already record exactly which media a page uses, and one indexed read is
 * cheaper than re-walking the Markdown. Bounded by the page's own claims.
 */
export async function pageImageDimensions(
  db: D1Database,
  pageId: number,
): Promise<Map<string, { width: number; height: number }>> {
  const { results } = await db
    .prepare(
      `SELECT m.image_key, m.width, m.height
         FROM page_media pm JOIN media m ON m.id = pm.media_id
        WHERE pm.page_id = ? AND m.width IS NOT NULL AND m.height IS NOT NULL`,
    )
    .bind(pageId)
    .all<{ image_key: string; width: number; height: number }>();
  return new Map((results ?? []).map((r) => [r.image_key, { width: r.width, height: r.height }]));
}

/**
 * Builds statements to replace a page's media associations.
 *
 * @param pageId - The page whose media associations are replaced
 * @param mediaIds - The media IDs to associate with the page
 * @returns Prepared statements that remove existing associations and insert existing media associations in parameter-limited batches
 */
export function pageMediaClaimStatements(
  db: D1Database,
  pageId: number,
  mediaIds: number[],
): D1PreparedStatement[] {
  const statements = [db.prepare("DELETE FROM page_media WHERE page_id = ?").bind(pageId)];

  // One statement per CHUNK, not per image. D1 allows only 50 queries per
  // Worker invocation on the Free plan, and a save already spends several on
  // auth, settings, the page load, the slug check, the media lookup, and the
  // readback — so a statement per image would break saving an image-heavy page
  // on exactly the plan this project targets.
  for (let i = 0; i < mediaIds.length; i += MAX_BOUND_PARAMS - 1) {
    const chunk = mediaIds.slice(i, i + MAX_BOUND_PARAMS - 1); // -1 for pageId
    const placeholders = chunk.map(() => "?").join(", ");
    statements.push(
      // INSERT ... SELECT FROM media so a concurrently deleted row is skipped
      // rather than written as a dangling association.
      db
        .prepare(
          `INSERT OR IGNORE INTO page_media (page_id, media_id)
           SELECT ?1, m.id FROM media m WHERE m.id IN (${placeholders})`,
        )
        .bind(pageId, ...chunk),
    );
  }

  return statements;
}

/** Replace a page's media associations with exactly `mediaIds`. */
export async function syncPageMedia(
  db: D1Database,
  pageId: number,
  mediaIds: number[],
): Promise<void> {
  await db.batch(pageMediaClaimStatements(db, pageId, mediaIds));
}

/**
 * Point a product's gallery row at a different media item, guarded on that
 * media still existing. Returns false when the media vanished (or the gallery
 * row is gone), so the caller can refuse rather than write a dangling key.
 */
export async function replaceProductImageFromMedia(
  db: D1Database,
  productId: number,
  oldKey: string,
  mediaId: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE product_images
          SET image_key = (SELECT image_key FROM media WHERE id = ?3)
        WHERE product_id = ?1
          AND image_key = ?2
          AND EXISTS (SELECT 1 FROM media WHERE id = ?3)`,
    )
    .bind(productId, oldKey, mediaId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/**
 * Store the header logo, sourced from `media` in the same statement that writes
 * it. A check-then-write leaves a window where the file is deleted between the
 * two, persisting a key that renders a broken logo site-wide. Returns false if
 * the media row is gone.
 */
export async function setLogoFromMedia(db: D1Database, imageKey: string): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO settings (key, value)
       SELECT 'logo_image_key', m.image_key FROM media m WHERE m.image_key = ?1
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    )
    .bind(imageKey)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}
