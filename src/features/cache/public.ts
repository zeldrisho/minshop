export const PUBLIC_CACHE_CONTROL = "public, max-age=0, s-maxage=600";
export const PRIVATE_CACHE_CONTROL = "private, no-store";

/**
 * Determines whether a pathname targets the public product catalog API.
 *
 * @param pathname - The request pathname to classify
 * @returns `true` if the pathname is the product catalog endpoint or a nested product API path, `false` otherwise.
 */
export function isPublicCatalogApi(pathname: string): boolean {
  return pathname === "/api/products" || pathname.startsWith("/api/products/");
}

/** Storefront routes whose HTML is identical for every shopper. */
export function isPublicStorefrontPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/products" ||
    pathname.startsWith("/product/") ||
    pathname === "/search" ||
    pathname.startsWith("/products/") ||
    pathname.startsWith("/category/") ||
    pathname.startsWith("/categories/") ||
    pathname.startsWith("/pages/") ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/llms.txt"
  );
}

/**
 * Identifies paths that may expose private shopper, payment, order, cart, checkout, admin, or internal data.
 *
 * @param pathname - The request pathname to classify
 * @returns `true` if the pathname is private, `false` otherwise.
 */
export function isPrivatePath(pathname: string): boolean {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/api/admin" ||
    pathname.startsWith("/api/admin/") ||
    pathname === "/api/internal" ||
    pathname.startsWith("/api/internal/") ||
    pathname === "/account" ||
    pathname.startsWith("/account/") ||
    pathname === "/order" ||
    pathname.startsWith("/order/") ||
    pathname === "/pay" ||
    pathname.startsWith("/pay/") ||
    pathname === "/payment-setup" ||
    pathname.startsWith("/payment-setup/") ||
    pathname === "/partials" ||
    pathname.startsWith("/partials/") ||
    pathname === "/express" ||
    pathname === "/cart" ||
    pathname === "/checkout" ||
    pathname === "/api/cart" ||
    pathname === "/api/checkout"
  );
}

/**
 * Explicit allowlist for the shared page policy. Known public successes and
 * permanent legacy redirects get the storefront directive; private paths are
 * always no-store; other routes retain an explicit policy of their own and
 * otherwise fall back to no-store. Cloudflare's heuristic caching never decides.
 */
export function responseCacheControl(
  pathname: string,
  status: number,
  existing: string | null,
  productError = false,
): string {
  if (isPrivatePath(pathname) || productError) return PRIVATE_CACHE_CONTROL;

  const publicResponse =
    (status === 200 || status === 301) &&
    (isPublicCatalogApi(pathname) || isPublicStorefrontPath(pathname));
  if (publicResponse) return existing ?? PUBLIC_CACHE_CONTROL;

  // Non-page routes such as immutable /images objects may own a more specific
  // policy. Preserve explicit choices; only close the heuristic-cache gap when
  // the route emitted no directive.
  return existing ?? PRIVATE_CACHE_CONTROL;
}
