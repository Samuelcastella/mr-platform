// M04.1: transaction-bound heavy quote acceptance. This helper is not an HTTP route.
type DB = any;
export async function acceptHeavyQuoteInTx(tx: DB, orderId: number, quoteId: number, orderToken: string) {
  if (!Number.isSafeInteger(orderId) || orderId < 1 || !Number.isSafeInteger(quoteId) || quoteId < 1 || !orderToken)
    return { error: "invalid_input", status: 400 };
  const orders = await tx`SELECT id, public_token, status, currency, subtotal_minor,
    discount_total_minor, tax_total_minor FROM orders WHERE id = ${orderId} FOR UPDATE`;
  if (!orders.length || String(orders[0].public_token) !== orderToken)
    return { error: "order_not_found", status: 404 };
  const quotes = await tx`SELECT id, variant_id, status, currency, shipping_minor, expires_at
    FROM heavy_logistics_quotes WHERE id = ${quoteId} AND order_id = ${orderId} FOR UPDATE`;
  if (!quotes.length) return { error: "quote_not_found", status: 404 };
  const order = orders[0], quote = quotes[0];
  if (quote.status === "ACCEPTED") return { accepted: true, replayed: true };
  // Compare the immutable priced lines to the current order while holding the order lock.
  const lines = await tx`SELECT variant_id, quantity FROM order_items WHERE order_id = ${orderId}`;
  const snapshots = await tx`SELECT variant_id, quantity, shipping_minor
    FROM heavy_logistics_quote_lines WHERE quote_id = ${quoteId}`;
  if (snapshots.length) {
    const ordered = new Map<number, number>();
    for (const line of lines) {
      const variant = Number(line.variant_id), quantity = Number(line.quantity);
      if (!Number.isSafeInteger(variant) || variant <= 0 || !Number.isSafeInteger(quantity) || quantity <= 0)
        return { error: "heavy_quote_order_coverage_required", status: 409 };
      ordered.set(variant, (ordered.get(variant) || 0) + quantity);
    }
    let sum = 0;
    if (snapshots.length !== ordered.size) return { error: "heavy_quote_order_coverage_required", status: 409 };
    for (const snapshot of snapshots) {
      const variant = Number(snapshot.variant_id), quantity = Number(snapshot.quantity);
      const price = Number(snapshot.shipping_minor);
      if (ordered.get(variant) !== quantity || !Number.isSafeInteger(price) || price < 0)
        return { error: "heavy_quote_order_coverage_required", status: 409 };
      sum += price;
      if (!Number.isSafeInteger(sum)) return { error: "invalid_amount", status: 409 };
    }
    if (sum !== Number(quote.shipping_minor)) return { error: "heavy_quote_total_mismatch", status: 409 };
  } else if (lines.length !== 1 || Number(lines[0].quantity) !== 1 ||
             Number(lines[0].variant_id) !== Number(quote.variant_id)) {
    // Legacy quotes without snapshots cover only one unit of one variant.
    return { error: "heavy_quote_order_coverage_required", status: 409 };
  }
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
