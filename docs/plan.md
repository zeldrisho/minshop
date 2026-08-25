# Plan

> Lean — only remaining work. Completed toolchain upgrades and the `minshop` provisioning from this session are archived in `docs/decisions.md` §§7–9.

## Remaining — PR & deploy verification

- [ ] **PR `chore/toolchain-node24-pnpm11` green and merged** — `git fetch --prune`, CI `verify` + `themes` matrix pass on Node 24 / pnpm 11.13.1 (local `CI=true vp run verify` already green: 907/907, `astro check` 0 errors, build ok, all D1 suites, `mcp:check`; requires push via PR — direct push to `main` is protected)
- [ ] **Finish storefront smoke after admin onboarding** — provisioned instance `https://minshop.zeldrisho.workers.dev` currently `302 /admin/setup` until admin password is set. After setup, verify `GET /`, `/products/[slug]`, `/search`, `POST /api/checkout` (form + JSON), `/pay/[publicId]`, webhooks `constructEventAsync`, `/images/[...key]`
- [ ] **Cache purge path** — `cache.enabled: false` on this instance (free-plan default); verify `POST /api/internal/cache-purge` with `CACHE_PURGE_SECRET` only if `cross_version_cache` is later enabled (requires `CANONICAL_ORIGIN` + `workers_dev: false`)
- [ ] **MCP (optional)** — `mcp/` bumped only for pnpm version; `vp run mcp:check` dry-run passes. Run `vp run mcp:deploy` only if the MCP worker is needed for this instance
- [ ] **Monitor 15 min after full smoke** — Workers Observability (`head_sampling_rate: 1`), error rate <1% (5 min), P50 <800ms / P95 <1500ms, `POST /api/checkout` 200, cron `scheduled` firing every 5 min

### Already verified locally (not re-checked in PR)

- `db/migrations/` additive (40 files, `0033_*` duplicate prefix handled lexicographically), `vp run db:migrate` local ✅, remote `764e0369-8373-49ae-af4e-74a2fc930254` applied via provision
- `config/theme.config.json` → `default` via `resolveTheme()`, `wrangler.jsonc` generated from `config/wrangler.template.jsonc` (not hand-edited)
- `SECRETS_KEK` + `AUTH_SECRET` in Worker secrets (set via `wrangler secret put` after provision; `openssl` missing from image so generated via `node:crypto`)
- `mcp:check` dry-run passes; `scripts/db/provision-cf.sh` fixed (`ROOT` `../..`, `themes.ts` + `--experimental-strip-types`)

## Rollback triggers

- Error rate >1% (5 min), P50 >800ms / P95 >1500ms, `POST /api/checkout` 500, webhook failures, or `scheduled` cron not firing

## Skip (intentional)

- `*.astro` templates and `*.sh` helpers — framework/shell files, deliberately kept
