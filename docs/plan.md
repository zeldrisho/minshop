# Plan

## Remain

All conversion work is code-complete; only the final green gate is outstanding.

- [ ] **Run `vp run verify` once, serially, to green.** Everything passes individually
      (unit 906/906, `astro check` 0 errors, build ok, all D1 integration suites,
      `mcp:check`) but a full-gate run was never completed because:
  1. Two `verify` runs overlapped and orphaned `wrangler dev` processes holding
     port `8791` (`d1-integration.sh` then fails with "Address already in use").
     Recovery: `pkill -9 -f workerd`, kill stray `wrangler ... --port 8791`
     processes, confirm `ss -tln | grep 8791` is empty, then re-run.
  2. `awk` was missing from the machine — installed `gawk` via linuxbrew.
- [ ] **Commit** the `.mjs → .ts` conversion (see Session notes below).

## Skip

- Converting `*.astro` templates and `*.sh` helpers to TS — framework/shell files,
  deliberately kept (`.astro` is Astro's required DSL; `.sh` orchestrates wrangler).
