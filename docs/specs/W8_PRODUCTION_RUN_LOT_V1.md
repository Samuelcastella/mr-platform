# W8 Production Run / Lot v1

**Roadmap:** W8 — Private label and owned products  
**Date:** 2026-10-09  
**Status:** implementation spec  
**Dependencies:** W8 Product Specification v1, W8 Manufacturer Registry v1

## Purpose

Track manufacturing execution against an explicitly approved technical specification and an explicitly linked manufacturer, while keeping manufacturing records separate from inventory receipt, quality approval and landed-cost accounting.

A completed ProductionRun or ProductionLot means manufacturing activity was recorded. It does **not** mean merchandise is sellable, received into inventory, quality-approved or fully costed.

## ProductionRun

Fields:

- run_code, unique;
- product_specification_version_id;
- manufacturer_link_id;
- status;
- external_reference nullable;
- planned_start_at / planned_end_at nullable;
- actual_start_at / actual_end_at nullable;
- notes nullable;
- created/updated actor metadata;
- released_by / released_at;
- completed_by / completed_at;
- timestamps.

Statuses:

- `PLANNED`
- `RELEASED`
- `IN_PRODUCTION`
- `COMPLETED`
- `CANCELLED`

The specification-version and manufacturer-link references are immutable after run creation.

## ProductionLot

Each run contains one or more variant-specific lots.

Fields:

- production_run_id;
- lot_code, unique;
- variant_id;
- status;
- planned_quantity > 0;
- produced_quantity >= 0;
- started_at nullable;
- completed_at nullable;
- notes nullable;
- actor/timestamps.

Statuses:

- `PLANNED`
- `IN_PRODUCTION`
- `COMPLETED`
- `CANCELLED`

Multiple lots may reference the same variant when separate physical lots need distinct traceability.

## Compatibility rules

A run can be created only when:

1. ProductSpecificationVersion exists and is currently `APPROVED`;
2. its ProductSpecification is active;
3. ManufacturerLink exists and is active;
4. Manufacturer is active;
5. ManufacturerLink resolves to the same product as the specification;
6. when both specification and ManufacturerLink target VARIANT, they reference the same variant.

Lot creation adds further rules:

- lot.variant must belong to the specification's resolved product;
- if the specification targets VARIANT, lot.variant must be that exact variant;
- if ManufacturerLink targets VARIANT, lot.variant must be that exact variant.

## Release gate

`POST /v1/internal/production-runs/:id/release`

Release is a governed action.

Requirements:

- permission `production_runs.release`;
- actor must be a StaffUser, not an internal service token;
- run status is `PLANNED`;
- at least one lot exists;
- all lots remain `PLANNED`;
- the referenced specification version is still `APPROVED`;
- specification, ManufacturerLink and Manufacturer are still active.

This deliberately revalidates dependencies at release time. A run planned against a version that was later superseded cannot be released silently.

Release does not receive stock.

## Execution lifecycle

Run:

- PLANNED → RELEASED
- RELEASED → IN_PRODUCTION
- IN_PRODUCTION → COMPLETED
- PLANNED / RELEASED → CANCELLED

Run cancellation after manufacturing begins is not supported in v1.

Lot:

- PLANNED → IN_PRODUCTION
- IN_PRODUCTION → COMPLETED
- PLANNED / IN_PRODUCTION → CANCELLED

Run completion requires:

- run status `IN_PRODUCTION`;
- every lot is `COMPLETED` or `CANCELLED`;
- at least one lot is `COMPLETED`.

## Configuration locking

Before release, authorized staff may update:

- run external reference;
- planned dates;
- notes;
- lot planned quantity;
- lot notes.

After release:

- run planning configuration is locked;
- lot planning configuration is locked;
- specification and manufacturer references cannot be changed.

Execution actions create history instead of rewriting prior state.

## Permissions

- `production_runs.read`
- `production_runs.manage`
- `production_runs.release`

Role policy:

- ADMIN: read/manage/release
- MANAGER: read/manage/release
- INVENTORY_OPERATOR: read only
- ANALYST: `reports.read` does not imply production access

All StaffUser mutations require CSRF.

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

List filters:

- status
- productId

### Lots

- `POST /v1/internal/production-runs/:id/lots`
- `GET /v1/internal/production-lots/:id`
- `PATCH /v1/internal/production-lots/:id`
- `POST /v1/internal/production-lots/:id/start`
- `POST /v1/internal/production-lots/:id/complete`
- `POST /v1/internal/production-lots/:id/cancel`

## Audit and history

Append-only snapshot tables:

- `production_run_history`
- `production_lot_history`

Common audit actions:

- production_run.created
- production_run.updated
- production_run.released
- production_run.started
- production_run.completed
- production_run.cancelled
- production_lot.created
- production_lot.updated
- production_lot.started
- production_lot.completed
- production_lot.cancelled

## Control Center

The `Producción` view supports:

- create run from an approved specification version;
- select an active ManufacturerLink;
- create/edit planned lots;
- human release;
- start manufacturing;
- start/complete/cancel lots;
- complete/cancel run where lifecycle rules permit.

Every run displays the boundary:

**fabricación registrada ≠ inventario recibido**.

## Explicit non-effects

Production Run / Lot must not automatically:

- create or modify InventorySource;
- change inventory.quantity or inventory.reserved;
- create inventory_movements;
- create PurchaseOrder;
- create GoodsReceipt;
- calculate landed cost;
- mark quality control as passed;
- publish/unpublish product;
- change Product.commercial_model;
- change ManufacturerLink;
- create settlement, commission or payout records.

Inventory receipt, quality control and landed-cost allocation remain separate governed workflows.

## Acceptance

1. Run creation rejects non-APPROVED specification versions.
2. Run creation rejects incompatible/inactive manufacturer links.
3. Lot variant compatibility is enforced.
4. Inventory Operator can read but not mutate/release.
5. Internal service cannot perform human release.
6. Release revalidates specification and manufacturer state.
7. Superseded specification blocks release of an old planned run.
8. Released run/lot configuration is locked.
9. Full lifecycle completes with append-only history.
10. Produced quantity is recorded without creating stock.
11. No PO, GoodsReceipt, InventorySource or inventory movement is created.
12. Product classification and ManufacturerLink remain unchanged.
