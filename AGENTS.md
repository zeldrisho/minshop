# Agent Instructions

## Package Manager

- Use **vp**: `vp install`

## Project Layout

| Path                               | Purpose                                                              |
| ---------------------------------- | -------------------------------------------------------------------- |
| `src/config.ts`                    | Schema + defaults (upstream-owned); `getConfig()` is source of truth |
| `src/store.config.ts`              | Build-time overrides (deep-merged on top)                            |
| `src/features/`                    | Vertical slices — each owns db, types, components                    |
| `src/pages/`                       | Routes: storefront, admin, api, images, sitemap                      |
| `src/themes/<theme>/`              | Templates + `tokens.css` (`@theme` block)                            |
| `src/middleware.ts`                | Admin auth gate (fail-closed)                                        |
| `mcp/`                             | Standalone MCP Worker — own `package.json` / `node_modules`          |
| `db/migrations/`                   | Additive D1 migrations (numbered, never rewrite)                     |
| `db/seeds/`                        | Seed SQL (`seed.sql`, demo catalog)                                  |
| `config/`                          | Theme selection, wrangler template, oxlint plugin                    |
| `scripts/{db,theme,deploy,check}/` | Ops scripts grouped by domain                                        |
| `tests/`                           | Integration, fixtures, baselines, contract suites                    |

## Commands

| Task               | Command             |
| ------------------ | ------------------- |
| Verify (gate)      | `vp run verify`     |
| Dev server         | `vp run dev`        |
| Prod preview       | `vp run preview`    |
| Unit tests         | `vp test`           |
| D1 integration     | `vp run test:d1`    |
| DB migrate (local) | `vp run db:migrate` |
| Astro diagnostics  | `vp run check`      |
| MCP check          | `vp run mcp:check`  |

## Key Conventions

- `vp run verify` is the green/red gate — run after every meaningful edit.
- Storefront is near-zero client JS; orders are paid-only (`pending_payments` until settled).
- Money is integer minor units; format at edge via `formatPrice()`.
- Tests stay pure — `*.test.ts` must NOT import `cloudflare:workers`; pass `db`/secrets as params.
- Bindings via `import { env } from 'cloudflare:workers'`; migrations are additive, never rewrite.
- Admin is fail-closed — test auth with `vp run preview`; use Local Explorer (`/cdn-cgi/explorer/api`) for D1 reads.
- `mcp/` has its own deps — never hoist `agents`/`@modelcontextprotocol/sdk` to root.
- Before implementation, run `git fetch --prune`, start from the latest `main`, and preserve uncommitted work.
- Delete a completed local branch only when it is merged into its target and its upstream branch is gone.

## External References

| Need                     | File                          |
| ------------------------ | ----------------------------- |
| Overview & quick start   | `README.md`                   |
| Architecture & ports     | `docs/architecture.md`        |
| Development & gotchas    | `docs/development.md`         |
| Security & invariants    | `docs/security-invariants.md` |
| Public API               | `docs/api.md`                 |
| Testing strategy         | `docs/testing.md`             |
| Storefront customization | `docs/customizing.md`         |
| Recipes (how to add X)   | `docs/recipes.md`             |
