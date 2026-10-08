# SPEC — Module 09: Returns & After-Sales Core v1

**Project:** MR עדולם  
**Status:** APPROVED FOR IMPLEMENTATION  
**Date:** 2026-10-08  
**Issue:** #34  
**Method:** Spec-Driven Development (SDD)  
**Dependencies:** M01–M08

## 1. Objective

Create the post-delivery customer-return domain for MR עדולם without rewriting the original Order, without automatically refunding a Payment, and without putting returned stock back on sale before inspection.

This module is distinct from logistics Return-to-Origin (RTO).

## 2. Domain boundary

Order
→ ReturnCase
→ ReturnItem
→ ReturnItemDisposition
→ InventoryMovement

A ReturnCase may request a commercial resolution:

- REFUND
- EXCHANGE
- STORE_CREDIT
- NONE

But the return domain does not claim that a financial refund or fiscal adjustment has happened merely because merchandise was returned.

## 3. Customer Return vs Return-to-Origin

### Customer Return

The customer previously received the merchandise and later returns all or part of it.

### Return-to-Origin

The original delivery was never successfully completed and the parcel returns through the fulfillment/logistics flow.

These are separate aggregates and histories.

M09 implements Customer Return.

## 4. ReturnCase

Fields:

- id
- return_number unique
- order_id
- status
- requested_resolution
- resolution_status
- reason_code
- reason_note nullable
- receive_location_id nullable
- idempotency_key unique
- idempotency_hash
- receive_idempotency_key nullable unique
- receive_idempotency_hash nullable
- inspection_idempotency_key nullable unique
- inspection_idempotency_hash nullable
- requested_by_user_id nullable
- requested_by_service nullable
- approved_by_user_id nullable
- rejected_by_user_id nullable
- received_by_user_id nullable
- received_by_service nullable
- inspected_by_user_id nullable
- inspected_by_service nullable
- requested_at
- approved_at nullable
- rejected_at nullable
- received_at nullable
- inspected_at nullable
- completed_at nullable
- cancelled_at nullable
- created_at
- updated_at

Statuses:

- REQUESTED
- APPROVED
- REJECTED
- RECEIVED
- INSPECTED
- COMPLETED
- CANCELLED

Resolution statuses:

- NOT_REQUIRED
- PENDING_HANDOFF
- RESOLVED

For v1:

- requested_resolution = NONE starts NOT_REQUIRED;
- REFUND / EXCHANGE / STORE_CREDIT starts PENDING_HANDOFF;
- M09 does not fabricate a gateway refund or fiscal credit note.

## 5. ReturnItem

Fields:

- id
- return_case_id
- order_item_id
- variant_id nullable
- sku_snapshot
- product_name_snapshot
- quantity_requested
- quantity_received
- created_at
- updated_at

Rules:

- quantity_requested > 0;
- quantity_received >= 0;
- quantity_received <= quantity_requested;
- each OrderItem appears at most once per ReturnCase;
- cumulative active/non-rejected returned quantity cannot exceed the original sold quantity.

## 6. Eligibility

A ReturnCase may be created only for an Order whose status is:

- DELIVERED
- COMPLETED

v1 does not encode a legal return-window duration because the Honduras policy/fiscal workstream must validate the definitive business/legal rule first.

A configurable policy can be added later.

## 7. Quantity guard

For each OrderItem:

available_to_return =
order_item.quantity
− sum(quantity_requested from existing ReturnCases whose status is not REJECTED or CANCELLED)

New request quantity must be <= available_to_return.

The validation is transactional and locks the relevant Order/OrderItem rows so concurrent staff actions cannot over-return the same units.

## 8. Return creation

Endpoint:

POST /v1/internal/returns

Requires:

- returns.create
- Idempotency-Key
- StaffUser CSRF when using a cookie session

Input:

- orderId
- requestedResolution
- reasonCode
- reasonNote optional
- items:
  - orderItemId
  - quantity

The server snapshots SKU/product name/variant reference from the original OrderItem.

The original Order and OrderItem are never rewritten.

## 9. Approval

REQUESTED → APPROVED

Requires:

- returns.approve

Rejection:

REQUESTED → REJECTED

Requires:

- returns.approve
- reason

Cancellation:

REQUESTED/APPROVED → CANCELLED

Requires:

- returns.cancel

Cancellation/rejection release the requested quantity for a future ReturnCase.

## 10. Physical receiving

APPROVED → RECEIVED

Endpoint:

POST /v1/internal/returns/{id}/receive

Requires:

- returns.receive
- Idempotency-Key
- active Location

Input:

- locationId

v1 receives the approved ReturnCase as a whole. Each ReturnItem receives quantity_requested.

Important:

RECEIVED does not change sellable inventory.

Returned merchandise remains physically held but commercially unclassified until inspection.

## 11. Inspection

RECEIVED → INSPECTED

Endpoint:

POST /v1/internal/returns/{id}/inspect

Requires:

- returns.inspect
- Idempotency-Key

Each ReturnItem receives one or more dispositions whose quantities sum exactly to quantity_received.

Disposition types:

- RESTOCK
- DAMAGED
- QUARANTINE
- RETURN_TO_SUPPLIER

Example:

ReturnItem quantity_received = 3

Dispositions:

- RESTOCK = 2
- DAMAGED = 1

## 12. ReturnItemDisposition

Fields:

- id
- return_item_id
- disposition
- quantity
- notes nullable
- created_at

Rules:

- quantity > 0;
- disposition sum per item = quantity_received when inspection posts;
- dispositions are immutable after successful inspection in v1.

## 13. Inventory effect

Only RESTOCK changes sellable inventory.

For each RESTOCK disposition:

1. variant_id must still exist;
2. increment inventory.quantity at receive_location_id;
3. preserve inventory.reserved;
4. create InventoryMovement:
   - movement_type = CUSTOMER_RETURN
   - quantity = positive restocked quantity
   - reference = return:{return_number}
5. commit transaction.

DAMAGED / QUARANTINE / RETURN_TO_SUPPLIER do not increase sellable inventory in v1.

Future modules may model quarantine stock separately.

## 14. Idempotency

Return creation:

- Idempotency-Key required.

Receiving:

- separate Idempotency-Key required.

Inspection:

- separate Idempotency-Key required.

Same key + same request:

- returns previous result;
- no duplicate inventory movement.

Same key + different request:

- 409 idempotency_conflict.

## 15. Completion

INSPECTED → COMPLETED

In v1, COMPLETED means the physical return workflow is complete.

It does not mean a requested REFUND/EXCHANGE/STORE_CREDIT has been financially or fiscally completed.

The independent resolution_status remains visible:

- NOT_REQUIRED
- PENDING_HANDOFF
- RESOLVED

A future payment/fiscal workflow may set RESOLVED through a contract without rewriting the return inspection.

## 16. Refund separation

Return != Refund.

M09 must not:

- set Payment to REFUNDED automatically;
- create a fake provider refund;
- edit original payment history;
- replicate LIRA ledger;
- assume a fiscal credit-note rule that is still under validation.

A future refund command will reference:

- return_case_id
- payment_id
- amount
- currency
- provider/external reference

Payment remains the commercial payment-status authority.

## 17. Exchange separation

An exchange may later create:

- replacement Order;
- zero/positive/negative commercial adjustment;
- new inventory reservation.

M09 v1 records EXCHANGE as requested_resolution but does not synthesize a replacement order automatically.

## 18. API v1

- POST /v1/internal/returns
- GET /v1/internal/returns
- GET /v1/internal/returns/{id}
- POST /v1/internal/returns/{id}/approve
- POST /v1/internal/returns/{id}/reject
- POST /v1/internal/returns/{id}/cancel
- POST /v1/internal/returns/{id}/receive
- POST /v1/internal/returns/{id}/inspect
- POST /v1/internal/returns/{id}/complete

## 19. Permissions

New permissions:

- returns.read
- returns.create
- returns.approve
- returns.cancel
- returns.receive
- returns.inspect

Initial role intent:

### ADMIN

All permissions.

### MANAGER

All return permissions.

### CUSTOMER_SUPPORT

- returns.read
- returns.create

### CASHIER

- returns.read
- returns.create

### INVENTORY_OPERATOR

- returns.read
- returns.receive
- returns.inspect

### FULFILLMENT_OPERATOR

- returns.read

## 20. Audit

Critical events:

- return.requested
- return.approved
- return.rejected
- return.cancelled
- return.received
- return.inspected
- return.completed

Audit metadata may include:

- return_case_id
- order_id
- location_id
- quantities
- disposition totals
- requested resolution
- status transition

Do not copy unnecessary customer PII or long free-text notes into audit metadata.

## 21. Security

- internal-only API in v1;
- StaffUser RBAC server-side;
- CSRF on cookie mutations;
- Location scope enforced for receive/inspect;
- public customer token does not authorize return administration;
- idempotency keys are operation-specific;
- no payment credentials stored in return tables.

## 22. Invariants

RET-001 — Original Order/OrderItem remain immutable.  
RET-002 — Customer Return is separate from logistics RTO.  
RET-003 — Only DELIVERED/COMPLETED orders are eligible.  
RET-004 — Cumulative requested return quantity never exceeds sold quantity.  
RET-005 — REJECTED/CANCELLED quantities become available for a future request.  
RET-006 — RECEIVED never auto-restocks inventory.  
RET-007 — Only inspected RESTOCK quantity increases sellable inventory.  
RET-008 — Every restock creates CUSTOMER_RETURN movement.  
RET-009 — Inspection retry never duplicates stock/movement.  
RET-010 — Return does not automatically refund Payment.  
RET-011 — Return does not fabricate fiscal documentation.  
RET-012 — Return creation/receive/inspection are idempotent.  
RET-013 — Location scope applies to physical receive/inspection.  
RET-014 — Disposition quantities equal received quantity before INSPECTED.  
RET-015 — Financial ledger remains outside MR return domain.

## 23. Acceptance tests

- create return for COMPLETED order;
- reject return for non-delivered order;
- create partial return quantity;
- block cumulative over-return;
- reject/cancel releases returnable quantity;
- Customer Support can create but cannot approve;
- Manager approves;
- Inventory Operator wrong location denied;
- receive does not change inventory;
- receive retry idempotent;
- inspect with mixed RESTOCK/DAMAGED;
- disposition sum mismatch rejected;
- RESTOCK changes inventory exactly once;
- inspection retry does not duplicate inventory;
- CUSTOMER_RETURN movement exists exactly once;
- non-restock disposition does not increase inventory;
- complete physical case;
- requested REFUND remains PENDING_HANDOFF;
- Payment status remains unchanged;
- audit events created;
- existing order/payment/fulfillment tests remain green.

## 24. Definition of Done

Requirement
→ Return state machine
→ Quantity guard
→ Authorization
→ Idempotency
→ Inspection
→ Inventory effect
→ Automated test
→ Audit evidence

M09 v1 is complete when post-delivery returns are traceable and physically safe without conflating inventory, payments or fiscal adjustments.
