import { mediaUrl } from "../media/url";
import { validateUpload } from "../media/upload";

export type ImageDelivery = "original" | "cloudflare";
export type ProductImageUsage = "card" | "detail" | "thumbnail";

export const PRODUCT_IMAGE_WIDTHS = [128, 384, 768, 1024] as const;

const USAGE_DEFAULTS: Record<
  ProductImageUsage,
  { fallbackWidth: (typeof PRODUCT_IMAGE_WIDTHS)[number]; sizes: string }
> = {
  card: {
    fallbackWidth: 384,
    sizes: "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 384px",
  },
  detail: {
    fallbackWidth: 768,
    sizes: "(max-width: 768px) 100vw, 50vw",
  },
  thumbnail: {
    fallbackWidth: 128,
    sizes: "128px",
  },
};

export interface ProductImageSources {
  src: string;
  srcset?: string;
  sizes?: string;
}

/**
 * Determines whether on-demand image delivery can use the specified base URL.
 *
 * @param baseUrl - The URL to validate as the image delivery origin
 * @returns `true` if `baseUrl` is an HTTPS URL with a hostname, `false` otherwise.
 */
export function onDemandImageDeliveryAvailable(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.protocol === "https:" && !!url.hostname;
  } catch {
    return false;
  }
}

/**
 * Builds the public URL for a product image, or the shared placeholder when no image key is provided.
 *
 * @param imageKey - The stored media object key, or `null` when the product has no image
 * @param baseUrl - Optional base URL used to produce an absolute media URL
 * @returns The product image URL or `/placeholder.png`
 */
export function productImageUrl(imageKey: string | null, baseUrl = ""): string {
  if (!imageKey) return "/placeholder.png";
  return mediaUrl(imageKey, baseUrl);
}

/**
 * Object-key prefixes eligible for on-demand transformation.
 *
 * `media/` is where every upload has gone since the media library shipped, and
 * where the key rename moved the existing `products/` objects. Gating on
 * `products/` alone silently dropped the whole srcset ladder — the browser fell
 * back to the full-size original for every image, on every store with on-demand
 * delivery enabled. Measured on the demo: 77,830 bytes served where a 384px AVIF
 * is 10,124.
 *
 * `products/` stays for stores that have not been renamed.
 */
const TRANSFORMABLE_KEY = /^(?:products|media)\/[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/** Shared by the storefront srcset and the upload pre-warm — one string, so the
 *  pre-warmed cache entries are byte-identical to the URLs pages emit. */
const TRANSFORM_OPTIONS = "fit=scale-down,format=auto,quality=82,onerror=redirect";

/**
 * Builds an absolute source URL for a valid store image key on the configured origin.
 *
 * @param imageKey - The store image key to resolve
 * @param baseUrl - The configured image origin
 * @returns The absolute source URL, or `null` when the key or origin is invalid
 */
function versionedTransformSource(imageKey: string, baseUrl: string): string | null {
  // On-demand transforms require a public absolute source. Keep transformation
  // requests scoped to the store's own image prefixes on the configured origin;
  // malformed or out-of-prefix keys simply retain original delivery.
  if (!TRANSFORMABLE_KEY.test(imageKey)) return null;
  if (imageKey.split("/").some((segment) => segment === "." || segment === "..")) return null;
  try {
    const base = new URL(`${baseUrl.replace(/\/+$/, "")}/`);
    if (base.protocol !== "https:" && base.protocol !== "http:") return null;
    const source = new URL(imageKey, base);
    if (source.origin !== base.origin || !source.pathname.startsWith(base.pathname)) return null;
    // No cache-busting parameter: every key is unique per upload, so a given
    // source URL can never serve different bytes. A store that still holds
    // legacy slug-named objects — which a re-upload could overwrite in place —
    // should replace them rather than version the URL, since the object itself
    // is what changed.
    return source.href;
  } catch {
    return null;
  }
}

/**
 * Builds the Cloudflare image transformation URL prefix for an optional origin.
 *
 * @param transformOrigin - The HTTP or HTTPS origin for image transformations.
 * @returns The transformation prefix, or `null` if the origin is invalid.
 */
function transformPrefix(transformOrigin = ""): string | null {
  if (!transformOrigin) return "/cdn-cgi/image/";
  try {
    const origin = new URL(transformOrigin);
    if (origin.protocol !== "https:" && origin.protocol !== "http:") return null;
    return `${origin.origin}/cdn-cgi/image/`;
  } catch {
    return null;
  }
}

/**
 * Builds a transformed image URL from a source path and transformation options.
 *
 * @param source - The image source path
 * @param options - The transformation options segment
 * @param transformOrigin - The origin used for image transformations
 * @returns The transformed image URL, or `null` when the transformation origin is invalid
 */
function transformedUrl(source: string, options: string, transformOrigin = ""): string | null {
  const prefix = transformPrefix(transformOrigin);
  return prefix ? `${prefix}${options}/${source}` : null;
}

/**
 * Builds responsive product-image attributes using the configured delivery mode.
 *
 * @param imageKey - The stored image key, or `null` when no image is available
 * @param options - Delivery, responsive sizing, and transformation settings
 * @returns Image attributes for the original image or responsive transformed sources
 */
export function productImageSources(
  imageKey: string | null,
  options: {
    baseUrl?: string;
    delivery?: ImageDelivery;
    usage?: ProductImageUsage;
    sizes?: string;
    transformOrigin?: string;
  } = {},
): ProductImageSources {
  const baseUrl = options.baseUrl ?? "";
  const original = productImageUrl(imageKey, baseUrl);
  if (!imageKey || options.delivery !== "cloudflare" || !baseUrl) {
    return { src: original };
  }

  const source = versionedTransformSource(imageKey, baseUrl);
  if (!source) return { src: original };

  const usage = options.usage ?? "card";
  const defaults = USAGE_DEFAULTS[usage];
  const common = TRANSFORM_OPTIONS;
  const candidates = PRODUCT_IMAGE_WIDTHS.flatMap((width) => {
    const url = transformedUrl(source, `width=${width},${common}`, options.transformOrigin);
    return url ? [`${url} ${width}w`] : [];
  });
  const fallback = transformedUrl(
    source,
    `width=${defaults.fallbackWidth},${common}`,
    options.transformOrigin,
  );
  if (!fallback || candidates.length === 0) return { src: original };

  return {
    src: fallback,
    srcset: candidates.join(", "),
    sizes: options.sizes ?? defaults.sizes,
  };
}

/**
 * Warms responsive image transformations for an uploaded image.
 *
 * Requests each configured width for AVIF and WebP content negotiation variants.
 * Failed requests are logged and do not cause the function to reject.
 *
 * @param imageKey - The stored image key to transform
 * @param baseUrl - The base URL used to resolve the source image
 * @param transformOrigin - The origin that serves image transformations
 */
export async function prewarmImageTransforms(
  imageKey: string,
  baseUrl: string,
  transformOrigin: string,
): Promise<void> {
  const source = versionedTransformSource(imageKey, baseUrl);
  if (!source) return;
  const results = await Promise.allSettled(
    PRODUCT_IMAGE_WIDTHS.flatMap((width) => {
      const url = transformedUrl(source, `width=${width},${TRANSFORM_OPTIONS}`, transformOrigin);
      if (!url) return [];
      return ["image/avif,image/webp,image/apng,*/*", "image/webp,*/*"].map((accept) =>
        fetch(url, {
          headers: { accept },
          // A wedged resize must not pin the background task to its 30s bound.
          signal: AbortSignal.timeout(15_000),
        }).then((res) => {
          // Drain so the edge caches the full body, not an abandoned stream.
          return res.ok ? res.arrayBuffer().then(() => undefined) : undefined;
        }),
      );
    }),
  );
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    console.error(JSON.stringify({ event: "image_prewarm_incomplete", key: imageKey, failed }));
  }
}

/**
 * Builds an absolute product image URL suitable for email clients.
 *
 * @param imageKey - The product image key, or `null` when no image is available
 * @param siteOrigin - The site origin used to create the absolute URL
 * @param baseUrl - The base URL for stored product media
 * @param delivery - The configured image delivery mode
 * @returns A 96×96 JPEG thumbnail URL when Cloudflare delivery is available, or the original image URL otherwise
 */
export function productEmailImageUrl(
  imageKey: string | null,
  siteOrigin: string,
  baseUrl = "",
  delivery: ImageDelivery = "original",
): string {
  const original = new URL(productImageUrl(imageKey, baseUrl), siteOrigin).href;
  if (!imageKey || delivery !== "cloudflare" || !baseUrl) return original;
  const source = versionedTransformSource(imageKey, baseUrl);
  if (!source) return original;
  return (
    transformedUrl(
      source,
      "width=96,height=96,fit=cover,format=jpeg,quality=80,onerror=redirect",
      siteOrigin,
    ) ?? original
  );
}

/**
 * Upload validation now lives in the shared media feature — the rules are about
 * stored files, not about products. Re-exported so existing product call sites
 * and tests keep one import.
 */
export const validateImage = validateUpload;
