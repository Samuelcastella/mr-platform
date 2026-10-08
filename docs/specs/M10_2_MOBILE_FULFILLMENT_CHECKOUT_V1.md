# SPEC — M10.2 Native Mobile Fulfillment & Checkout v0.3

**Project:** MR עדולם  
**Status:** APPROVED FOR IMPLEMENTATION  
**Date:** 2026-10-08  
**Issue:** #39  
**Dependencies:** M03 Checkout, M04 Fulfillment, M10.1 Mobile Order Reservation  
**Method:** Spec-Driven Development (SDD)

## 1. Goal

Allow an APP-channel Order created in the MR עדולם mobile client to continue through delivery selection and offline payment orchestration without duplicating Commerce Core rules.

## 2. Architecture

```text
Mobile Order
   ↓
Geography / Delivery Quote
   ↓
POST /v1/fulfillments
   ↓
POST /v1/checkouts
   ↓
Order CONFIRMED
Payment PENDING
Fulfillment PENDING
```

Commerce Core remains authoritative for shipping price, ETA, order total, payment amount and valid state transitions.

## 3. Public geography contract

Add:

`GET /v1/geography/countries/HN/subdivisions`

Response:

- countryCode: HN
- subdivisions:
  - code
  - name

v0.3 uses the current Honduras department names already maintained by M04.

The endpoint exists so clients do not hardcode an independent geography list.

## 4. Delivery selection

Supported paths:

### Store pickup

- type: STORE_PICKUP
- no department required
- shipping is server-defined as zero
- payment methods shown by mobile:
  - CASH
  - BANK_TRANSFER

### Delivery

The user selects:

- department
- municipality
- address line
- optional reference

The app calls:

`GET /v1/fulfillment/options?department=...`

It only enables delivery options whose quote has:

- quoteRequired = false
- shippingMinor not null
- ETA values present

Possible types:

- LOCAL_DELIVERY
- COURIER

Payment methods shown:

- BANK_TRANSFER
- CASH_ON_DELIVERY

## 5. Manual quote fallback

If the Commerce Core returns only options with `quoteRequired=true`, the mobile client must not invent shipping cost or ETA.

It offers the configured WhatsApp handoff, or storefront fallback if WhatsApp is unavailable.

## 6. Fulfillment creation

`POST /v1/fulfillments`

The app sends only:

- orderId
- orderToken
- type
- department
- municipality
- addressLine
- addressReference
- recipientName
- recipientPhone

Forbidden client authority:

- shippingMinor
- quotedShippingMinor
- etaMinDays
- etaMaxDays
- currency

A dedicated Idempotency-Key is reused after uncertain network outcomes.

## 7. Checkout creation

Checkout always occurs after Fulfillment.

`POST /v1/checkouts`

The app sends:

- orderId
- orderToken
- paymentMethod

The app never sends authoritative amount/currency/total.

A separate Idempotency-Key is used for checkout and reused on uncertain retry.

## 8. Payment semantics

v0.3 uses the existing offline payment methods:

- CASH
- BANK_TRANSFER
- CASH_ON_DELIVERY

All are represented as `PENDING` at initial checkout under the current M03 contract.

The UI must never say “paid” when the server says PENDING.

## 9. State separation

The final mobile confirmation shows separately:

- Order status
- Fulfillment status
- Payment status

Example:

```text
Order: CONFIRMED
Fulfillment: PENDING
Payment: PENDING
```

No combined fake “completed” state.

## 10. Failure recovery

### Fulfillment uncertain network result

Retry same payload with the same fulfillment idempotency key.

### Checkout uncertain network result

Retry same payload with the same checkout idempotency key.

### Delivery quote changed

Re-query options and let server decide.

### Checkout conflict

Do not create another Order.

The app keeps the current order/fulfillment references and presents a recoverable message.

## 11. Security

No new secret is embedded.

Allowed public configuration remains:

- EXPO_PUBLIC_API_BASE_URL
- EXPO_PUBLIC_STOREFRONT_URL
- EXPO_PUBLIC_WHATSAPP_URL

The client never receives internal API tokens or payment/fiscal secrets.

## 12. Invariants

MOB-031 — Mobile geography comes from Commerce Core.  
MOB-032 — Client never authors shipping amount.  
MOB-033 — Client never authors payment amount.  
MOB-034 — Fulfillment precedes Checkout.  
MOB-035 — COD is unavailable for STORE_PICKUP.  
MOB-036 — CASH is shown only for STORE_PICKUP in v0.3.  
MOB-037 — Manual-quote delivery is not auto-created.  
MOB-038 — Fulfillment retry reuses one operation key.  
MOB-039 — Checkout retry reuses a separate operation key.  
MOB-040 — PENDING Payment is never presented as paid.  
MOB-041 — Order, Payment and Fulfillment states remain separate.

## 13. Acceptance

- geography endpoint returns all Honduras departments;
- mobile loads department selector from API;
- STORE_PICKUP path requires no address;
- delivery path requires department/municipality/address;
- configured zone shows server quote/ETA;
- unconfigured zone shows manual-quote handoff;
- fulfillment creation cannot send client shipping;
- fulfillment retry is idempotent;
- checkout follows fulfillment;
- CASH works for pickup;
- BANK_TRANSFER works for pickup/delivery;
- COD shown only for delivery;
- final screen displays separate server states;
- typecheck green;
- Android export green;
- fulfillment regression green.

## 14. Definition of Done

```text
Geography API
→ Mobile delivery selector
→ Idempotent Fulfillment
→ Idempotent Checkout
→ Separate state confirmation
→ Backend tests
→ Mobile typecheck/export
→ CI
```
