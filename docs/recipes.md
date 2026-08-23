# Recipes — How to Add X

> All paths are repo-relative.

## A product field

1. New migration: `vp exec wrangler d1 migrations create minshop-db <name>` → `ALTER TABLE products ADD COLUMN …`
2. Update `Product` / `AdminProduct` types + queries in `features/products/db.ts`
3. Add field to `ProductForm.astro` + `parseProductForm` in `features/products/form.ts`
4. `vp run db:migrate` (local) → `vp run db:migrate:remote` (prod, before deploy) — via `vp exec wrangler`

## A content page

Nothing to add — merchants create them at `/admin/pages`. Published pages appear at `/pages/<slug>`, in the footer, sitemap, and `llms.txt` automatically.

## A page layout preset

Add **one** entry to `PAGE_LAYOUTS` in `features/pages/layouts.ts`. The editor dropdown, validation, storefront, and admin preview all derive from it; `measure` / `titleAlign` are emitted as CSS custom properties so no stylesheet edit is needed. A preset needing more than those two axes can also target `[data-page-layout="<key>"]` in `global.css`. Unknown/removed presets fall back to `standard` at render time.

## A config setting

- **Build-time:** add to `SiteConfig` interface **and** `defaultConfig()` in `config.ts`; read via `getConfig()`; document override in `store.config.example.ts` (per-env overrides may read an env var, see `TIME_ZONE`).
- **Runtime (dashboard):** add a `SettingKey` + `StoreSettings` field in `features/settings/db.ts` and a form in `/admin/settings`.

## A payment provider

1. Implement `PaymentProvider` in `features/payments/<name>.ts`
2. Add a case to `getPaymentProvider()` in `payments/index.ts`
3. Add its key as a `SecretName` in `features/secrets/store.ts` (encrypted in D1 via admin vault — provider keys are **not** env vars) and a `SecretField` in the settings Payments card

## A Lightning backend

1. Implement `LightningBackend` in `features/payments/lightning/<name>.ts`
2. Add a case to `getLightningBackend()`

## A shipping zone / rate

Edit `shipping.zones` in `config.ts` default (or `store.config.ts` override). Pure logic lives in `shipping/calculator.ts` — unit-test it. Runtime shipping is managed in Admin → Shipping (zones, flat/weight-banded rates, free-over thresholds).

## A migration

```sh
vp exec wrangler d1 migrations create minshop-db <name>
# edit db/migrations/<number>_<name>.sql  (CREATE TABLE IF NOT EXISTS / ALTER TABLE ADD COLUMN)
vp run db:migrate          # local
vp run db:migrate:remote   # prod, before deploy
```

Never edit an applied migration; never `DROP` destructively. Numbered files only.

## An admin page

`src/pages/admin/<x>.astro` using `AdminLayout` (add a nav entry there). Mutations go through `/api/admin/*` (covered by the auth gate in `src/middleware.ts`).

## A storefront feature behind a flag

1. Add `config.features.<x>` toggle in `config.ts`
2. Gate the nav link in `Layout.astro` and the route itself

## Customer auth

`features/auth/customer.ts` is the magic-link adapter (no passwords) — reuses `token.ts` (signed HMAC) + the `EmailProvider`. Pages live under `pages/account/`. Swap to OAuth by replacing that module. Orders are keyed by email, so "my orders" = `listOrdersByEmail` (no per-user join needed).

## A search backend

1. Implement `SearchProvider` in `features/search/<name>.ts`
2. Add a branch to `getSearchProvider()`

Semantic (`vector`) keeps the index in sync via `indexProduct` / `unindexProduct` called from the admin product routes.

## General guardrails

- `vp run verify` after every meaningful edit; `git diff --check` + `git status --short` before handoff
- Money = integer minor units; format via `formatPrice()`
- Migrations additive; media is sole owner of R2 objects (single-statement guards)
- See `docs/architecture.md` (ports & adapters), `docs/development.md` (gotchas), `docs/security-invariants.md` (invariants)
