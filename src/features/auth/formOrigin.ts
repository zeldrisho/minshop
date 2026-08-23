import { isAccessToken } from "../ids/token";

const FORM_CONTENT_TYPES = [
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "text/plain",
];
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Determines whether a content type identifies a supported form submission format.
 *
 * @param contentType - The content type header value to inspect
 * @returns `true` if the value contains a supported form content type, `false` otherwise
 */
function hasFormContentType(contentType: string | null): boolean {
  const value = contentType?.toLowerCase() ?? "";
  return FORM_CONTENT_TYPES.some((type) => value.includes(type));
}

/**
 * Determines whether a pathname is a valid capability payment path.
 *
 * @param pathname - The pathname to evaluate
 * @returns `true` if the pathname contains a valid access token directly after `/pay/`, `false` otherwise
 */
function isCapabilityPayPath(pathname: string): boolean {
  if (!pathname.startsWith("/pay/")) return false;
  const token = pathname.slice("/pay/".length);
  return !token.includes("/") && isAccessToken(token);
}

/**
 * Determines whether a request violates the form origin policy.
 *
 * Safe methods and non-form requests are allowed. Mismatched origins are
 * allowed for POST requests targeting a valid `/pay/<access-token>` path.
 *
 * @returns `true` if the request is forbidden by the form origin policy, `false` otherwise.
 */
export function isForbiddenFormOrigin(request: Request, url: URL): boolean {
  if (SAFE_METHODS.has(request.method)) return false;

  const originMatches = request.headers.get("origin") === url.origin;
  if (!request.headers.has("content-type")) return !originMatches;
  if (!hasFormContentType(request.headers.get("content-type"))) return false;
  if (originMatches) return false;

  return !(request.method === "POST" && isCapabilityPayPath(url.pathname));
}
