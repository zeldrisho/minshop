# API Reference

Public, machine-readable surfaces. All reach the same checkout as the HTML storefront.

## Catalog API

### `GET /api/products`

List products (public). Supports query params:

| Param      | Type   | Description                                            |
| ---------- | ------ | ------------------------------------------------------ |
| `q`        | string | FTS search query (normalized, ≤200 chars)              |
| `category` | string | Category slug filter                                   |
| `sort`     | string | Whitelisted sort key (see `features/products/sort.ts`) |
| `page`     | number | Pagination (clamped)                                   |

Response: `{ products: ProductDTO[], pagination }` — `ProductDTO` from `features/catalog/serialize.ts`.

### `GET /api/products/[slug]`

Single product by slug (or `prod_…` public ID). Returns `ProductDTO` or 404.

Uses `features/catalog/http.ts` + `query.ts` for public shapes. Identifiers are prefixed public IDs; numeric IDs are rejected.

## Checkout API

### `POST /api/checkout`

The agent checkout. Accepts **form OR JSON** (`Content-Type: application/json` triggers the JSON path).

**JSON body:**

```json
{
  "items": [{ "product_id": "prod_…", "quantity": 1 }],
  "shipping_label": "standard",
  "ship_to": { "country": "US", "postal_code": "94105" },
  "email": "buyer@example.com"
}
```

- `items` — array of `{ product_id, quantity }` (public `prod_…` IDs, validated + reserved atomically)
- `ship_to` / `shipping_label` / `ship_country` — see shipping section (required when shipping is enabled; `ship_country` for Stripe flow, `ship_to` for others)
- `email` — optional; captured on the order for confirmation / account lookup

**Success (JSON request):**

```json
{
  "flow": "stripe | invoice | opennode | demo",
  "checkout_url": "https://…/pay/… | https://checkout.stripe.com/…",
  "order_status_url": "https://…/order/<token>/status",
  "lightning": { "invoice": "lnbc…", "amount_sat": 12345, "payment_hash": "…", "expires_at": "…" },
  "shipping_cents": 500,
  "total_cents": 3700
}
```

- `checkout_url` — redirect the buyer (fragment carries session token for Stripe — copy whole URL)
- `order_status_url` — poll without `Accept` header
- `lightning` — present only on Lightning flow (BOLT11)

The order is recorded only after the settlement verifier confirms payment. Browser form checkout is unchanged.

### Polling order status

`GET /order/<token>/status` (derived from `order_status_url`).

- `200` with `{ status: "paid" | "pending" | "expired", items: [{ id: "itm_…", download_url }] }`
- `410 Gone` when terminally expired without payment
- Stable `itm_…` item IDs; `download_url` is token-protected for digital deliverables; fully refunded orders omit downloads
- Responses are `private, no-store`; cross-origin GET/OPTIONS allowed
- If payment was submitted, keep polling through `expired` — delayed settlement can still become `paid`

## Cart API

- `POST /api/cart` — cookie-based cart (HttpOnly `cart` cookie). Form posts only.

## Webhooks

- `POST /api/webhook/stripe` — Stripe events: `checkout.session.completed`, `async_payment_succeeded/failed`, `expired`, `charge.refunded`. Uses `constructEventAsync`.
- `POST /api/webhook/opennode` / Lightning webhooks — untrusted nudge; authority is `backend.getIncoming()`.

## MCP (Model Context Protocol)

Standalone Worker at `mcp/` (`/mcp`). Two tiers, same URL:

| Tier     | Auth                                | Tools                                                                                                                                            |
| -------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Buyer    | none                                | `browse_products`, `get_product_details`, `payment_methods`, `create_checkout`, `check_order_status`                                             |
| Operator | `Authorization: Bearer <MCP_TOKEN>` | + `list_products`, `get_product`, `list_orders`, `get_order`, `order_stats`, `daily_totals`, `create_product`, `update_product`, `fulfill_order` |

Buyer tools proxy the public JSON API (no D1 access). All identifiers are prefixed public IDs. Set `MCP_URL` on the storefront to advertise in `llms.txt`.

## Other public surfaces

- `GET /sitemap.xml`, `GET /robots.txt`, `GET /llms.txt`
- `GET /images/[...key]` — serves R2 through the Worker (or via `IMAGE_BASE_URL` custom domain if set)
- `GET /category/[slug]`, `GET /products/[slug]` — plural browsable collections; singular token resources (`/order/<token>`, `/pay/<publicId>`) stay singular
- `GET /account/*` — passwordless magic-link flow when `features.accounts` is enabled
