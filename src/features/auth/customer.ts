import { env } from "cloudflare:workers";
import type { AstroCookies } from "astro";
import { getConfig } from "../../config";
import { getSetting } from "../settings/db";
import { getEmailProvider } from "../email";
import { loginLinkEmail } from "../email/loginLink";
import { signToken, verifyToken } from "./token";

/**
 * Passwordless customer auth (magic-link). Default adapter for the storefront
 * "accounts" feature — no passwords stored, so no hashing/reset/breach liability.
 * Reuses the signed-token primitive (token.ts) for both the login link and the
 * session cookie, and the EmailProvider seam to deliver the link. Swapping to
 * OAuth = replacing this module; the /account pages depend on these functions.
 */
const MAGIC_TTL = 15 * 60; // login link valid 15 min
const SESSION_TTL = 30 * 24 * 3600; // session cookie valid 30 days
const COOKIE = "customer_session";

const now = () => Date.now() / 1000;
const normalize = (email: string) => email.trim().toLowerCase();

/**
 * Determines whether customer accounts can be used.
 *
 * @returns `true` if accounts are enabled, a signing secret is configured, and an email provider is available; `false` otherwise.
 */
export async function accountsEnabled(): Promise<boolean> {
  const override = await getSetting(env.DB, "accounts_enabled");
  const on = override == null ? getConfig().features.accounts : override === "1";
  if (!on || !env.AUTH_SECRET) return false;
  return (await getEmailProvider()) !== null;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Sends a passwordless sign-in link for the specified email address.
 *
 * @param origin - The base URL used to construct the verification link
 */
export async function requestLogin(email: string, origin: string): Promise<void> {
  const secret = env.AUTH_SECRET;
  if (!secret) return;
  const addr = normalize(email);
  const token = await signToken(addr, secret, MAGIC_TTL, now());
  const link = `${origin}/account/verify?token=${encodeURIComponent(token)}`;

  if (import.meta.env.DEV) console.log(`[magic-link] ${addr} → ${link}`);

  const emailer = await getEmailProvider();
  if (emailer) {
    try {
      const storeName = (await getSetting(env.DB, "store_name")) || getConfig().storeName;
      await emailer.send(loginLinkEmail(addr, link, storeName));
    } catch (err) {
      console.error("Login email failed:", err);
    }
  }
}

/** Verify a magic-link token → the email it was issued for, or null. */
export async function verifyLoginToken(token: string | null): Promise<string | null> {
  const secret = env.AUTH_SECRET;
  if (!secret) return null;
  return verifyToken(token, secret, now());
}

/**
 * Creates a signed session token and stores it in the customer session cookie.
 *
 * @param email - The verified customer email associated with the session
 * @param secure - Whether the cookie should only be sent over secure connections
 */
export async function setCustomerSession(
  cookies: AstroCookies,
  email: string,
  secure: boolean,
): Promise<void> {
  const secret = env.AUTH_SECRET;
  if (!secret) return;
  const token = await signToken(email, secret, SESSION_TTL, now());
  cookies.set(COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

/**
 * Clears the customer's session cookie.
 *
 * @param cookies - The cookies used to remove the session cookie
 */
export function clearCustomerSession(cookies: AstroCookies): void {
  cookies.delete(COOKIE, { path: "/" });
}

/** The logged-in customer's email (verified session cookie), or null. */
export async function getCustomerEmail(cookies: AstroCookies): Promise<string | null> {
  const secret = env.AUTH_SECRET;
  if (!secret) return null;
  return verifyToken(cookies.get(COOKIE)?.value ?? null, secret, now());
}
