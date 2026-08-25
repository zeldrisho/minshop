# minshop

[![Verify](https://github.com/ddyy/minshop/actions/workflows/verify.yml/badge.svg)](https://github.com/ddyy/minshop/actions/workflows/verify.yml)
[![License: MIT](https://img.shields.io/github/license/ddyy/minshop)](LICENSE)

<p><em>Community fork — see <code>docs/</code> for development, architecture, security, and API docs.</em></p>

An open-source store an agent can pay for itself. Agents read the catalog and pay a Lightning invoice with no human in the loop — over plain JSON or over MCP; people check out the normal way with Stripe. Merchants can run the store over MCP too.

Small, server-rendered store for Cloudflare Workers (D1 + R2) with a full admin, multiple payment rails, and an optional MCP server — fits the free tier to start.

**[Live demo](https://demo.minshop.dev/)** (agent API at `/api/products`, `/api/checkout`) — test payments only.

![minshop storefront and checkout](docs/assets/minshop.gif)

## Scaffold a store

> Requires Node ≥ 24.11 and Git.

```sh
git clone https://github.com/ddyy/minshop.git my-store
cd my-store
vp install
vp run provision:local -- --seed
vp run dev  # http://localhost:4321 → /admin is the setup wizard
```

## Features

- **Storefront** — SSR, near-zero JS; list + detail, categories, search, cart drawer
- **Admin** — products, categories, pages, media, orders, customers, fulfillment, CSV, settings
- **Payments** — Stripe, Lightning (phoenixd/LNbits), OpenNode, demo — selectable in Admin
- **Shipping** — zones, flat/weight-banded rates, free-over threshold (Admin → Shipping)
- **Search** — FTS5 keyword (default, $0) or semantic via Workers AI + Vectorize
- **Content** — Markdown pages at `/pages/<slug>`, media library as single owner of R2 objects
- **Agent surfaces** — JSON `/api/products` + `/api/checkout` and MCP (`mcp/` Worker, buyer + operator tiers)

Details: [`docs/architecture.md`](docs/architecture.md), [`docs/api.md`](docs/api.md), [`docs/customizing.md`](docs/customizing.md).

## Stack

| Piece     | Choice                                                    |
| --------- | --------------------------------------------------------- |
| Framework | Astro 7 SSR on Cloudflare Workers (`@astrojs/cloudflare`) |
| Styling   | Tailwind CSS v4 (`@tailwindcss/vite`)                     |
| Data      | Cloudflare D1 (SQLite)                                    |
| Images    | Cloudflare R2                                             |
| Payments  | Stripe / Lightning / OpenNode / demo                      |

## Quick start (local)

```sh
vp install
vp run provision:local -- --seed  # migrate + seed + generate SECRETS_KEK + AUTH_SECRET
vp run dev                         # http://localhost:4321
vp run preview                     # wrangler dev — prod mode, admin gate active
```

`astro dev` bypasses the admin gate; use `preview` to test auth. One dev server at a time (shared `.wrangler` state).

Testing: `vp test` (unit) · `vp run test:d1` (clean-room D1) · `vp run verify` (full gate: unit + Astro check + build + D1 + MCP). See [`docs/testing.md`](docs/testing.md) and [`docs/development.md`](docs/development.md).

Stripe locally: paste `sk_test_…` in Admin → Settings → Payments, then `stripe listen --forward-to localhost:4321/api/webhook`.

## Deploy

**One-click:** [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ddyy/minshop) — provisions D1 + R2 (`minshop-images` + private `minshop-files`), runs migrations, deploys. Finish at `/admin/setup`; set Stripe webhook to `https://<host>/api/webhook/stripe`.

**CLI:**

```sh
vp exec wrangler login
vp run provision:cf my-store   # or: d1 create + r2 bucket create + wrangler secret put
vp run deploy                  # migrate + build + deploy + purge
```

Only two Worker secrets are required (`SECRETS_KEK`, `AUTH_SECRET`); everything else lives encrypted in D1 via Admin → Settings. See [`docs/development.md`](docs/development.md) for the full deploy/migration flow.

## Admin auth

`/admin` + `/api/admin/*` are fail-closed in production (`src/middleware.ts`). Use the setup-wizard password (`/admin/setup` → PBKDF2 in D1) or Cloudflare Access (`CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` covering both `/admin` and `/api/admin`). `astro dev` is open; test gates with `vp run preview`. Reset via `vp run admin:reset:remote`. See [`docs/security-invariants.md`](docs/security-invariants.md).

## Theming

Build-time themes in `src/themes/<theme>/tokens.css` (`@theme` block) + `src/styles/overrides.css` post-layer. No runtime engine. See [`docs/customizing.md`](docs/customizing.md) for the full store-owned surface, card/shell/catalog contracts, and checks.

## Documentation

| Topic                                  | File                                                         |
| -------------------------------------- | ------------------------------------------------------------ |
| Development, gotchas, config           | [`docs/development.md`](docs/development.md)                 |
| Architecture, ports & adapters         | [`docs/architecture.md`](docs/architecture.md)               |
| Security invariants                    | [`docs/security-invariants.md`](docs/security-invariants.md) |
| Public API (`/api/products`, checkout) | [`docs/api.md`](docs/api.md)                                 |
| Testing strategy                       | [`docs/testing.md`](docs/testing.md)                         |
| Recipes — how to add X                 | [`docs/recipes.md`](docs/recipes.md)                         |
| Storefront customization               | [`docs/customizing.md`](docs/customizing.md)                 |

## Cost

Default Worker + D1 + R2 fits Cloudflare's free-plan allowances for a small store; overages billed per Cloudflare pricing. Payment/email/AI/Vectorize/Images have their own pricing — review what you enable.
