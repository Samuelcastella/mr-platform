# SPEC — Module 04: Fulfillment & Logistics v1

**Status:** APPROVED FOR IMPLEMENTATION  
**Owner:** MR עדולם  
**Method:** Spec-Driven Development (SDD)  
**Maps to:** SPEC-MR-005 — Fulfillment & Logistics  
**Issue:** #17

## 1. Purpose

Implement the physical fulfillment lifecycle for MR עדולם in Honduras without coupling Orders or Payments to a specific courier.

The system must support:

- store pickup;
- local delivery;
- future courier adapters;
- department selection before confirmation;
- delivery quote / ETA lookup;
- address snapshots with descriptive references;
- normalized tracking;
- delivery attempts;
- failed delivery;
- proof of delivery;
- return to origin;
- Cash on Delivery collection tracked separately from commercial Payment.

## 2. Core boundaries

Order = commercial commitment.  
Payment = commercial payment state.  
Fulfillment = physical movement of merchandise.

These states are related but independent.

A delivered package does not automatically mean payment has been reconciled.

## 3. Fulfillment entity

Fields:

- id
- public_token
- order_id
- type
- status
- provider
- tracking_reference
- department
- municipality
- address_line
- address_reference
- recipient_name
- recipient_phone
- quoted_shipping_minor
- currency
- eta_min_days
- eta_max_days
- proof_of_delivery JSON
- created_at
- updated_at

Types:

- STORE_PICKUP
- LOCAL_DELIVERY
- COURIER

Statuses:

- PENDING
- PREPARING
- READY
- DISPATCHED
- OUT_FOR_DELIVERY
- DELIVERED
- FAILED
- RETURNING
- RETURNED
- CANCELLED

## 4. Delivery zones

MR must not hardcode unverifiable delivery prices or times into business logic.

A configurable DeliveryZone stores:

- department
- service_type
- active
- shipping_minor nullable
- currency
- eta_min_days nullable
- eta_max_days nullable
- provider
- notes

The customer selects one of the 18 Honduran departments:

- Atlántida
- Choluteca
- Colón
- Comayagua
- Copán
- Cortés
- El Paraíso
- Francisco Morazán
- Gracias a Dios
- Intibucá
- Islas de la Bahía
- La Paz
- Lempira
- Ocotepeque
- Olancho
- Santa Bárbara
- Valle
- Yoro

The storefront asks the API for the configured delivery option before final confirmation.

If no active rate / ETA exists, the server returns a quote-required response rather than inventing a price or delivery promise.

## 5. Public delivery quote API

`GET /v1/fulfillment/options?department=Cortés`

Response example:

```json
{
  "department": "Cortés",
  "options": [
    {
      "type": "LOCAL_DELIVERY",
      "provider": "MR",
      "shippingMinor": 0,
      "currency": "HNL",
      "etaMinDays": 1,
      "etaMaxDays": 2,
      "quoteRequired": false
    }
  ]
}
```

If commercial configuration is missing:

```json
{
  "department": "Olancho",
  "options": [
    {
      "type": "COURIER",
      "provider": null,
      "shippingMinor": null,
      "currency": "HNL",
      "etaMinDays": null,
      "etaMaxDays": null,
      "quoteRequired": true
    }
  ]
}
```

## 6. Fulfillment creation

`POST /v1/fulfillments`

Required:

- Order id/token
- fulfillment type
- recipient
- department
- municipality
- address
- descriptive reference

Rules:

- the public fulfillment plan is created **before checkout** while the order is PENDING_CONFIRMATION (or already CONFIRMED);
- one fulfillment plan per order in v1;
- shipping cost and ETA are copied from server DeliveryZone config;
- the server updates Order.shipping_total_minor and Order.grand_total_minor before checkout so checkout charges the authoritative delivered total;
- once checkout exists, the public fulfillment plan cannot be replaced;
- operational fulfillment transitions begin only after checkout has confirmed the order;
- client cannot set authoritative shipping price / ETA;
- STORE_PICKUP does not require delivery address;
- LOCAL_DELIVERY / COURIER require department + municipality + address.

## 7. State machine

```text
PENDING -> PREPARING | CANCELLED
PREPARING -> READY | CANCELLED
READY -> DISPATCHED | DELIVERED | CANCELLED
DISPATCHED -> OUT_FOR_DELIVERY | FAILED
OUT_FOR_DELIVERY -> DELIVERED | FAILED
FAILED -> OUT_FOR_DELIVERY | RETURNING
RETURNING -> RETURNED
DELIVERED -> terminal
RETURNED -> terminal
CANCELLED -> terminal
```

Direct READY -> DELIVERED supports store pickup.

Every transition creates FulfillmentStatusHistory.

## 8. Tracking events

FulfillmentTrackingEvent:

- id
- fulfillment_id
- event_type
- status
- description
- provider_event_id nullable
- location_text nullable
- occurred_at
- created_at

Events are immutable.

Future courier webhooks will normalize provider-specific events into this model.

## 9. Delivery attempts

DeliveryAttempt:

- id
- fulfillment_id
- attempt_number
- status
- reason
- occurred_at
- actor

Statuses:

- SUCCESS
- FAILED
- REJECTED

A failed attempt must preserve reason.

A subsequent retry creates a new attempt; it never overwrites history.

## 10. Proof of Delivery

Proof can include metadata references such as:

- recipient name
- signed/received-by name
- delivery note
- photo/object reference
- provider proof reference
- timestamp

The database stores metadata, not arbitrary raw binary files.

## 11. COD collection

CODCollection is separate from Payment.

Fields:

- id
- fulfillment_id
- payment_id
- status
- expected_amount_minor
- collected_amount_minor
- currency
- collector_reference
- collected_at
- reconciled_at

Statuses:

- PENDING
- COLLECTED
- FAILED
- RECONCILED

Rules:

- CODCollection is created when a COD fulfillment is dispatched and a CASH_ON_DELIVERY Payment exists;
- delivery and collection are separate facts;
- a successful delivery attempt may record CODCollection as COLLECTED;
- DELIVERED or COLLECTED does **not** automatically set Payment = PAID;
- only an explicit authorized RECONCILED transition, after validating collected vs expected amount, moves the linked Payment from PENDING to PAID;
- every COD status transition is auditable.

## 12. Return to origin

RETURNED means logistics returned the physical parcel to MR.

It does not automatically return inventory to sellable stock.

RETURNED creates a ReturnInspection in PENDING state. An authorized inspection must choose one disposition:

- RESTOCK
- DAMAGED
- QUARANTINE
- RETURN_TO_SUPPLIER

Only RESTOCK re-enters inventory and writes an auditable CUSTOMER_RETURN inventory movement. A completed inspection cannot be applied twice.

This prevents damaged, opened, used or unsuitable merchandise from becoming sellable automatically.

## 13. Order integration

Fulfillment transition may advance Order status only through approved mappings:

- PREPARING -> Order PROCESSING
- READY -> Order READY
- DISPATCHED -> Order SHIPPED and consumes the reserved physical stock
- DELIVERED -> Order DELIVERED for shipped delivery
- STORE_PICKUP READY -> DELIVERED maps to Order COMPLETED and consumes the reservation
- logistics cancellation maps to Order CANCELLED only while the Order is still cancellable
- failed delivery / returning / returned do not rewrite the Order into a fictitious delivered state

Order inventory consumption remains governed by the existing Order reservation lifecycle.

Fulfillment must not rewrite Order history directly outside controlled service commands.

## 14. Courier adapter boundary

Conceptual interface:

```text
CourierProvider.quote(...)
CourierProvider.createShipment(...)
CourierProvider.getTracking(...)
CourierProvider.cancelShipment(...)
CourierProvider.verifyWebhook(...)
```

v1 includes an INTERNAL provider only.

Future providers can be added without changing Order or Fulfillment domain contracts.

## 15. Public tracking API

`GET /v1/fulfillments/:id?token=<public-token>`

Returns:

- fulfillment type/status;
- tracking reference;
- department / municipality;
- ETA;
- normalized tracking events;
- delivery attempt summary;
- public proof-of-delivery projection.

## 16. Internal operations

Protected by `x-internal-key`:

- GET /v1/internal/fulfillments
- GET /v1/internal/fulfillments/:id
- PATCH /v1/internal/fulfillments/:id/status
- POST /v1/internal/fulfillments/:id/attempts
- POST /v1/internal/fulfillments/:id/tracking-events
- PATCH /v1/internal/cod-collections/:id/status
- GET /v1/internal/delivery-zones
- PUT /v1/internal/delivery-zones/:department

## 17. Storefront

Before final checkout:

1. customer selects department;
2. storefront queries delivery options;
3. storefront displays configured ETA + price when available;
4. otherwise it clearly displays “cotización por confirmar”;
5. selected delivery/address information is retained for fulfillment creation.

No delivery price is trusted from the client.

## 18. Security and audit

- internal logistics mutation requires authorization;
- public tracking requires opaque token;
- no courier secret reaches the browser;
- external webhook events must be deduplicated when adapters are added;
- manual status / COD changes are audited;
- addresses are minimized to required delivery data.

## 19. Acceptance criteria

1. Customer can select a Honduran department.
2. API returns server-configured delivery estimate/rate or quote-required.
3. Store pickup works without address.
4. Delivery fulfillment snapshots the address.
5. Invalid fulfillment state transitions return 409.
6. Delivery attempts are immutable/auditable.
7. Failed delivery can retry or return to origin.
8. Proof of delivery is stored as metadata.
9. CODCollection is separate from Payment.
10. DELIVERED does not automatically mark Payment PAID.
11. Returned parcel does not automatically restock inventory.
12. Public tracking requires token.
13. Internal mutations require authorization.
14. PostgreSQL integration tests pass.
15. Storefront smoke tests pass.
16. Return-to-origin creates a pending inspection and cannot auto-restock.
17. RESTOCK is idempotent and creates an immutable inventory movement.
18. COD COLLECTED remains Payment PENDING until explicit reconciliation.
19. Railway catalog-api/storefront deployments reach SUCCESS.

## 20. Traceability

```text
Honduras logistics research
-> Strategic Baseline Phase 4
-> Issue #17
-> M04 Fulfillment & Logistics
-> Code
-> PostgreSQL integration tests
-> CI
-> Railway production verification
```
