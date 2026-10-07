# SPEC — Module 03: Checkout & Payment Orchestration v1

**Status:** APPROVED FOR IMPLEMENTATION  
**Owner:** MR עדולם  
**Method:** Spec-Driven Development (SDD)  
**Maps to:** SPEC-MR-004 — Payments & Checkout  
**Issue:** #16

## 1. Purpose

Make checkout authoritative on the server and support the payment methods that matter to the initial Honduras operation without coupling MR עדולם to LIRA or any single financial provider.

The server owns:

- order amount;
- checkout state;
- commercial payment record;
- payment attempt idempotency;
- payment evidence;
- authorization for manual payment confirmation.

The browser may choose a payment method and submit evidence, but it cannot define or overwrite the payable amount.

## 2. Scope

Included in v1:

- CheckoutSession;
- Payment;
- PaymentAttempt;
- CASH;
- BANK_TRANSFER;
- CASH_ON_DELIVERY;
- server-authoritative amount;
- idempotent checkout creation;
- bank-transfer evidence/reference without automatic approval;
- internal payment confirmation/rejection;
- payment-provider interface for future adapters;
- automatic order confirmation when checkout is accepted;
- order and payment state kept independent.

Out of scope:

- card acquiring;
- LIRA implementation;
- lending / credit;
- refunds;
- settlement reconciliation;
- fiscal invoicing;
- courier COD reconciliation;
- chargebacks.

## 3. Architectural boundary

MR עדולם owns the **commercial payment state** associated with an order.

External financial systems may later perform the actual movement of money.

MR must not contain:

- a financial ledger;
- bank balances;
- inter-account transfers;
- LIRA accounting logic.

LIRA may later implement the same PaymentProvider contract as any other provider.

## 4. CheckoutSession

Fields:

- id
- public_token
- order_id
- status: OPEN / COMPLETED / CANCELLED / EXPIRED
- payment_method
- currency
- amount_minor
- idempotency_key
- idempotency_hash
- metadata JSON
- created_at
- updated_at

Rules:

- one checkout session is created from an existing order;
- amount and currency are copied from the server-side order;
- client-supplied totals are ignored / rejected;
- checkout can only be created for PENDING_CONFIRMATION or CONFIRMED orders;
- accepting a checkout moves a PENDING_CONFIRMATION order to CONFIRMED;
- checkout creation and payment creation occur atomically.

## 5. Payment

Fields:

- id
- checkout_session_id
- order_id
- provider
- method
- status
- amount_minor
- currency
- external_reference nullable
- evidence JSON
- created_at
- updated_at

Methods:

- CASH
- BANK_TRANSFER
- CASH_ON_DELIVERY

Statuses:

- PENDING
- PAID
- FAILED
- CANCELLED
- REFUNDED
- PARTIALLY_REFUNDED

v1 creates all three offline methods as PENDING.

Important:

- COD order may be CONFIRMED while Payment remains PENDING.
- CASH remains PENDING until collection is confirmed.
- BANK_TRANSFER remains PENDING even when evidence/reference is submitted.
- evidence never means payment approval.

## 6. PaymentAttempt

Fields:

- id
- payment_id
- provider
- idempotency_key
- idempotency_hash
- status
- provider_reference nullable
- response JSON
- created_at
- updated_at

Statuses:

- PENDING
- SUCCEEDED
- FAILED

For offline methods, the initial attempt remains PENDING.

The structure exists so future online providers can safely retry without creating duplicate charges.

## 7. PaymentProvider interface

Conceptual contract:

```text
PaymentProvider.authorize(request)
-> provider
-> status
-> providerReference?
-> response
```

v1 provider:

- OFFLINE

Future adapters may include:

- LIRA
- bank/acquirer
- hosted card processor
- other providers

Orders must never call LIRA directly.

## 8. Checkout creation

`POST /v1/checkouts`

Required header:

`Idempotency-Key`

Body:

```json
{
  "orderId": 123,
  "orderToken": "opaque-order-token",
  "paymentMethod": "BANK_TRANSFER",
  "evidence": {
    "reference": "optional bank reference",
    "note": "optional note"
  }
}
```

Server behavior:

1. validate idempotency key;
2. normalize request;
3. validate order token;
4. lock order;
5. ensure order is PENDING_CONFIRMATION or CONFIRMED;
6. read amount/currency from Order;
7. reject any client amount if supplied;
8. create CheckoutSession;
9. create Payment;
10. create PaymentAttempt;
11. if order is PENDING_CONFIRMATION, confirm it and remove reservation expiry;
12. commit atomically;
13. return checkout + payment + order projection.

## 9. Idempotency

Same key + same normalized request:

- returns the original checkout;
- does not create another Payment;
- does not create another PaymentAttempt.

Same key + different normalized request:

- HTTP 409 `idempotency_conflict`.

The database enforces unique idempotency keys.

## 10. Bank transfer evidence

Evidence may include:

- reference;
- note;
- optional future media/object reference.

Evidence is informational until an authorized operator verifies it.

Submitting evidence must never set Payment to PAID.

## 11. Internal payment operations

Protected with `x-internal-key`.

Endpoints:

- `GET /v1/internal/payments`
- `GET /v1/internal/payments/:id`
- `PATCH /v1/internal/payments/:id/status`

Allowed v1 transitions:

```text
PENDING -> PAID | FAILED | CANCELLED
PAID    -> terminal for v1
FAILED  -> terminal for v1
CANCELLED -> terminal for v1
```

Refund transitions are reserved for a later returns/refunds spec.

Every manual status change creates PaymentStatusHistory.

## 12. Public checkout read

`GET /v1/checkouts/:id?token=<checkout-token>`

Returns:

- checkout status;
- authoritative amount;
- currency;
- payment method;
- payment status;
- order id/order number.

No private internal evidence or staff notes are exposed unless explicitly part of the public contract.

## 13. Storefront behavior

The storefront shall:

- keep cart as temporary UX state;
- create the server-side Order;
- create server-side Checkout;
- select CASH, BANK_TRANSFER or CASH_ON_DELIVERY;
- send transfer reference/note as evidence only;
- never calculate the authoritative final payable amount;
- save only opaque order/checkout references for later tracking;
- preserve the checkout idempotency key across retry.

## 14. Checkout / Order / Payment independence

Example COD:

```text
Order.status   = CONFIRMED
Payment.status = PENDING
method         = CASH_ON_DELIVERY
```

This is valid and expected.

Order fulfillment may proceed while payment remains pending according to future fulfillment rules.

## 15. Security

- public checkout requires order token;
- internal payment mutation requires INTERNAL_API_TOKEN;
- storefront proxy blocks `/v1/internal/*`;
- client cannot mark payment PAID;
- client cannot supply the authoritative amount;
- provider secrets, when introduced, remain server-side.

## 16. Acceptance criteria

1. Checkout amount always matches server-side Order total.
2. Client-supplied amount cannot change payable value.
3. CASH checkout creates PENDING payment.
4. BANK_TRANSFER checkout creates PENDING payment with evidence preserved.
5. CASH_ON_DELIVERY checkout creates PENDING payment and CONFIRMED order.
6. Repeated checkout request with same idempotency key creates no duplicate payment/attempt.
7. Same idempotency key with different request returns 409.
8. Public client cannot set payment PAID.
9. Internal authorized action can move PENDING -> PAID.
10. Payment and Order states are independent.
11. MR operates without LIRA.
12. PostgreSQL integration tests pass.
13. Storefront smoke tests pass.
14. Railway catalog-api/storefront deployments reach SUCCESS.

## 17. Traceability

```text
Honduras payment reality
-> Strategic Baseline Phase 3
-> Issue #16
-> M03 Checkout & Payment Orchestration
-> Code
-> PostgreSQL integration tests
-> CI
-> Railway production verification
```
