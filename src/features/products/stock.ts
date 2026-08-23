/** Low-stock threshold for the customer-facing "Low stock" bucket. */
export const LOW_STOCK = 5;

export type StockState = "out" | "low" | "in";
export type StockTransitionPurger = (publicIds: string[]) => Promise<void>;

/**
 * Classifies a stock quantity for display.
 *
 * @param stock - The available stock quantity
 * @returns `"out"` when stock is zero or less, `"low"` when stock is between 1 and `LOW_STOCK`, or `"in"` when stock exceeds `LOW_STOCK`
 */
export function stockState(stock: number): StockState {
  if (stock <= 0) return "out";
  if (stock <= LOW_STOCK) return "low";
  return "in";
}

/**
 * Determines whether the displayed stock status changed.
 *
 * @param hasVariant - Whether the product has variants
 * @param before - Stock quantity before the change
 * @param after - Stock quantity after the change
 * @returns `true` if the displayed availability or stock state changed, `false` otherwise.
 */
export function visibleStockChanged(hasVariant: boolean, before: number, after: number): boolean {
  return hasVariant ? before > 0 !== after > 0 : stockState(before) !== stockState(after);
}
