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

## Acceptance and outstanding work

`services/catalog-api/test/checkout.integration.ts` runs against real PostgreSQL from the general CI workflow and verifies: valid and invalid signatures, concurrent event replay, one payment transition and audit, conflicting event identifiers, late capture with exactly one exception/audit, missing payment and mismatched amount, and zero automatic `SALE` Kardex entries for a late event.

**Limitations:** fixture payments are relabeled as SIMULATED within the disposable test database; no commercial gateway's signature verification, transaction lookup, callback semantics, settlement report, chargeback, capture/refund API, or sandbox has been homologated. No live credentials should be stored in source control. Do not promote this simulated adapter to production gateway integration.

Deploy only after CI is green, the full checkout-to-capture architecture for a chosen provider is built, settlement/reconciliation and refund procedures are implemented, and provider sandbox acceptance evidence is recorded.
