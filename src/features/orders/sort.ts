// Whitelisted sort columns for the orders admin table. The query param maps to a
// fixed column here, so user input never reaches SQL.
const COLUMNS: Record<string, string> = {
  order: "id",
  id: "id",
  email: "email",
  total: "amount_total_cents",
  status: "status",
  fulfillment: "fulfillment_status",
  when: "created_at",
  created: "created_at",
};

/**
 * Builds a safe SQL `ORDER BY` clause for orders.
 *
 * @param sort - The user-facing sort key
 * @param dir - The requested sort direction
 * @returns An `ORDER BY` fragment with a deterministic `id` tiebreaker
 */
export function orderByClause(sort: string | null, dir: string | null): string {
  const col = (sort && COLUMNS[sort]) || "created_at";
  const d = dir?.toLowerCase() === "asc" ? "ASC" : dir?.toLowerCase() === "desc" ? "DESC" : "DESC";
  const collate = col === "email" ? " COLLATE NOCASE" : "";
  // Tiebreak on the unique id (same direction) so low-cardinality columns (status,
  // fulfillment) or equal timestamps still sort deterministically AND flip asc/desc.
  const tiebreak = col === "id" ? "" : `, id ${d}`;
  return `${col}${collate} ${d}${tiebreak}`;
}
