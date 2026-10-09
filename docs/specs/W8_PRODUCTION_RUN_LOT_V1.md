# W8 Production Run / Lot v1

**Roadmap:** W8 — Private label and owned products  
**Date:** 2026-10-09  
**Status:** implementation spec  
**Dependencies:** W8 Product Specification v1, W8 Manufacturer Registry v1

## Purpose

Represent manufacturing execution and lot traceability before inventory receipt.

A completed ProductionRun or ProductionLot means manufacturing was recorded as complete. It does **not** mean merchandise has been received into MR inventory.

## ProductionRun

Fields:

- run_code, unique
- product_specification_version_id
- manufacturer_link_id
- status
- external_reference nullable
- planned_start_at / planned_end_at nullable
- actual_start_at / actual_end_at nullable
- notes nullable
- created/updated/released/completed/cancelled actor metadata
- timestamps

Statuses:

- `PLANNED`
- `RELEASED`
- `IN_PRODUCTION`
- `COMPLETED`
- `CANCELLED`

## ProductionLot

Fields:

- production_run_id
- lot_code, unique
- variant_id
- status
- planned_quantity
- produced_quantity
- started_at nullable
- completed_at nullable
- notes nullable
- actor/timestamps

Statuses:

- `PLANNED`
- `IN_PRODUCTION`
- `COMPLETED`
- `CANCELLED`

`planned_quantity` must be positive.

`produced_quantity` is non-negative and is recorded when the lot is completed.

## Specification requirement

Creating a ProductionRun requires a ProductSpecificationVersion with status exactly `APPROVED`.

A `DRAFT`, `SUPERSEDED` or `WITHDRAWN` specification version cannot be used to create a new run.

The specification version cannot be changed after run creation.

## Manufacturer requirement

Creating a ProductionRun requires an active ManufacturerLink whose Manufacturer is also active.

Compatibility:

- ManufacturerLink must resolve to the same Product as the specification.
- If specification target is VARIANT and ManufacturerLink target is VARIANT, both variants must be identical.
- Product-level ManufacturerLink can support a variant-level specification for the same product.
- Variant-level ManufacturerLink can support a product-level specification, but then every lot is restricted to that ManufacturerLink variant.

The ManufacturerLink cannot be changed after run creation.

## Lot compatibility

Every lot variant must belong to the Product resolved by the run specification.

Additional restrictions:

- if specification target is VARIANT, every lot must use that exact variant;
- if ManufacturerLink target is VARIANT, every lot must use that exact variant.

If both are product-level, the run may contain multiple variants of the same product.

## Lifecycle

### PLANNED

Editable planning metadata and lots.

Allowed:

- edit external reference / planned dates / notes;
- create lots;
- edit planned lot quantity / notes;
- release run;
- cancel run.

### RELEASED

Release requires:

- `production_runs.release`;
- human StaffUser actor;
- at least one lot;
- all lots PLANNED.

Specification and ManufacturerLink remain fixed.

### IN_PRODUCTION

A released run may be explicitly started.

Lots may then be:

- started;
- completed with produced quantity;
- cancelled with reason.

Starting/completing/cancelling lifecycle actions require a human StaffUser with `production_runs.release`.

### COMPLETED

Run completion requires:

- run status IN_PRODUCTION;
- all lots terminal: COMPLETED or CANCELLED;
- at least one COMPLETED lot.

COMPLETED is terminal and immutable in v1.

### CANCELLED

Run cancellation requires a reason.

For PLANNED/RELEASED runs, remaining PLANNED lots are cancelled atomically with the run.

A run with an IN_PRODUCTION lot cannot be cancelled until that lot is explicitly completed or cancelled.

CANCELLED is terminal.

## Permissions

- `production_runs.read`
- `production_runs.manage`
- `production_runs.release`

Role policy v1:

- ADMIN: read/manage/release
- MANAGER: read/manage/release
- INVENTORY_OPERATOR: read
- ANALYST: no access merely through `reports.read`

Staff mutations require CSRF.

Lifecycle authority additionally requires a human StaffUser actor.

## History and audit

ProductionRun and ProductionLot each maintain append-only snapshot history.

Run actions include:

- CREATED
- UPDATED
- RELEASED
- STARTED
- COMPLETED
- CANCELLED

Lot actions include:

- CREATED
- UPDATED
- STARTED
- COMPLETED
- CANCELLED
- CANCELLED_BY_RUN

Common audit actions:

- `production_run.created`
- `production_run.updated`
- `production_run.released`
- `production_run.started`
- `production_run.completed`
- `production_run.cancelled`
- `production_lot.created`
- `production_lot.updated`
- `production_lot.start`
- `production_lot.complete`
- `production_lot.cancel`

## API

### Runs

- `GET /v1/internal/production-runs`
- `POST /v1/internal/production-runs`
- `GET /v1/internal/production-runs/:id`
- `PATCH /v1/internal/production-runs/:id`
- `POST /v1/internal/production-runs/:id/release`
- `POST /v1/internal/production-runs/:id/start`
- `POST /v1/internal/production-runs/:id/complete`
- `POST /v1/internal/production-runs/:id/cancel`

### Lots

- `POST /v1/internal/production-runs/:id/lots`
- `GET /v1/internal/production-lots/:id`
- `PATCH /v1/internal/production-lots/:id`
- `POST /v1/internal/production-lots/:id/start`
- `POST /v1/internal/production-lots/:id/complete`
- `POST /v1/internal/production-lots/:id/cancel`

## Control Center

The `Producción` view supports:

- create run from current APPROVED specification + active ManufacturerLink;
- edit planning while PLANNED;
- add/edit lots while PLANNED;
- release;
- start production;
- start/complete/cancel lots;
- complete/cancel run;
- inspect planned vs produced quantity.

The UI explicitly states that completed production is not inventory receipt.

## Explicit non-effects

Creating, releasing, starting, completing or cancelling runs/lots must not:

- create/update InventorySource;
- change inventory quantity/reserved;
- create inventory_movements;
- create GoodsReceipt;
- create/modify PurchaseOrder;
- calculate landed cost;
- mark QualityInspection as PASS/FINAL;
- modify Product or ProductVariant;
- modify ProductSpecificationVersion;
- modify ManufacturerLink or Manufacturer;
- create settlement, commission or payout records.

## Acceptance

1. Run creation requires APPROVED spec.
2. ManufacturerLink/Manufacturer must be active.
3. Specification/manufacturer compatibility is enforced.
4. Lot variant compatibility is enforced.
5. Release requires at least one planned lot.
6. Service/internal actor cannot perform lifecycle release/start/complete/cancel.
7. Run follows PLANNED → RELEASED → IN_PRODUCTION → COMPLETED.
8. Lot follows PLANNED → IN_PRODUCTION → COMPLETED.
9. Run cannot complete with nonterminal lots.
10. Run completion requires at least one completed lot.
11. Cancellation behavior is explicit and auditable.
12. Completed production does not mutate inventory or procurement.
