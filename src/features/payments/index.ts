import { env } from "cloudflare:workers";
import type { PaymentProvider } from "./provider";
import type { StoreSettings } from "../settings/db";
import { getStoreSettings } from "../settings/db";
import { createStripeProvider } from "./stripe";
import { createLightningProvider } from "./lightning-provider";
import { getLightningBackend } from "./lightning";
import { createOpenNodeProvider } from "./opennode";
import { createDemoProvider } from "./demo";
import { getSecret, vaultReady } from "../secrets/store";

export type { PaymentProvider } from "./provider";
export {
  STRIPE_CHECKOUT_TTL_SECONDS,
  OPENNODE_CHECKOUT_TTL_SECONDS,
  RESERVATION_EXPIRY_GRACE_SECONDS,
} from "./provider";
export { DEMO_CHECKOUT_TTL_SECONDS } from "./demo";

// 'demo' is a first-class method — a simulated checkout that's ALWAYS offered
// (records a real, demo-tagged order). The real rails work only when configured.
export type PaymentMethod = "stripe" | "lightning" | "opennode" | "demo";
const ALL_METHODS: PaymentMethod[] = ["stripe", "lightning", "opennode"];
// The buttons always presented at checkout. Each real rail works if configured,
// else its button leads to setup instructions; demo always works.
const OFFERED: PaymentMethod[] = ["stripe", "lightning", "demo"];

/**
 * Determines whether a value identifies a supported payment method.
 *
 * @param value - The value to evaluate
 * @returns `true` if the value is a supported payment method, `false` otherwise.
 */
export function isPaymentMethod(value: string): value is PaymentMethod {
  return value === "stripe" || value === "lightning" || value === "opennode" || value === "demo";
}

/**
 * Determines whether a payment method is configured and ready for use.
 *
 * @param method - The payment method to check
 * @param settings - Store payment and Lightning configuration
 * @returns `true` if the method is available for processing payments, `false` otherwise
 */
export function isMethodAvailable(
  method: PaymentMethod,
  settings: StoreSettings,
  vault = vaultReady(),
): boolean {
  const has = (name: string) => vault && settings.configuredSecrets.includes(name);
  switch (method) {
    case "stripe":
      return has("stripe_secret_key") && has("stripe_webhook_secret");
    case "opennode":
      return has("opennode_api_key");
    case "lightning":
      return settings.lightningBackend === "lnbits"
        ? !!settings.lnbitsUrl && has("lnbits_api_key")
        : !!settings.phoenixdUrl && has("phoenixd_password");
    case "demo":
      return true; // demo is always usable
  }
}

/** True when at least one REAL payment rail is configured (demo doesn't count). */
export function hasRealMethod(settings: StoreSettings, vault = vaultReady()): boolean {
  return ALL_METHODS.some((m) => isMethodAvailable(m, settings, vault));
}

/** No real rail configured: only the demo method can take a payment. */
export function paymentsInDemoMode(settings: StoreSettings, vault = vaultReady()): boolean {
  return !hasRealMethod(settings, vault);
}

/** The store's default rail (Settings → Payments; default 'stripe'). */
export function defaultMethod(settings: StoreSettings): PaymentMethod {
  return settings.paymentProvider;
}

/**
 * Lists the payment methods currently configured and enabled for checkout, with the default method prioritized.
 *
 * @param settings - Store payment configuration, including the default and disabled methods
 * @returns The available payment methods in checkout order; may be empty if all methods are disabled
 */
export function enabledMethods(settings: StoreSettings, vault = vaultReady()): PaymentMethod[] {
  const off = new Set(settings.disabledPaymentMethods);
  const def = defaultMethod(settings);
  const orderedReal = def === "demo" ? ALL_METHODS : [def, ...ALL_METHODS.filter((m) => m !== def)];
  const real = orderedReal
    .filter((m): m is Exclude<PaymentMethod, "demo"> => m !== "demo")
    .filter((m) => isMethodAvailable(m, settings, vault))
    .filter((m) => !off.has(m));
  if (off.has("demo")) return real;
  return def === "demo" ? ["demo", ...real] : [...real, "demo"];
}

/**
 * Determines which payment methods the checkout interface should offer.
 *
 * Includes setup links for unconfigured Stripe and Lightning methods, configured
 * additional payment methods, and the demo method, excluding administrator-disabled
 * methods.
 *
 * @param settings - Store payment settings and disabled-method configuration
 * @returns The payment methods available for display, which may be empty
 */
export function offeredMethods(settings: StoreSettings, vault = vaultReady()): PaymentMethod[] {
  const off = new Set(settings.disabledPaymentMethods);
  const extra = ALL_METHODS.filter(
    (m) => !OFFERED.includes(m) && isMethodAvailable(m, settings, vault),
  );
  return (["stripe", "lightning", ...extra, "demo"] as PaymentMethod[]).filter((m) => !off.has(m));
}

/**
 * Creates the payment provider selected for the store or by the caller.
 *
 * @param method - The payment method to create; when omitted, the store's configured default is used.
 * @returns The configured payment provider.
 * @throws Error if the selected OpenNode or Stripe provider lacks required credentials.
 */
export async function getPaymentProvider(method?: PaymentMethod): Promise<PaymentProvider> {
  const settings = await getStoreSettings(env.DB);
  const m = method ?? settings.paymentProvider;
  if (m === "demo") return createDemoProvider(env.DB);
  switch (m) {
    case "lightning":
      // Self-hosted Lightning (phoenixd / LNbits) behind a self-rendered pay page.
      return createLightningProvider(env.DB, await getLightningBackend());
    case "opennode": {
      const key = await getSecret(env.DB, "opennode_api_key");
      if (!key) throw new Error("OpenNode is not configured.");
      return createOpenNodeProvider(env.DB, key, settings.opennodeApiUrl ?? undefined);
    }
    case "stripe":
    default: {
      const secretKey = await getSecret(env.DB, "stripe_secret_key");
      const webhookSecret = await getSecret(env.DB, "stripe_webhook_secret");
      if (!secretKey || !webhookSecret) throw new Error("Stripe is not fully configured.");
      return createStripeProvider(secretKey, webhookSecret);
    }
  }
}
