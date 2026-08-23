import type { EmailProvider, EmailMessage } from "./provider";

/**
 * Creates an email provider that sends messages through the Resend API.
 *
 * @param apiKey - Resend API key used for authentication
 * @param from - Sender email address and optional display name
 * @returns An email provider configured to send from the specified address
 */
export function createResendEmail(
  apiKey: string,
  from: { email: string; name: string },
): EmailProvider {
  const fromHeader = from.name ? `${from.name} <${from.email}>` : from.email;
  return {
    async send(msg: EmailMessage): Promise<void> {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          // Resend dedupes on this for 24h — an outbox retry of an
          // already-delivered send becomes a no-op instead of a duplicate.
          ...(msg.idempotencyKey ? { "idempotency-key": msg.idempotencyKey } : {}),
        },
        body: JSON.stringify({
          from: fromHeader,
          to: [msg.to],
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`Resend send failed (${res.status}): ${detail}`);
      }
    },
  };
}
