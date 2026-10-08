# SPEC — Module 02: Orders, Reservations & Idempotency v2 Amendment

**Project:** MR עדולם
**Status:** PROPOSED FOR APPROVAL
**Date:** 2026-10-08
**Base specification:** M02_ORDERS_RESERVATIONS_V1.md
**Roadmap:** STRATEGIC_BASELINE_HONDURAS_V2.md
**Dependencies:** M01 v2 amendment, M11, M13

## 1. Purpose

Amend M02 so authoritative orders preserve the commercial facts required for hybrid seller economics and staff attribution without changing the existing order/reservation state machine.

M02 v1 remains authoritative except where explicitly extended below.

## 2. OrderItem commercial snapshot

Each OrderItem must be able to preserve the economic context resolved at order creation or commercial commitment.

Add fields or an equivalent linked immutable record containing:

- seller_id nullable
- seller_agreement_id nullable
- commercial_mode
- inventory_owner_type
- inventory_source_id nullable
- unit_cost_basis_minor nullable
- commission_basis nullable
- commission_rate_bps nullable
- fixed_fee_minor nullable
- settlement_rule_version nullable
- commercial_snapshot_at

Rules:

1. Snapshot is derived server-side from authoritative inventory/catalog/agreement data.
2. Browser/client cannot supply authoritative seller economics.
3. Snapshot becomes immutable once the order reaches the defined commercial commitment point.
4. Later SellerAgreement edits do not rewrite historical OrderItems.
5. MR-owned lines may have seller fields null.

## 3. Mixed commercial ownership orders

One customer Order MAY contain:

- MR-owned lines;
- consigned lines;
- third-party commission lines;
- other future M11-compatible lines.

This amendment does not require:

- seller self-service;
- seller-managed fulfillment;
- split customer payment;
- separate customer-facing orders per seller.

Customer order remains one commercial order unless a later marketplace SPEC requires decomposition.

## 4. Inventory source allocation

Reservation must ultimately identify the inventory source used for each reserved quantity where ownership attribution is required.

Implementation may extend InventoryReservation with:

- inventory_source_id nullable

or use an equivalent reservation-allocation child record.

Rules:

- reservation allocation is server-side;
- source allocation must remain consistent with availability;
- consumed quantity must preserve the same commercial ownership context used for OrderItem snapshot or record an explicit audited reallocation before commitment.

## 5. Staff attribution

Add a normalized attribution mechanism for commercial staff.

Preferred entity:

OrderStaffAttribution

- id
- order_id
- order_item_id nullable
- staff_user_id
- attribution_type
- allocation_bps nullable
- source
- created_at
- corrected_at nullable
- correction_reason nullable

attribution_type initial values:

- PRIMARY_SALESPERSON
- ASSIST
- MANUAL_OVERRIDE

source examples:

- STORE
- PHONE
- WHATSAPP
- WEB_ASSISTED
- INTERNAL_ASSIGNMENT

Rules:

1. Attribution must not change order totals.
2. Attribution correction is audited.
3. M13 consumes attribution; M02 does not calculate commission.
4. If only one salesperson is supported initially, implementation may expose a simplified field backed by a migration path to the normalized model.

## 6. Order entity extension

Order may add:

- customer_id nullable once M07 integration is active
- originating_staff_user_id nullable
- sales_channel_detail nullable

These fields do not replace existing channel.

## 7. Reservation and idempotency invariants

All M02 v1 reservation and idempotency invariants remain unchanged.

Additional invariant:

The same idempotent Order creation retry must return the same commercial snapshot and staff attribution result unless the original request had not yet committed and the server explicitly rolled back.

## 8. Cancellation / return interaction

Cancellation before inventory consumption:

- releases reservations;
- does not create seller settlement eligibility;
- does not create earned staff commission unless M13 business policy explicitly allows a prior trigger, which is not recommended.

After-sale returns are governed by M09.

M11 and M13 consume stable M09 events to create seller/commission reversals.

M02 does not rewrite historical OrderItems after a return.

## 9. Privacy / API projection

Public order tracking may expose:

- product/variant snapshot;
- quantities;
- prices;
- order state;
- fulfillment/payment public status where allowed.

Public APIs must not expose:

- internal cost basis;
- seller commission;
- seller agreement terms;
- staff commission attribution;
- internal staff IDs unless explicitly needed for customer service display later.

## 10. Functional requirements added

- FR-ORD-013 Snapshot seller/economic context per OrderItem.
- FR-ORD-014 Preserve inventory-source attribution for hybrid stock.
- FR-ORD-015 Support one Order with mixed commercial ownership lines.
- FR-ORD-016 Preserve staff sales attribution.
- FR-ORD-017 Audit staff-attribution corrections.
- FR-ORD-018 Keep seller settlement and staff commission calculations outside M02.
- FR-RES-005 Preserve source allocation across reservation consumption.
- FR-IDEM-004 Idempotent retries preserve identical commercial snapshot outcome.

## 11. Acceptance criteria added

1. OrderItem seller/economic data cannot be forged by the client.
2. Historical OrderItem economics do not change when SellerAgreement changes.
3. One order can contain both MR-owned and third-party lines.
4. Public tracking does not expose private seller economics.
5. Staff attribution can be captured without changing order amount/state.
6. Staff attribution correction is audited.
7. Reservation consumption preserves inventory-source ownership context.
8. M11 can calculate settlement from stable OrderItem source facts.
9. M13 can calculate accrual from stable staff attribution and order events.
10. Existing M02 concurrency, reservation and idempotency tests remain valid.

## 12. Migration / implementation gate

Before implementation:

- inspect current Order/OrderItem/Reservation production schema;
- choose inline snapshot columns vs linked commercial snapshot table;
- choose simplified vs normalized staff attribution implementation;
- confirm no existing client contract breaks;
- add migration and integration tests;
- preserve existing order state machine unless a separate approved SPEC changes it.

This amendment changes data capture and integration contracts, not the customer-facing order state machine.
