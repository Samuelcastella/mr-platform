# SPEC — Module 08: Suppliers & Procurement Core v1

**Project:** MR עדולם  
**Status:** APPROVED FOR IMPLEMENTATION  
**Date:** 2026-10-08  
**Issue:** #32  
**Method:** Spec-Driven Development (SDD)  
**Dependencies:** M01–M07

## 1. Objective

Create the supplier and procurement domain for MR עדולם so inventory can be sourced from Honduras, the United States, China, or any other country through a controlled purchase-order and goods-receipt workflow.

Procurement is commercial/operational. It does not make MR the financial ledger for accounts payable, settlement, bank balances or supplier money movement.

## 2. Domain boundary

Supplier
→ PurchaseOrder
→ PurchaseOrderItem
→ GoodsReceipt
→ GoodsReceiptItem
→ Inventory / InventoryMovement

MR owns:

- supplier master data;
- procurement commitments;
- quantities ordered/received;
- commercial cost snapshots;
- operational receiving;
- inventory impact.

MR does not own:

- bank settlement;
- accounts-payable ledger;
- supplier financial account balances;
- money-transfer core;
- LIRA ledger.

## 3. Supplier

The existing suppliers table is retained and evolved.

Fields:

- id
- name
- legal_name nullable
- country_code nullable
- contact_name nullable
- email nullable
- phone nullable
- website nullable
- default_currency nullable
- payment_terms_days nullable
- lead_time_days nullable
- notes nullable
- active
- created_at
- updated_at

Rules:

- supplier may originate in any country;
- no China-only assumptions;
- inactive supplier cannot receive new purchase orders;
- old purchase orders retain supplier snapshots/references even if supplier later changes.

## 4. Purchase Order

PurchaseOrder fields:

- id
- po_number unique
- supplier_id
- destination_location_id
- status
- currency
- subtotal_minor
- shipping_estimate_minor
- tax_estimate_minor
- other_costs_minor
- grand_total_minor
- supplier_reference nullable
- expected_at nullable
- ordered_at nullable
- approved_at nullable
- created_by_user_id nullable
- created_by_service nullable
- approved_by_user_id nullable
- idempotency_key unique
- idempotency_hash
- created_at
- updated_at

Statuses:

- DRAFT
- APPROVED
- ORDERED
- PARTIALLY_RECEIVED
- RECEIVED
- CANCELLED

## 5. Purchase Order Item

PurchaseOrderItem fields:

- id
- purchase_order_id
- variant_id
- sku_snapshot
- product_name_snapshot
- supplier_sku nullable
- origin_country_code nullable
- quantity_ordered
- quantity_received
- unit_cost_minor
- currency
- line_total_minor
- created_at
- updated_at

Rules:

- quantity_ordered > 0;
- quantity_received >= 0;
- quantity_received <= quantity_ordered;
- line_total_minor = quantity_ordered × unit_cost_minor;
- cost is a historical procurement snapshot;
- product/variant edits do not rewrite prior PO lines.

## 6. Monetary representation

All procurement totals use integer minor units.

Example:

HNL 1,250.75
→ 125075 minor units.

No binary floating-point arithmetic is used for authoritative totals.

The server calculates:

subtotal_minor = sum(line_total_minor)

grand_total_minor =
subtotal_minor
+ shipping_estimate_minor
+ tax_estimate_minor
+ other_costs_minor

The client cannot submit an authoritative grand total.

## 7. Purchase Order lifecycle

Create:

DRAFT

Transitions:

DRAFT → APPROVED
APPROVED → ORDERED
ORDERED → PARTIALLY_RECEIVED
ORDERED → RECEIVED
PARTIALLY_RECEIVED → PARTIALLY_RECEIVED
PARTIALLY_RECEIVED → RECEIVED

Cancellation:

DRAFT → CANCELLED
APPROVED → CANCELLED
ORDERED → CANCELLED only when quantity_received = 0

No cancellation after any receipt has posted.

## 8. Approval separation

Creating a PO requires:

- procurement.create

Approving requires:

- procurement.approve

Receiving requires:

- procurement.receive

Cancelling requires:

- procurement.cancel

This supports separation of duties.

The creator may be allowed to approve in the first implementation if they possess both permissions. A four-eyes rule may be configured later.

## 9. Idempotency

PO creation requires:

Idempotency-Key

Same key + same normalized request:
returns the original PO.

Same key + different request:
409 idempotency_conflict.

Goods receipt creation also requires Idempotency-Key.

A retry must never increment inventory twice.

## 10. Goods Receipt

GoodsReceipt fields:

- id
- receipt_number unique
- purchase_order_id
- location_id
- status
- idempotency_key unique
- idempotency_hash
- supplier_delivery_reference nullable
- received_by_user_id nullable
- received_by_service nullable
- received_at
- created_at

Status v1:

- POSTED

The first implementation posts receipts atomically on creation rather than maintaining editable draft receipts.

## 11. Goods Receipt Item

Fields:

- id
- goods_receipt_id
- purchase_order_item_id
- variant_id
- quantity_received
- unit_cost_minor
- currency
- created_at

Rules:

- quantity_received > 0;
- receipt variant must match PO item variant;
- cumulative receipt cannot exceed quantity_ordered.

## 12. Inventory integration

Posting a receipt is one database transaction.

For every receipt line:

1. lock PurchaseOrderItem;
2. validate remaining quantity;
3. increment inventory.quantity at destination_location_id;
4. preserve inventory.reserved;
5. insert immutable inventory movement:
   - movement_type = PURCHASE_RECEIPT
   - quantity = received quantity
   - reference = goods receipt identifier;
6. increment purchase_order_items.quantity_received;
7. update PO status.

The transaction must leave:

reserved <= quantity

and never duplicate the movement on idempotent retry.

## 13. Inventory movement semantics

PURCHASE_RECEIPT is a physical inventory event.

It is not a financial ledger entry.

Inventory movement reference example:

goods_receipt:GR-2026-000123

The receipt and PO remain auditable independently of any supplier payment.

## 14. Partial receiving

Example:

PO item quantity_ordered = 10.

Receipt A = 6
→ quantity_received = 6
→ PO = PARTIALLY_RECEIVED.

Receipt B = 4
→ quantity_received = 10
→ PO = RECEIVED.

Receipt C = 1
→ rejected as over_receipt.

## 15. Supplier currency

Supplier default currency is informational/defaulting.

Each PO has one authoritative ISO 4217 currency.

Each PO item uses the PO currency in v1.

Multi-currency landed-cost conversion may be added later; v1 does not invent exchange-rate accounting.

## 16. Country of origin

Each PO item may record origin_country_code.

This is independent from supplier.country_code.

Example:

supplier company in the United States
with goods manufactured in Vietnam.

This distinction is required for scalable sourcing and later customs/landed-cost analysis.

## 17. API v1

### Suppliers

- GET /v1/internal/suppliers
- POST /v1/internal/suppliers
- GET /v1/internal/suppliers/{id}
- PATCH /v1/internal/suppliers/{id}

### Purchase Orders

- GET /v1/internal/procurement/purchase-orders
- POST /v1/internal/procurement/purchase-orders
- GET /v1/internal/procurement/purchase-orders/{id}
- POST /v1/internal/procurement/purchase-orders/{id}/approve
- POST /v1/internal/procurement/purchase-orders/{id}/order
- POST /v1/internal/procurement/purchase-orders/{id}/cancel
- POST /v1/internal/procurement/purchase-orders/{id}/receipts

## 18. Permission vocabulary

New permissions:

- suppliers.read
- suppliers.write
- procurement.read
- procurement.create
- procurement.approve
- procurement.receive
- procurement.cancel

Initial role intent:

### ADMIN

All permissions.

### MANAGER

All procurement permissions.

### INVENTORY_OPERATOR

- suppliers.read
- procurement.read
- procurement.receive
- inventory.read
- inventory.receive

### CASHIER

No supplier/procurement write access.

### CUSTOMER_SUPPORT

No supplier/procurement write access.

### ANALYST

No direct supplier master access by default; future aggregate reports use reports.read.

## 19. Audit

Critical actions:

- supplier.created
- supplier.updated
- purchase_order.created
- purchase_order.approved
- purchase_order.ordered
- purchase_order.cancelled
- goods_receipt.posted

Audit metadata may include:

- supplier_id;
- purchase_order_id;
- receipt_id;
- location_id;
- quantities;
- status transitions.

Do not log private credentials or raw payment information.

## 20. Supplier payment separation

A supplier invoice/payment may later reference:

- purchase_order_id;
- supplier_reference;
- amount;
- currency.

But M08 does not create a payable ledger.

If a future LIRA integration handles supplier payment, MR sends a commercial reference and stores only the external financial reference/status needed by MR.

No shared database.

## 21. Future sourcing extensions

Not required for v1:

- RFQ / request for quotation;
- supplier offers;
- MOQ price tiers;
- Incoterms;
- container/shipment procurement;
- customs documents;
- landed-cost allocation;
- supplier scorecards;
- quality inspection workflow;
- supplier returns;
- automated reorder suggestions.

The v1 schema should not prevent these extensions.

## 22. Invariants

PROC-001 — Supplier may be from any country.  
PROC-002 — Inactive supplier cannot receive a new PO.  
PROC-003 — PO total is server-calculated.  
PROC-004 — PO creation is idempotent.  
PROC-005 — Receipt creation is idempotent.  
PROC-006 — Receipt cannot exceed ordered quantity.  
PROC-007 — Every posted receipt changes inventory through PURCHASE_RECEIPT movement.  
PROC-008 — Idempotent retry never increments inventory twice.  
PROC-009 — Purchase order cost snapshots are historical.  
PROC-010 — Approval is a distinct permission from creation.  
PROC-011 — Receiving is a distinct permission from approval.  
PROC-012 — PO cannot be cancelled after any quantity has been received.  
PROC-013 — MR procurement is not a financial ledger.  
PROC-014 — Country of supplier and country of origin are separate concepts.

## 23. Acceptance tests

- create supplier in Honduras;
- create supplier in another country;
- deactivate supplier;
- reject PO for inactive supplier;
- create PO with two items;
- server recomputes totals;
- same idempotency key replays same PO;
- different payload with same key returns 409;
- unauthorized user cannot create PO;
- creator without approval permission cannot approve;
- manager/admin approves PO;
- order transition recorded;
- inventory operator receives partial quantity;
- partial receipt updates inventory and movement exactly once;
- receipt retry does not duplicate stock;
- second receipt completes PO;
- over-receipt rejected;
- receipt at wrong location rejected;
- cancellation after partial receipt rejected;
- audit events exist;
- existing order/checkout tests remain green.

## 24. Definition of Done

Requirement
→ Domain model
→ State machine
→ Authorization
→ API contract
→ Transactional inventory effect
→ Automated test
→ Audit evidence

M08 v1 is complete when procurement can create, approve, order and receive inventory safely with CI green.
