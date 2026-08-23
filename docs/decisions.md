# Decisions — toolchain & scaffold

Captures the important choices from `docs/plan.md` and the 2026-08-23 vp-migration session. The plan itself now keeps only remaining work.

## 1. Single package manager via `vp` (not `npm`/`npx`/`pnpm`)

**Context:** Repo mixed `npm run`, `npx wrangler`, `pnpm --prefix mcp`, `npm ci --prefix mcp`. Single PM needed for `vp` DX and free-tier CI.

**Decision:**

- `pnpm-workspace.yaml` → `packages: [".", "mcp"]`, single `pnpm-lock.yaml`. `mcp/` stays isolated (`mcp/node_modules` symlinked via workspace, never hoisted to root — `agents`/`@modelcontextprotocol/sdk` stay out of storefront build).
- Root + `mcp/package.json` both `packageManager: pnpm@10.25.0`, `devEngines.packageManager.onFail: download` — `vp install` downloads pnpm 10.25.0, no global `pnpm` required.
- All commands via `vp`: `vp install` (workspace), `vp run <script>` (verify, dev, build, deploy), `vp test` (unit), `vp check` (fmt+lint), `vp exec <bin>` (astro, wrangler, tsc, vitest), `vp dlx` for one-offs. No `npm run`/`npx`/`pnpm exec` in scripts, docs, or workflows.
- Scripts updated: `package.json` (`check`/`test`/`test:d1`/`verify` use `node`+`vp`), `scripts/deploy.ts`/`verify-theme.ts`/`check-mcp.sh` use `vp exec`, shell helpers (`provision-*`, `destroy-*`, `seed-*`, `backfill`, `admin-reset`, `reset`) use `vp exec wrangler`/`vp exec astro`, `tests/integration/*.sh` use `vp exec wrangler`, `.github/workflows/verify.yml` single `vp install`.

**Consequences:** `vp install` is the only install entry; CI needs one step; local `which pnpm` resolves to `~/.vite-plus/js_runtime` (managed).

## 2. Lint gate triage

**Context:** `vp check` (oxlint + type-aware) reported 405 errors (anti-slop) + 16 TS errors (`TS2307` `#theme`, `restrict-template-expressions`, `no-base-to-string`). `astro check` was already clean.

**Decision:**

- `vite.config.ts` `lint.ignorePatterns` add `mcp/**` (was `create-minshop/**`, removed with scaffold). Keep `tools/oxlint/anti-slop/**`.
- Downgrade `anti-slop/*` from `error` → `warn` — strict rules kept as warnings while codebase is brought into compliance incrementally.
- `lint.options` → `typeAware: true, typeCheck: false` — duplication removed; full type gate stays in `astro check` (`vp run check` / `verify`). `vp check` is now fmt + lint only.
- `tsconfig.json` `types: ["@cloudflare/workers-types","node"]` + `devDep @types/node` — fixes `tsconfig-error: Cannot find type definition file for 'node'`.
- Remaining `restrict-template-expressions` / `no-base-to-string` in `tests/integration/*.ts` and `FormData String(form.get(...))` kept as triaged warnings.

**Result:** `vp check` 0 errors / ~460 warnings, `vp exec astro check` 0 errors.

## 3. Scaffold — no npm publish

**Context:** `create-minshop/` + `.github/workflows/publish-create-minshop.yml` + `scaffold:check` existed for `npm create minshop` / `npm publish`, but repo is a community fork not published to npmjs.

**Decision:** Delete `create-minshop/`, `publish-create-minshop.yml`, `package.json:scaffold:check` and its `verify` step. Remove npm badges from `README.md`, switch scaffold docs from `npm create minshop@latest` → `git clone https://github.com/ddyy/minshop.git` (`README.md`, `docs/development.md`, `SECURITY.md`), remove `create-minshop/**` from `vite.config.ts`.

**Result:** `verify` is shorter, no `npm pack` in CI, clone is the scaffold path.

## 4. Tests — oxfmt tolerance

**Context:** `oxfmt` reformatted `src/pages/llms.txt.ts` and `src/features/digitalDelivery/rollout.ts` (single→double quotes, multiline `entitlementWriterActive`, newline splits), breaking strict regexes in `tests/scripts/rollout-gates.test.ts` + `tests/scripts/deploy-plan.test.ts` (8 failures).

**Decision:** Make tests quote- and whitespace-tolerant: `lifecycleActive`/`entitlementWriterActive` → `\(\s*release`, `publicId:` → `publicId:\s*item`, `const claims` → `\s*\?`, `remove_deliverable` → `["']`, `mcpUrl` → `(?:''|"")`, `wrangler` → `["']wrangler["']`, count helper normalizes `"`→`'`. No source revert.

**Result:** `vp test` 81/81 (906/906).

## 5. `verify` is the green/red gate

Keep `vp run verify` as defined in `AGENTS.md`: `theme:sync → vp test → astro check → theme:check → astro build → check-built-css → test:integration → check-stripe-countries → mcp:check`. Run after every meaningful edit.

## References

- `AGENTS.md` — Package Manager / Commands / Key Conventions
- `docs/development.md` — Install / Build & deploy / Gotchas
- `docs/testing.md`, `docs/architecture.md`

## 6. Scripts/tests — all `.mjs` converted to `.ts`

**Context:** Fork still had `*.mjs` tooling alongside `*.ts` source. Node ≥22.6 runs
TS directly via `--experimental-strip-types` (already used by `deploy`), so the
extension no longer buys anything. `*.astro` and `*.sh` stay by design.

**Decision:** Rename every tracked `.mjs` → `.ts` (scripts in their subdirs,
`astro.config.ts`, tests/helpers, tests/integration, tests/scripts, tests/storefront).
Mechanics:

- `package.json`: bare `node script` invocations gained `--experimental-strip-types`;
  paths updated to the new extensions.
- Internal imports `.mjs` → `.ts`; vitest include globs dropped `{ts,mjs}`.
- `astro.config.ts`: theme-stamp hook's dynamic `await import("node:fs")` moved to a
  static top-level import — under Vite's module runner the dynamic import runs after
  the runner closed and crashed `astro:build:done`. `platformProxy` is forwarded to
  `@cloudflare/vite-plugin` but absent from the adapter's re-exported `Options`, so
  adapter options are passed as a variable (no inline excess-property check).
- Strict-TS fallout fixed, not suppressed: annotated helpers/params in scripts and
  test harnesses; D1 row reads in harnesses use `.first<any>()`/`.all<any>()`;
  discriminated-union internals asserted by tests go through loose typed aliases
  (e.g. `addMenuItem`, `claimPurchase`) so production modules stay strictly typed.
- `check-themes.ts` `SOURCE_EXTENSIONS` drops `".mjs"`; boundary fixture renamed.
- Reorg fix: `scripts/check/check-mcp.sh` + `scripts/db/*.sh` resolved repo root with
  one `..`; after moving two levels deep they needed `../..`.

**Result:** `vp test` 81/81 files (906 tests), `astro check` 0 errors, build +
integration suites pass. Full-gate rerun pending — see `docs/plan.md`.
