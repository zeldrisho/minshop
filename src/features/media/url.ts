/**
 * Constructs the public URL for a stored media object.
 *
 * @param imageKey - The stored media object's key
 * @param baseUrl - Optional base URL for generating an absolute URL
 * @returns An absolute URL when `baseUrl` is provided; otherwise, a root-relative `/images/{imageKey}` path
 */
export function mediaUrl(imageKey: string, baseUrl = ""): string {
  return baseUrl ? `${baseUrl}/${imageKey}` : `/images/${imageKey}`;
}
