import { env } from "cloudflare:workers";
import { getConfig } from "../../config";
import { getStoreSettings, type StoreSettings } from "../settings/db";
import { getSecret } from "../secrets/store";
import type { EmailProvider } from "./provider";
import { createCloudflareEmail } from "./cloudflare";
import { createResendEmail } from "./resend";

export type { EmailProvider, EmailMessage } from "./provider";

/**
 * Creates the configured email provider when email is available.
 *
 * @param settings - Optional store settings to use instead of loading them from D1
 * @returns The configured email provider, or `null` when email is disabled or unavailable
 */
export async function getEmailProvider(settings?: StoreSettings): Promise<EmailProvider | null> {
  const s = settings ?? (await getStoreSettings(env.DB));
  if (!s.emailEnabled) return null;

  const cfg = getConfig().email;
  // Sender display name: explicit from-name → runtime store name → build-time default.
  const from = {
    email: s.emailFrom ?? cfg.from,
    name: s.emailFromName ?? s.storeName ?? cfg.fromName,
  };

  if (s.emailProvider === "resend") {
    const apiKey = await getSecret(env.DB, "resend_api_key");
    if (!apiKey) return null;
    return createResendEmail(apiKey, from);
  }

  // 'cloudflare' — the send_email binding (Workers Paid plan).
  const binding = env.EMAIL;
  if (!binding) return null;
  return createCloudflareEmail(binding, from);
}
