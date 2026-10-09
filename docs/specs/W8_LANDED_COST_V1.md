# W8 Landed Cost v1

**Roadmap:** W8 — Private label and owned products  
**Date:** 2026-10-09  
**Status:** implementation spec  
**Dependencies:** M08 Procurement, W8 Production Run / Lot v1

## Purpose

Preserve actual landed-cost components and their explicit allocation to received or produced units without rewriting source transactions, inventory, economic ownership or historical costs.

Landed Cost v1 is an auditable costing ledger. It is not an inventory receipt, accounting journal, FX engine, payable or settlement workflow.

## LandedCostCase

A case targets exactly one authoritative source:

- `GOODS_RECEIPT`
- `PRODUCTION_RUN`

Fields:

- case_code unique;
- source_type;
- goods_receipt_id nullable;
- production_run_id nullable;
- currency;
- status: `DRAFT` / `FINAL`;
- allocation_method: `MANUAL`;
- notes nullable;
- finalized_by_user_id nullable;
- finalized_at nullable;
- created/updated actor metadata;
- timestamps.

Only one LandedCostCase may exist for the same GoodsReceipt or ProductionRun in v1.

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
- amount_minor;
- description nullable;
- active;
- actor/timestamps.

Money uses integer minor units.

Inactive draft components do not participate in the final component total.

## Allocations

Each allocation belongs to exactly one case and exactly one compatible source line.

### GoodsReceipt case

Allocation target:

- `GOODS_RECEIPT_ITEM`

Snapshot fields:

- variant_id;
- quantity_snapshot;
- base_unit_cost_minor;
- base_cost_minor = unit_cost × quantity;
- allocated_cost_minor;
- currency.

The source currency comes from the receipt item and must equal the case currency.

### ProductionRun case

Allocation target:

- `PRODUCTION_LOT`

Requirements:

- lot belongs to the case ProductionRun;
- lot status is `COMPLETED`;
- produced_quantity is snapshotted;
- positive allocation to zero produced quantity is rejected.

ProductionRun does not invent a base manufacturing cost. Therefore:

- base_unit_cost_minor = null;
- base_cost_minor = null;
- manufacturing cost is an explicit `MANUFACTURING` component when applicable.

## Monetary and FX rules

- All amounts are integer minor units.
- Currency is explicit on every case/allocation.
- No implicit FX conversion exists in v1.
- A GoodsReceipt case inherits and validates one authoritative receipt currency.
- A mixed-currency GoodsReceipt is not finalizable through one case.
- A ProductionRun case requires a manually declared ISO-4217 currency.

API responses explicitly expose:

`fxConversionApplied:false`

## Allocation method

The only allowed allocation method in v1 is:

`MANUAL`

No weight-, quantity-, value- or algorithmic auto-allocation is performed.

A human operator explicitly assigns component cost across eligible receipt items or production lots.

## Finalization gate

`POST /v1/internal/landed-cost/cases/:id/finalize`

Requirements:

1. permission `landed_cost.finalize`;
2. actor is a StaffUser, not an internal service token;
3. case is `DRAFT`;
4. source still exists and is valid;
5. GoodsReceipt source remains `POSTED`, or ProductionRun source is `COMPLETED`;
6. at least one active component exists;
7. every eligible source line has one allocation;
8. every allocation snapshot still matches authoritative source facts;
9. allocation currency equals case currency;
10. sum(active components) exactly equals sum(allocations).

If any invariant fails, finalization fails closed.

On success the case becomes `FINAL`.

## Immutability

A `FINAL` case is immutable.

After finalization, v1 rejects:

- case edits;
- component edits;
- allocation edits;
- additional components;
- additional allocations.

Corrections require a future governed adjustment/version workflow; historical FINAL facts are not silently rewritten.

## Cost semantics

For a GoodsReceipt allocation:

`line landed cost = base receipt cost + allocated landed cost`

For a ProductionLot allocation:

`line captured landed cost = allocated landed cost`

because production base cost is not inferred from another domain.

For a GoodsReceipt case summary:

`total landed cost = base received cost + total allocated landed cost`

For a ProductionRun case summary:

`total landed cost = total explicitly captured/allocated components`

These figures are costing facts only. They are not automatically written to inventory cost basis.

## Permissions

- `landed_cost.read`
- `landed_cost.manage`
- `landed_cost.finalize`

Role policy:

- ADMIN: read/manage/finalize
- MANAGER: read/manage/finalize
- INVENTORY_OPERATOR: read only
- ANALYST: `reports.read` alone does not grant access

StaffUser mutations require CSRF.

## API

### Cases

- `GET /v1/internal/landed-cost/cases`
- `POST /v1/internal/landed-cost/cases`
- `GET /v1/internal/landed-cost/cases/:id`
- `PATCH /v1/internal/landed-cost/cases/:id`
- `POST /v1/internal/landed-cost/cases/:id/finalize`

Filters:

- status
- sourceType

### Eligible source targets

- `GET /v1/internal/landed-cost/targets`

Returns GoodsReceipts / ProductionRuns not already assigned to a LandedCostCase.

### Components

- `POST /v1/internal/landed-cost/cases/:id/components`
- `PATCH /v1/internal/landed-cost/components/:id`

### Allocations

- `POST /v1/internal/landed-cost/cases/:id/allocations`
- `PATCH /v1/internal/landed-cost/allocations/:id`

## Audit and history

Append-only histories:

- `landed_cost_case_history`
- `landed_cost_component_history`
- `landed_cost_allocation_history`

Common audit actions:

- `landed_cost_case.created`
- `landed_cost_case.updated`
- `landed_cost_case.finalized`
- `landed_cost_component.created`
- `landed_cost_component.updated`
- `landed_cost_allocation.created`
- `landed_cost_allocation.updated`

Finalization audit metadata preserves:

- source identity;
- currency;
- component total;
- allocation total;
- allocation method;
- no-FX assertion;
- non-effect assertions.

## Control Center

The `Landed Cost` view supports:

- selecting an eligible GoodsReceipt or ProductionRun;
- creating a DRAFT case;
- adding actual cost components;
- manually allocating amounts across source lines/lots;
- viewing component, allocation and difference totals;
- human finalization once balanced.

The UI must clearly state that finalization does not apply cost to inventory automatically.

## Explicit non-effects

Landed Cost v1 must not automatically:

- update `ProductVariant.cost`;
- create/update/delete `InventorySource`;
- update `InventorySource.cost_basis_minor`;
- change inventory.quantity or inventory.reserved;
- create inventory movements;
- rewrite PurchaseOrder or GoodsReceipt;
- rewrite ProductionRun or ProductionLot;
- create GoodsReceipt or PurchaseOrder;
- create accounting journal entries;
- create accounts payable;
- perform FX conversion;
- create or modify quality inspections;
- create seller settlement, commission or payout records.

Applying a finalized landed cost to an authoritative inventory cost basis requires a separate approved workflow.

## Acceptance criteria

1. Receipt and production sources can each create a case.
2. One source cannot have duplicate cases.
3. Receipt currency is authoritative and mismatches fail closed.
4. Production requires explicit currency.
5. Components use allowed typed vocabulary and integer minor units.
6. Allocations can target only lines/lots belonging to the selected source.
7. Production allocations require completed lots.
8. Finalization requires complete source-line coverage.
9. Finalization requires exact component/allocation balance.
10. Internal service cannot finalize; human StaffUser is required.
11. FINAL cases are immutable.
12. Receipt base cost remains historical and unchanged.
13. Production does not invent a base cost.
14. No InventorySource, stock, movement, source transaction or ProductVariant.cost mutation occurs.
15. Audit/history preserve create/update/finalize facts.
