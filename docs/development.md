# Development

How to build, run, and contribute to this fork of **minshop**.

## Prerequisites

- **Node 22** — required toolchain is Node ≥ 22.12
- **Git**, **pnpm** via `vp` (no global install needed)
- `wrangler` is a devDependency — no global install needed

## Install

```sh
vp install
vp install --prefix mcp   # MCP Worker has its own package.json (or: pnpm --prefix mcp install)
```

## Local development

```sh
vp run provision:local -- --seed   # one-shot: build, migrate + seed D1, generate .dev.vars
vp run dev                         # astro dev  -> http://localhost:4321
vp run preview                     # wrangler dev -> prod-mode (admin gate active)
```

- `astro dev` **bypasses** the admin auth gate (so you can't lock yourself out).
- Test login/middleware with `vp run preview`.
- Only one dev server at a time — two share `.wrangler` local D1 state and race as `no such table`.

### Inspecting local data

Prefer Local Explorer over `wrangler d1 execute --local` (~70x faster):

```sh
curl -s localhost:4321/cdn-cgi/explorer/api/d1/database/DB/raw \
  -H 'content-type: application/json' \
  -d '{"sql":"SELECT status, COUNT(*) FROM orders GROUP BY status"}'
```

`GET /cdn-cgi/explorer/api` returns the OpenAPI spec. Local only, unauthenticated on the dev origin.

## Type generation & checks

```sh
vp run check          # theme:sync + astro check
vp run theme:sync     # sync theme tokens
vp run theme:check    # verify themes
```

## Build & deploy

```sh
vp run build          # astro build
vp run deploy         # migrate + build + deploy + cache purge
vp run db:migrate     # apply migrations/ to local D1
vp run db:migrate:remote  # apply to production D1
```

Provisioning a fresh instance:

```sh
npm create minshop@latest my-store
npx wrangler login
vp run provision:cf my-store
# or manually: wrangler d1 create / r2 bucket create / wrangler secret put ...
```

## Configuration

- **Build-time:** `src/store.config.ts` (deep-merged on top of `src/config.ts` defaults). Never edit `src/config.ts` directly.
- **Runtime:** Admin → Settings (D1 `settings` table) — store identity, time zone, payment/email/search toggles.
- **Infra:** `wrangler.jsonc` — optional bindings (Images, Workers AI + Vectorize, Email). Keep optional bindings disabled unless configured.
- **Secrets:** only `SECRETS_KEK` + `AUTH_SECRET` are Worker secrets; provider keys live encrypted in D1 via Admin vault.

## Workflow conventions

- One concern per PR; small focused PRs land fastest.
- Keep the no-JS paths working — every storefront flow has a plain-form fallback.
- New payment rails = one adapter implementing `PaymentProvider` + factory wiring.
- New tests ride along with behavior changes.
- Run `vp run verify` after every meaningful edit; run `git diff --check` + `git status --short` before handoff.
- Migrations: `npx wrangler d1 migrations create minshop-db <name>` → edit → `vp run db:migrate`.

## Gotchas

- `wrangler.jsonc` must not set `main`/`assets` — the adapter supplies the worker entry.
- Bare `<`/`<=` in Astro `{expression}` parses as a tag open → flip operands or compute in frontmatter.
- CSRF on POST: browsers send `Origin` automatically; `curl` needs `-H "Origin: http://localhost:4321"`.
- Webhooks need `constructEventAsync` (Stripe) — sync verifier uses Node crypto, absent on Workers.
- FTS5 `MATCH` throws on raw input — sanitize to alphanumeric prefix tokens.
- `wrangler d1 export` fails with FTS5 — drop `products_fts`, export, re-run migration `0003`.
- MCP deps live in `mcp/` only — adding `agents`/`@modelcontextprotocol/sdk` to root breaks the Astro build.
