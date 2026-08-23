import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Miniflare } from "miniflare";
import {
  claimOrderIdentity,
  resolveAccessToken,
  getGuestAccess,
  reissueGuestAccess,
  deleteGuestAccessIfUnsettled,
  sweepAbandonedGuestAccess,
  guestOrderUrl,
} from "../../src/features/orders/guestAccess.ts";
import { parsePublicId } from "../../src/features/ids/publicId.ts";
import { isAccessToken } from "../../src/features/ids/token.ts";

// Worker secret used to seal stored tokens in this test (resolveGuestKek input).
const KEK = "test-kek";
const sha256Hex = (s) => createHash("sha256").update(s).digest("hex");

const mf = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("ok") } }',
  compatibilityDate: "2026-07-20",
  d1Databases: ["DB"],
});

try {
  const db = await mf.getD1Database("DB");
  // Minimal production-shaped schema for the guest-access state machine. The
  // Wrangler integration gate applies every real migration clean-room.
  for (const sql of [
    `CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT UNIQUE, email TEXT)`,
    `CREATE TABLE order_guest_access (
       order_public_id TEXT NOT NULL PRIMARY KEY,
       access_token    TEXT NOT NULL,
       access_token_hash TEXT,
       generation      INTEGER NOT NULL DEFAULT 1,
       created_at      TEXT NOT NULL DEFAULT (datetime('now')),
       rotated_at      TEXT,
       hidden_at       TEXT
     )`,
    `CREATE UNIQUE INDEX idx_order_guest_access_token_hash
        ON order_guest_access(access_token_hash) WHERE access_token_hash IS NOT NULL`,
    `CREATE TABLE order_notifications (
       order_id INTEGER NOT NULL, kind TEXT NOT NULL,
       state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
       lease_expires_at TEXT, last_error TEXT,
       created_at TEXT NOT NULL DEFAULT (datetime('now')), sent_at TEXT,
       PRIMARY KEY (order_id, kind))`,
    `CREATE TABLE pending_payments (public_id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'pending', expires_at TEXT)`,
    `CREATE TABLE checkout_reservations (public_id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'active', terminal_at TEXT)`,
  ]) {
    await db.exec(sql.replace(/\n\s*/g, " "));
  }

  // Claim at checkout: BOTH halves minted together; token resolves; bare id never.
  const { publicId: orderPublicId, accessToken: token } = await claimOrderIdentity(db, KEK);
  assert.ok(parsePublicId(orderPublicId, "order"), "claimed id is a valid ord_");
  assert.ok(isAccessToken(token), "issued token is canonical");
  // The raw bearer value never lands in D1: only its hash verifier + a sealed copy.
  const stored = await db
    .prepare(
      "SELECT access_token, access_token_hash FROM order_guest_access WHERE order_public_id = ?",
    )
    .bind(orderPublicId)
    .first();
  assert.notEqual(stored.access_token, token, "raw token is not persisted");
  assert.ok(stored.access_token.startsWith("gcm$"), "stored token is sealed");
  assert.equal(stored.access_token_hash, sha256Hex(token), "verifier is SHA-256 of the token");
  const resolved = await resolveAccessToken(db, token, KEK);
  assert.equal(resolved?.order_public_id, orderPublicId);
  assert.equal(await resolveAccessToken(db, orderPublicId), null, "bare ord_ id grants nothing");
  assert.equal(await resolveAccessToken(db, "otk_invalid"), null);

  // Reissue refuses an UNSETTLED checkout (no orders row yet).
  assert.equal(await reissueGuestAccess(db, orderPublicId), null, "reissue refused while pending");

  // Settle, then reissue: rotation + notification enqueue land in ONE batch.
  const inserted = await db
    .prepare("INSERT INTO orders (public_id, email) VALUES (?, ?) RETURNING id")
    .bind(orderPublicId, "c@example.com")
    .first();
  const reissued = await reissueGuestAccess(db, orderPublicId, KEK);
  assert.equal(reissued?.generation, 2);
  assert.equal(await resolveAccessToken(db, token, KEK), null, "old token stops resolving");
  const rotated = await getGuestAccess(db, orderPublicId, KEK);
  assert.ok(rotated && rotated.access_token.startsWith("gcm$"), "rotated credential stored sealed");
  const reissueUrl = await guestOrderUrl(db, orderPublicId, "https://s.example", KEK);
  const newToken = reissueUrl.split("/order/")[1];
  assert.ok(newToken && isAccessToken(newToken), "unsealed URL carries the canonical new token");
  assert.equal(
    (await resolveAccessToken(db, newToken, KEK))?.order_public_id,
    orderPublicId,
    "unsealed token resolves after rotation",
  );
  const queued = await db
    .prepare("SELECT kind, state FROM order_notifications WHERE order_id = ?")
    .bind(inserted.id)
    .first();
  assert.equal(
    queued?.kind,
    "guest-link-reissue:2",
    "notification queued atomically with rotation",
  );
  assert.equal(queued?.state, "pending");

  // A second reissue queues its own versioned row (no idempotent collision).
  const again = await reissueGuestAccess(db, orderPublicId, KEK);
  assert.equal(again?.generation, 3);
  const kinds = (
    await db
      .prepare("SELECT kind FROM order_notifications WHERE order_id = ? ORDER BY kind")
      .bind(inserted.id)
      .all()
  ).results.map((r) => r.kind);
  assert.deepEqual(kinds, ["guest-link-reissue:2", "guest-link-reissue:3"]);

  // GC guard: a settled order's row is never deleted; an unsettled one is.
  assert.equal(
    await deleteGuestAccessIfUnsettled(db, orderPublicId),
    false,
    "settled row survives GC",
  );
  const abandoned = await claimOrderIdentity(db, KEK);
  assert.equal(
    await deleteGuestAccessIfUnsettled(db, abandoned.publicId),
    true,
    "abandoned row collected",
  );
  assert.equal(await getGuestAccess(db, abandoned.publicId), null);

  // A terminal reservation is hidden after its visible window, never deleted:
  // the same credential must recover if a delayed paid event lands later.
  const terminal = await claimOrderIdentity(db, KEK);
  await db
    .prepare(
      "INSERT INTO checkout_reservations (public_id, status, terminal_at) VALUES (?, 'expired', datetime('now', '-4 days'))",
    )
    .bind(terminal.publicId)
    .run();
  await db
    .prepare(
      "UPDATE order_guest_access SET created_at = datetime('now', '-10 days') WHERE order_public_id = ?",
    )
    .bind(terminal.publicId)
    .run();
  const orphan = await claimOrderIdentity(db, KEK);
  await db
    .prepare(
      "UPDATE order_guest_access SET created_at = datetime('now', '-8 days') WHERE order_public_id = ?",
    )
    .bind(orphan.publicId)
    .run();
  const fresh = await claimOrderIdentity(db, KEK); // recent row, nothing terminal — must survive
  const changed = await sweepAbandonedGuestAccess(db);
  assert.equal(changed, 2, "sweep hid the terminal row and removed only the impossible orphan");
  assert.ok(
    (await getGuestAccess(db, terminal.publicId))?.hidden_at,
    "terminal credential became a tombstone",
  );
  assert.equal(await getGuestAccess(db, orphan.publicId), null);
  assert.ok(await getGuestAccess(db, fresh.publicId), "fresh unsettled row survives the sweep");
  assert.ok(await getGuestAccess(db, orderPublicId), "settled row survives the sweep");

  // Customer-email guest URLs: tokenized for ord_ orders, legacy passthrough,
  // and null (omit link) when a new order somehow has no registry row.
  const url = await guestOrderUrl(db, orderPublicId, "https://s.example", KEK);
  assert.match(url, /^https:\/\/s\.example\/order\/otk_[A-Za-z0-9_-]{22}$/);
  assert.equal(
    (await resolveAccessToken(db, url.split("/order/")[1], KEK))?.order_public_id,
    orderPublicId,
    "emailed URL token resolves",
  );
  // Without a KEK a sealed token cannot be recovered: link omitted, not leaked.
  assert.equal(await guestOrderUrl(db, orderPublicId, "https://s.example"), null);
  const legacy = "ab".repeat(16);
  assert.equal(
    await guestOrderUrl(db, legacy, "https://s.example"),
    `https://s.example/order/${legacy}`,
  );
  assert.equal(await guestOrderUrl(db, "ord_zzzzzzzzzz", "https://s.example"), null);

  console.log("guest-access integration: all assertions passed");
} finally {
  await mf.dispose();
}
