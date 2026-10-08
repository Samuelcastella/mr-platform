# SPEC — M10.3 Mobile Order & Fulfillment Tracking v0.4

**Project:** MR עדולם  
**Status:** APPROVED FOR IMPLEMENTATION  
**Date:** 2026-10-08  
**Issue:** #41  
**Dependencies:** M02 Orders, M04 Fulfillment, M10.2 Native Fulfillment/Checkout  
**Method:** Spec-Driven Development (SDD)

## 1. Goal

Give the mobile customer a post-checkout tracking view backed by the public tokenized Order and Fulfillment contracts already owned by Commerce Core.

The app presents operational state. It does not become the state authority.

## 2. Data sources

Order:

`GET /v1/orders/{id}?token={orderToken}`

Fulfillment:

`GET /v1/fulfillments/{id}?token={fulfillmentToken}`

No internal route or internal API key is used.

## 3. Tracking model

The tracking UI shows separately:

- Order status;
- Fulfillment status;
- Payment status captured from the latest checkout response;
- tracking reference;
- provider;
- destination summary;
- quoted ETA;
- fulfillment tracking events;
- delivery attempts.

The UI must not collapse these into one synthetic state.

## 4. Polling

While the tracking screen is active:

- refresh Order and Fulfillment at a moderate interval;
- default interval: 30 seconds;
- provide manual refresh;
- stop interval when leaving tracking view;
- avoid overlapping refresh calls.

Polling is only a transport strategy. It does not imply provider GPS.

## 5. Status language

The UI maps operational statuses to customer-readable text without changing raw server status.

Examples:

- PENDING → Pendiente de preparación
- PREPARING → Preparando
- READY → Listo
- DISPATCHED → Despachado
- OUT_FOR_DELIVERY → En ruta
- DELIVERED → Entregado
- FAILED → Intento no completado
- RETURNING → Regresando a origen
- RETURNED → Devuelto a origen
- CANCELLED → Cancelado

Raw state remains visible for support/debug context when appropriate.

## 6. Timeline

Use `fulfillment.events` returned by Commerce Core.

Each event may show:

- eventType;
- status;
- description;
- locationText when present;
- occurredAt.

Events are sorted by the server. The mobile client does not fabricate missing events.

## 7. Delivery attempts

If the API returns delivery attempts, display:

- attempt number;
- status;
- reason when present;
- occurredAt.

An attempt failure is not automatically a payment failure.

## 8. ETA

If `etaMinDays` / `etaMaxDays` are present, show the quote range as the original service estimate.

Do not recalculate or shorten the ETA client-side.

## 9. Tracking reference

If a tracking reference exists, display it.

The client does not infer that the provider supports public GPS or a carrier URL unless a future provider contract explicitly supplies that capability.

## 10. Error recovery

If one refresh fails:

- keep the last successful data visible;
- show a non-destructive refresh warning;
- allow manual retry;
- do not clear tokens or checkout state.

A tracking network failure does not change Order, Payment or Fulfillment.

## 11. Completion

DELIVERED may be shown as delivery complete.

The Payment may still be PENDING depending on the method or reconciliation path.

The UI must continue to show Payment independently.

## 12. Privacy

The tracking view uses only data already returned through the tokenized public API.

Do not surface:

- internal audit events;
- StaffUser identity;
- internal notes;
- database identifiers beyond the customer-facing order/tracking references;
- unrelated customer PII.

## 13. Session scope

v0.4 tracks the order completed in the current app session.

Persistence across app restarts and secure token storage is a later increment.

This prevents insecure ad-hoc storage from being introduced without a storage threat model.

## 14. Invariants

MOB-042 — Tracking reads public tokenized APIs only.  
MOB-043 — Polling never writes state.  
MOB-044 — Tracking failure never mutates Order/Payment/Fulfillment.  
MOB-045 — Polling stops outside tracking view.  
MOB-046 — Payment and Fulfillment remain independent.  
MOB-047 — No GPS is claimed without provider capability.  
MOB-048 — Timeline events are server events only.  
MOB-049 — Last successful tracking data remains visible after transient failure.

## 15. Acceptance

- tracking opens from completed checkout;
- Order is refreshed by public token;
- Fulfillment is refreshed by public token;
- tracking reference is shown;
- timeline renders server events;
- delivery attempts render when present;
- manual refresh works;
- polling runs only while tracking view active;
- network failure preserves last successful values;
- DELIVERED does not imply Payment PAID;
- typecheck passes;
- Android export passes;
- general CI passes.

## 16. Definition of Done

```text
Public tokenized read
→ Tracking view
→ Manual refresh
→ Controlled polling
→ Timeline
→ Independent state rendering
→ Typecheck/export
→ CI
```
