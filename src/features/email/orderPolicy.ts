/**
 * Determines whether to send an order email to the customer.
 *
 * @param paymentMethod - The payment method associated with the order
 * @returns `true` if the payment method is not `"demo"`, `false` otherwise
 */
export function shouldSendCustomerOrderEmail(paymentMethod: string | null | undefined): boolean {
  return paymentMethod !== "demo";
}

/**
 * Resolves the email address required to place a demo order.
 *
 * @param submittedEmail - The email address provided with the order
 * @param existingEmail - The previously stored email address used when no address is submitted
 * @returns The selected email address if it matches the expected format, or `null` otherwise
 */
export function resolveRequiredOrderEmail(
  submittedEmail: string,
  existingEmail: string | null | undefined,
): string | null {
  const email = submittedEmail.trim() || existingEmail?.trim() || "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
