import type { D1Database } from "@cloudflare/workers-types";
import type { StorageProvider } from "../storage";
// Explicit .ts: test/integration/media.mjs loads this module through Node's type
// stripping, which does not resolve extensionless relative imports.
import { createMediaRecord, type Media } from "./db.ts";
import { readImageDimensions } from "./dimensions.ts";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * SVG is deliberately absent: uploaded objects are served from the store's own
 * origin, and an SVG is a script-execution vector there.
 */
const ALLOWED = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

/** Returns a user-facing error string if the upload is invalid, else null. */
export function validateUpload(file: File): string | null {
  if (!ALLOWED.has(file.type)) {
    return "Image must be JPEG, PNG, WebP, or GIF.";
  }
  if (file.size > MAX_BYTES) {
    return "Image must be 5 MB or smaller.";
  }
  return null;
}

/**
 * Generates a unique immutable storage key for an uploaded media file.
 *
 * @param file - The file whose MIME type determines the key's extension
 * @returns A storage key containing a random identifier and the file extension, or `bin` for unsupported MIME types
 */
export function mediaKeyFor(file: File): string {
  const ext = ALLOWED.get(file.type) ?? "bin";
  const id = crypto.getRandomValues(new Uint8Array(10));
  return `media/${[...id].map((b) => b.toString(16).padStart(2, "0")).join("")}.${ext}`;
}

/**
 * Stores an optimized media file and records its metadata in the library.
 *
 * @param originalName - The filename to preserve in the media record
 * @returns The created media record
 * @throws The underlying storage or database error
 */
export async function uploadMedia(
  db: D1Database,
  storage: StorageProvider,
  file: File,
  originalName: string,
): Promise<Media> {
  const key = mediaKeyFor(file);
  // One read of the bytes, used for both the upload and the header parse. `file`
  // is already the OPTIMIZED file — every caller passes optimizeUpload(file) —
  // so these dimensions describe the object actually stored, not the original.
  const buffer = await file.arrayBuffer();
  await storage.put(key, buffer, file.type);
  const dimensions = readImageDimensions(new Uint8Array(buffer));
  try {
    return await createMediaRecord(db, {
      image_key: key,
      original_name: originalName,
      mime_type: file.type,
      size_bytes: file.size,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
    });
  } catch (err) {
    try {
      await storage.delete(key);
    } catch (cleanupErr) {
      // The row never existed, so nothing references this object; log the key
      // so it can be swept manually rather than failing the request twice.
      console.error(
        JSON.stringify({
          event: "media_orphan_after_failed_insert",
          key,
          message: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
        }),
      );
    }
    throw err;
  }
}
