import { publicIdToken } from "../ids/publicId.ts";

export interface OrderNumberConfig {
  offset: number;
  step: number;
  randomStep: number;
}

/**
 * Computes a deterministic customer-facing order number from an internal order ID.
 *
 * @param id - The internal order ID.
 * @param cfg - Configuration defining the starting offset, spacing, and optional jitter range.
 * @returns The calculated customer-facing order number.
 */
export function orderNumber(id: number, cfg: OrderNumberConfig): number {
  const jitter = cfg.randomStep > 0 ? (Math.imul(id, 2654435761) >>> 0) % (cfg.randomStep + 1) : 0;
  return cfg.offset + (id - 1) * cfg.step + jitter;
}

/**
 * Generates the public reference for an order.
 *
 * @param publicId - The public identifier used to derive the order token
 * @param id - The order's numeric identifier
 * @param cfg - Configuration for calculating the fallback order number
 * @returns A public order token when `publicId` is available; otherwise, the calculated order number as a string
 */
export function orderReference(
  publicId: string | null,
  id: number,
  cfg: OrderNumberConfig,
): string {
  return publicIdToken(publicId ?? "", "order") ?? String(orderNumber(id, cfg));
}
