import { env } from "cloudflare:workers";
import { getOrder } from "../orders/db";
import { getEmailProvider } from "../email";
import { orderRefundedEmail } from "../email/orderConfirmation";
import { guestOrderUrl } from "../orders/guestAccess.ts";
import { shouldSendCustomerOrderEmail } from "../email/orderPolicy";
import { getConfig } from "../../config";
import { getSetting } from "../settings/db";

/**
 * Sends a customer email for a positive refund amount.
 *
 * @param orderId - The order receiving the refund
 * @param deltaCents - The newly refunded amount in cents
 * @param origin - The origin used to generate the guest order URL
 */
export async function sendRefundNotice(
  orderId: number,
  deltaCents: number,
  origin: string,
): Promise<void> {
  if (deltaCents <= 0) return;
  const order = await getOrder(env.DB, orderId);
  if (!order?.email) return;
  if (!shouldSendCustomerOrderEmail(order.payment_method)) return;
  const emailer = await getEmailProvider();
  if (!emailer) return;
  try {
    const storeName = (await getSetting(env.DB, "store_name")) || getConfig().storeName;
    await emailer.send(
      orderRefundedEmail(
        order,
        deltaCents,
        order.refunded_cents,
        storeName,
        await guestOrderUrl(env.DB, order.public_id, origin),
      ),
    );
  } catch (err) {
    console.error("Refund email failed:", err);
  }
}
