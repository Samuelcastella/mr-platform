/**
 * Read-only financial preflight. NEVER sends a provider request, modifies an
 * order/payment or claims that approved money has been returned.
 */
type DB = any;

export async function loadRefundExecutionPreflight(db: DB, refundRequestId: number) {
  const rows = await db`
    SELECT r.id, r.payment_id, r.status AS request_status,
           r.provider_reference AS approved_capture_reference,
           r.captured_amount_minor AS approved_amount_minor,
           r.captured_currency AS approved_currency,
           r.requested_by_user_id,
           e.event_id, e.code AS exception_code,
           e.resolution_status, e.reviewed_by_user_id,
           o.id AS order_id, o.location_id, o.status AS order_status,
           p.provider AS payment_provider, p.status AS payment_status,
           p.amount_minor AS expected_amount_minor, p.currency AS expected_currency,
           s.provider_reference AS signed_capture_reference,
           s.captured_amount_minor AS signed_amount_minor,
           s.captured_currency AS signed_currency,
           (SELECT COUNT(*)::int FROM inventory_movements m
            WHERE m.reference = 'order:' || o.id::text AND m.movement_type = 'SALE')
             AS sale_movements
    FROM payment_exception_refund_requests r
    JOIN payment_webhook_exceptions e ON e.id = r.exception_id
    JOIN payments p ON p.id = r.payment_id AND p.id = e.payment_id
    JOIN orders o ON o.id = e.order_id AND o.id = p.order_id
    JOIN simulated_payment_events s ON s.event_id = e.event_id AND s.payment_id = p.id
    WHERE r.id = ${refundRequestId}`;
  if (!rows.length) return null;
  const r = rows[0];
  const checks = {
    approvedAndNotSubmitted:
      r.request_status === "APPROVED_NOT_SUBMITTED" && r.resolution_status === "REFUND_REQUESTED",
    independentReviewerAndApprover:
      r.reviewed_by_user_id != null && r.requested_by_user_id != null &&
      Number(r.reviewed_by_user_id) !== Number(r.requested_by_user_id),
    captureReferenceConsistent:
      Boolean(r.approved_capture_reference) &&
      r.approved_capture_reference === r.signed_capture_reference,
    capturedAmountConsistent:
      Number.isSafeInteger(Number(r.approved_amount_minor)) &&
      Number(r.approved_amount_minor) === Number(r.signed_amount_minor) &&
      Number(r.approved_amount_minor) === Number(r.expected_amount_minor) &&
      String(r.approved_currency).trim() === String(r.signed_currency).trim() &&
      String(r.approved_currency).trim() === String(r.expected_currency).trim(),
    cancelledOrder: r.order_status === "CANCELLED",
    noSaleKardexMovement: Number(r.sale_movements) === 0,
    exceptionIsLateCapture: r.exception_code === "LATE_PAYMENT_EXPIRED_RESERVATION",
    providerHomologated: false // Intentionally fail closed until real sandbox acceptance
  };
  const blockers = Object.entries(checks)
    .filter(([, ok]) => !ok).map(([name]) => name);
  return {
    refundRequestId: Number(r.id),
    paymentId: Number(r.payment_id),
    orderId: Number(r.order_id),
    locationId: Number(r.location_id),
    paymentProvider: String(r.payment_provider),
    requestStatus: r.request_status,
    exceptionCode: r.exception_code,
    checks, blockers,
    executionEnabled: false,
    providerExecutionAttempted: false
  };
}
