-- 0041: guest tokens are verified by hash, never stored as plaintext.
--
-- order_guest_access.access_token authorizes /order/<token> and /pay/<token>.
-- Storing the raw bearer value meant a D1 export or read disclosure could
-- replay every stored token. From this migration on:
--   access_token_hash — SHA-256 hex of the token (the ONE lookup credential;
--                       incoming tokens are hashed before comparison, so
--                       rotation behavior is unchanged);
--   access_token      — the token sealed with AES-256-GCM under a Worker
--                       secret (SECRETS_KEK, falling back to AUTH_SECRET) so
--                       customer-email builders can still regenerate the guest
--                       URL for settlement/shipping/refund notices. Envelope
--                       recovery needs reversibility; a one-way hash alone
--                       cannot regenerate emailed links.
--
-- SQL migrations cannot hash or encrypt (no WebCrypto), mirroring how public_id
-- backfills run outside SQL: rows written before this migration keep their raw
-- token and a NULL hash; they keep resolving via the legacy path (raw match
-- while access_token_hash IS NULL) and are re-sealed lazily by the Worker the
-- first time the row is touched. Unsettled checkouts' rows are garbage-collected
-- as before.
ALTER TABLE order_guest_access ADD COLUMN access_token_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_order_guest_access_token_hash
ON order_guest_access(access_token_hash) WHERE access_token_hash IS NOT NULL;
