# MR Adulán — Payment gateway adapter contract

**State:** Provider-neutral TypeScript boundary implemented on `feat/m04-heavy-logistics`. SIMULATED is a local-only test adapter. **No external gateway or refund API has been homologated; no Railway deployment or credentials are authorized by this document.**

## Adapter source and responsibilities

`services/catalog-api/payment-gateway-adapter.ts` defines `PaymentGatewayAdapter`:

- `verifyWebhookSignature(headers, rawBody)` authenticates **original raw bytes**, not re-serialized JSON.
- `parseWebhookEvent(rawBody)` normalizes signed callbacks to `PAYMENT_CAPTURED`, `REFUND_CONFIRMED` or `REFUND_FAILED` events (currently SIMULATED understands only `payment.succeeded`).
- `executeVoid(request)` is a **different same-day reversal**, not a refund; it remains disabled until a dedicated authorization and provider sandbox contract exist.
- `executeRefund(request)` is a **financial network side effect** reserved for a later approved-refund worker. It must receive `refundRequestId`, `paymentId`, a verified capture reference, amount **in integer minor units**, currency and a stable idempotency key.
- `getRefundStatus(request)` reconciles UNKNOWN/ACCEPTED responses after timeouts before any retries.

`SimulatedPaymentGatewayAdapter` uses HMAC-SHA256 with `x-simulated-signature` and `SIMULATED_PAYMENT_WEBHOOK_SECRET`, **only for the simulated endpoint**. All three financial methods (`executeVoid`, `executeRefund`, `getRefundStatus`) fail closed. The external `PIXELPAY` and `BAC_CYBERSOURCE` factories also fail closed until approved implementations are available.

The existing `POST /v1/webhooks/payments/simulated` now invokes the adapter's verification and normalization methods before its PostgreSQL transaction. The existing exception-approval pipeline persists `payment_exception_refund_requests.status='APPROVED_NOT_SUBMITTED'`, without any gateway call.

## Finance read-only execution preflight — implemented but blocked

`GET /v1/internal/payments/refund-requests/:id/preflight` is available to **human finance staff** with the existing `payments.refund` permission scoped to the order's location. Anonymous, non-finance and legacy service-token callers are denied.

The preflight in `services/catalog-api/refund-execution-preflight.ts` queries PostgreSQL without altering financial state or contacting PixelPay, and checks:
1. `APPROVED_NOT_SUBMITTED` and `REFUND_REQUESTED` from the approved two-person workflow;
2. reviewer and refund approver are distinct;
3. the signed simulated capture reference is identical to the approved refund reference;
4. approved amount and currency match the stored signed event and payment;
5. order is cancelled, no `SALE` Kardex movements exist, and the underlying exception is a late captured payment.

The response **always** contains `executionEnabled: false`, `providerExecutionAttempted: false`, and `providerHomologated: false` in checks. Any additional failed checks are listed as blockers. Passing local database checks is NOT gateway homologation and does not submit an external refund.

Current scope is strictly the simulated signed-event schema; before adapting to PixelPay replace the simulated capture-evidence joins with the provider's verified settlement records and support approved refunds for cases other than late cancellation through a separate policy.

## Conciliación de estados por identificador de captura — incorporada como ensayo aislado

La documentación oficial de PixelPay muestra `getStatus` mediante `StatusTransaction.payment_uuid`, ejecutado desde el backend. Este contrato no prueba la firma del callback, ni certifica reembolsos posteriores a la liquidación. Referencia: https://docs.pixelpay.com/use-case?case=sdk%2Fstatus%2Fstatus&lang=php&locale=es.

`services/catalog-api/gateway-status-reconciliation.ts` añade un libro de observaciones `payment_gateway_status_observations` con hash de idempotencia por pago/observación. **No actualiza** `payments`, `orders`, `inventory_reservations` ni `inventory_movements`. Registra una auditoría solo al agregar una observación nueva.

La función `reconcileSimulatedGatewayStatus` ensaya consultas con un lector inyectado `TrustedGatewayStatusReader`, usando únicamente referencias previamente recibidas en eventos HMAC simulados. Rechaza `PIXELPAY` explícitamente y solo se permite con `ALLOW_DESTRUCTIVE_TEST_DB=true` para evitar interpretar un resultado simulado como verificación bancaria. No hay consultas HTTP ni credenciales de PixelPay en esta implementación.

La comparación detecta, entre otros: `PROVIDER_REFERENCE_MISMATCH`, `PAYMENT_AMOUNT_MISMATCH`, `LATE_PAYMENT_EXPIRED_RESERVATION`, `MATCHED_CAPTURE_REQUIRES_REVIEW` y `REFUND_STATUS_REQUIRES_SETTLEMENT_EVIDENCE`. Incluso una respuesta simulada `REFUNDED` **no convierte el pago en reembolsado**.

El endpoint de solo lectura `GET /v1/internal/payments/provider-status-observations?paymentId=<id>` requiere sesión humana con `payments.refund` en el ámbito de ubicación del pedido. Rechaza tokens de servicio y operadores sin ese permiso. El CI ejecuta pruebas PostgreSQL de concurrencia, observaciones duplicadas, discrepancias y ausencia de movimientos `SALE`.

**Pendiente para PixelPay real:** aprovisionar sandbox y SDK/endpoint configurado por el adquirente; consultar exclusivamente el `payment_uuid` guardado de forma autoritativa, validar la estructura real de `TransactionResult`, relacionar moneda/importes/referencia de transacción y conservar evidencia del estado autenticado. Luego desarrollar el adaptador real bajo otra revisión, nunca habilitar pagos con base en datos de callback sin validación.

## Worker integration contract (future; not deployed)

1. A dedicated backend worker (never the public webhook or HTTP request) loads a `payment_exception_refund_requests` row, verifies `APPROVED_NOT_SUBMITTED`, validates actor approvals and reconciles **all capture references and amounts**.
2. Claim the request under a PostgreSQL row lock / reliable outbox, recording a stable **provider-scoped idempotency key** and attempt state in a dedicated execution ledger. Concurrency must not allow two workers to execute the same refund.
3. Commit the claim **before** the external call. Call `adapter.executeRefund` *outside* the database transaction; avoid holding a PostgreSQL lock while waiting on network.
4. Persist the response and raw provider references. `ACCEPTED` or `UNKNOWN` must **not** set `payments.status='REFUNDED'`. On uncertainty call `getRefundStatus`/provider transaction lookup, not blind retries.
5. Only verified settlement/reconciliation permits an atomic payment status transition and audit. Never restore an expired reservation, confirm an order or create a Kardex `SALE` from a late payment/refund.
6. Handle partial refunds, multiple captures, voids, chargebacks, the provider's immutable transaction ID, notifications, reconciliation reports and recovery after process crashes before enabling production.

## Proposed Railway variable names — not yet configured

These names are an **MR Adulán configuration proposal**, not proof of exact PixelPay API field names. Secret values must be stored exclusively in Railway environment secrets, never in the repository.

| Variable | Usage | Current state |
|---|---|---|
| `SIMULATED_PAYMENT_WEBHOOK_SECRET` | local/CI HMAC secret, at least 32 characters | CI generates an ephemeral value |
| `PAYMENT_GATEWAY_PROVIDER` | `disabled` / `simulated` / `pixelpay` | **Not wired; do not set as a live feature flag yet** |
| `PIXELPAY_ENVIRONMENT` | `sandbox` or `production` | Proposed only |
| `PIXELPAY_API_ENDPOINT` | approved sandbox API endpoint | Proposed only; validate against provider account |
| `PIXELPAY_MERCHANT_KEY` | server-side merchant credential | Proposed only |
| `PIXELPAY_SECRET_KEY` | server-side secret used with SDK/verification | Proposed only |
| `PIXELPAY_CALLBACK_URL` | publicly reachable webhook URL | Proposed only; implementation absent |
| `PIXELPAY_VOID_AUTH_USER` | optional authorized void actor depending on contract | Proposed only |

Do not enable a live PixelPay callback route or grant refund execution merely because these environment variables exist.

## PixelPay fact-check before coding the real adapter

Official docs: https://docs.pixelpay.com/ and https://docs.pixelpay.com/page/sdk/use-cases/index?lang=php&locale=es

- Docs provide SDK, API, Sandbox, payment-hash verification (`verifyPaymentHash`), and `doVoid` with a SHA-512 cancellation signature based on merchant user, order ID and secret. **This is not evidence that its callback uses the same HMAC as our simulator.**
- The public material reviewed does **not establish** an unconditional standalone refund API matching our proposed `executeRefund` contract. Confirm separately whether a settled refund (as opposed to a same-day void) is supported, its API/status semantics, permitted timing, reversals, partial refund rules and account eligibility.
- Do not label an auth hold, void or approved refund request as money refunded. Confirm signature format, hosted-payment callback, sandbox credential provisioning, supported currencies and settlement report with the provider.

## PixelPay legacy security primitives — implemented, not connected to payments

`services/catalog-api/pixelpay-legacy-security.ts` now includes:
- `verifyPixelPayLegacyPaymentHash`: compares the documented SDK legacy `MD5(order_id|key_id|secret_key)` hash against a supplied `payment_hash`, without exposing the secret. This weak/legacy hash is **only a response-integrity check**, not a trusted webhook verifier and never sufficient to mark a payment PAID. A fresh backend transaction-status check plus amount, currency, transaction UUID and merchant reconciliation is still required.
- `buildPixelPayLegacyVoidAuthorization`: generates `auth_user = SHA512(authorized_email)` and `void_signature = SHA512(authorized_email|order_id|secret_key)` for the documented same-day void protocol. **It sends no HTTP request, voids no funds, and cannot execute settled refunds.**
- `pixelPayIntegrationReadiness`: explicitly reports payment acceptance and refund execution disabled, regardless of presence of provisional credentials.

Tests use independently calculated MD5/SHA512 known vectors, reject altered hashes, invalid signatures, delimiter injection and short secrets, and assert that the gateway remains disabled. These primitives are not a stand-in for a signed PixelPay callback protocol; no `/v1/webhooks/payments/pixelpay` route exists.

Documentation reference: https://docs.pixelpay.com/page/sdk/use-cases/index?lang=swift&locale=es and https://docs.pixelpay.com/page/sdk/use-cases/index?lang=php&locale=es

## Acceptance gates

- Existing GitHub CI runs Bun unit tests for adapter signature verification, malformed payloads and disabled financial methods, plus real-PostgreSQL checkout/webhook/refund-approval regressions.
- PixelPay sandbox acceptance must later cover signed/unsigned/replayed callbacks, successful/pending/late captures, amount mismatch, concurrent authorized refunds, timeout/UNKNOWN recovery, refund status confirmation, duplicate prevention and reconciliation into the finance ledger.
- **No merge to `main` or Railway production deployment until all applicable tests are green and real provider sandbox evidence is documented.**
