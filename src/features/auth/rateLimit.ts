import type { RateLimit } from "@cloudflare/workers-types";

export type RateLimitBucket = "auth" | "checkout" | "search";

/**
 * Classifies a request by the rate-limit bucket applicable to its route and method.
 *
 * @param method - The HTTP method.
 * @param pathname - The request route pathname.
 * @param hasSearchQuery - Whether the request includes a search query.
 * @returns The applicable rate-limit bucket, or `null` when no bucket applies.
 */
export function rateLimitBucket(
  method: string,
  pathname: string,
  hasSearchQuery = false,
): RateLimitBucket | null {
  if (
    method === "GET" &&
    hasSearchQuery &&
    (pathname === "/search" || pathname === "/api/products")
  ) {
    return "search";
  }
  if (method !== "POST") return null;
  if (pathname === "/admin/login" || pathname === "/account/login") return "auth";
  if (pathname === "/api/checkout" || pathname === "/checkout" || pathname.startsWith("/pay/")) {
    return "checkout";
  }
  return null;
}

/**
 * Creates a rate-limit key scoped to the request host, route, and client address.
 *
 * @param request - The request whose host and client address are used
 * @param pathname - The route pathname to include in the key
 * @returns A key combining the host, pathname, and client address, using `unknown-client` when the address is unavailable
 */
export function anonymousRateLimitKey(request: Request, pathname: string): string {
  const client = request.headers.get("cf-connecting-ip")?.trim() || "unknown-client";
  return `${new URL(request.url).hostname}:${pathname}:${client}`;
}

/**
 * Determines whether a request is permitted by the configured rate limiter.
 *
 * @param limiter - The rate limiter binding, if available.
 * @param request - The incoming request.
 * @param pathname - The route pathname used to generate the rate-limit key.
 * @returns `true` if no limiter is configured or the request is permitted, `false` otherwise.
 */
export async function checkRateLimit(
  limiter: RateLimit | undefined,
  request: Request,
  pathname: string,
): Promise<boolean> {
  // Old/custom Wrangler configs may not have adopted the binding yet. Keep the
  // storefront available while the checked-in configs make throttling the normal
  // production path.
  if (!limiter) return true;
  const result = await limiter.limit({ key: anonymousRateLimitKey(request, pathname) });
  return result.success;
}

/**
 * Creates a rate-limit response for an API or page route.
 *
 * @param pathname - The request pathname used to determine the response format and CORS headers
 * @returns A non-cacheable `429` response with a 60-second retry interval
 */
export function rateLimitedResponse(pathname: string): Response {
  const api = pathname.startsWith("/api/");
  return new Response(
    api
      ? JSON.stringify({ error: "Too many requests. Try again shortly." })
      : "Too many requests. Try again shortly.",
    {
      status: 429,
      headers: {
        "cache-control": "no-store",
        "content-type": api ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
        "retry-after": "60",
        ...(pathname === "/api/checkout" || pathname === "/api/products"
          ? { "access-control-allow-origin": "*" }
          : {}),
      },
    },
  );
}
