import type { D1Database } from "@cloudflare/workers-types";
import type {
  PaymentProvider,
  CreateCheckoutParams,
  CheckoutResult,
  WebhookResult,
} from "./provider";
import type { ShippingAddress } from "../orders/db";
import type { LightningBackend } from "./lightning/backend";
import { getBtcRate, fiatCentsToSats } from "./lightning/rate";
import { createPendingPayment, getPendingByHash, pendingToPaidOrder } from "./lightning/pending";
import { getConfig } from "../../config";

export interface MintLightningOrderInput {
  origin: string;
  publicId: string;
  /** Guest access token — addresses the customer-facing /pay URL. */
  accessToken?: string | null;
  currency: string;
  subtotalCents: number;
  shippingCents?: number;
  shippingLabel?: string | null;
  shippingWeightGrams?: number | null;
  deliveryMethod?: "pickup" | "shipping" | null;
  /** Pre-serialized JSON cart snapshot: [{ id, q, n, p }]. */
  itemsJson?: string | null;
  email?: string | null;
  shippingAddress?: ShippingAddress | null;
  reservationId?: string | null;
}

/**
 * Creates a Lightning invoice for an order and records it as a pending payment.
 *
 * @param input - Order, pricing, customer, shipping, and reservation data used to create the invoice
 * @returns The customer payment URL, BOLT11 invoice, amount in satoshis, payment hash, and expiration timestamp
 */
export async function mintLightningOrder(
  db: D1Database,
  backend: LightningBackend,
  input: MintLightningOrderInput,
): Promise<{
  payUrl: string;
  bolt11: string;
  amountSat: number;
  paymentHash: string;
  expiresAt: string;
}> {
  const cfg = getConfig();
  const ln = cfg.payments.lightning;
  const shippingCents = input.shippingCents ?? 0;
  const totalCents = input.subtotalCents + shippingCents;

  const fiatPerBtc = await getBtcRate(input.currency, ln.rateUrl);
  const amountSat = fiatCentsToSats(totalCents, fiatPerBtc, input.currency);
  const expirySeconds = ln.invoiceExpiryMinutes * 60;

  const invoice = await backend.createInvoice({
    amountSat,
    description: `${cfg.storeName} — order ${input.publicId.slice(0, 8)}`,
    externalId: input.publicId,
    expirySeconds,
    // Per-provider path so Lightning settlements route to the Lightning verifier
    // even when another rail (e.g. Stripe) owns the default /api/webhook.
    webhookUrl: `${input.origin}/api/webhook/lightning`,
  });

  const expiresAt = new Date(Date.now() + expirySeconds * 1000).toISOString();
  await createPendingPayment(db, {
    publicId: input.publicId,
    paymentHash: invoice.paymentHash,
    backend: backend.name,
    bolt11: invoice.bolt11,
    amountSat,
    amountTotalCents: totalCents,
    currency: input.currency,
    email: input.email ?? null,
    itemsJson: input.itemsJson ?? null,
    shippingCents,
    shippingLabel: input.shippingLabel ?? null,
    shippingWeightGrams: input.shippingWeightGrams ?? null,
    deliveryMethod: input.deliveryMethod ?? null,
    shipAddressJson: input.shippingAddress ? JSON.stringify(input.shippingAddress) : null,
    reservationId: input.reservationId ?? null,
    expiresAt,
  });

  return {
    payUrl: `${input.origin}/pay/${input.accessToken ?? input.publicId}`,
    bolt11: invoice.bolt11,
    amountSat,
    paymentHash: invoice.paymentHash,
    expiresAt,
  };
}

/**
 * Creates a payment provider for Lightning checkout and payment verification.
 *
 * @returns A Lightning payment provider with checkout creation and webhook verification support.
 */
export function createLightningProvider(
  db: D1Database,
  backend: LightningBackend,
): PaymentProvider {
  return {
    async createCheckout(params: CreateCheckoutParams): Promise<CheckoutResult> {
      const cfg = getConfig();
      const currency = params.lineItems[0]?.currency ?? cfg.currency;
      const subtotalCents = params.lineItems.reduce((s, l) => s + l.amountCents * l.quantity, 0);
      const publicId = params.metadata?.public_id ?? crypto.randomUUID();
      const origin = new URL(params.successUrl).origin;

      const minted = await mintLightningOrder(db, backend, {
        origin,
        publicId,
        accessToken: params.accessToken ?? null,
        currency,
        subtotalCents,
        itemsJson: params.orderItemsJson ?? null,
        reservationId: params.metadata?.reservation_id ?? null,
      });
      return {
        url: minted.payUrl,
        lightning: {
          invoice: minted.bolt11,
          amountSat: minted.amountSat,
          paymentHash: minted.paymentHash,
          expiresAt: minted.expiresAt,
        },
      };
    },

    async verifyWebhook(payload: string, headers: Headers): Promise<WebhookResult> {
      const evt = await backend.verifyWebhook(payload, headers);
      // The webhook is an untrusted nudge — re-poll the node for the truth.
      const status = await backend.getIncoming(evt.paymentHash);
      if (!status.paid) return { type: "lightning.unconfirmed" };

      const pending = await getPendingByHash(db, evt.paymentHash);
      if (!pending) return { type: "lightning.unknown" };
      return {
        type: "lightning.paid",
        settlePendingPaymentId: evt.paymentHash,
        order: pendingToPaidOrder(pending),
      };
    },
    // No refund: Lightning payments can't be reversed in place.
  };
}
