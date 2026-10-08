# SPEC — Module 09: Returns & After-Sales Core v2 Amendment

**Project:** MR עדולם
**Status:** PROPOSED FOR APPROVAL
**Date:** 2026-10-08
**Base specification:** M09_RETURNS_AFTER_SALES_V1.md
**Roadmap:** STRATEGIC_BASELINE_HONDURAS_V2.md
**Dependencies:** M02 v2 amendment, M06 v2 amendment, M11, M12, M13

## 1. Purpose

Amend M09 so completed customer returns can produce stable operational facts for seller-settlement reversals, staff-commission reversals and later inventory adjustments without rewriting historical orders, payments or prior return records.

M09 remains the physical/post-sale return authority.

M11 owns seller economic reversal.
M13 owns staff commission reversal.
M12 owns later exceptional stock adjustments.

M09 v1 remains authoritative except where explicitly extended below.

## 2. Verified implementation baseline — 2026-10-08

The current catalog-api already implements:

- return_cases;
- return_items;
- return_item_dispositions;
- approval/rejection/cancellation;
- receive step;
- inspection step;
- dispositions including RESTOCK, DAMAGED, QUARANTINE and RETURN_TO_SUPPLIER;
- CUSTOMER_RETURN inventory movements for approved restock;
- permission-protected internal operations;
- idempotency for receive/inspection flows;
- audit/state transitions.

Therefore M09 v2 adds integration/event contracts rather than replacing the return state machine.

## 3. Stable return-economic event

Once a return has reached a commercially meaningful final state, M09 must expose an immutable normalized fact that downstream modules can consume.

Suggested logical event:

ReturnEconomicResolution

Fields or equivalent payload:

- event_id
- return_case_id
- return_item_id
- order_id
- order_item_id
- variant_id nullable
- returned_quantity
- accepted_quantity
- rejected_quantity
- final_disposition
- requested_resolution
- resolution_status
- completed_at
- economic_effect_type
- source_event_version

Possible economic_effect_type values:

- NONE
- FULL_REVERSAL
- PARTIAL_REVERSAL
- MANUAL_REVIEW

The exact event transport may be synchronous projection, outbox event or queryable immutable record.

## 4. Seller settlement reversal boundary

M11 consumes the stable return-economic fact.

Rules:

- M09 does not edit SettlementStatement or SettlementLine;
- M09 does not calculate seller commission;
- M09 exposes order_item_id and returned quantity;
- M11 uses the original M02/M11 commercial snapshot to calculate economic reversal;
- if the original seller statement is already PAID, M11 carries the reversal into a later statement/adjustment;
- M09 never rewrites the historical sale line.

## 5. Staff commission reversal boundary

M13 consumes the same stable return-economic fact.

Rules:

- M09 does not edit CommissionAccrual;
- partial return can trigger proportional or rule-defined reversal in M13;
- original commission accrual remains historically visible;
- staff attribution comes from M02 v2;
- M09 only supplies authoritative returned quantity/status/disposition facts.

## 6. Payment/refund boundary

M09 may request or record the intended customer resolution, but Payment/refund mutation remains governed by the payment/refund capability.

M09 must not infer that physical return automatically means Payment = REFUNDED.

Examples:

- physical return completed, refund pending;
- return exchanged with no cash refund;
- store credit issued;
- return rejected after inspection;
- seller economic reversal required even when customer refund mechanism differs.

Order, return, payment and seller-settlement states remain distinct.

## 7. Inventory restock boundary

Existing restock behavior using CUSTOMER_RETURN remains valid.

Rules:

- only inspected/accepted quantities may restock;
- final disposition determines inventory effect;
- CUSTOMER_RETURN preserves the physical return event;
- seller economic reversal is separate from inventory movement;
- staff commission reversal is separate from inventory movement.

## 8. Post-return shrinkage / damage boundary

If an item was restocked or dispositioned and later found missing, damaged or incorrectly counted:

- do not modify the completed ReturnCase;
- create an M12 InventoryAdjustmentRequest;
- preserve the return event as historical truth;
- link M12 adjustment back to return_case_id/return_item_id where useful.

M09 dispositions describe condition/outcome at inspection time.
M12 describes later exceptional inventory correction.

## 9. RETURN_TO_SUPPLIER boundary

RETURN_TO_SUPPLIER is a disposition decision, not proof that a supplier shipment/claim has occurred.

Rules:

- M09 records that the item should not return to sellable inventory;
- future supplier-return/shipping/claim workflow belongs to M08 or a procurement extension;
- M11 may assess seller liability according to agreement;
- do not create supplier payable/receivable ledger entries inside M09.

## 10. Hybrid inventory ownership

For third-party-owned inventory, the return flow must preserve enough context to reconnect the item to its original commercial source.

Preferred source:

- M02 OrderItem commercial snapshot;
- inventory_source_id/economic_owner_type;
- seller_id/seller_agreement_version.

M09 should not duplicate mutable seller agreement data.

## 11. Return completion semantics

A downstream economic event should be emitted only when return facts are sufficiently stable.

Recommended trigger:

- return inspection completed;
- final disposition recorded;
- resolution_status known or explicitly MANUAL_REVIEW.

If M09 v1 permits status COMPLETED before all economic resolution is finished, the downstream event contract must use a distinct readiness predicate rather than relying on status name alone.

## 12. Idempotency

Downstream return-economic facts must be idempotent.

- same return_item + event version cannot create duplicate downstream reversal input;
- if the return is corrected before economic finalization, prior draft projection may be superseded with audit history;
- after final emission, corrections require explicit compensating event rather than mutation of the original event.

## 13. Audit additions

Audit should preserve:

- return economic event emitted;
- final disposition;
- accepted/rejected quantity;
- economic_effect_type;
- compensating event if later correction is required;
- actor/system source.

Do not store private seller agreement or staff compensation details inside M09 audit metadata.

## 14. Functional requirements added

- FR-RET-015 Expose stable return-economic resolution facts.
- FR-RET-016 Preserve order_item linkage for seller/staff reversals.
- FR-RET-017 Keep M11 settlement calculation outside M09.
- FR-RET-018 Keep M13 commission reversal calculation outside M09.
- FR-RET-019 Keep customer refund/payment state separate from physical return state.
- FR-RET-020 Route later inventory corrections through M12.
- FR-RET-021 Preserve RETURN_TO_SUPPLIER as disposition, not supplier-claim completion.
- FR-RET-022 Make downstream economic event emission idempotent.
- FR-RET-023 Preserve hybrid inventory/source context through original OrderItem snapshot.

## 15. Acceptance criteria added

1. A completed inspected return exposes order_item_id and returned quantity.
2. M11 can create seller reversal without modifying M09 records.
3. M13 can create commission reversal without modifying M09 records.
4. Partial return provides enough data for proportional downstream treatment.
5. Physical return does not automatically set Payment to REFUNDED.
6. CUSTOMER_RETURN inventory movement remains compatible.
7. Later discovered damage/loss uses M12 instead of rewriting ReturnCase.
8. RETURN_TO_SUPPLIER does not falsely indicate supplier shipment/financial settlement.
9. Duplicate downstream processing cannot duplicate reversal input.
10. Existing M09 receive/inspect/idempotency tests remain valid.

## 16. Implementation gate

Before implementing the economic event:

- M02 v2 commercial/staff attribution must be approved;
- inspect current ReturnCase/ReturnItem state transitions;
- define exact economic-readiness predicate;
- choose outbox/event table vs stable query projection;
- add idempotency/versioning tests;
- define refund integration separately if not already governed;
- preserve current physical return behavior.

This amendment does not change the existing customer return state machine by itself.
