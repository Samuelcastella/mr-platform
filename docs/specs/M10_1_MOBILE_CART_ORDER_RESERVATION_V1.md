# SPEC — M10.1 Mobile Product Detail, Cart & Order Reservation v0.2

**Project:** MR עדולם  
**Status:** APPROVED FOR IMPLEMENTATION  
**Date:** 2026-10-08  
**Issue:** #36  
**Dependency:** M10 Mobile Shell, M01 Catalog/Inventory, M02 Orders/Reservations  
**Method:** Spec-Driven Development (SDD)

## 1. Goal

Upgrade the MR עדולם mobile client from read-only catalog browsing to a real APP sales channel while keeping Commerce Core authoritative for product price, variant stock, order totals and reservations.

## 2. Architecture

```text
Mobile UI
  ↓
GET /v1/products
  ↓
local ephemeral cart
  ↓
POST /v1/orders  channel=APP
  ↓
Commerce Core reservation
  ↓
Order number + WhatsApp/storefront handoff
```

The mobile client never writes inventory directly and never calculates authoritative order totals.

## 3. Scope

v0.2 includes:

- product detail screen;
- exact variant selection by server variant id;
- size/color/SKU visibility;
- stock-aware quantity controls;
- in-memory cart;
- minimum customer contact capture;
- native Order creation through the public order contract;
- idempotency key reuse on network retry;
- order reservation summary;
- WhatsApp handoff when `EXPO_PUBLIC_WHATSAPP_URL` exists;
- storefront fallback;
- catalog refresh after successful reservation.

## 4. Deliberate non-goals

Not in v0.2:

- native payment;
- native fulfillment creation;
- persistent customer account;
- local order ledger;
- local authoritative price cache;
- offline checkout;
- cart persistence across app restarts;
- embedded internal API credentials;
- LIRA integration.

## 5. Product detail

The detail screen uses the product/variant payload already returned by Commerce Core.

For each variant show:

- SKU;
- size when available;
- color when available;
- price;
- available quantity.

Only variants with `available > 0` are addable.

The UI may display stock optimistically, but the server remains authoritative at Order creation.

## 6. Cart model

Ephemeral line:

- variantId
- productId
- productName
- sku
- size
- color
- unitPriceDisplay
- currency
- quantity
- visibleAvailable

Rules:

- one line per variantId;
- quantity >= 1;
- quantity <= visibleAvailable;
- changing cart content invalidates a pending idempotency key;
- display totals are informational only.

## 7. Customer fields

v0.2 asks for:

- name;
- phone.

Both are required by the mobile UI for operational follow-up.

Commerce Core still performs its own validation and stores only the Order commercial snapshot.

## 8. Order creation

Request:

`POST /v1/orders`

Headers:

- `Content-Type: application/json`
- `Idempotency-Key: mobile-order-*`

Body:

```json
{
  "channel": "APP",
  "customer": {
    "name": "...",
    "phone": "..."
  },
  "items": [
    {
      "variantId": 123,
      "quantity": 2
    }
  ]
}
```

The mobile client does not send authoritative prices or totals.

## 9. Idempotency

The app generates one idempotency key when a submission attempt begins.

If the network result is uncertain, retrying the unchanged cart reuses the same key.

Changing cart content clears that key.

After a successful order the key is cleared.

This prevents duplicate orders caused by taps or connection retry.

## 10. Stock conflicts

If Commerce Core returns `409 insufficient_stock`:

1. show a specific stock-conflict message;
2. invalidate the attempt key;
3. refresh catalog;
4. keep the user in a recoverable state.

The app does not override the server.

## 11. Reservation semantics

A successful mobile Order is not represented as paid.

The order remains governed by M02/M03 state rules.

v0.2 presents it as:

- reservation/order created;
- pending confirmation/payment workflow.

The client must not claim payment success.

## 12. Handoff

Preferred configured handoff:

`EXPO_PUBLIC_WHATSAPP_URL`

The app appends a message containing:

- MR עדולם;
- order number;
- request to continue confirmation.

If WhatsApp is not configured, the primary continuation opens the public storefront.

No WhatsApp number is hardcoded in source.

## 13. Security

The mobile bundle may contain only public configuration.

Allowed:

- `EXPO_PUBLIC_API_BASE_URL`
- `EXPO_PUBLIC_STOREFRONT_URL`
- `EXPO_PUBLIC_WHATSAPP_URL`

Forbidden:

- Postgres credentials;
- internal API token;
- payment provider secret;
- fiscal authorization data;
- LIRA credentials.

## 14. UX states

Required states:

- catalog loading;
- catalog error;
- catalog empty;
- product detail;
- sold-out variant;
- cart empty;
- cart populated;
- order submitting;
- stock conflict;
- generic order failure;
- order success.

Touch targets should remain at least approximately 44 pt.

## 15. Invariants

MOB-021 — Mobile never becomes inventory source of truth.  
MOB-022 — Mobile never becomes price source of truth.  
MOB-023 — Order channel is APP.  
MOB-024 — One cart line per variant.  
MOB-025 — Visible quantity cannot exceed visible availability.  
MOB-026 — Server stock conflict overrides local state.  
MOB-027 — Uncertain retry reuses idempotency key.  
MOB-028 — Cart mutation invalidates prior idempotency key.  
MOB-029 — Successful reservation is not shown as payment success.  
MOB-030 — No secret is embedded in mobile config.

## 16. Acceptance

- active catalog still loads;
- user opens product detail;
- user selects an available variant;
- user adds variant to cart;
- user increments/decrements without exceeding visible stock;
- user removes line;
- user submits name/phone + cart;
- request uses `channel=APP`;
- duplicate tap is guarded while submitting;
- network retry keeps same key;
- stock conflict triggers refresh;
- success displays order number;
- catalog refresh reflects reservation;
- WhatsApp handoff uses configured public URL;
- no WhatsApp config falls back to storefront;
- TypeScript typecheck passes;
- Android Expo export passes.

## 17. Definition of Done

```text
Spec
→ Product detail
→ Cart
→ Idempotent APP Order
→ Recoverable states
→ CI typecheck
→ Android export
```

v0.2 is complete when the native app can safely create a Commerce Core order reservation without duplicating checkout/payment logic.
