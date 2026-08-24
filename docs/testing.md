# Testing

## The gate

```sh
vp run verify
```

Single green/red signal CI runs: unit tests → Astro diagnostics → production build → clean-room D1 integration → MCP typecheck/deployment dry run. If green, the change holds.

## Unit tests

```sh
vp test              # vitest run (pure logic)
vp test --watch      # watch mode (or: vp run test:watch)
```

- **70 test files**, organized as colocated `foo.ts` + `foo.test.ts` throughout the codebase, plus centralized directories including `test/storefront`, `test/integration`, and `create-minshop/test`.
- Renders `.astro` components via `AstroContainer` + contract/baseline checks.
- Covers: `slugify`, FTS search sanitizer + edit-distance, `parseProductForm`, image validation, cart counting, reservation aggregation, order-number scheme, Access JWT verifier, pagination clamping, `orderByClause` sort whitelisting (SQL-injection boundary).
- **Rule:** `*.test.ts` must NOT import `cloudflare:workers` (vitest can't load it). Keep DB/env logic out of unit-tested modules — pass `db`/secrets as params (see `lightning/rate.ts`, `auth/session.ts`).

## D1 integration

```sh
vp run test:d1           # build + isolated D1 (migrations + seed + Worker boot)
vp run test:integration  # reservations, refunds, media, menus, guest-access, shipping, d1-integration.sh
```

Clean-room gates: reservation concurrency/release/settlement/legacy compatibility, then a demo checkout through paid-order settlement and confirmation against an isolated DB.

## Storefront equivalence

```sh
vp run test:storefront-equivalence   # astro build + storefront-baselines.sh
vp test run tests/storefront          # vitest run tests/storefront
```

Proves template refactors didn't change rendered output a customer sees. Run after non-trivial UI changes; screenshot to `/tmp` if needed (deleted after).

## MCP

```sh
vp run mcp:check   # typecheck + deployment dry run for mcp/ Worker
```

`mcp/` has its own `package.json` + `node_modules`.

## Local data inspection

Use Local Explorer, not `wrangler d1 execute --local`:

```sh
curl -s localhost:4321/cdn-cgi/explorer/api/d1/database/DB/raw \
  -H 'content-type: application/json' \
  -d '{"sql":"SELECT status, COUNT(*) FROM orders GROUP BY status"}'
```

## Conventions

- Colocate tests next to source; test pure logic, verify D1/R2 against a real Worker.
- Add a test that would have caught the old behavior for every behavior change.
- Keep the no-JS paths covered — cart, search, checkout all have plain-form fallbacks.
