import type { D1Database } from "@cloudflare/workers-types";
import { getSetting, setSetting } from "../settings/db";
import { hashPassword, verifyPassword } from "./password";

/**
 * The admin login credential: a PBKDF2 hash in D1 (`admin_password_hash`), set
 * through the first-run setup wizard. There is no env password — until one is set
 * the store is in BOOTSTRAP mode (the gate lets you reach /admin/setup to create
 * it; see src/middleware.ts). Cloudflare Access remains the alternative/edge
 * protection. Kept out of the general settings overlay (never in `locals.settings`)
 * — read only here, on protected requests.
 */
const HASH_KEY = "admin_password_hash";

/**
 * Stores the administrator password as a PBKDF2 hash or clears it to enable bootstrap mode.
 *
 * @param db - The D1 database used to store the password hash
 * @param password - The administrator password; an empty string clears the stored password
 */
export async function setAdminPassword(db: D1Database, password: string): Promise<void> {
  await setSetting(db, HASH_KEY, password ? await hashPassword(password) : null);
}

/** The stored password hash (the session-tag source), or null when none is set. */
export function adminPasswordHash(db: D1Database): Promise<string | null> {
  return getSetting(db, HASH_KEY);
}

export interface AdminCredential {
  /** Whether password login is active (a hash is set in D1). */
  enabled: boolean;
  /** Value the session tag binds to — changing it invalidates sessions. '' if none. */
  tagSource: string;
  /** Verify a typed password (slow PBKDF2 compare). */
  verify(typed: string): Promise<boolean>;
}

/**
 * Loads the administrator credential configuration.
 *
 * @param db - The database containing the administrator password hash
 * @returns The enabled credential configuration when a password is set, or a disabled configuration otherwise
 */
export async function adminCredential(db: D1Database): Promise<AdminCredential> {
  const hash = await getSetting(db, HASH_KEY);
  if (hash) {
    return { enabled: true, tagSource: hash, verify: (t) => verifyPassword(t, hash) };
  }
  return { enabled: false, tagSource: "", verify: async () => false };
}
