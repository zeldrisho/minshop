# Security Invariants

> Authoritative invariants live in `src/middleware.ts` / `src/features/auth/*`.

## Trust boundaries

- **Admin surface** (`/admin` + `/api/admin/*`) is fail-closed in production. Either a Cloudflare Access JWT (`CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD`) or the D1-hashed setup-wizard password (`admin_password_hash`) is required. Until a password is set, `/admin/setup` is the only open path — set it immediately on a public deploy or front `/admin` with Access.
- **Local dev** (`astro dev`) bypasses the gate — never bind it to a public interface. Use `vp run preview` (wrangler dev) to test auth.
- **Customer accounts** are magic-link (HMAC, 15-min single-use link → 30-day cookie). No passwords. Orders are keyed by email (`listOrdersByEmail`).

## Invariants — do not break

1. **Storefront is near-zero client JS.** Never require JS for a page to work.
2. **Orders are paid-only.** `orders` holds settled orders; `pending_payments` holds in-flight Lightning invoices. Never write an unpaid order.
3. **Config has two layers.** Runtime values in D1 `settings`; build-time defaults in `src/config.ts` overridden by `src/store.config.ts`. Currency is build-time, store-wide.
4. **Provider-agnostic core.** `checkout.ts` / `webhook.ts` / shipping never import a vendor SDK — only ports. Vendor code stays in adapters.
5. **Migrations are additive.** Numbered files, `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ADD COLUMN`. Never rewrite or `DROP`.
6. **Money is integer minor units** end-to-end; format at the edge via `formatPrice()`.
7. **Public routes are plural** (`/products/<slug>`, `/categories/<slug>`) matching admin + API; token-addressed singles stay singular (`/order/<token>`, `/pay/<publicId>`). Retiring a public URL = keep a 301 forever.
8. **Media is sole owner of R2 objects.** Products/pages/logo record usage by `image_key`; only `/api/admin/media/:id` deletes an R2 object and refuses while referenced (single-statement guard vs race).
9. **Page bodies are Markdown with `html: false`.** Raw HTML is escaped; `renderMarkdown()` is the single server-side renderer.
10. **Provider keys are write-only.** Entered in Admin, encrypted under `SECRETS_KEK` in D1, never displayed again. The Worker needs only `SECRETS_KEK` + `AUTH_SECRET`.

## Additional guarantees

- **CSRF:** Astro rejects cross-origin form POSTs (403). Browsers pass via `Origin`; scripted clients must set it.
- **Webhooks:** untrusted nudge — authority is `backend.getIncoming()` re-poll. Stripe uses `constructEventAsync` (Web Crypto) on Workers.
- **FTS5:** sanitize raw input to alphanumeric prefix tokens before `MATCH` to avoid `fts5: syntax error`.
- **IDs:** public IDs (`prod_…`, `ord_…`, `itm_…`) are the external contract; numeric DB IDs are rejected. See `src/features/ids/*`.
- **Rate limiting:** `AUTH_RATE_LIMITER` (10/min), `CHECKOUT_RATE_LIMITER` (20/min), `SEARCH_RATE_LIMITER` (60/min), `MCP_RATE_LIMITER` (30/min for buyer tier).

## Reporting

See `SECURITY.md`. Use GitHub private advisory (`Report a vulnerability`) or email `dev@daniel-yang.com`. Do not open a public issue for exploitable findings. Never include real keys, tokens, or customer data in reports.
