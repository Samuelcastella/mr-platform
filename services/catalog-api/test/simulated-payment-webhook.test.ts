import { test, expect } from "bun:test";
import { signSimulatedWebhook, handleSimulatedWebhook } from "../simulated-payment-webhook";

test("simulated webhook rejects missing configuration and invalid signatures without DB writes", async () => {
  const original = Bun.env.SIMULATED_PAYMENT_WEBHOOK_SECRET;
  const secret = "test-secret-at-least-32-characters-long";
  const raw = JSON.stringify({ eventId: "event-test-001", paymentId: 1, type: "payment.succeeded" });
  const url = new URL("http://localhost/v1/webhooks/payments/simulated");
  const db: any = { begin: () => { throw new Error("database must not be touched"); } };
  try {
    delete Bun.env.SIMULATED_PAYMENT_WEBHOOK_SECRET;
    let response = await handleSimulatedWebhook(new Request(url, { method: "POST", body: raw }), url, db);
    expect(response?.status).toBe(503);
    Bun.env.SIMULATED_PAYMENT_WEBHOOK_SECRET = secret;
    response = await handleSimulatedWebhook(new Request(url, {
      method: "POST", headers: { "x-simulated-signature": "0".repeat(64) }, body: raw
    }), url, db);
    expect(response?.status).toBe(401);
    const signature = await signSimulatedWebhook(secret, raw);
    expect(signature).toHaveLength(64);
    expect(signature).not.toBe("0".repeat(64));
  } finally {
    if (original === undefined) delete Bun.env.SIMULATED_PAYMENT_WEBHOOK_SECRET;
    else Bun.env.SIMULATED_PAYMENT_WEBHOOK_SECRET = original;
  }
});
