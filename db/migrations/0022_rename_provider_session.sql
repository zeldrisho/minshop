-- 0022: generalize the payment idempotency column (additive expand step).
-- The orders idempotency key holds the payment PROVIDER's session/reference id
-- for every rail (Stripe, Lightning, OpenNode, demo), not just Stripe.
--
-- Additive on purpose: the old stripe_session_id column stays in place so a
-- pre-rename Worker still serving traffic keeps working; new code writes only
-- provider_session_id. Dropping stripe_session_id is deferred to a later
-- numbered contract migration once old Workers no longer receive traffic —
-- renaming/dropping here would fail their requests with a missing-column
-- error and violate the additive-migration policy.
ALTER TABLE orders ADD COLUMN provider_session_id TEXT;

-- Backfill rows written before this migration ran.
UPDATE orders SET provider_session_id = stripe_session_id
WHERE stripe_session_id IS NOT NULL;

-- Same uniqueness the inline constraint gave stripe_session_id (0001), now on
-- the provider-neutral column the settlement code upserts against. Deliberately
-- a full (not partial) unique index: SQLite's ON CONFLICT(provider_session_id)
-- target only matches full unique indexes, and like the old inline UNIQUE
-- constraint it admits any number of NULLs.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_provider_session
ON orders(provider_session_id);
