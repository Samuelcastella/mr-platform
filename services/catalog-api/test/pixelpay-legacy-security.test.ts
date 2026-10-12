import { expect, test } from "bun:test";
import {
  verifyPixelPayLegacyPaymentHash,
  buildPixelPayLegacyVoidAuthorization,
  pixelPayIntegrationReadiness
} from "../pixelpay-legacy-security";

const credentials = {
  orderId: "MR-TEST-0042",
  merchantKeyId: "merchant-0815",
  merchantSecret: "s3cret-key-value"
};

test("PixelPay legacy payment hash accepts documented order/key/secret MD5 vector", () => {
  expect(verifyPixelPayLegacyPaymentHash(
    "a0efd0f720cd9d1e13041c0aed9e01bc", credentials
  )).toBe(true);
  expect(verifyPixelPayLegacyPaymentHash(
    "A0EFD0F720CD9D1E13041C0AED9E01BC", credentials
  )).toBe(true);
  expect(verifyPixelPayLegacyPaymentHash(
    "a0efd0f720cd9d1e13041c0aed9e01bc", { ...credentials, orderId: "MR-TEST-0043" }
  )).toBe(false);
  expect(verifyPixelPayLegacyPaymentHash(
    "a0efd0f720cd9d1e13041c0aed9e01bX", credentials
  )).toBe(false);
  expect(verifyPixelPayLegacyPaymentHash("", credentials)).toBe(false);
});

test("PixelPay same-day void authorization uses SHA512 email hash and email|order|secret signature", () => {
  const { authUserHash, voidSignature } = buildPixelPayLegacyVoidAuthorization({
    authorizedUserEmail: "approver@merchant.test",
    orderId: credentials.orderId,
    merchantSecret: credentials.merchantSecret
  });
  expect(authUserHash).toBe(
    "3066014aad6e48d2a49088faaa20b247b83aa1a5a3e2c7f8c8d47572b12f907180f14d594966ef73e5fcd57e1891e7ec5a04de8e4b95bd76c6e1b6f6d7d7832f"
  );
  expect(voidSignature).toBe(
    "086f46917bcce1e7cfd78075378f161b03ade097b3007cdfe18bfc6651dcc18346b2a4ba11db4be11bebf9d099d36c90de2f2e3085915812e3b08e5079aa97fa"
  );
});

test("PixelPay signature parameters reject separators and weak/malformed credentials", () => {
  expect(() => verifyPixelPayLegacyPaymentHash("a".repeat(32), {
    ...credentials, orderId: "MR|INJECT"
  })).toThrow("invalid_pixelpay_order_id");
  expect(() => verifyPixelPayLegacyPaymentHash("a".repeat(32), {
    ...credentials, merchantSecret: "short"
  })).toThrow("invalid_pixelpay_merchant_secret");
  expect(() => buildPixelPayLegacyVoidAuthorization({
    authorizedUserEmail: "user|injected@example.test",
    orderId: credentials.orderId, merchantSecret: credentials.merchantSecret
  })).toThrow("invalid_pixelpay_authorized_email");
  expect(() => buildPixelPayLegacyVoidAuthorization({
    authorizedUserEmail: "not-an-email",
    orderId: credentials.orderId, merchantSecret: credentials.merchantSecret
  })).toThrow("invalid_pixelpay_authorized_email");
});

test("PixelPay remains disabled even when candidate sandbox inputs are supplied", () => {
  const readiness = pixelPayIntegrationReadiness({
    sandboxCredentialsPresent: true,
    callbackSignatureHomologated: true,
    settledRefundContractHomologated: false
  });
  expect(readiness.gateway).toBe("PIXELPAY");
  expect(readiness.paymentAcceptanceEnabled).toBe(false);
  expect(readiness.refundExecutionEnabled).toBe(false);
  expect(readiness.reason).toBe("pixelpay_sandbox_acceptance_not_completed");
  expect(JSON.stringify(readiness)).not.toInclude("merchantSecret");
});
