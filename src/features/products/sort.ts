// Whitelisted sort columns. The query param `sort` maps to a fixed column name
// here, so user input is never interpolated into SQL.
const COLUMNS: Record<string, string> = {
  newest: "created_at",
  created: "created_at",
  name: "name",
  price: "price_cents",
  stock: "stock",
  sold: "sold", // aggregate alias from listAllProducts (units sold, paid orders)
  active: "active",
  id: "id",
};

/**
 * Builds a safe SQL `ORDER BY` clause from whitelisted sort parameters.
 *
 * @param sort - The requested sort field.
 * @param dir - The requested sort direction.
 * @param fallback - The field and direction used when the requested values are invalid or absent.
 * @returns A SQL `ORDER BY` expression with deterministic ID tie-breaking.
 */
export function orderByClause(
  sort: string | null,
  dir: string | null,
  fallback: { col: string; dir: "ASC" | "DESC" } = { col: "created_at", dir: "DESC" },
): string {
  const col = (sort && COLUMNS[sort]) || fallback.col;
  const d =
    dir?.toLowerCase() === "asc" ? "ASC" : dir?.toLowerCase() === "desc" ? "DESC" : fallback.dir;
  const collate = col === "name" ? " COLLATE NOCASE" : ""; // case-insensitive name sort
  // Tiebreak on the unique id (same direction) so equal values still sort
  // deterministically AND flip with direction — e.g. products seeded with the same
  // created_at would otherwise look identical for "Newest" ascending vs descending.
  const tiebreak = col === "id" ? "" : `, id ${d}`;
  return `${col}${collate} ${d}${tiebreak}`;
}

/**
 * Preset storefront sort options (rendered as links). One entry per field — `dir`
 * is the DEFAULT direction applied when you first pick that field; clicking an
 * already-active field toggles it (the arrow flips), so a field never appears twice.
 */
export const STORE_SORTS: { sort: string; dir: "asc" | "desc"; label: string }[] = [
  { sort: "newest", dir: "desc", label: "Newest" },
  { sort: "price", dir: "asc", label: "Price" },
  { sort: "name", dir: "asc", label: "Name" },
];

export type StoreSort = "newest" | "price" | "name";

export interface StoreSortQuery {
  sort: StoreSort;
  dir: "asc" | "desc";
}

/**
 * Normalizes storefront sorting parameters to a supported sort field and direction.
 *
 * @param sort - The requested sort field; unsupported values default to `newest`
 * @param dir - The requested direction; only `asc` is preserved, and all other values become `desc`
 * @returns The normalized storefront sort field and direction
 */
export function parseStoreSortQuery(sort: string | null, dir: string | null): StoreSortQuery {
  const normalizedSort: StoreSort =
    sort === "price" || sort === "name" || sort === "newest" ? sort : "newest";
  const normalizedDir = dir?.toLowerCase() === "asc" ? "asc" : "desc";
  return { sort: normalizedSort, dir: normalizedDir };
}
