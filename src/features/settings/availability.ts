import type { StoreSettings } from "./db";

export interface RuntimeCapabilities {
  vault: boolean;
  authSecret: boolean;
  images: boolean;
  emailBinding: boolean;
  ai: boolean;
  vectorize: boolean;
}

export interface SettingAvailability {
  available: boolean;
  reason?: string;
}

const hasSecret = (settings: StoreSettings, caps: RuntimeCapabilities, name: string): boolean =>
  caps.vault && settings.configuredSecrets.includes(name);

/**
 * Determines whether Stripe is configured for the store.
 *
 * @returns `true` if both the Stripe secret key and webhook secret are available, `false` otherwise.
 */
export function stripeConfigured(settings: StoreSettings, caps: RuntimeCapabilities): boolean {
  return (
    hasSecret(settings, caps, "stripe_secret_key") &&
    hasSecret(settings, caps, "stripe_webhook_secret")
  );
}

/**
 * Determines whether email delivery is configured for the store.
 *
 * @param settings - Store settings that control email availability and provider selection
 * @param caps - Runtime capabilities used to verify the selected email provider
 * @returns `true` if email is enabled and the selected provider is configured, `false` otherwise
 */
export function emailConfigured(settings: StoreSettings, caps: RuntimeCapabilities): boolean {
  if (!settings.emailEnabled) return false;
  return settings.emailProvider === "cloudflare"
    ? caps.emailBinding
    : hasSecret(settings, caps, "resend_api_key");
}

/**
 * Determines whether a store setting can be enabled with the available runtime configuration.
 *
 * @param key - The store setting to evaluate
 * @param settings - The store configuration used to check required integrations
 * @param caps - The runtime capabilities available to the store
 * @returns The setting's availability and, when unavailable, the reason it cannot be enabled
 */
export function featureAvailability(
  key: string,
  settings: StoreSettings,
  caps: RuntimeCapabilities,
): SettingAvailability {
  if (key === "discounts_enabled" || key === "tax_enabled") {
    return stripeConfigured(settings, caps)
      ? { available: true }
      : { available: false, reason: "Unavailable until Stripe is configured" };
  }
  if (key === "accounts_enabled") {
    if (!caps.authSecret) {
      return { available: false, reason: "Unavailable until AUTH_SECRET is set" };
    }
    if (!emailConfigured(settings, caps)) {
      return { available: false, reason: "Unavailable until email is enabled and configured" };
    }
  }
  if (key === "image_optimize" && !caps.images) {
    return { available: false, reason: "Unavailable until the IMAGES binding is added" };
  }
  return { available: true };
}

/**
 * Determines whether semantic search is available.
 *
 * @param caps - Runtime capabilities to evaluate
 * @returns `true` if both AI and Vectorize capabilities are available, `false` otherwise.
 */
export function semanticSearchAvailable(caps: RuntimeCapabilities): boolean {
  return caps.ai && caps.vectorize;
}

/**
 * Validates the URL and credential required to connect to a Lightning backend.
 *
 * @param backend - The Lightning backend to validate.
 * @param url - The backend's HTTP(S) URL.
 * @param hasCredential - Whether the required backend credential is configured.
 * @returns An error message when the configuration is invalid, or `null` when it is valid.
 */
export function lightningConfigurationError(
  backend: "lnbits" | "phoenixd",
  url: string,
  hasCredential: boolean,
): string | null {
  const label = backend === "lnbits" ? "LNbits" : "phoenixd";
  if (!url) return `Add the ${label} URL.`;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return `Enter a valid HTTP(S) URL for ${label}.`;
    }
  } catch {
    return `Enter a valid HTTP(S) URL for ${label}.`;
  }
  if (!hasCredential) {
    return backend === "lnbits" ? "Add the LNbits invoice/read key." : "Add the phoenixd password.";
  }
  return null;
}

/**
 * Determines whether Turnstile is configured for the store.
 *
 * @param settings - Store settings containing the Turnstile site key and configured secrets
 * @param caps - Runtime capabilities required to access secrets
 * @returns `true` if vault access, a Turnstile site key, and the Turnstile secret are available, `false` otherwise.
 */
export function turnstileConfigured(settings: StoreSettings, caps: RuntimeCapabilities): boolean {
  return (
    caps.vault &&
    !!settings.turnstileSiteKey &&
    settings.configuredSecrets.includes("turnstile_secret_key")
  );
}
