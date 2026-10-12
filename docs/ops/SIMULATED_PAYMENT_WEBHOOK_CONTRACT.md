# Simulated payment webhook — acceptance contract (non-production adapter)

This is an **isolated simulated gateway adapter** in `services/catalog-api/simulated-payment-webhook.ts`. It does **not** prove compatibility with a real payment provider, and it does not issue refunds.

## Endpoint and signature

`POST /v1/webhooks/payments/simulated`

The request MUST include `x-simulated-signature`: 64 hexadecimal characters representing HMAC-SHA256 of the **exact UTF-8 request body bytes**, keyed by `SIMULATED_PAYMENT_WEBHOOK_SECRET` (at least 32 characters). Empty/missing secret disables the endpoint (HTTP 503); invalid signature returns HTTP 401. The signature is checked before parsing JSON or touching the database.

Example signed payload (values must match an existing `SIMULATED` payment):

```json
{
  "eventId": "sim-capture-2026-0001",
  "paymentId": 123,
  "type": "payment.succeeded",
  "providerReference": "sim-provider-capture-0001",
  "amountMinor": 32000,
  "currency": "HNL"
}
```

Only the `payment.succeeded` event is supported. Amounts are in minor units. The `paymentId` must already exist in `payments` with `provider = 'SIMULATED'`; ordinary checkouts currently create `OFFLINE` payments, so this adapter is not an integrated provider-authorization flow.

## Transactional outcomes

All event-state changes take place within one PostgreSQL transaction. The event ID is claimed atomically with `INSERT ... ON CONFLICT DO NOTHING`; signed retries with identical bytes replay the original outcome without repeating payment history or audit; reuse of the same event ID with a changed body returns HTTP 409 `event_id_conflict`.

| Outcome | Conditions | Database effect |
|---|---|---|
| `PAID` | Pending SIMULATED payment; confirmed order; every reservation active and not expired; captured amount/currency match | Sets payment to PAID, inserts one payment status history record and audit record |
| `ALREADY_PAID` | Payment is already paid and amount/currency match | Persists the received event but makes no new payment-status transition |
| `LATE_PAYMENT_EXPIRED_RESERVATION` | Order cancelled/not confirmed, or reservation expired/consumed/missing, or otherwise ineligible | Writes a `payment_webhook_exceptions` row and one audit record; **no automatic sale**, inventory movement, order reactivation or payment transition |
| `PAYMENT_AMOUNT_MISMATCH` | Captured amount/currency do not match the authoritative payment | Writes a dedicated exception and one audit record; **no automatic payment transition** |

Every event stores a signed-body hash, provider capture reference, captured amount and currency for later investigation. Every exception starts in `PENDING_REVIEW`; operators must reconcile and decide whether to revalidate or refund outside this adapter. **An exception is not itself a refund.**

Unknown/non-simulated payment identifiers return HTTP 404 without persisting a stranded `PROCESSING` claim.

## Operations: read-only exception queue

`GET /v1/internal/payments/webhook-exceptions` requires the existing internal authorization and `payments.read` permission. Defaults to unresolved `PENDING_REVIEW` exceptions; `?status=ALL` returns the latest 100 regardless of review state. Each record includes event/payment/order IDs, order and payment status, the provider capture reference, captured amount/currency and the expected payment amount/currency. This read-only endpoint never reactivates inventory or requests refunds.

## Controlled exception resolution and refund requests

`PATCH /v1/internal/payments/webhook-exceptions/:id/review` is implemented in `payment-exception-review.ts`. It requires a **logged-in human staff session**, a valid CSRF token, an `idempotency-key` of 8–128 characters, a documented reason (12–500 characters), and location-scoped authorization. Legacy machine tokens **cannot** approve review actions.

```json
{ "action": "START_REVIEW", "reason": "Investigar conciliación de captura tardía" }
```

| Current state | Action | Required permission | New state |
|---|---|---|---|
| `PENDING_REVIEW` | `START_REVIEW` | `payments.exceptions.review` | `IN_REVIEW` |
| `IN_REVIEW` | `REQUEST_REVALIDATION` | `payments.exceptions.review` | `REVALIDATION_REQUESTED` |
| `IN_REVIEW` | `REQUEST_REFUND` | `payments.refund` | `REFUND_REQUESTED` |

- Finance approval for `REQUEST_REFUND` requires a **different human user from the initial reviewer**; a manager lacks the refund permission by default.
- `payment_webhook_exception_review_actions` records an immutable-style action history with globally unique idempotency keys. The audit event `payment.webhook_exception_reviewed` is written **in the same transaction**.
- `payment_exception_refund_requests` stores `APPROVED_NOT_SUBMITTED` requests with a unique `payment_id`, source exception, captured provider reference, captured amount/currency and approver. **There is no API request to any payment provider and no update to `payments.status`**. Multiple signed event IDs for the same payment cannot generate two approved refund requests.
- `GET /v1/internal/payments/refund-requests` exposes the latest 100 approved-but-unsubmitted refund requests and capture evidence. It requires a **human staff session** with `payments.refund`; a manager without this permission and any legacy machine token are rejected. This read-only view is not a refund execution endpoint.
- `REQUEST_REVALIDATION` does **not** reopen an order or reservation and does not create Kardex movements; separate stock/payment revalidation is necessary.
- Duplicate identical authorized requests return `replayed: true` without a second audit; changed request payloads using an existing idempotency key return `409 idempotency_conflict`.

**Refund execution is NOT implemented.** The actual bank/gateway refund, confirmation webhook, refund amount policy, multi-capture support, settlement reconciliation, customer notification and resulting `REFUNDED` state must remain blocked until a provider-specific sandbox adapter and independent evidence are available. Never report `REFUND_REQUESTED` or `APPROVED_NOT_SUBMITTED` as money returned.

## Acceptance and outstanding work

`services/catalog-api/test/checkout.integration.ts` runs against real PostgreSQL from the general CI workflow and verifies: valid and invalid signatures, concurrent event replay, one payment transition and audit, conflicting event identifiers, late capture with exactly one exception/audit, missing payment and mismatched amount, and zero automatic `SALE` Kardex entries for a late event.

**Limitations:** fixture payments are relabeled as SIMULATED within the disposable test database; no commercial gateway's signature verification, transaction lookup, callback semantics, settlement report, chargeback, capture/refund API, or sandbox has been homologated. No live credentials should be stored in source control. Do not promote this simulated adapter to production gateway integration.

Deploy only after CI is green, the full checkout-to-capture architecture for a chosen provider is built, settlement/reconciliation and refund procedures are implemented, and provider sandbox acceptance evidence is recorded.
