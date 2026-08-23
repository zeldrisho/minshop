/** Supported carriers for fulfillment tracking. */
export const CARRIERS = [
  { code: "usps", name: "USPS" },
  { code: "ups", name: "UPS" },
  { code: "fedex", name: "FedEx" },
  { code: "dhl", name: "DHL" },
  { code: "other", name: "Other" },
] as const;

/**
 * Resolves a carrier code to its display name.
 *
 * @param code - The carrier code to resolve
 * @returns The carrier's display name, the original code when no carrier matches, or `"—"` when `code` is null
 */
export function carrierName(code: string | null): string {
  return CARRIERS.find((c) => c.code === code)?.name ?? code ?? "—";
}

/**
 * Builds a public tracking URL for a supported carrier and tracking number.
 *
 * @param carrier - The carrier code.
 * @param number - The tracking number.
 * @returns The URL-encoded tracking URL, or `null` when the carrier or number is missing or the carrier is not linkable.
 */
export function trackingUrl(carrier: string | null, number: string | null): string | null {
  if (!carrier || !number) return null;
  const n = encodeURIComponent(number);
  switch (carrier) {
    case "usps":
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`;
    case "ups":
      return `https://www.ups.com/track?tracknum=${n}`;
    case "fedex":
      return `https://www.fedex.com/fedextrack/?trknbr=${n}`;
    case "dhl":
      return `https://www.dhl.com/en/express/tracking.html?AWB=${n}`;
    default:
      return null; // 'other' / unknown — show the number without a link
  }
}
