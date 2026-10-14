import { writeAuditEvent } from "./auth";

type DB = any;

/**
 * Contract for a trusted, server-side gateway status lookup. This module does
 * not implement PixelPay getStatus; only an isolated SIMULATED harness exists.
 */
export type GatewayStatusSnapshot = Readonly<{
  transactionReference: string;
  status: "CAPTURED" | "AUTHORIZED" | "PENDING" | "FAILED" | "VOIDED" | "REFUNDED" | "UNKNOWN";
  amountMinor: number;
  currency: string;
}>;

export interface TrustedGatewayStatusReader {
  readonly id: "SIMULATED" | "PIXELPAY";
  lookupStatus(providerCaptureReference: string): Promise<GatewayStatusSnapshot>;
}

export async function ensureGatewayStatusObservationSchema(db: DB) {
  await db`
    CREATE TABLE IF NOT EXISTS payment_gateway_status_observations (
      id BIGSERIAL PRIMARY KEY,
      payment_id BIGINT NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
      provider TEXT NOT NULL,
      capture_reference TEXT NOT NULL,
      observed_transaction_reference TEXT NOT NULL,
      observed_status TEXT NOT NULL,
      observed_amount_minor BIGINT NOT NULL CHECK (observed_amount_minor >= 0),
      observed_currency CHAR(3) NOT NULL,
      finding TEXT NOT NULL,
      observation_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(payment_id, observation_hash),
      CHECK(observed_status IN (
        'CAPTURED','AUTHORIZED','PENDING','FAILED','VOIDED','REFUNDED','UNKNOWN'
      ))
    )`;
  await db`
    CREATE INDEX IF NOT EXISTS idx_payment_gateway_status_observations_payment
    ON payment_gateway_status_observations(payment_id, created_at DESC)`;
}

function validSnapshot(value: unknown): value is GatewayStatusSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as GatewayStatusSnapshot;
  return typeof snapshot.transactionReference === "string" &&
    /^[A-Za-z0-9_.:-]{8,160}$/.test(snapshot.transactionReference) &&
    ["CAPTURED", "AUTHORIZED", "PENDING", "FAILED", "VOIDED", "REFUNDED", "UNKNOWN"].includes(snapshot.status) &&
    Number.isSafeInteger(snapshot.amountMinor) && snapshot.amountMinor >= 0 &&
    typeof snapshot.currency === "string" && /^[A-Z]{3}$/.test(snapshot.currency);
}

/**
 * CI-only, credential-free rehearsal of eventual PixelPay getStatus ingestion.
 * A mock status response NEVER updates Payment, Order, Reservations or Kardex.
 * No endpoint accepts a status supplied directly by a web client.
 */
export async function reconcileSimulatedGatewayStatus(
  db: DB, paymentId: number, reader: TrustedGatewayStatusReader
) {
  if (Bun.env.ALLOW_DESTRUCTIVE_TEST_DB !== "true" || reader.id !== "SIMULATED")
    throw new Error("gateway_status_homologation_required");
  if (!Number.isSafeInteger(paymentId) || paymentId < 1)
    throw new Error("invalid_payment_id");

  const paymentRows = await db`
    SELECT id, provider FROM payments WHERE id = ${paymentId}`;
  if (paymentRows.length !== 1 || paymentRows[0].provider !== "SIMULATED")
    throw new Error("simulated_payment_required");

  // Use only evidence from the previously signed and committed webhook events.
  const captures = await db`
    SELECT DISTINCT provider_reference, captured_amount_minor, captured_currency
    FROM simulated_payment_events
    WHERE payment_id = ${paymentId} AND provider_reference IS NOT NULL`;
  if (captures.length !== 1 || !captures[0].provider_reference)
    throw new Error("unique_signed_capture_required");

  const capture = captures[0];
  // No locks while waiting on the gateway. In CI the reader is an injected fake.
  const observed = await reader.lookupStatus(String(capture.provider_reference));
  if (!validSnapshot(observed)) throw new Error("invalid_gateway_status");

  const observationHash = new Bun.CryptoHasher("sha256")
    .update(JSON.stringify({
      provider: "SIMULATED", paymentId,
      requestedCaptureReference: capture.provider_reference,
      ...observed
    })).digest("hex");

  return db.begin(async (tx: DB) => {
    // Lock the payment before inserting a foreign-key referencing observation,
    // serializing concurrent, differently hashed observations for this payment.
    const rows = await tx`
      SELECT p.id, p.status, p.provider, p.amount_minor, p.currency,
             o.id AS order_id, o.status AS order_status
      FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE p.id = ${paymentId} FOR UPDATE OF p, o`;
    if (rows.length !== 1 || rows[0].provider !== "SIMULATED")
      throw new Error("simulated_payment_required");
    const p = rows[0];

    // Revalidate signed capture evidence in case it changed while the gateway
    // lookup was in flight.
    const freshCaptures = await tx`
      SELECT DISTINCT provider_reference, captured_amount_minor, captured_currency
      FROM simulated_payment_events
      WHERE payment_id = ${paymentId} AND provider_reference IS NOT NULL`;
    if (freshCaptures.length !== 1 ||
        freshCaptures[0].provider_reference !== capture.provider_reference ||
        String(freshCaptures[0].captured_currency).trim() !== String(capture.captured_currency).trim() ||
        Number(freshCaptures[0].captured_amount_minor) !== Number(capture.captured_amount_minor))
      throw new Error("signed_capture_changed");

    const reservationRows = await tx`
      SELECT status, expires_at FROM inventory_reservations
      WHERE order_id = ${p.order_id} FOR UPDATE`;
    const reservationsValid = reservationRows.length > 0 &&
      reservationRows.every((r: any) => r.status === "ACTIVE" &&
        (r.expires_at == null || new Date(r.expires_at).getTime() > Date.now()));
    const moneyMatches = Number(p.amount_minor) === observed.amountMinor &&
      Number(capture.captured_amount_minor) === observed.amountMinor &&
      String(p.currency).trim() === observed.currency &&
      String(capture.captured_currency).trim() === observed.currency;

    const finding =
      observed.transactionReference !== capture.provider_reference
        ? "PROVIDER_REFERENCE_MISMATCH" :
      !moneyMatches ? "PAYMENT_AMOUNT_MISMATCH" :
      observed.status === "CAPTURED" && (p.order_status !== "CONFIRMED" || !reservationsValid)
        ? "LATE_PAYMENT_EXPIRED_RESERVATION" :
      observed.status === "CAPTURED" ? "MATCHED_CAPTURE_REQUIRES_REVIEW" :
      observed.status === "REFUNDED" ? "REFUND_STATUS_REQUIRES_SETTLEMENT_EVIDENCE" :
      observed.status === "VOIDED" ? "VOID_REQUIRES_SETTLEMENT_EVIDENCE" :
      observed.status === "FAILED" ? "PAYMENT_FAILED_REQUIRES_REVIEW" :
      "STATUS_NOT_FINAL";

    const inserted = await tx`
      INSERT INTO payment_gateway_status_observations(
        payment_id, provider, capture_reference, observed_transaction_reference,
        observed_status, observed_amount_minor, observed_currency, finding, observation_hash
      ) VALUES (
        ${paymentId}, 'SIMULATED', ${capture.provider_reference},
        ${observed.transactionReference}, ${observed.status},
        ${observed.amountMinor}, ${observed.currency}, ${finding}, ${observationHash}
      )
      ON CONFLICT(payment_id, observation_hash) DO NOTHING
      RETURNING id`;
    if (inserted.length) {
      await writeAuditEvent(tx, {
        actorType: "SYSTEM", action: "payment.provider_status_observed",
        resourceType: "Payment", resourceId: paymentId,
        outcome: "SUCCESS", reason: finding,
        correlationId: "status:" + observationHash.slice(0,32),
        metadata: {
          provider: "SIMULATED", status: observed.status,
          observedAmountMinor: observed.amountMinor, currency: observed.currency,
          captureReference: capture.provider_reference, orderId: Number(p.order_id),
          paymentStatusUnchanged: true, stockUnchanged: true
        }
      });
    }
    return {
      replayed: inserted.length === 0,
      finding,
      observedStatus: observed.status,
      paymentId,
      paymentStatusUnchanged: true,
      orderAndKardexUnchanged: true,
      providerHomologated: false
    };
  });
}
