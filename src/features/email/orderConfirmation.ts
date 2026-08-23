import { formatPrice, getConfig } from "../../config";
import type { Order, OrderItemWithImage, ShippingAddress } from "../orders/db";
import { orderReference } from "../orders/number";
import { productEmailImageUrl, type ImageDelivery } from "../products/image";
import { carrierName, trackingUrl } from "../orders/tracking";
import type { EmailMessage } from "./provider";
import {
  PALETTE,
  emailShell,
  emailButton,
  emailLabel,
  emailItemsTable,
  escapeHtml,
  type TotalRow,
} from "./layout";

/** A 48px product thumbnail cell (absolute URL so email clients can fetch it).
 *  `new URL` resolves both an absolute image base (R2 domain) and the relative
 *  /images route against the site origin. */
const thumbCell = (
  imageKey: string | null,
  baseUrl: string,
  imageDelivery: ImageDelivery,
): string => {
  const src = productEmailImageUrl(imageKey, baseUrl, getConfig().images.baseUrl, imageDelivery);
  return `<td style="width:60px;padding:10px 0;border-bottom:1px solid ${PALETTE.line};"><img src="${escapeHtml(src)}" width="48" height="48" alt="" style="display:block;border-radius:4px;object-fit:cover;background:${PALETTE.paper};" /></td>`;
};

/**
 * Builds receipt rows for shipping, discounts, tax, and the order total.
 *
 * @param money - Formats an amount in cents for display
 * @returns Receipt rows in display order, omitting zero-valued optional charges
 */
function totalRows(order: Order, money: (cents: number) => string): TotalRow[] {
  return [
    ...(order.shipping_cents > 0
      ? [{ label: "Shipping", amount: money(order.shipping_cents) }]
      : []),
    ...(order.discount_cents > 0
      ? [{ label: "Discount", amount: `&minus;${money(order.discount_cents)}` }]
      : []),
    ...(order.tax_cents > 0 ? [{ label: "Tax", amount: money(order.tax_cents) }] : []),
    { label: "Total", amount: money(order.amount_total_cents), strong: true },
  ];
}

/** One-line-per-field shipping address, blank lines dropped. */
function formatShipAddress(order: Order): string {
  if (!order.ship_address) return "-";
  const a = JSON.parse(order.ship_address) as ShippingAddress;
  return [
    a.name,
    a.line1,
    a.line2,
    [a.city, a.state, a.postal].filter(Boolean).join(", "),
    a.country,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Creates a paid-order confirmation email with item details, charges, totals, and optional order or download links.
 *
 * @param guestOrderUrl - Tokenized guest link for viewing the order; omit or set to `null` to exclude the link.
 * @returns The order-confirmation email message addressed to the customer
 */
export function orderConfirmationEmail(
  order: Order,
  items: OrderItemWithImage[],
  baseUrl: string,
  storeName: string,
  imageDelivery: ImageDelivery = "original",
  /** Tokenized guest link (allowlisted email position); null = omit the link. */
  guestOrderUrl?: string | null,
): EmailMessage {
  const cfg = getConfig();
  const num = orderReference(order.public_id, order.id, cfg.orderNumber);
  const money = (cents: number) => formatPrice(cents, order.currency);
  const orderUrl = guestOrderUrl ?? null;
  const hasDigital = items.some((item) => Boolean(item.file_key));

  const rows = items.map(
    (it) => `${it.name} × ${it.quantity}: ${money(it.price_cents * it.quantity)}`,
  );

  const text = [
    `Thanks for your order!`,
    ``,
    `Order #${num}, ${storeName}`,
    ``,
    ...rows,
    ...(order.shipping_cents > 0 ? [`Shipping: ${money(order.shipping_cents)}`] : []),
    ...(order.discount_cents > 0 ? [`Discount: -${money(order.discount_cents)}`] : []),
    ...(order.tax_cents > 0 ? [`Tax: ${money(order.tax_cents)}`] : []),
    `Total: ${money(order.amount_total_cents)}`,
    ...(hasDigital && orderUrl ? [``, `Your download is ready.`] : []),
    ...(orderUrl ? [``, `View your order: ${orderUrl}`] : []),
  ].join("\n");

  const html = emailShell({
    storeName,
    heading: "Thanks for your order",
    subheading: `Order #${num} is confirmed. We'll email you again when it ships.`,
    body:
      emailItemsTable(
        items.map((it) => ({
          thumb: thumbCell(it.image_key, baseUrl, imageDelivery),
          name: it.name,
          quantity: it.quantity,
          amount: money(it.price_cents * it.quantity),
        })),
        totalRows(order, money),
      ) +
      (hasDigital && orderUrl
        ? `<p style="margin:20px 0 0;font-size:14px;">Your download is ready.</p>`
        : "") +
      (orderUrl ? emailButton(orderUrl, "View your order") : ""),
    footer: `Questions about this order? Just reply to this email.`,
  });

  return {
    to: order.email!,
    subject: `Your ${storeName} order #${num}`,
    html,
    text,
  };
}

/**
 * Builds a store-owner notification containing the new order details and an admin link.
 *
 * @param order - The order to include in the notification
 * @param items - The products included in the order
 * @param to - The store owner's email address
 * @param baseUrl - The site origin used to construct the admin order link
 * @param storeName - The store name included in the email
 * @param imageDelivery - The configured product image delivery mode
 * @returns The store-owner order notification email
 */
export function orderNotificationEmail(
  order: Order,
  items: OrderItemWithImage[],
  to: string,
  baseUrl: string,
  storeName: string,
  imageDelivery: ImageDelivery = "original",
): EmailMessage {
  const publicId = order.public_id ?? "—";
  // ASCII hyphen on purpose: a non-ASCII char anywhere in a header forces RFC
  // 2047 encoded-words, which read as "=?utf-8?b?...?=" in raw logs. The em
  // dashes in the BODY are fine — bodies declare their charset.
  const subjectPublicId = order.public_id ? ` - ${order.public_id}` : "";
  const money = (cents: number) => formatPrice(cents, order.currency);
  const shipText = formatShipAddress(order);
  const adminUrl = `${baseUrl}/admin/orders/${order.public_id ?? order.id}`;

  const rows = items.map(
    (it) => `${it.name} × ${it.quantity}: ${money(it.price_cents * it.quantity)}`,
  );

  const text = [
    `New order #${order.id}`,
    `Public ID: ${publicId}`,
    ``,
    `Customer: ${order.email ?? "-"}`,
    ``,
    `Ship to:`,
    shipText,
    ``,
    ...rows,
    ...(order.shipping_cents > 0 ? [`Shipping: ${money(order.shipping_cents)}`] : []),
    ...(order.discount_cents > 0 ? [`Discount: -${money(order.discount_cents)}`] : []),
    ...(order.tax_cents > 0 ? [`Tax: ${money(order.tax_cents)}`] : []),
    `Total: ${money(order.amount_total_cents)}`,
    ``,
    `View in admin: ${adminUrl}`,
  ].join("\n");

  const html = emailShell({
    storeName,
    heading: `New order #${order.id}`,
    subheading: `${money(order.amount_total_cents)} from ${escapeHtml(order.email ?? "an unknown address")}`,
    body:
      emailLabel("Order identifiers") +
      `<p style="margin:0;font-size:14px;line-height:1.6;">Order #${order.id}<br><span style="font-family:monospace;">${escapeHtml(publicId)}</span></p>` +
      emailLabel("Ship to") +
      `<p style="margin:0;font-size:14px;line-height:1.6;">${escapeHtml(shipText).replace(/\n/g, "<br>")}</p>` +
      emailItemsTable(
        items.map((it) => ({
          thumb: thumbCell(it.image_key, baseUrl, imageDelivery),
          name: it.name,
          quantity: it.quantity,
          amount: money(it.price_cents * it.quantity),
        })),
        totalRows(order, money),
      ) +
      emailButton(adminUrl, "View in admin"),
  });

  return {
    to,
    subject: `New ${storeName} order #${order.id}${subjectPublicId}`,
    html,
    text,
  };
}

/**
 * Builds a shipment notification email for an order.
 *
 * @param order - The shipped order, including its recipient email address
 * @param storeName - The store name displayed in the email
 * @param guestOrderUrl - Optional tokenized URL for viewing the order
 * @returns The shipment notification email message
 */
export function orderShippedEmail(
  order: Order,
  storeName: string,
  /** Tokenized guest link (allowlisted email position); null = omit the link. */
  guestOrderUrl?: string | null,
): EmailMessage {
  const cfg = getConfig();
  const num = orderReference(order.public_id, order.id, cfg.orderNumber);
  const url = trackingUrl(order.tracking_carrier, order.tracking_number);
  const orderUrl = guestOrderUrl ?? null;

  const text = [
    `Your order #${num} has shipped!`,
    ...(order.tracking_number
      ? [
          ``,
          `Carrier: ${carrierName(order.tracking_carrier)}`,
          `Tracking: ${order.tracking_number}`,
          ...(url ? [`Track it: ${url}`] : []),
        ]
      : []),
    ...(orderUrl ? [``, `View your order: ${orderUrl}`] : []),
  ].join("\n");

  const trackingHtml = order.tracking_number
    ? emailLabel("Tracking") +
      `<p style="margin:0;font-size:14px;line-height:1.6;">
        ${escapeHtml(carrierName(order.tracking_carrier))}<br>
        ${
          url
            ? `<a href="${url}" style="color:${PALETTE.brand};font-weight:600;">${escapeHtml(order.tracking_number)}</a>`
            : escapeHtml(order.tracking_number)
        }
      </p>`
    : "";

  const html = emailShell({
    storeName,
    heading: "Your order is on its way",
    subheading: `Order #${num} shipped.`,
    body:
      trackingHtml +
      (url
        ? emailButton(url, "Track your package")
        : orderUrl
          ? emailButton(orderUrl, "View your order")
          : ""),
    footer:
      orderUrl && url
        ? `Order details: <a href="${orderUrl}" style="color:${PALETTE.muted};">${orderUrl}</a>`
        : undefined,
  });

  return {
    to: order.email!,
    subject: `Your ${storeName} order #${num} has shipped`,
    html,
    text,
  };
}

/**
 * Builds an email notification for a partial or full order refund.
 *
 * @param refundCents - The amount refunded in this transaction, in the order's currency
 * @param refundedCents - The cumulative amount refunded for the order, in cents
 * @param guestOrderUrl - Optional link for guests to view their order
 * @returns The refund notification email
 */
export function orderRefundedEmail(
  order: Order,
  refundCents: number,
  refundedCents: number,
  storeName: string,
  /** Tokenized guest link (allowlisted email position); null = omit the link. */
  guestOrderUrl?: string | null,
): EmailMessage {
  const cfg = getConfig();
  const num = orderReference(order.public_id, order.id, cfg.orderNumber);
  const orderUrl = guestOrderUrl ?? null;
  const full = refundedCents >= order.amount_total_cents;
  const remaining = Math.max(0, order.amount_total_cents - refundedCents);
  const method = order.payment_method;

  // How the money actually gets back differs per rail, and the honest answer is
  // "it depends on your bank" for cards. Saying nothing invites a support email.
  const timing =
    method === "stripe" || method === null
      ? "Card refunds usually appear within 5-10 business days, depending on your bank."
      : "The refund was sent back over the same payment method you used.";

  // Prices in the ORDER's currency, not the store's current one — an order
  // placed before a currency change must still read back in what was charged.
  const money = (cents: number) => formatPrice(cents, order.currency);

  const priorLine =
    refundedCents > refundCents ? `Total refunded so far: ${money(refundedCents)}` : null;

  const text = [
    full ? `Your order #${num} has been refunded.` : `A refund was issued for order #${num}.`,
    ``,
    `Refunded: ${money(refundCents)}`,
    ...(priorLine ? [priorLine] : []),
    ...(full ? [] : [`Still paid: ${money(remaining)}`]),
    ``,
    timing,
    ...(orderUrl ? [``, `View your order: ${orderUrl}`] : []),
  ].join("\n");

  const rows: TotalRow[] = [
    { label: "Refunded", amount: money(refundCents), strong: true },
    ...(priorLine ? [{ label: "Total refunded", amount: money(refundedCents) }] : []),
    ...(full ? [] : [{ label: "Still paid", amount: money(remaining) }]),
  ];

  const html = emailShell({
    storeName,
    heading: full ? "Your order has been refunded" : "A refund is on its way",
    subheading: `Order #${num}`,
    body:
      emailLabel("Refund") +
      `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">${rows
        .map(
          (r) =>
            `<tr><td style="padding:4px 0;font-size:14px;color:${PALETTE.muted};">${escapeHtml(r.label)}</td>` +
            `<td align="right" style="padding:4px 0;font-size:14px;${r.strong ? "font-weight:600;" : ""}">${escapeHtml(r.amount)}</td></tr>`,
        )
        .join("")}</table>` +
      `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:${PALETTE.muted};">${escapeHtml(timing)}</p>` +
      (orderUrl ? emailButton(orderUrl, "View your order") : ""),
  });

  return {
    to: order.email!,
    subject: full
      ? `Your ${storeName} order #${num} has been refunded`
      : `A refund for your ${storeName} order #${num}`,
    html,
    text,
  };
}
