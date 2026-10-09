# W8 Quality Control v1

**Roadmap:** W8 — Private label and owned products  
**Date:** 2026-10-09  
**Status:** implementation spec  
**Dependency:** W8 Product Specification v1

## Purpose

Create a human-governed quality inspection domain that records evidence, defects and a final human decision without mutating inventory, purchasing or production state.

Quality Control v1 is observational and decision-recording only.

## QualityInspection

Each inspection targets exactly one:

- `PRODUCT`
- `VARIANT`

Fields:

- inspection_type
- target_type
- product_id nullable
- variant_id nullable
- specification_version_id nullable
- sample_reference nullable
- inspected_quantity
- status
- result
- rationale nullable while draft
- evidence_reference nullable
- aql_reference nullable
- created/updated/finalized actor
- timestamps

Inspection types:

- `SAMPLE`
- `PRE_PRODUCTION`
- `IN_PROCESS`
- `FINAL`
- `RECEIVING`

Statuses:

- `DRAFT`
- `FINAL`

Results:

- `PENDING`
- `PASS`
- `CONDITIONAL`
- `FAIL`

New inspections start `DRAFT/PENDING`.

## QualityDefect

Fields:

- inspection_id
- severity
- defect_code
- description
- quantity
- evidence_reference nullable
- active
- created/updated actor
- timestamps

Severity:

- `MINOR`
- `MAJOR`
- `CRITICAL`

Defects can be created, edited or marked inactive while the inspection is DRAFT.

After finalization, defects are immutable because the parent inspection is immutable.

## Specification-version relationship

An inspection may optionally reference a ProductSpecificationVersion.

The referenced version must be immutable. `DRAFT` specification versions are rejected.

Accepted lifecycle states:

- `APPROVED`
- `SUPERSEDED`
- `WITHDRAWN`

Compatibility rules:

- PRODUCT inspection → specification must target the same Product.
- VARIANT inspection → specification may target:
  - the exact same Variant; or
  - the parent Product.

This allows variant inspections to use an approved product-level specification when no variant-specific specification exists.

The inspection does not mutate the referenced specification.

## Draft lifecycle

While DRAFT, users with `quality.manage` may update:

- sample reference
- inspected quantity
- AQL/reference text
- evidence reference
- notes/rationale
- defects

The final result remains `PENDING`.

Defect counts or severity do not calculate a result automatically.

## Finalization

Finalization requires:

- `quality.finalize`
- authenticated StaffUser actor
- result of PASS, CONDITIONAL or FAIL
- rationale of at least 8 characters

Service/internal-key actors cannot finalize and receive `human_finalization_required`.

Finalization atomically stores:

- status FINAL
- human result
- rationale
- finalizer identity/time
- full inspection + defect snapshot in append-only history

FINAL inspections and their defects are immutable.

## Permissions

- `quality.read`
- `quality.manage`
- `quality.finalize`

Role policy v1:

- ADMIN: read/manage/finalize
- MANAGER: read/manage/finalize
- INVENTORY_OPERATOR: read/manage draft, no finalize
- ANALYST: no access merely through `reports.read`

Staff mutations require CSRF.

## History and audit

Inspection history records:

- CREATED
- UPDATED
- FINALIZED

Defect history records:

- CREATED
- UPDATED

Common audit actions:

- `quality_inspection.created`
- `quality_inspection.updated`
- `quality_inspection.finalized`
- `quality_defect.created`
- `quality_defect.updated`

Finalization audit metadata records the human result and active-defect count, while explicitly recording no inventory/PO/production side effects.

## API

### Inspections

- `GET /v1/internal/quality-inspections`
- `POST /v1/internal/quality-inspections`
- `GET /v1/internal/quality-inspections/:id`
- `PATCH /v1/internal/quality-inspections/:id`
- `POST /v1/internal/quality-inspections/:id/finalize`

List filters:

- status
- result
- productId
- variantId

### Defects

- `POST /v1/internal/quality-inspections/:id/defects`
- `PATCH /v1/internal/quality-defects/:id`

## Control Center

The `Calidad` view supports:

- create an inspection;
- target Product or Variant;
- optionally select the current approved specification version;
- edit draft inspection metadata;
- add/edit/deactivate defects;
- finalize with explicit PASS/CONDITIONAL/FAIL + rationale;
- read final immutable inspection.

The UI explicitly states that defects do not calculate the outcome automatically.

## Explicit non-effects

Creating, editing or finalizing a quality inspection must not:

- change inventory quantity/reserved;
- create inventory movements;
- create or modify InventorySource;
- receive or modify PurchaseOrder;
- modify Product or ProductVariant;
- modify ProductSpecification or ProductSpecificationVersion;
- modify ManufacturerLink;
- create or modify ProductionRun/Lot;
- publish/unpublish product;
- calculate PASS/FAIL automatically.

## Acceptance

1. Manager/Admin can manage and finalize.
2. Inventory Operator can manage drafts but cannot finalize.
3. reports.read alone does not grant access.
4. DRAFT specification version cannot be referenced.
5. Product/Variant specification compatibility is enforced.
6. Defects are editable only before finalization.
7. Internal service actor cannot finalize.
8. Finalization requires explicit human result and rationale.
9. FINAL inspection and defects are immutable.
10. Final snapshot contains defects and human result.
11. No inventory, procurement, production, manufacturer or catalog side effect occurs.
