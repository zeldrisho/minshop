/**
 * Shared response helpers for the public catalog API. CORS is open (it's
 * read-only public data) so browser-based agents/tools can fetch it cross-origin.
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
} as const;

/**
 * Creates a pretty-printed JSON response with the specified HTTP status and shared CORS headers.
 *
 * @param data - The value to serialize as JSON
 * @param status - The HTTP response status
 * @returns A JSON response containing the serialized data
 */
export function catalogJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });
}

/** CORS preflight (OPTIONS). */
export function catalogPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}
