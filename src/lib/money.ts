/**
 * Pure currency-scaling math — NO imports, so it's safe to use from unit-tested
 * code (e.g. parseProductForm) without pulling in the Cloudflare runtime.
 *
 * Money is stored as integer MINOR units (what Stripe uses): cents for USD/EUR,
 * whole yen for JPY, thousandths for BHD. The scale per currency comes from Intl's
 * ISO 4217 data, so nothing here hardcodes 100.
 *
 * NOTE: correct for display + storage across normal currencies, but a few
 * Stripe-specific quirks aren't captured — HUF/TWD/UGX charge as zero-decimal at
 * Stripe despite 2 ISO digits, and 3-decimal currencies must be rounded to
 * multiples of 10. Add an override map here if you ever sell in those.
 */

// `new Intl.NumberFormat` is expensive to construct, so cache one formatter per
// currency and reuse it (a product listing calls this once per item).
const priceFormatters = new Map<string, Intl.NumberFormat>();
const currencyDecimalsCache = new Map<string, number>();

/** Decimal places a currency uses (2 USD, 0 JPY, 3 BHD). */
export function currencyDecimals(currency: string): number {
  const code = currency.toUpperCase();
  const cached = currencyDecimalsCache.get(code);
  if (cached !== undefined) return cached;
  // Reuse the formatter cache when available to avoid constructing two
  // Intl.NumberFormat instances per call (one for decimals, one for formatting).
  const formatter = priceFormatters.get(code);
  let decimals: number;
  if (formatter !== undefined) {
    decimals = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  } else {
    try {
      decimals =
        new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: code,
        }).resolvedOptions().maximumFractionDigits ?? 2;
    } catch {
      decimals = 2;
    }
  }
  currencyDecimalsCache.set(code, decimals);
  return decimals;
}

/** Minor units per major unit (100 USD, 1 JPY, 1000 BHD). */
export function minorUnitsPerMajor(currency: string): number {
  return 10 ** currencyDecimals(currency);
}

/** Major-unit number → integer minor units (19.99 USD → 1999; 1000 JPY → 1000). */
export function toMinorUnits(major: number, currency: string): number {
  return Math.round(major * minorUnitsPerMajor(currency));
}

/** Integer minor units → major-unit number (1999 USD → 19.99; 1000 JPY → 1000). */
export function toMajorUnits(minor: number, currency: string): number {
  return minor / minorUnitsPerMajor(currency);
}

/**
 * Stripe diverges from ISO 4217 for a handful of currencies. Keep storage on
 * ISO scale (currencyDecimals) and convert only at the Stripe boundary.
 * - HUF, UGX, ISK: ISO 2, Stripe 0 (charge in whole units)
 * - BHD, JOD, KWD, OMR, TND: ISO 3, Stripe 2 (charge in hundredths, must be multiple of 10)
 * See https://docs.stripe.com/currencies#zero-decimal and 3-decimal handling.
 */
const STRIPE_ZERO_DECIMAL = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
  "HUF",
  "ISK",
  "TWD",
]);
const STRIPE_THREE_TO_TWO = new Set(["BHD", "JOD", "KWD", "OMR", "TND"]);

export function stripeCurrencyDecimals(currency: string): number {
  const code = currency.toUpperCase();
  if (STRIPE_ZERO_DECIMAL.has(code)) return 0;
  if (STRIPE_THREE_TO_TWO.has(code)) return 2;
  return currencyDecimals(currency);
}

/**
 * Convert stored ISO minor units to Stripe's expected unit_amount.
 * Storage stays ISO; only the adapter scales for Stripe's quirks.
 */
export function toStripeAmount(storedMinor: number, currency: string): number {
  const iso = currencyDecimals(currency);
  const stripe = stripeCurrencyDecimals(currency);
  if (iso === stripe) return storedMinor;
  // e.g. HUF ISO 2 → Stripe 0: 1999 (19.99) → 20; BHD ISO 3 → Stripe 2: 2500 (2.5) → 250
  const scale = 10 ** Math.abs(iso - stripe);
  return iso > stripe ? Math.round(storedMinor / scale) : storedMinor * scale;
}

/**
 * Format minor units for display, in an EXPLICIT currency.
 *
 * The currency is required on purpose. `config.formatPrice` defaults it to the
 * store's configured currency, which reads deployment vars — harmless in a
 * route, but it makes any caller binding-aware. Presentation builders take the
 * currency from their caller instead, so they stay pure and unit-testable.
 */
export function formatMoney(cents: number, currency: string): string {
  const code = currency.toUpperCase();
  let formatter = priceFormatters.get(code);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", { style: "currency", currency: code });
    priceFormatters.set(code, formatter);
  }
  return formatter.format(toMajorUnits(cents, currency));
}
