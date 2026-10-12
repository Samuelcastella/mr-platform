import { test, expect } from "bun:test";
import {
  createPaymentGatewayAdapter,
  SimulatedPaymentGatewayAdapter,
  signSimulatedWebhook,
  type RefundExecutionRequest
} from "../payment-gateway-adapter";

const secret = "ci-webhook-signing-secret-longer-than-32-characters";
const encoder = new TextEncoder();
const request: RefundExecutionRequest = {
  refundRequestId: 11,
  paymentId: 5,
  providerCaptureReference: "ci-capture-reference-0001",
  amountMinor: 32000,
  currency: "HNL",
  idempotencyKey: "ci-refund-request-11"
};

test("simulated adapter rejects absent/weak secret and unhomologated providers", () => {
  expect(() => createPaymentGatewayAdapter("SIMULATED")).toThrow("simulated_webhook_secret_required");
  expect(() => new SimulatedPaymentGatewayAdapter("short")).toThrow("simulated_webhook_secret_required");
  expect(() => createPaymentGatewayAdapter("PIXELPAY", secret)).toThrow("gateway_not_homologated:PIXELPAY");
  expect(() => createPaymentGatewayAdapter("BAC_CYBERSOURCE", secret)).toThrow("gateway_not_homologated:BAC_CYBERSOURCE");
});

test("simulated adapter authenticates exact raw bytes and rejects modified signatures", async () => {
  const adapter = new SimulatedPaymentGatewayAdapter(secret);
  const raw = encoder.encode(JSON.stringify({
    eventId: "ci-event-12345",
    paymentId: 5,
    type: "payment.succeeded",
    providerReference: "ci-capture-reference-0001",
    amountMinor: 32000,
    currency: "HNL",
    note: "captura de prueba"
  }));
  const signature = await signSimulatedWebhook(secret, raw);
  const headers = new Headers({ "x-simulated-signature": signature });
  expect(await adapter.verifyWebhookSignature(headers, raw)).toBe(true);
  const changedRaw = encoder.encode(new TextDecoder().decode(raw).replace("32000", "32001"));
  expect(await adapter.verifyWebhookSignature(headers, changedRaw)).toBe(false);
  expect(await adapter.verifyWebhookSignature(
    new Headers({ "x-simulated-signature": "0".repeat(64) }), raw
  )).toBe(false);
  expect(await adapter.verifyWebhookSignature(new Headers(), raw)).toBe(false);
  expect(adapter.parseWebhookEvent(raw)).toEqual({
    eventId: "ci-event-12345",
    kind: "PAYMENT_CAPTURED",
    paymentReference: "5",
    amountMinor: 32000,
    currency: "HNL",
    providerEventId: "ci-capture-reference-0001"
  });
});

test("adapter rejects malformed payment events and invalid amounts", () => {
  const adapter = new SimulatedPaymentGatewayAdapter(secret);
  const parse = (body: unknown) => adapter.parseWebhookEvent(encoder.encode(JSON.stringify(body)));
  expect(parse({ eventId: "ci-event-12345", type: "refund.succeeded" })).toBe(null);
  expect(parse({
    eventId: "ci-event-12345", paymentId: 5, type: "payment.succeeded",
    providerReference: "ci-capture-reference-0001", amountMinor: 3.14, currency: "HNL"
  })).toBe(null);
  expect(parse({
    eventId: "ci-event-12345", paymentId: 5, type: "payment.succeeded",
    providerReference: "ci-capture-reference-0001", amountMinor: 32000, currency: "hnl"
  })).toBe(null);
  expect(adapter.parseWebhookEvent(new Uint8Array([0xff, 0xfe]))).toBe(null);
});

test("sandbox adapter cannot execute or falsely reconcile a refund", async () => {
  const adapter = new SimulatedPaymentGatewayAdapter(secret);
  expect(adapter.id).toBe("SIMULATED");
  expect(adapter.environment).toBe("sandbox");
  expect(adapter.executeVoid({
    paymentId: request.paymentId,
    providerPaymentUuid: "P-fake-uuid",
    orderId: "MR-ORDER-001",
    reason: "same day release",
    idempotencyKey: "ci-void-001"
  })).rejects.toThrow("void_execution_disabled");
  expect(adapter.executeRefund(request)).rejects.toThrow("refund_execution_disabled");
  expect(adapter.getRefundStatus(request)).rejects.toThrow("refund_reconciliation_disabled");
});
