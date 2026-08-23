# Plan

## Remain

- [ ] Fix 2 failing `vp test` suites (`test/scripts/rollout-gates.test.mjs` + 1 storefront) — `oxfmt` reformatted `src/pages/llms.txt.ts` whitespace so regex `const mcpUrl = (env.MCP_URL ?? ''` mismatches; update expectation or revert formatting
- [ ] Address `vp check` lint gate (16 errors, 78 warnings): `TS2307` `#theme/*.astro` aliases, `restrict-template-expressions` in `test/integration/refunds.mjs`, `unicorn/no-new-array`, `eslint/no-unused-vars` `readdirSync` etc. — triage or add `oxlint` overrides
- [ ] Decide on ESLint/Prettier migration — no configs existed, so none deleted; run `@oxlint/migrate` / `oxfmt --migrate=prettier` only if desired
- [ ] Optionally convert `mcp/` to pnpm (still `npm` + `package-lock.json`) for single PM, or keep standalone
- [ ] Verify `pnpm` is not global (`which pnpm` should fail, `vp` downloads pnpm 10.25.0 via `devEngines.packageManager.onFail: download`)

## Skip

- 2. skipped

## Maybe

- Remove `create-minshop/` and `.github/workflows/publish-create-minshop.yml` — not publishing to npmjs. If removed, also delete `scaffold:check` from `package.json:scripts.verify`.
