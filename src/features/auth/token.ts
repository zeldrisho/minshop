/**
 * Encodes text as unpadded Base64URL.
 *
 * @param s - The text to encode
 * @returns The UTF-8 encoded text in Base64URL format
 */
function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decodes a Base64URL-encoded string into UTF-8 text.
 *
 * @param s - The Base64URL-encoded string
 * @returns The decoded UTF-8 text, or `null` if decoding fails
 */
function b64urlDecode(s: string): string | null {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Generates an HMAC-SHA-256 signature for a message.
 *
 * @param key - The secret key used to generate the signature
 * @param message - The message to sign
 * @returns The signature encoded as lowercase hexadecimal
 */
async function hmacHex(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Compares two strings for equality using a constant-time comparison.
 *
 * @param a - The first string to compare
 * @param b - The second string to compare
 * @returns `true` if the strings are equal, `false` otherwise
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Sign `payload` into a token valid for `ttlSeconds` from `nowSeconds`. */
export async function signToken(
  payload: string,
  key: string,
  ttlSeconds: number,
  nowSeconds: number,
): Promise<string> {
  const exp = Math.floor(nowSeconds) + ttlSeconds;
  const head = `${b64urlEncode(payload)}.${exp}`;
  return `${head}.${await hmacHex(key, head)}`;
}

/**
 * Verifies a signed token and extracts its payload when valid and unexpired.
 *
 * @param token - The token to verify.
 * @param nowSeconds - The current Unix timestamp in seconds.
 * @returns The decoded payload, or `null` if the token is missing, malformed, expired, invalid, or undecodable.
 */
export async function verifyToken(
  token: string | null | undefined,
  key: string,
  nowSeconds: number,
): Promise<string | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [p, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= Math.floor(nowSeconds)) return null;
  const expected = await hmacHex(key, `${p}.${expStr}`);
  if (!constantTimeEqual(sig, expected)) return null;
  return b64urlDecode(p);
}
