/**
 * Resolves the canonical origin for absolute URLs in shared responses.
 *
 * @param requestOrigin - The origin derived from the current request when no configured origin is provided
 * @param configuredOrigin - The configured canonical origin, if available
 * @returns The normalized canonical origin
 * @throws If the configured origin is empty, invalid, or does not meet the required HTTPS origin format
 */
export function publicOrigin(requestOrigin: string, configuredOrigin: string | undefined): string {
  if (configuredOrigin === undefined) return new URL(requestOrigin).origin;

  const value = configuredOrigin.trim();
  if (!value) throw new Error("CANONICAL_ORIGIN must not be empty");

  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("CANONICAL_ORIGIN must be an HTTPS origin without a path");
  }
  return url.origin;
}
