import { getConfig } from "../../config";
import type { Order } from "../orders/db";
import { orderReference } from "../orders/number";
import type { EmailMessage } from "./provider";
import { PALETTE, emailShell, emailButton, escapeHtml } from "./layout";

/**
 * Creates an email containing a replacement guest access link for an order.
 *
 * @param order - The order receiving the replacement link
 * @param storeName - The store name displayed in the email
 * @param guestOrderUrl - The replacement URL for accessing the order
 * @returns An email message addressed to the order's email address
 */
export function guestLinkReissueEmail(
  order: Order,
  storeName: string,
  guestOrderUrl: string,
): EmailMessage {
  const num = orderReference(order.public_id, order.id, getConfig().orderNumber);

  const text = [
    `Here is a fresh link to your ${storeName} order #${num}.`,
    ``,
    `Any links from earlier emails no longer work — use this one from now on:`,
    guestOrderUrl,
    ``,
    `If you didn't ask for a new link, you can ignore this email; the new link`,
    `still shows your order as usual.`,
  ].join("\n");

  const html = emailShell({
    storeName,
    heading: "Your new order link",
    subheading: `A fresh link for order #${escapeHtml(num)}.`,
    body:
      `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:${PALETTE.muted};">` +
      `Any links from earlier emails no longer work — use this one from now on.</p>` +
      emailButton(guestOrderUrl, "View your order"),
    footer: `If you didn't ask for a new link, you can ignore this email.`,
  });

  return {
    to: order.email!,
    subject: `Your new ${storeName} order link (#${num})`,
    html,
    text,
  };
}
