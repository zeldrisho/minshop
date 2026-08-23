import type { D1Database } from "@cloudflare/workers-types";
import { generateAccessToken, hashAccessToken, isAccessToken } from "../ids/token.ts";
import { generatePublicId, isPublicIdConflict } from "../ids/publicId.ts";
import { encryptSecret, decryptSecret } from "../secrets/crypto.ts";
import { guestLinkReissueKind } from "../email/outboxStore.ts";

/**
 * Guest-access registry (order_guest_access) — the ONE authoritative mapping
 * from a revocable access token to an order public ID. Created at checkout
 * before provider handoff; carried through settlement; the credential behind
 * /order/<token> and /pay/<token>.
 *
 * The raw token is NEVER stored (migration 0041). Lookup goes through the
 * one-way `access_token_hash` verifier: incoming tokens are hashed before
 * comparison, so a D1 export alone cannot replay them. Because asynchronous
 * rails settle in a webhook that has only the order public ID, and later
 * receipt/shipping/refund customer emails must regenerate the guest URL, the
 * token is additionally stored sealed — AES-256-GCM under a Worker secret
 * (`resolveGuestKek`: SECRETS_KEK, falling back to AUTH_SECRET so demo-mode
 * stores without a KEK still get working links). Only customer-email builders
 * may unseal it — never admin, MCP, or API payloads. Rows written before 0041
 * keep their raw token with a NULL hash; they still resolve via the legacy
 * path and are re-sealed lazily on first touch.
 */
export interface GuestAccess {
  order_public_id: string;
  access_token: string;
  access_token_hash: string | null;
  generation: number;
  created_at: string;
  rotated_at: string | null;
  hidden_at: string | null;
}

/**
 * Resolves the Worker secret used to seal/unseal stored guest tokens.
 *
 * @param env - Worker bindings/secrets
 * @returns SECRETS_KEK, falling back to AUTH_SECRET, or null when neither is set (unsealed fallback mode)
 */
export function resolveGuestKek(env: {
  SECRETS_KEK?: string | undefined;
  AUTH_SECRET?: string | undefined;
}): string | null {
  return env.SECRETS_KEK || env.AUTH_SECRET || null;
}

/** Optional Worker secret used to seal/unseal stored guest tokens. */
export type GuestTokenKek = string | null | undefined;

const isSealed = (stored: string): boolean => stored.startsWith("gcm$");

/** Hash + (when a KEK exists) seal a raw token for storage. */
async function storeForm(
  rawToken: string,
  kek: string | null | undefined,
): Promise<{ token: string; hash: string }> {
  return {
    token: kek ? await encryptSecret(kek, rawToken) : rawToken,
    hash: await hashAccessToken(rawToken),
  };
}

/** Unseal a stored token for the allowlisted customer-email URL builders. */
async function openStoredToken(
  access: GuestAccess,
  kek: string | null | undefined,
): Promise<string | null> {
  if (!isSealed(access.access_token)) return access.access_token; // legacy plaintext row
  return kek ? decryptSecret(kek, access.access_token) : null; // no KEK → link omitted
}

/** Lazily upgrade a pre-0041 row to hash + sealed storage. Races are benign. */
async function resealLegacyRow(
  db: D1Database,
  access: GuestAccess,
  kek: string | null,
): Promise<void> {
  if (access.access_token_hash !== null && isSealed(access.access_token)) return;
  const { token, hash } = await storeForm(access.access_token, kek);
  await db
    .prepare(
      "UPDATE order_guest_access SET access_token = ?1, access_token_hash = ?2 WHERE order_public_id = ?3",
    )
    .bind(token, hash, access.order_public_id)
    .run();
}

/**
 * Creates and registers a public order ID with a guest access token. Only the
 * token's hash (and, when `kek` is set, its sealed form) is persisted.
 *
 * @param db - The D1 database
 * @param kek - Worker secret used to seal the stored token (see `resolveGuestKek`)
 * @returns The generated public ID and guest access token.
 * @throws If registration fails for a reason other than a uniqueness conflict, or if uniqueness conflicts persist after three attempts.
 */
export async function claimOrderIdentity(
  db: D1Database,
  kek?: string | null,
): Promise<{ publicId: string; accessToken: string }> {
  for (let i = 0; i < 3; i++) {
    const publicId = generatePublicId("order");
    const accessToken = generateAccessToken();
    try {
      const { token, hash } = await storeForm(accessToken, kek);
      await db
        .prepare(
          "INSERT INTO order_guest_access (order_public_id, access_token, access_token_hash) VALUES (?, ?, ?)",
        )
        .bind(publicId, token, hash)
        .run();
      return { publicId, accessToken };
    } catch (err) {
      if (!isPublicIdConflict(err)) throw err; // either side collided → fresh pair
    }
  }
  throw new Error("order identity collision retry exhausted");
}

/** Resolve a presented token to its mapping. Strict shape check first. */
export async function resolveAccessToken(
  db: D1Database,
  token: unknown,
  kek?: string | null,
): Promise<GuestAccess | null> {
  if (!isAccessToken(token)) return null;
  // Verifier lookup: the only path for post-0041 rows.
  const byHash = await db
    .prepare("SELECT * FROM order_guest_access WHERE access_token_hash = ?")
    .bind(await hashAccessToken(token))
    .first<GuestAccess>();
  if (byHash) return byHash;
  // Legacy path for pre-0041 rows: raw match while no verifier exists yet,
  // then upgrade the row in place so plaintext storage converges to zero.
  const legacy = await db
    .prepare(
      "SELECT * FROM order_guest_access WHERE access_token = ? AND access_token_hash IS NULL",
    )
    .bind(token)
    .first<GuestAccess>();
  if (!legacy) return null;
  await resealLegacyRow(db, legacy, kek ?? null);
  return legacy;
}

/**
 * Retrieves guest access details for an order, upgrading pre-0041 plaintext
 * rows in passing.
 *
 * @param orderPublicId - The order's public identifier
 * @param kek - Worker secret used to seal a legacy row (see `resolveGuestKek`)
 * @returns The guest access record, or `null` if none exists
 */
export async function getGuestAccess(
  db: D1Database,
  orderPublicId: string,
  kek?: string | null,
): Promise<GuestAccess | null> {
  const access = await db
    .prepare("SELECT * FROM order_guest_access WHERE order_public_id = ?")
    .bind(orderPublicId)
    .first<GuestAccess>();
  if (access && kek) await resealLegacyRow(db, access, kek);
  return access;
}

/**
 * Reissues guest access for a known order and queues a notification for the new access generation.
 *
 * @param orderPublicId - The public identifier of the order whose guest access should be reissued
 * @returns The new access generation, or `null` if the order is unknown or unsettled
 * @throws Error if token-collision retries are exhausted
 */
export async function reissueGuestAccess(
  db: D1Database,
  orderPublicId: string,
  kek?: string | null,
): Promise<{ generation: number } | null> {
  for (let i = 0; i < 3; i++) {
    const current = await db
      .prepare(
        `SELECT g.generation, o.id AS order_id
           FROM order_guest_access g
           JOIN orders o ON o.public_id = g.order_public_id
          WHERE g.order_public_id = ?`,
      )
      .bind(orderPublicId)
      .first<{ generation: number; order_id: number }>();
    if (!current) return null;
    const next = current.generation + 1;
    const rawToken = generateAccessToken();
    try {
      const { token: stored, hash } = await storeForm(rawToken, kek);
      // Atomic pair: the optimistic generation guard makes a concurrent
      // reissue lose cleanly, and the INSERT only lands when the UPDATE did.
      const results = await db.batch([
        db
          .prepare(
            `UPDATE order_guest_access
                SET access_token = ?1, access_token_hash = ?2, generation = ?3, rotated_at = datetime('now')
              WHERE order_public_id = ?4 AND generation = ?5`,
          )
          .bind(stored, hash, next, orderPublicId, current.generation),
        db
          .prepare(
            `INSERT OR IGNORE INTO order_notifications (order_id, kind)
             SELECT ?1, ?2
              WHERE EXISTS (SELECT 1 FROM order_guest_access
                             WHERE order_public_id = ?3 AND generation = ?4)`,
          )
          .bind(current.order_id, guestLinkReissueKind(next), orderPublicId, next),
      ]);
      if ((results[0]?.meta.changes ?? 0) === 0) continue; // lost a race — re-read
      return { generation: next };
    } catch (err) {
      if (!isPublicIdConflict(err)) throw err;
    }
  }
  throw new Error("guest access token collision retry exhausted");
}

/**
 * Builds a customer-facing guest order URL, unsealing the stored token (the
 * allowlisted consumer path). Returns null when there is nothing to link or
 * the token cannot be recovered.
 *
 * @param orderPublicId - The order's public identifier, or `null` when no order exists.
 * @param baseUrl - The base URL for the application.
 * @param kek - Worker secret used to unseal the stored token (see `resolveGuestKek`)
 * @returns A guest order URL, or `null` when the identifier is missing or has no guest access record.
 */
export async function guestOrderUrl(
  db: D1Database,
  orderPublicId: string | null,
  baseUrl: string,
  kek?: string | null,
): Promise<string | null> {
  if (!orderPublicId) return null;
  if (!orderPublicId.startsWith("ord_")) return `${baseUrl}/order/${orderPublicId}`;
  const access = await getGuestAccess(db, orderPublicId, kek);
  if (!access) return null;
  const token = await openStoredToken(access, kek);
  return token ? `${baseUrl}/order/${token}` : null;
}

/**
 * Bounded reconciliation sweep for orphaned guest credentials. The inline
 * deletions (provider-expiry webhook, failed provider setup) cover the common
 * paths; this catches what they can't: demo checkouts (no webhook exists) and
 * lightning invoices whose expiry never produced a callback. Two clauses, both
 * guarded on no settled order existing, both well past any webhook retry
 * window:
 *   - a self-rendered pending payment expired > 3 days ago (its invoice/window
 *     is terminally unpayable — that IS the provider truth for these rails);
 *   - a registry row > 7 days old with no order, no live reservation, and no
 *     live pending payment (provider setup died mid-checkout).
 * LIMIT keeps it piggyback-sized; it rides along on settlements like the
 * notification sweep.
 */
export async function sweepAbandonedGuestAccess(db: D1Database, limit = 5): Promise<number> {
  const hidden = await db
    .prepare(
      `UPDATE order_guest_access
          SET hidden_at = COALESCE(hidden_at, datetime('now'))
        WHERE order_public_id IN (
          SELECT g.order_public_id FROM order_guest_access g
          JOIN checkout_reservations r ON r.public_id = g.order_public_id
         WHERE r.status IN ('expired', 'failed')
           AND r.terminal_at < datetime('now', '-3 days')
           AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.public_id = g.order_public_id)
         LIMIT ?1)`,
    )
    .bind(limit)
    .run();
  const deleted = await db
    .prepare(
      `DELETE FROM order_guest_access
        WHERE order_public_id IN (
          SELECT g.order_public_id FROM order_guest_access g
           WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.public_id = g.order_public_id)
             AND g.created_at < datetime('now', '-7 days')
             AND NOT EXISTS (SELECT 1 FROM checkout_reservations r
                              WHERE r.public_id = g.order_public_id)
             AND NOT EXISTS (SELECT 1 FROM pending_payments p
                              WHERE p.public_id = g.order_public_id)
           LIMIT ?1)`,
    )
    .bind(limit)
    .run();
  return (hidden.meta.changes ?? 0) + (deleted.meta.changes ?? 0);
}

/**
 * Garbage-collect the mapping for a checkout that reached provider-confirmed
 * terminal state without settling. The no-settled-order check is atomic with
 * the delete, so a paid webhook that raced local expiry keeps its row.
 */
export async function deleteGuestAccessIfUnsettled(
  db: D1Database,
  orderPublicId: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `DELETE FROM order_guest_access
        WHERE order_public_id = ?1
          AND NOT EXISTS (SELECT 1 FROM orders WHERE public_id = ?1)`,
    )
    .bind(orderPublicId)
    .run();
  return result.meta.changes > 0;
}
