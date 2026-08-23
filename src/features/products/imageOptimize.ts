import { env } from "cloudflare:workers";
import { getConfig } from "../../config";
import { getSetting } from "../settings/db";

/**
 * Optionally optimizes an uploaded image before storage.
 *
 * @param file - The uploaded image to optimize
 * @returns The optimized WebP image, or the original file when optimization is disabled or unavailable
 */
export async function optimizeUpload(file: File): Promise<File> {
  const cfg = getConfig().images;
  // Settings → Features toggle (D1 `image_optimize`) wins over the build-time default.
  const override = await getSetting(env.DB, "image_optimize");
  const optimize = override == null ? cfg.optimizeOnUpload : override === "1";
  // Feature off, or the IMAGES binding isn't declared (free-plan default) → store as-is.
  if (!optimize || !env.IMAGES) return file;

  try {
    const out = await env.IMAGES.input(file.stream())
      .transform({ width: cfg.maxWidth })
      .output({ format: "image/webp", quality: 82 });
    const buf = await out.response().arrayBuffer();
    if (buf.byteLength === 0) return file;
    return new File([buf], "optimized.webp", { type: "image/webp" });
  } catch {
    return file; // transformation unavailable (e.g. local dev) — keep the original
  }
}
