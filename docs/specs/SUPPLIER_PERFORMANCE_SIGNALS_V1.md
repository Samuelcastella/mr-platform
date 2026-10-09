# Supplier Performance Signals v1

**Date:** 2026-10-08  
**Status:** implementation spec  
**Dependencies:** M08 Suppliers & Procurement Core + SupplierVariant Sourcing Offers

## Purpose

Expose factual supplier procurement/receiving signals without calculating a supplier score or making an automatic sourcing decision.

This module is analytical and read-only.

## Security boundary

The endpoint requires both:

- `suppliers.read`
- `procurement.read`

`reports.read` by itself does not grant access to supplier identity, supplier pricing or procurement history.

## Analysis window

`30–365` days, anchored on `PurchaseOrder.ordered_at`.

Included PO statuses:

- ORDERED
- PARTIALLY_RECEIVED
- RECEIVED

DRAFT, APPROVED and CANCELLED POs are excluded because they are not active/realized ordered procurement for this analysis.

## Signals by supplier

### Purchase orders

- total ordered POs in window;
- ORDERED/open count;
- PARTIALLY_RECEIVED count;
- RECEIVED count.

### Units

- quantity ordered;
- quantity received;
- receipt progress percentage.

Receipt progress is an operational completion measure. It is not a quality score.

### Timing

- average days from ordered_at to first posted receipt;
- average days from ordered_at to last receipt for fully RECEIVED POs.

### On-time completion

A PO is eligible only when:

- status is RECEIVED;
- expected_at is present;
- at least one receipt exists.

It counts as on-time when the final receipt timestamp is <= expected_at.

If there are no eligible POs, on-time percentage is null instead of an invented zero.

### Received cost

Received commercial cost is:

`GoodsReceiptItem.quantity_received × GoodsReceiptItem.unit_cost_minor`

Amounts remain grouped by their explicit currency.

No FX conversion is applied.

This is procurement cost history, not accounts payable or cash movement.

### Sourcing context

The response also exposes current SupplierVariant counts:

- active offers;
- preferred offers;
- distinct active variants.

These are current sourcing relationships and are not used to alter historical PO metrics.

## Endpoint

`GET /v1/internal/supplier-performance?days=90`

Response includes:

- summary;
- suppliers[];
- methodology.

Methodology explicitly states:

- `fxConversionApplied:false`
- `supplierScoreCalculated:false`
- `automaticSupplierDecision:false`

## Explicit non-effects

Reading supplier performance must not:

- create/update/cancel PurchaseOrder;
- receive inventory;
- create InventorySource;
- select or block a supplier;
- mark a SupplierVariant preferred;
- create payable/AP records;
- create seller settlement or staff commission records;
- convert currencies;
- calculate landed cost without actual landed-cost allocation data.

## Control Center

The existing `Sourcing` page shows:

- 30/90/180/365-day performance window;
- aggregate PO/receipt progress;
- per-supplier PO activity;
- received/ordered units;
- first/complete receipt timing;
- on-time percentage when eligible;
- received cost grouped by currency;
- current active sourcing offer counts.

No ranking badge, grade, score or auto-recommendation is displayed.
