# SPEC — Module 02: Orders, Reservations & Idempotency v1

**Status:** APPROVED FOR IMPLEMENTATION  
**Owner:** MR עדולם  
**Method:** Spec-Driven Development (SDD)  
**Issues:** #14, #15

## 1. Purpose

Move commercial orders out of browser-local state into the server-side Commerce Core and introduce transactional inventory reservations so MR עדולם can accept real orders without overselling or duplicating submissions.

This module must support the current boutique operation and future channels without coupling the order domain to a payment provider.

## 2. Scope

Included:

- server-side Order and OrderItem;
- historical item snapshots;
- public order creation;
- idempotent order creation;
- inventory reservation by variant + location;
- reservation expiry and release;
- order state machine;
- public token-based order tracking;
- public confirm/cancel operations;
- authenticated internal state transitions;
- stock consumption when merchandise leaves MR inventory;
- audit history for order status transitions;
- concurrency protection for the last available unit.

Out of scope:

- financial payment ledger;
- payment authorization;
- shipping provider integration;
- returns processing;
- tax/CAI implementation;
- marketplace settlement.

## 3. Core invariants

1. PostgreSQL is the source of truth for orders and reservations.
2. Browser-local state may keep cart UX state and opaque order references only; it must not be the order system of record.
3. An order item preserves SKU, product name, variant attributes, unit price and currency as a historical snapshot.
4. Available inventory is always `quantity - reserved`.
5. `reserved` and `quantity` must never become negative.
6. Reservation writes and order creation happen inside the same database transaction.
7. Inventory rows are locked before reservation decisions.
8. Concurrent buyers cannot both reserve the last unit.
9. Reusing the same idempotency key with the same normalized request returns the original order.
10. Reusing an idempotency key with a different request returns conflict.
11. Order status and future payment status remain independent.
12. LIRA is not required by this module.

## 4. Order entity

### Order

- `id` BIGSERIAL internal identifier
- `order_number` stable human-readable reference
- `public_token` unguessable token for customer-side access
- `channel`
- `status`
- `currency`
- `subtotal_minor`
- `discount_total_minor`
- `tax_total_minor`
- `shipping_total_minor`
- `grand_total_minor`
- `location_id`
- optional customer name / phone snapshot
- `idempotency_key`
- `idempotency_hash`
- optional cancellation reason
- `created_at` / `updated_at`

### OrderItem

- `id`
- `order_id`
- nullable `variant_id`
- `sku_snapshot`
- `product_name_snapshot`
- `variant_snapshot` JSON
- `quantity`
- `unit_price_minor`
- `currency`
- `line_total_minor`
- `created_at`

## 5. Channels

Supported v1 values:

- `STORE`
- `PHONE`
- `WHATSAPP`
- `WEB`
- `APP`
- `MARKETPLACE`

The initial storefront uses `WEB`.

## 6. State machine

Initial public order state:

`PENDING_CONFIRMATION`

Allowed transitions:

```text
PENDING_CONFIRMATION -> CONFIRMED | CANCELLED
CONFIRMED           -> PROCESSING | CANCELLED
PROCESSING          -> READY | CANCELLED
READY               -> SHIPPED | COMPLETED | CANCELLED
SHIPPED             -> DELIVERED
DELIVERED           -> COMPLETED
COMPLETED           -> terminal
CANCELLED           -> terminal
```

Rules:

- invalid transitions return HTTP 409;
- cancellation releases active reservations;
- confirmation removes the temporary expiry from active reservations;
- shipping consumes reserved inventory because the unit physically leaves the origin location;
- direct pickup completion from READY also consumes inventory;
- every successful transition appends an OrderStatusHistory record.

## 7. Inventory reservation

### InventoryReservation

- `id`
- `order_id`
- `variant_id`
- `location_id`
- `quantity`
- `status`: ACTIVE / RELEASED / CONSUMED / EXPIRED
- nullable `expires_at`
- `created_at` / `updated_at`

Default pending reservation TTL: 30 minutes, configurable by environment.

On creation:

1. lock inventory row;
2. calculate available quantity;
3. reject if insufficient;
4. increment `inventory.reserved`;
5. create ACTIVE reservation;
6. commit order and reservation atomically.

On confirmation:

- ACTIVE reservation remains reserved;
- `expires_at` becomes null.

On cancellation:

- decrement `inventory.reserved`;
- mark reservation RELEASED.

On expiry:

- decrement `inventory.reserved`;
- mark reservation EXPIRED;
- pending order becomes CANCELLED with reason `reservation_expired`.

On shipment / pickup completion:

- decrement both `inventory.quantity` and `inventory.reserved`;
- write a SALE inventory movement;
- mark reservation CONSUMED.

## 8. Idempotency

Public order creation requires:

`Idempotency-Key: <opaque-client-generated-key>`

The server stores:

- idempotency key;
- SHA-256 hash of the normalized order request.

Behavior:

- same key + same hash -> return original order;
- same key + different hash -> HTTP 409 `idempotency_conflict`;
- concurrent duplicate submissions must converge on one order.

## 9. Public API

### Create order

`POST /v1/orders`

Headers:

- `Content-Type: application/json`
- `Idempotency-Key`

Body:

```json
{
  "channel": "WEB",
  "locationId": 1,
  "customer": {
    "name": "Optional",
    "phone": "Optional"
  },
  "items": [
    {
      "variantId": 12,
      "quantity": 1
    }
  ]
}
```

`locationId` may be omitted; the Commerce Core selects the first active store location.

### Track order

`GET /v1/orders/:id?token=<public_token>`

### Confirm order

`POST /v1/orders/:id/confirm?token=<public_token>`

### Cancel order

`POST /v1/orders/:id/cancel?token=<public_token>`

## 10. Internal API

Protected by `x-internal-key` matching `INTERNAL_API_TOKEN`.

- `GET /v1/internal/orders`
- `GET /v1/internal/orders/:id`
- `PATCH /v1/internal/orders/:id/status`
- `POST /v1/internal/reservations/expire`

The public storefront proxy must never proxy `/v1/internal/*`.

## 11. Concurrency

Reservation transactions lock inventory rows in ascending variant-id order before modifying `reserved`.

This prevents:

- two buyers reserving the same last unit;
- negative availability;
- deadlock-prone inconsistent locking order.

The transaction is the correctness boundary.

## 12. Monetary rules

- order API totals use integer minor units;
- source catalog prices are converted from current NUMERIC major units into exact integer minor values at order creation;
- currency is snapshotted on each line and the order;
- mixed-currency order creation is rejected.

A later catalog migration may move source prices to minor-unit storage directly.

## 13. Storefront behavior

The storefront must:

- use the exact variant id selected by the customer;
- send server order creation rather than persisting authoritative orders in `localStorage`;
- keep only opaque order id/token references locally for convenience;
- generate and reuse an idempotency key during retry;
- fetch order status from the API;
- stop mutating authoritative inventory locally.

## 14. Acceptance criteria

### Orders

- create order through API;
- query order with token;
- confirm order;
- cancel order;
- reject invalid transition;
- preserve historical item snapshot after product/price changes.

### Reservations

- reservation increments `reserved`;
- cancellation releases it;
- expiry releases it;
- shipment or pickup completion consumes it;
- concurrent buyers cannot reserve the same final unit;
- available inventory never goes below zero.

### Idempotency

- repeated identical submission returns same order;
- different payload with same key returns conflict;
- duplicate concurrent retry cannot create two orders.

### Delivery gate

- backend integration tests pass against PostgreSQL;
- storefront smoke tests pass;
- PR CI is green;
- merge to `main`;
- Railway `catalog-api` and `storefront` deployments report SUCCESS.

## 15. Traceability

```text
Honduras market diagnosis
-> Strategic Baseline Phase 2
-> Issue #14 + Issue #15
-> M02 Orders, Reservations & Idempotency
-> Implementation
-> CI
-> Railway production verification
```
