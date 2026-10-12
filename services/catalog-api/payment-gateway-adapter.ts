/**
 * Provider-neutral boundary for gateway callbacks and financial refunds.
 *
 * No adapter may infer an approved refund from an incoming HTTP request.
 * Callers must load an APPROVED_NOT_SUBMITTED refund request from PostgreSQL,
 * claim it atomically and persist the result (including UNKNOWN) independently.
 * An accepted API request is NOT proof that money was returned.
 */
export type GatewayId = "SIMULATED" | "PIXELPAY" | "BAC_CYBERSOURCE";
export type GatewayEnvironment = "sandbox" | "production";

export type Money = Readonly<{ amountMinor: number; currency: string }>;

export type NormalizedGatewayEvent = Readonly<{
  eventId: string;
  paymentReference: string;
  kind: "PAYMENT_CAPTURED" | "REFUND_CONFIRMED" | "REFUND_FAILED";
  amountMinor: number;
  currency: string;
  providerEventId?: string;
  providerRefundReference?: string;
}>;

export type RefundExecutionRequest = Readonly<{
  /** Internal immutable refund-request identifier; never take directly from a client body. */
  refundRequestId: number;
  paymentId: number;
  /** Verified capture/transaction reference from the gateway. */
  providerCaptureReference: string;
  amountMinor: number;
  currency: string;
  /** Persisted provider-scoped idempotency key, stable across retries. */
  idempotencyKey: string;
}>;

/** A same-day authorization reversal, NEVER interchangeable with a settled refund. */
export type VoidExecutionRequest = Readonly<{
  paymentId: number;
  providerPaymentUuid: string;
  orderId: string;
  reason: string;
  idempotencyKey: string;
}>;

export type VoidExecutionResult = Readonly<{
  status: "ACCEPTED" | "CONFIRMED" | "REJECTED" | "UNKNOWN";
  providerVoidReference?: string;
  providerStatus?: string;
}>;

export type RefundExecutionResult = Readonly<{
  /** ACCEPTED is not settled; UNKNOWN requires status reconciliation before retry. */
  status: "ACCEPTED" | "CONFIRMED" | "REJECTED" | "UNKNOWN";
  providerRefundReference?: string;
  providerStatus?: string;
  failureCode?: string;
}>;

export type RefundReconciliationResult = Readonly<{
  status: "PENDING" | "CONFIRMED" | "FAILED" | "UNKNOWN";
  providerRefundReference?: string;
  settledAmountMinor?: number;
  settledCurrency?: string;
}>;

export interface PaymentGatewayAdapter {
  readonly id: GatewayId;
  readonly environment: GatewayEnvironment;
  /** Verify the exact callback body as received, not a JSON re-serialization. */
  verifyWebhookSignature(headers: Headers, rawBody: Uint8Array): Promise<boolean>;
  /** Validate/normalize only provider-authentic events; null means invalid input. */
  parseWebhookEvent(rawBody: Uint8Array): NormalizedGatewayEvent | null;
  /**
   * Same-day void/reversal. Distinct authorization policy, time window and ledger
   * treatment from a post-settlement refund; never use for REFUND_REQUESTED.
   */
  executeVoid(request: VoidExecutionRequest): Promise<VoidExecutionResult>;
  /** Network financial side effect: callable only from a persisted approved-refund worker. */
  executeRefund(request: RefundExecutionRequest): Promise<RefundExecutionResult>;
  /** Required to reconcile uncertainty after network timeouts/unknown outcomes. */
  getRefundStatus(request: RefundExecutionRequest): Promise<RefundReconciliationResult>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export async function signSimulatedWebhook(secret: string, rawBody: Uint8Array | string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const bytes = typeof rawBody === "string" ? encoder.encode(rawBody) : rawBody;
  const signature = await crypto.subtle.sign("HMAC", key, bytes);
  return Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeHexEqual(provided: string, expected: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(provided) || !/^[0-9a-f]{64}$/i.test(expected)) return false;
  let difference = 0;
  for (let i = 0; i < 64; i++) difference |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}

export class SimulatedPaymentGatewayAdapter implements PaymentGatewayAdapter {
  readonly id = "SIMULATED";
  readonly environment = "sandbox";

  constructor(private readonly signingSecret: string) {
    if (signingSecret.length < 32) throw new Error("simulated_webhook_secret_required");
  }

  async verifyWebhookSignature(headers: Headers, rawBody: Uint8Array): Promise<boolean> {
    const supplied = headers.get("x-simulated-signature") || "";
    if (!/^[0-9a-f]{64}$/i.test(supplied)) return false;
    const expected = await signSimulatedWebhook(this.signingSecret, rawBody);
    return constantTimeHexEqual(supplied, expected);
  }

  parseWebhookEvent(rawBody: Uint8Array): NormalizedGatewayEvent | null {
    let body: any;
    try { body = JSON.parse(decoder.decode(rawBody)); } catch { return null; }
    if (!body || body.type !== "payment.succeeded" ||
        typeof body.eventId !== "string" || !/^[a-zA-Z0-9_-]{8,120}$/.test(body.eventId) ||
        !Number.isSafeInteger(body.paymentId) || body.paymentId < 1 ||
        typeof body.providerReference !== "string" ||
        !/^[A-Za-z0-9_.:-]{8,160}$/.test(body.providerReference) ||
        !Number.isSafeInteger(body.amountMinor) || body.amountMinor < 0 ||
        typeof body.currency !== "string" || !/^[A-Z]{3}$/.test(body.currency)) return null;
    return {
      eventId: body.eventId,
      kind: "PAYMENT_CAPTURED",
      paymentReference: String(body.paymentId),
      amountMinor: body.amountMinor,
      currency: body.currency,
      providerEventId: body.providerReference
    };
  }

  async executeVoid(_request: VoidExecutionRequest): Promise<VoidExecutionResult> {
    throw new Error("void_execution_disabled:simulated_gateway");
  }

  async executeRefund(_request: RefundExecutionRequest): Promise<RefundExecutionResult> {
    throw new Error("refund_execution_disabled:simulated_gateway");
  }

  async getRefundStatus(_request: RefundExecutionRequest): Promise<RefundReconciliationResult> {
    throw new Error("refund_reconciliation_disabled:simulated_gateway");
  }
}

/** Fail closed until actual provider contract, sandbox keys and acceptance tests exist. */
export function createPaymentGatewayAdapter(id: GatewayId, simulatedSecret?: string): PaymentGatewayAdapter {
  if (id === "SIMULATED") return new SimulatedPaymentGatewayAdapter(simulatedSecret || "");
  throw new Error("gateway_not_homologated:" + id);
}
