import { describe, expect, it } from "vite-plus/test";

// .mjs for the same reason as the sibling script tests: tsconfig's `types` is
// pinned to the Cloudflare types, so node builtins have no declarations here.
import { readdirSync, readFileSync } from "node:fs";

/**
 * `wrangler d1 migrations apply --remote` splits a migration file itself before
 * handing statements to the D1 HTTP API, and it finds a trigger's terminus by
 * scanning for `END;`. A trigger body containing its own `END;` — from a
 * `CASE WHEN … END`, or a nested `BEGIN … END` — is therefore cut short, and D1
 * rejects the remainder with "incomplete input: SQLITE_ERROR".
 *
 * Nothing local catches this: `--local` applies the file verbatim, and even
 * `wrangler d1 execute --remote --file` parses it correctly. Only the remote
 * migrations path fails, which means the first time you find out is against a
 * production database. Reproduced on wrangler 4.115.0 and 4.118.0.
 *
 * Use `SELECT RAISE(ABORT, '…') WHERE EXISTS (…);` instead of
 * `SELECT CASE WHEN EXISTS (…) THEN RAISE(ABORT, '…') END;`.
 */

const MIGRATIONS = new URL("../../migrations/", import.meta.url);

// A trigger spans from CREATE TRIGGER to its final column-zero END;. Finding
// the FIRST such marker instead of the last would let an inner `CASE … END`
// closed at column zero masquerade as the terminus — exactly the shape wrangler
// truncates on — so the close is always the LAST marker in the trigger's
// region, and everything between BEGIN and it is held to the no-END rule.
function triggerBodies(sql) {
  const starts = [...sql.matchAll(/CREATE TRIGGER/gi)];
  return starts.map((start, i) => {
    const region = sql.slice(start.index, i + 1 < starts.length ? starts[i + 1].index : undefined);
    const closes = [...region.matchAll(/\nEND;/gi)];
    if (closes.length === 0) return null;
    const finalClose = closes[closes.length - 1];
    return region.slice(0, finalClose.index).replace(/^[\s\S]*?\bBEGIN\b/i, "");
  });
}

describe("migrations survive wrangler --remote", () => {
  const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql"));

  it("has migrations to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  // Comments are NOT stripped before matching, deliberately: wrangler's splitter
  // does not strip them either, so a comment inside a trigger body that merely
  // mentions the close keyword truncates the trigger just as effectively as real
  // SQL would. An earlier draft of this test stripped comments and therefore
  // passed a migration that failed against the live database.
  it.each(files)("%s has no early trigger close, in SQL or comments", (name) => {
    const sql = readFileSync(new URL(name, MIGRATIONS), "utf8");
    for (const body of triggerBodies(sql)) {
      if (body === null) continue;
      expect(
        body,
        `${name}: a trigger body closes early — wrangler's remote migration ` +
          "splitter truncates there. Use SELECT RAISE(ABORT, …) WHERE EXISTS (…) " +
          "instead of CASE, and keep explanatory comments outside the body.",
      ).not.toMatch(/\bEND\s*;/i);
    }
  });

  it("detects an inner END; closed at column zero", () => {
    // Regression guard for the extraction above: a CASE closed at column zero
    // must be seen as body content, not swallowed as the trigger's terminus.
    const broken = [
      "CREATE TRIGGER t BEFORE INSERT ON items BEGIN",
      "SELECT CASE WHEN NEW.qty < 0 THEN RAISE(ABORT, 'negative')",
      "END;",
      "UPDATE items SET ok = 1;",
      "END;",
    ].join("\n");
    expect(triggerBodies(broken)[0]).toMatch(/\bEND\s*;/i);
  });
});
