import type { D1Database } from "@cloudflare/workers-types";
import type { MenuItem, MenuLocation, MenuTargetType } from "./db.ts";

/**
 * How many options a picker offers before the merchant has to search.
 *
 * Sized so most stores never hit it: below this the whole list is in the page
 * and filtering is instant and complete client-side. Past it, filtering has to
 * go back to the server, because a client-side filter over a truncated list
 * would confidently report 'no matches' for a product that exists just beyond
 * the cap.
 */
export const PICKER_LIMIT = 50;

export interface TargetOption {
  id: number;
  /** Prefixed public ID — what the admin picker submits; null only pre-backfill. */
  public_id: string | null;
  name: string;
}

export interface TargetChoices {
  options: TargetOption[];
  /** Matches beyond PICKER_LIMIT, so the UI can say "refine your search". */
  remaining: number;
}

/**
 * Finds available navigation targets matching a search query.
 *
 * @param targetType - The type of target to search
 * @param query - The search text used to match target names
 * @returns The matching target options and the number of additional matches beyond the result limit
 */
export async function targetChoices(
  db: D1Database,
  targetType: MenuTargetType,
  query: string,
): Promise<TargetChoices> {
  const sources: Partial<Record<MenuTargetType, { table: string; name: string; where: string }>> = {
    page: { table: "pages", name: "title", where: "published = 1" },
    product: { table: "products", name: "name", where: "active = 1" },
    category: { table: "categories", name: "name", where: "1 = 1" },
  };
  const source = sources[targetType];
  if (!source) return { options: [], remaining: 0 };

  const q = query.trim();
  // LIKE with a short, merchant-supplied pattern only. D1 rejects long patterns
  // outright ("LIKE or GLOB pattern too complex"), so the search term is bounded.
  const filter = q ? `AND ${source.name} LIKE ?1` : "";
  const pattern = `%${q.slice(0, 60)}%`;

  const listSql = `SELECT id, public_id, ${source.name} AS name FROM ${source.table}
                    WHERE ${source.where} ${filter}
                    ORDER BY ${source.name} COLLATE NOCASE, id
                    LIMIT ${PICKER_LIMIT}`;
  const countSql = `SELECT COUNT(*) AS c FROM ${source.table}
                     WHERE ${source.where} ${filter}`;

  const [list, count] = await db.batch<Record<string, unknown>>([
    q ? db.prepare(listSql).bind(pattern) : db.prepare(listSql),
    q ? db.prepare(countSql).bind(pattern) : db.prepare(countSql),
  ]);

  const options = (list.results ?? []) as unknown as TargetOption[];
  const total = Number((count.results?.[0] as { c?: number } | undefined)?.c ?? 0);
  return { options, remaining: Math.max(0, total - options.length) };
}

/**
 * Explains why a menu item is unavailable on the storefront.
 *
 * @param item - The menu item to evaluate
 * @returns The unavailability reason, or `null` when the item is available
 */
export function unavailableReason(item: MenuItem): string | null {
  if (item.available) return null;
  // targetExists, not an empty label: a custom label outlives its target, so a
  // deleted page labelled "Company" still renders text and would otherwise be
  // reported as a draft — sending the merchant to un-draft a page that is gone.
  if (!item.targetExists) return "Target no longer exists";
  switch (item.targetType) {
    case "page":
      return "Draft — hidden on the storefront";
    case "product":
      return "Inactive — hidden on the storefront";
    case "category":
      return "Target no longer exists";
    default:
      return "Unavailable";
  }
}

/**
 * Finds menu locations that reference each target ID.
 *
 * @param targetType - The type of targets to search for
 * @param ids - The target IDs to look up
 * @returns A map from each referenced target ID to its unique menu locations
 */
export async function menuReferencesFor(
  db: D1Database,
  targetType: MenuTargetType,
  ids: number[],
): Promise<Map<number, MenuLocation[]>> {
  const found = new Map<number, MenuLocation[]>();
  if (ids.length === 0) return found;

  const CHUNK = 90; // under D1's 100-parameter ceiling, with room for target_type
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => "?").join(", ");
    const { results } = await db
      .prepare(
        `SELECT DISTINCT target_id, location FROM menu_items
          WHERE target_type = ? AND target_id IN (${placeholders})`,
      )
      .bind(targetType, ...chunk)
      .all<{ target_id: number; location: MenuLocation }>();
    for (const row of results ?? []) {
      const list = found.get(row.target_id) ?? [];
      if (!list.includes(row.location)) list.push(row.location);
      found.set(row.target_id, list);
    }
  }
  return found;
}

export const TARGET_TYPE_LABELS: Record<MenuTargetType, string> = {
  home: "Home",
  catalog: "Catalog",
  page: "Page",
  product: "Product",
  category: "Category",
};
