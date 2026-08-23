# Architecture

> Fork of [`ddyy/minshop`](https://github.com/ddyy/minshop) — Astro 7 SSR on Cloudflare Workers + D1 + R2 + Stripe/Lightning.

## High-level design

```text
Browser ──> Astro SSR Worker (Cloudflare) ──> D1 (SQLite) + R2 (images/files)
               │  middleware.ts (admin gate)
               │  pages/* (storefront + admin)
               │  api/* (cart, checkout, webhooks, admin CRUD)
               │  images/[...key] (R2 gateway)
               │  sitemap.xml / robots.txt / llms.txt
               │
               └─> Stripe / OpenNode / Lightning (phoenixd | LNbits)
               └─> Resend | Cloudflare Email (EmailProvider)
               └─> FTS5 | Workers AI + Vectorize (SearchProvider)
               └─> cron (scheduled) — sweeps for expired holds + deferred work

MCP Worker (mcp/) ──> public JSON API (/api/products, /api/checkout) ──> same checkout
  Buyer tier (open) + Operator tier (Bearer MCP_TOKEN)
```

## Project layout

```
src/
  config.ts              SCHEMA + DEFAULTS (upstream-owned)
  store.config.ts        build-time overrides (deep-merged)
  styles/overrides.css   post-theme override layer
  middleware.ts          admin auth gate
  env.d.ts               Cloudflare.Env bindings
  layouts/               Layout.astro (storefront), AdminLayout.astro
  themes/<theme>/        Header, Footer, ProductCard, Catalog, ProductDetail, ContentPage, tokens.css
  features/
    products/  db · form · image · search · stock · slug · sort
    orders/    db · number · reservations (atomic checkout holds)
    payments/  provider (port) · stripe · opennode · lightning-provider · index
               lightning/ backend (port) · phoenixd · lnbits · rate · pending
    shipping/  calculator (zones + ShippingCalculator port)
    storage/   provider (port) · r2 · index
    email/     provider (port) · resend · cloudflare · orderConfirmation
    auth/      access (CF Access JWT) · session (cookie) · turnstile
    search/    provider (port) · fts · vector
    settings/  db (SettingKey + StoreSettings)
    media/     db · upload · usage (sole owner of R2 objects)
    pages/     layouts · renderMarkdown
    cart · categories · customers · navigation · etc.
  pages/
    index, products/[slug], categories/[slug], pages/[slug], search, cart, checkout
    pay/[publicId], order/[token], account/*, admin/*, api/*, images/[...key]
```

## Ports & adapters

Routes depend on interfaces, never on a vendor:

| Port                 | Location                        | Factory                       | Adapters                    |
| -------------------- | ------------------------------- | ----------------------------- | --------------------------- |
| `PaymentProvider`    | `payments/provider.ts`          | `payments/index.ts`           | stripe, opennode, lightning |
| `LightningBackend`   | `payments/lightning/backend.ts` | `payments/lightning/index.ts` | phoenixd, lnbits            |
| `StorageProvider`    | `storage/provider.ts`           | `storage/index.ts`            | r2                          |
| `EmailProvider`      | `email/provider.ts`             | `email/index.ts`              | resend, cloudflare          |
| `SearchProvider`     | `search/provider.ts`            | `search/index.ts`             | fts, vector                 |
| `ShippingCalculator` | `shipping/calculator.ts`        | (config-rates)                | carrier rates (future)      |

To add a provider: one adapter file + wire the factory + add `SecretName`/`SecretField` if it needs a key.

## Data model & storage

- **D1 (SQLite):** products, categories, product_categories, orders, pending_payments, checkout_reservations, settings, secrets (encrypted), media, pages, navigation, customers, refunds, shipping_labels, etc. FTS5 virtual table `products_fts` + triggers.
- **R2:** `BUCKET` (`minshop-images`) for public images; `FILES` (`minshop-files`, private) for digital deliverables. One R2 key per file; media rows own usage.
- **Bindings:** `env.DB` (D1), `env.BUCKET` / `env.FILES` (R2), `env.IMAGES` (optional), `env.AI` + `env.VECTORIZE` (optional), `env.CACHE_PURGE_SECRET`, rate limiters.

## Request flow

1. **Storefront** — SSR Astro pages, near-zero client JS. Catalog/search/pagination are server-rendered; cart drawer / live search are progressive enhancements.
2. **Checkout** — `POST /api/checkout` (form OR JSON `{items}` → `checkout_url`). Captures address, delivery method, shipping, discount/tax. Lightning checkout polls `/pay/[publicId]`.
3. **Webhooks** — `POST /api/webhook/stripe` et al. verify signature (`constructEventAsync` on Workers), then re-poll the provider (`backend.getIncoming()`) as authority before marking paid.
4. **Reservations** — atomic stock holds via `checkout_reservations`; expired holds released on next reservation or by cron (`src/worker.ts` scheduled handler every 5 min).
5. **Caching** — Workers Cache with tags (`shell`, `catalog`, per-product). Admin writes purge affected tags; stock changes purge only on In-stock / Low-stock / Sold-out transitions.

## Theming

Build-time, not runtime. Each theme owns `tokens.css` with a Tailwind v4 `@theme` block (`--color-brand`, `--color-accent`, `--font-sans`, radii). `src/styles/overrides.css` is the post-theme override layer. `src/features/storefront/` is upstream-owned presentation models + controls.

## MCP server

`mcp/` is a sibling Cloudflare Worker (own `package.json`) to isolate the Agents SDK from the Astro build.

- **Buyer** (no auth): `browse_products`, `get_product_details`, `payment_methods`, `create_checkout`, `check_order_status` — proxies the public JSON API.
- **Operator** (`Bearer MCP_TOKEN`): adds `list_products`, `get_product`, `list_orders`, `get_order`, `order_stats`, `daily_totals`, `create_product`, `update_product`, `fulfill_order`.
- Identifiers are prefixed public IDs (`prod_…`, `ord_…`, `itm_…`). Tier is fixed at session open.
