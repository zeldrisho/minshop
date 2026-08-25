# Plan

## Remain

All conversion work is code-complete; only the final green gate is outstanding.

- [x] **Run `vp run verify` once, serially, to green.** — **done** `2026-05-13` · `CI=true vp run verify` green serially on Node 24.19.0 + pnpm 11.13.1 (907/907 unit, `astro check` 0 errors, build ok, all D1 integration suites, `mcp:check`). Pre-run cleaned orphaned `workerd`/`wrangler dev` holding `127.0.0.1:8791` (`pkill -9`, `ss -tln` empty). No overlap.
- [x] **Commit** the `.mjs → .ts` conversion + Node 24 / pnpm 11 upgrades — **done** (this commit).

## Implement: Node 24 upgrade

Goal: move required toolchain from Node 22 (Maintenance LTS) to Node 24 (Active LTS, v24.19.0 Krypton). `v22` EOL ~Apr 2027, `v24` is the production LTS. `--experimental-strip-types` (22.6+) is unchanged in 24.x — no script changes.

### Tasks — already applied externally (sync plan to reality)

- [x] `package.json` — `engines.node: ">=22.18.0"` → `">=24.11.0"` — **done** (working tree)
- [x] `README.md:18` — `Requires Node ≥ 22.12` → `Requires Node ≥ 24.11` — **done**
- [x] `docs/development.md:7` — `Node 22 — required toolchain is Node ≥ 22.12` → `Node 24 — required toolchain is Node ≥ 24.11` — **done**
- [x] `docs/decisions.md §6` — `Node ≥22.6` → `Node ≥24.11` (kept history: "originally ≥22.6; bumped to 24.11") — **done**
- [x] `.github/workflows/ci.yml:28,100` — `node-version: 22` → `24` (both `verify` and `themes` jobs) — **done**

### Verify

- [x] `node -v` shows `v24.x` (now `v24.19.0` via `vp`), `vp install` clean, `vp run verify` green (serial run; `ss -tln | grep 8791` empty before) — **done**
- [ ] CI `verify` + `themes` matrix green on Node 24 — awaiting push

## Implement: pnpm 11.13.1 upgrade

Goal: move from `pnpm@10.34.5` to `pnpm@11.13.1`. v11 requires Node ≥22 (we have 24), switches to pure ESM, SQLite store (v11), and tightens security defaults. No Node flag changes.

### Breaking changes affecting this repo

- `pnpm-workspace.yaml: onlyBuiltDependencies: [esbuild, workerd]` is removed → `allowBuilds: { esbuild: true, workerd: true }`
- `packageManager` must bump in both `package.json` and `mcp/package.json` (+ `devEngines.packageManager.version`)
- `.npmrc` is now auth/registry only — we have no `.npmrc`, no `pnpm` field in `package.json`, so no split needed
- Store upgrades to SQLite, `lockfileVersion` stays `9.0` but `pnpm-lock.yaml` will diff (store index + `allowBuilds`)
- New defaults: `minimumReleaseAge: 1440` (1 day), `blockExoticSubdeps: true`, `strictDepBuilds: true` — may delay newly published deps

### Tasks

- [x] Run codemod via `vp` (not `pnpx`): `vp dlx codemod run pnpm-v10-to-v11` — codemod requires TTY (`Failed to get user input: The input device is not a TTY`), so manual fallback used — **done**
- [x] Manual fallback if codemod not used: `pnpm-workspace.yaml` `onlyBuiltDependencies` → `allowBuilds`, `package.json` + `mcp/package.json` `packageManager: pnpm@10.34.5` → `pnpm@11.13.1`, `devEngines.packageManager.version: 10.34.5` → `11.13.1` — **done**
- [x] Do NOT create `.node-version` (per instruction) — **done**, none created
- [x] `vp install` — regenerates lockfile + SQLite store — **done** (`CI=true vp install`, lockfile now on pnpm 11.13.1, `vp --version` shows `pnpm v11.13.1`)
- [x] `vp run verify` green on Node 24 (serial) — **done**

### Verify

- [x] `vp --version` shows `Package manager pnpm v11.13.1` + `Node v24.19.0` — **done**
- [x] `pnpm-lock.yaml` diff only shows `packageManager` + store metadata, no missing deps — **done** (`@pnpm/exe` + platform packages bumped to 11.13.1, `lockfileVersion` stays `9.0`)
- [ ] CI green with `setup-vp` resolving pnpm 11.13.1 — awaiting push

## Deploy checklist (v0.1.0 — when green)

> Original deploy gate from beginning of session — keep until `vp run verify` is serial-green on Node 24 + pnpm 11.

### Pre-deploy (gate)

- [ ] `git fetch --prune` + clean tree (`git status --short` empty) on `main`
- [ ] CI `verify` + `themes` matrix green (`.github/workflows/ci.yml` on Node 24 / pnpm 11)
- [ ] Review `db/migrations/` — additive only, numbered, applies cleanly via `vp run db:migrate` locally; dry-run remote `wrangler d1 migrations list DB --remote`
- [ ] Theme/config: `theme.config.json` resolves via `resolveTheme()`; `CANONICAL_ORIGIN` / `cache.cross_version_cache` / `workers_dev` consistent; `CACHE_PURGE_SECRET` present if caching enabled
- [ ] Secrets: `SECRETS_KEK` + `AUTH_SECRET` in Worker secrets; provider keys encrypted in D1 `secrets` (Admin vault)
- [ ] `wrangler.jsonc` is generated (`dist/server/wrangler.json` via `config/wrangler.template.jsonc`), not hand-edited

### Deploy

- [ ] Preview first: `vp run preview` (fail-closed admin gate active)
- [ ] Smoke test: `/`, `/products/[slug]`, `/search`, `POST /api/checkout` (form + JSON), `/pay/[publicId]`, webhooks (`constructEventAsync`), `/images/[...key]`
- [ ] Production: `vp run deploy` (migrations run automatically; purge `POST /api/internal/cache-purge` with 5 retries)
- [ ] If `mcp/` changed: `vp run mcp:check && vp run mcp:deploy`
- [ ] Monitor 15 min: Workers Observability (`head_sampling_rate: 1`), error rate & P50/P95

### Rollback triggers

- Error rate >1% (5 min), P50 >800ms / P95 >1500ms, `POST /api/checkout` 500, webhook failures, or `scheduled` cron not firing

## Skip

- Converting `*.astro` templates and `*.sh` helpers to TS — framework/shell files,
  deliberately kept (`.astro` is Astro's required DSL; `.sh` orchestrates wrangler).
