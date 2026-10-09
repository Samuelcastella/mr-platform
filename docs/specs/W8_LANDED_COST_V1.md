# W8 Landed Cost v1

**Roadmap:** W8 — Private label and owned products  
**Date:** 2026-10-09  
**Status:** implementation spec  
**Dependencies:** M08 Procurement, W8 Production Run / Lot v1

## Purpose

Record and allocate landed-cost components for merchandise that entered MR through either:

- a posted GoodsReceipt; or
- a completed ProductionRun.

This domain produces an auditable cost snapshot. It does not receive inventory, rewrite historical source cost or create an accounting ledger.

## LandedCostCase

A case targets exactly one source:

- `GOODS_RECEIPT`
- `PRODUCTION_RUN`

Fields:

- case_code unique;
- source_type;
- goods_receipt_id nullable;
- production_run_id nullable;
- currency;
- status;
- allocation_method;
- notes nullable;
- finalized_by_user_id / finalized_at;
- created/updated actor;
- timestamps.

Statuses:

- `DRAFT`
- `FINAL`

Allocation method v1:

- `MANUAL`

One v1 case is allowed per exact GoodsReceipt or ProductionRun.

## Currency rules

All authoritative money is integer minor units.

The case has exactly one ISO-4217 currency.

### GoodsReceipt

Currency is derived from the PurchaseOrder / receipt lines.

The caller may omit currency.

If currency is supplied, it must match the receipt currency.

### ProductionRun

There is no procurement currency to inherit, so currency is required explicitly.

### No FX

v1 does not:

- fetch exchange rates;
- accept a hidden conversion rate;
- combine components in multiple currencies;
- translate supplier quote currency.

Any future FX support requires a separately governed exchange-rate snapshot.

## Cost components

Allowed component types:

- `FREIGHT`
- `DUTY`
- `BROKERAGE`
- `INSURANCE`
- `LOCAL_TRANSPORT`
- `PACKAGING`
- `MANUFACTURING`
- `OTHER`

Each component stores:

- case_id;
- component_type;
- amount_minor >= 0;
- description nullable;
- active;
- actor/timestamps.

Components are editable only while the case is DRAFT.

Inactive components do not participate in the final component total.

No tax-accounting interpretation is inferred. A business-specific tax treatment must be modeled explicitly in a later accounting/tax domain.

## Allocations

A cost component total is allocated to source lines manually.

Compatible targets:

| Case source | Allocation target |
| --- | --- |
| GOODS_RECEIPT | GOODS_RECEIPT_ITEM |
| PRODUCTION_RUN | PRODUCTION_LOT |

Allocation fields:

- allocated_cost_minor >= 0;
- quantity_snapshot > 0;
- base_unit_cost_minor nullable;
- base_cost_minor nullable;
- currency;
- notes nullable;
- actor/timestamps.

Only one allocation row per case + source line is allowed.

### GoodsReceipt allocation snapshot

At allocation creation:

- quantity_snapshot = receipt item quantity;
- base_unit_cost_minor = receipt item unit cost;
- base_cost_minor = quantity × unit cost;
- currency = receipt currency.

The historical GoodsReceiptItem itself is not changed.

### ProductionRun allocation snapshot

Only COMPLETED ProductionLots with produced_quantity > 0 are eligible.

At allocation creation:

- quantity_snapshot = produced_quantity;
- base_unit_cost_minor = null;
- base_cost_minor = null;
- currency = case currency.

Production v1 does not invent a manufacturing base cost. Direct manufacturing cost must be entered explicitly as one or more `MANUFACTURING` components.

## Totals

For a case:

`landed_components_minor = sum(active component amount_minor)`

`allocated_minor = sum(allocation allocated_cost_minor)`

`allocation_delta_minor = landed_components_minor - allocated_minor`

### Procurement case

`source_base_cost_minor = sum(receipt quantity × receipt unit cost)`

`total_cost_minor = source_base_cost_minor + landed_components_minor`

### Production case

No independent source base cost exists in v1.

`source_base_cost_minor = null`

`total_cost_minor = landed_components_minor`

Each allocation response exposes:

- base cost where known;
- allocated cost;
- total line cost;
- exact unit total only when integer minor units divide evenly;
- remainder otherwise.

This avoids silently rounding an authoritative unit cost.

## Finalization

`POST /v1/internal/landed-cost/cases/:id/finalize`

Requires:

- permission `landed_cost.finalize`;
- StaffUser actor — service token cannot finalize;
- case status DRAFT;
- source still valid:
  - GoodsReceipt remains POSTED; or
  - ProductionRun remains COMPLETED;
- source lines still exist;
- every eligible source line has exactly one explicit allocation, including explicit zero allocations where applicable;
- allocation snapshots still match source quantity;
- GoodsReceipt allocation snapshots still match authoritative base unit cost and base line cost;
- allocation currency equals case currency;
- sum(allocation) exactly equals sum(active components).

If totals do not match, finalization fails with:

`allocation_total_mismatch`

and returns component, allocated and delta minor-unit totals.

A FINAL case is immutable.

## Permissions

- `landed_cost.read`
- `landed_cost.manage`
- `landed_cost.finalize`

Role policy:

- ADMIN: read/manage/finalize
- MANAGER: read/manage/finalize
- INVENTORY_OPERATOR: read
- ANALYST: reports.read does not imply landed-cost access

Read scope semantics:

- GLOBAL `landed_cost.read` may read both GoodsReceipt and ProductionRun cost data;
- LOCATION `landed_cost.read` may read only GoodsReceipt sources/cases whose `GoodsReceipt.location_id` matches that grant;
- LOCATION grants do not expose ProductionRun cost data in v1 because ProductionRun has no authoritative location field;
- case-detail reads apply the same rule and fail with `forbidden` outside scope;
- internal service authentication remains global for internal workflows.

Mutation/finalization scope semantics:

- GOODS_RECEIPT mutations evaluate `landed_cost.manage` / `landed_cost.finalize` against the receipt's `location_id`;
- a LOCATION grant can therefore manage/finalize only receipts in that exact location;
- PRODUCTION_RUN mutations/finalization require a GLOBAL grant in v1 because ProductionRun has no authoritative location field;
- the rule applies uniformly to case, component and allocation mutations;
- internal service authentication remains global, but FINAL still requires a human StaffUser.

Staff mutations require CSRF.

## API

### Sources

`GET /v1/internal/landed-cost/sources`

Returns eligible posted GoodsReceipts and completed ProductionRuns, including whether a case already exists.

Response visibility is filtered by the caller's landed-cost read scope.

### Cases

- `GET /v1/internal/landed-cost/cases`
- `POST /v1/internal/landed-cost/cases`
- `GET /v1/internal/landed-cost/cases/:id`
- `PATCH /v1/internal/landed-cost/cases/:id`
- `POST /v1/internal/landed-cost/cases/:id/finalize`

### Components

- `POST /v1/internal/landed-cost/cases/:id/components`
- `PATCH /v1/internal/landed-cost/components/:id`

### Allocations

- `POST /v1/internal/landed-cost/cases/:id/allocations`
- `PATCH /v1/internal/landed-cost/allocations/:id`

## History and audit

Every critical mutation writes its business change, full case snapshot history and common audit event atomically.

History actions include:

- CREATED
- UPDATED
- COMPONENT_CREATED
- COMPONENT_UPDATED
- ALLOCATION_CREATED
- ALLOCATION_UPDATED
- FINALIZED

Audit actions:

- landed_cost_case.created
- landed_cost_case.updated
- landed_cost_component.created
- landed_cost_component.updated
- landed_cost_allocation.created
- landed_cost_allocation.updated
- landed_cost_case.finalized

## Control Center

The `Costeo` view supports:

- create a case from an uncosted GoodsReceipt or completed ProductionRun;
- view source base cost where authoritative;
- add/edit/deactivate cost components;
- allocate amounts manually to receipt items or completed production lots;
- see allocation delta;
- finalize with human permission;
- read immutable final cases.

The UI explicitly states:

- no FX;
- production does not invent a base cost;
- finalizing does not change inventory or source historical cost.

## Explicit non-effects

Landed Cost v1 must not automatically:

- change `product_variants.cost`;
- rewrite PurchaseOrderItem or GoodsReceiptItem unit cost;
- change PurchaseOrder or GoodsReceipt lifecycle;
- change ProductionRun or ProductionLot lifecycle;
- create or modify InventorySource;
- change inventory.quantity or inventory.reserved;
- create inventory_movements;
- create PurchaseOrder or GoodsReceipt;
- post supplier payables/AP;
- create accounting journal entries;
- change Product.commercial_model;
- change ManufacturerLink;
- change QualityInspection;
- create settlement, commission or payout records;
- perform FX conversion.

## Acceptance

1. Receipt case derives currency and source base cost.
2. Receipt case rejects mismatched requested currency.
3. Production case requires explicit currency.
4. Only completed production lots may receive allocations.
5. Allocation snapshots preserve quantity/base cost where applicable.
6. Every eligible source line requires one explicit allocation before finalization.
7. Finalization revalidates GoodsReceipt base unit/line cost snapshots and fails closed if they changed.
8. Manual allocations must equal active component total before finalization.
9. Service actor cannot finalize.
10. Inventory Operator can read but cannot manage/finalize.
11. LOCATION-scoped Inventory Operator sees only GoodsReceipt landed-cost data for its own location.
12. LOCATION-scoped Inventory Operator cannot read ProductionRun landed-cost data in v1.
13. Out-of-scope GoodsReceipt case detail returns forbidden.
14. Analyst cannot read solely through reports.read.
15. FINAL case, components and allocations are immutable.
16. Source costs remain unchanged.
17. Inventory quantity/reserved/movements remain unchanged.
18. InventorySource, PO, receipt, production and QC state remain unchanged.
19. No FX is applied.
20. History/audit are complete.
21. LOCATION-scoped landed_cost.manage can mutate only GoodsReceipt cases in its exact location.
22. LOCATION-scoped landed_cost.finalize can finalize only GoodsReceipt cases in its exact location.
23. LOCATION-scoped manage/finalize cannot act on ProductionRun landed-cost cases in v1.
24. Component and allocation mutation endpoints enforce the same source scope as the parent case.
