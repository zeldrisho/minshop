import type { D1Database } from "@cloudflare/workers-types";
import { generateAccessToken, isAccessToken } from "../ids/token.ts";
import { generatePublicId, isPublicIdConflict } from "../ids/publicId.ts";
import { guestLinkReissueKind } from "../email/outboxStore.ts";

/**
 * Guest-access registry (order_guest_access) — the ONE authoritative mapping
 * from a revocable access token to an order public ID. Created at checkout
 * before provider handoff; carried through settlement; the credential behind
 * /order/<token> and /pay/<token>.
 *
 * The raw token is stored by design (not hashed): asynchronous rails settle in
 * a webhook that has only the order public ID, and later receipt/shipping/
 * refund customer emails must regenerate the guest URL. Only customer-email
 * builders may read it — never admin, MCP, or API payloads.
 */
export interface GuestAccess {
  order_public_id: string;
  access_token: string;
  generation: number;
  created_at: string;
  rotated_at: string | null;
  hidden_at: string | null;
}

/**
 * Creates and registers a public order ID with a guest access token.
 *
 * @returns The generated public ID and guest access token.
 * @throws If registration fails for a reason other than a uniqueness conflict, or if uniqueness conflicts persist after three attempts.
 */
export async function claimOrderIdentity(
  db: D1Database,
): Promise<{ publicId: string; accessToken: string }> {
  for (let i = 0; i < 3; i++) {
    const publicId = generatePublicId("order");
    const accessToken = generateAccessToken();
    try {
      await db
        .prepare("INSERT INTO order_guest_access (order_public_id, access_token) VALUES (?, ?)")
        .bind(publicId, accessToken)
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
): Promise<GuestAccess | null> {
  if (!isAccessToken(token)) return null;
  return db
    .prepare("SELECT * FROM order_guest_access WHERE access_token = ?")
    .bind(token)
    .first<GuestAccess>();
}

/**
 * Retrieves guest access details for an order.
 *
 * @param orderPublicId - The order's public identifier
 * @returns The guest access record, or `null` if none exists
 */
export async function getGuestAccess(
  db: D1Database,
  orderPublicId: string,
): Promise<GuestAccess | null> {
  return db
    .prepare("SELECT * FROM order_guest_access WHERE order_public_id = ?")
    .bind(orderPublicId)
    .first<GuestAccess>();
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
    const token = generateAccessToken();
    try {
      // Atomic pair: the optimistic generation guard makes a concurrent
      // reissue lose cleanly, and the INSERT only lands when the UPDATE did.
      const results = await db.batch([
        db
          .prepare(
            `UPDATE order_guest_access
                SET access_token = ?1, generation = ?2, rotated_at = datetime('now')
              WHERE order_public_id = ?3 AND generation = ?4`,
          )
          .bind(token, next, orderPublicId, current.generation),
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
 * Builds a customer-facing guest order URL.
 *
 * @param orderPublicId - The order's public identifier, or `null` when no order exists.
 * @param baseUrl - The base URL for the application.
 * @returns A guest order URL, or `null` when the identifier is missing or has no guest access record.
 */
export async function guestOrderUrl(
  db: D1Database,
  orderPublicId: string | null,
  baseUrl: string,
): Promise<string | null> {
  if (!orderPublicId) return null;
  if (!orderPublicId.startsWith("ord_")) return `${baseUrl}/order/${orderPublicId}`;
  const access = await getGuestAccess(db, orderPublicId);
  return access ? `${baseUrl}/order/${access.access_token}` : null;
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
