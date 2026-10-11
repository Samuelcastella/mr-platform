// M04.1: transaction-bound heavy quote acceptance. This helper is not an HTTP route.
type DB = any;
export async function acceptHeavyQuoteInTx(tx: DB, orderId: number, quoteId: number, orderToken: string) {
  if (!Number.isSafeInteger(orderId) || orderId < 1 || !Number.isSafeInteger(quoteId) || quoteId < 1 || !orderToken)
    return { error: "invalid_input", status: 400 };
  const orders = await tx`SELECT id, public_token, status, currency, subtotal_minor,
    discount_total_minor, tax_total_minor FROM orders WHERE id = ${orderId} FOR UPDATE`;
  if (!orders.length || String(orders[0].public_token) !== orderToken)
    return { error: "order_not_found", status: 404 };
  const quotes = await tx`SELECT id, status, currency, shipping_minor, expires_at
    FROM heavy_logistics_quotes WHERE id = ${quoteId} AND order_id = ${orderId} FOR UPDATE`;
  if (!quotes.length) return { error: "quote_not_found", status: 404 };
  const order = orders[0], quote = quotes[0];
  if (quote.status === "ACCEPTED") return { accepted: true, replayed: true };
  if (quote.status !== "DRAFT" || new Date(quote.expires_at).getTime() <= Date.now())
    return { error: "quote_unavailable", status: 409 };
  if (!["PENDING_CONFIRMATION", "CONFIRMED"].includes(order.status) || String(order.currency) !== String(quote.currency))
    return { error: "order_not_eligible", status: 409 };
  if ((await tx`SELECT id FROM checkout_sessions WHERE order_id = ${orderId} LIMIT 1`).length)
    return { error: "checkout_started", status: 409 };
  if ((await tx`SELECT id FROM fulfillments WHERE order_id = ${orderId} LIMIT 1`).length)
    return { error: "fulfillment_exists", status: 409 };
  if ((await tx`SELECT id FROM heavy_logistics_quotes WHERE order_id = ${orderId} AND status = 'ACCEPTED' LIMIT 1`).length)
    return { error: "another_quote_accepted", status: 409 };
  const shipping = Number(quote.shipping_minor);
  const total = Number(order.subtotal_minor) - Number(order.discount_total_minor) + Number(order.tax_total_minor) + shipping;
  if (!Number.isSafeInteger(shipping) || shipping < 0 || !Number.isSafeInteger(total) || total < 0)
    return { error: "invalid_amount", status: 409 };
  // Caller must create fulfillment and audit in this SAME transaction before commit.
  await tx`UPDATE orders SET shipping_total_minor = ${shipping}, grand_total_minor = ${total}, updated_at = NOW() WHERE id = ${orderId}`;
  await tx`UPDATE heavy_logistics_quotes SET status = 'ACCEPTED', accepted_at = NOW() WHERE id = ${quoteId}`;
  return { accepted: true, replayed: false, shippingMinor: shipping, grandTotalMinor: total };
}
