/**
 * PixelPay LEGACY SDK cryptographic primitives, isolated from webhook auth.
 * Official reference: https://docs.pixelpay.com/page/sdk/use-cases/index?lang=swift&locale=es
 *
 * PAYMENT HASH: MD5(order_id|key_id|secret_key) according to legacy SDK guide.
 * VOID SIGNATURE: SHA512(auth_user_email|order_id|secret_key).
 * PLATFORM USER: SHA512(auth_user_email).
 *
 * IMPORTANT: Neither proves a webhook payload is authentic, nor that a refund
 * settled. Payment status must be queried from PixelPay in the provider-specific
 * adapter after its sandbox contract is validated. Never run doVoid here.
 */
const digest = (algorithm: "md5" | "sha512", value: string) =>
  new Bun.CryptoHasher(algorithm).update(value).digest("hex");

function requireField(value: string, name: string) {
  if (typeof value !== "string" || !value || value.length > 256 ||
      /[|\x00-\x1f\x7f]/.test(value))
    throw new Error("invalid_pixelpay_" + name);
  return value;
}

function requireMerchantSecret(secret: string) {
  if (typeof secret !== "string" || secret.length < 16 || secret.length > 512)
    throw new Error("invalid_pixelpay_merchant_secret");
  return secret;
}

function constantTimeHexMatch(supplied: string, expected: string) {
  if (typeof supplied !== "string" || supplied.length !== expected.length ||
      !/^[a-f\d]+$/i.test(supplied)) return false;
  let difference = 0;
  const normalized = supplied.toLowerCase();
  for (let i = 0; i < expected.length; i++) {
    difference |= normalized.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return difference === 0;
}

export type PixelPayMerchantHashInput = Readonly<{
  orderId: string;
  merchantKeyId: string;
  merchantSecret: string;
}>;

/** Legacy return-value integrity only. NOT sufficient to mark a payment PAID. */
export function verifyPixelPayLegacyPaymentHash(
  paymentHash: string, input: PixelPayMerchantHashInput
): boolean {
  const { orderId, merchantKeyId, merchantSecret } = input;
  const message = [
    requireField(orderId, "order_id"),
    requireField(merchantKeyId, "merchant_key_id"),
    requireMerchantSecret(merchantSecret)
  ].join("|");
  return constantTimeHexMatch(paymentHash, digest("md5", message));
}

export type PixelPayVoidSignatureInput = Readonly<{
  authorizedUserEmail: string;
  orderId: string;
  merchantSecret: string;
}>;

/**
 * Create the values documented for a SAME-DAY void ONLY.
 * No HTTP request is made; a void is NOT a settled refund.
 */
export function buildPixelPayLegacyVoidAuthorization(input: PixelPayVoidSignatureInput) {
  const email = requireField(input.authorizedUserEmail, "authorized_email");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    throw new Error("invalid_pixelpay_authorized_email");
  const orderId = requireField(input.orderId, "order_id");
  const secret = requireMerchantSecret(input.merchantSecret);
  return {
    authUserHash: digest("sha512", email),
    voidSignature: digest("sha512", [email, orderId, secret].join("|"))
  };
}

/**
 * A pure readiness gate. Never returns secrets or grants execution permission.
 * The webhook signature and settled-refund contract are not yet homologated.
 */
export function pixelPayIntegrationReadiness(config: {
  sandboxCredentialsPresent: boolean;
  callbackSignatureHomologated: boolean;
  settledRefundContractHomologated: boolean;
}) {
  return {
    gateway: "PIXELPAY" as const,
    sandboxCredentialsPresent: config.sandboxCredentialsPresent,
    callbackVerificationReady: config.callbackSignatureHomologated,
    settledRefundContractReady: config.settledRefundContractHomologated,
    paymentAcceptanceEnabled: false,
    refundExecutionEnabled: false,
    reason: "pixelpay_sandbox_acceptance_not_completed" as const
  };
}
