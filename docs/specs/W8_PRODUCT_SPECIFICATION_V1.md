# W8 Product Specification v1

**Roadmap:** W8 — Private label and owned products  
**Date:** 2026-10-09  
**Status:** implementation spec  
**Dependencies:** M01 Product Classification v1, W8 Manufacturer Registry v1

## Purpose

Provide an auditable, immutable technical specification/version domain for owned and private-label product development.

A ProductSpecification identifies the technical document series for one exact Product or ProductVariant. ProductSpecificationVersion stores the technical snapshot.

Approving a specification does not automatically apply it to production, purchasing, catalog publication or inventory.

## ProductSpecification

Exactly one target:

- `PRODUCT`
- `VARIANT`

Fields:

- id
- code, unique and normalized
- title
- target_type
- product_id nullable
- variant_id nullable
- active
- actor/timestamps

There may be one active ProductSpecification per exact Product target and one active ProductSpecification per exact Variant target.

A Product may therefore have a product-level specification while individual variants have separate variant-level specifications.

## ProductSpecificationVersion

Fields:

- specification_id
- version_no, sequential within specification
- status
- materials JSON
- measurements JSON
- construction JSON
- packaging JSON
- labeling JSON
- quality_requirements JSON
- notes nullable
- change_summary
- created_by / updated_by
- approved_by nullable
- approved_at nullable
- timestamps

Each technical section must be a JSON object and is size-bounded by the API.

## Version lifecycle

Allowed statuses:

- `DRAFT`
- `APPROVED`
- `SUPERSEDED`
- `WITHDRAWN`

### DRAFT

Editable.

A draft may be created empty or by cloning an earlier version from the same specification.

Creating a version acquires a row lock on the specification before assigning the next sequential version number.

### APPROVED

Technical content is immutable.

Approval requires:

- `product_specs.approve`;
- an authenticated StaffUser actor.

Service/internal-key actors cannot approve. They receive `human_approval_required`.

### SUPERSEDED

When a newer draft is approved, the previous current `APPROVED` version in the same specification is atomically changed to `SUPERSEDED`.

Technical content is not changed.

A unique partial database index enforces at most one `APPROVED` version per specification.

### WITHDRAWN

The current approved version may be explicitly withdrawn by a human approver with a required reason.

A withdrawn version remains immutable and readable.

## Immutability rule

No technical section of `APPROVED`, `SUPERSEDED` or `WITHDRAWN` may be edited in place.

To change technical content after approval, the operator creates a new `DRAFT` version.

This preserves the exact snapshot against which a future production run or quality-control event may be evaluated.

## Permissions

- `product_specs.read`
- `product_specs.manage`
- `product_specs.approve`

Role policy v1:

- ADMIN: read/manage/approve
- MANAGER: read/manage/approve
- INVENTORY_OPERATOR: read
- ANALYST: no access merely through `reports.read`

StaffUser mutations require CSRF.

Approval and withdrawal additionally require a human StaffUser actor.

## History and audit

ProductSpecification maintains append-only metadata history.

ProductSpecificationVersion maintains append-only snapshot history for:

- CREATED
- UPDATED
- APPROVED
- SUPERSEDED
- WITHDRAWN

Common audit actions:

- `product_specification.created`
- `product_specification.updated`
- `product_specification_version.created`
- `product_specification_version.updated`
- `product_specification_version.approved`
- `product_specification_version.withdrawn`

## API

### Specification series

- `GET /v1/internal/product-specifications`
- `POST /v1/internal/product-specifications`
- `GET /v1/internal/product-specifications/:id`
- `PATCH /v1/internal/product-specifications/:id`

Filters:

- productId
- variantId
- active

### Versions

Create:

`POST /v1/internal/product-specifications/:id/versions`

Example:

```json
{
  "cloneVersionId": 41,
  "changeSummary": "Revise packaging for pilot production",
  "sections": {
    "packaging": {
      "bag": "paper sleeve",
      "unitsPerCarton": 16
    }
  },
  "notes": "All unspecified sections inherit from the cloned version."
}
```

Read/update draft:

- `GET /v1/internal/product-specification-versions/:id`
- `PATCH /v1/internal/product-specification-versions/:id`

Approval:

`POST /v1/internal/product-specification-versions/:id/approve`

Withdrawal:

`POST /v1/internal/product-specification-versions/:id/withdraw`

## Clone semantics

When `cloneVersionId` belongs to the same specification:

- all technical sections are copied;
- supplied sections override their matching cloned section;
- the new version receives a new sequential `version_no`;
- the new version always starts as `DRAFT`;
- approval metadata is never cloned.

## Control Center

The `Especificaciones` view supports:

- create Product/Variant specification series;
- open a specification detail;
- create blank or cloned versions;
- edit DRAFT sections as JSON;
- approve a DRAFT;
- withdraw the current APPROVED version;
- inspect immutable snapshots and lifecycle status.

The UI does not pre-approve or automatically apply a version.

## Relationship to Manufacturer and production

ProductSpecification is independent of ManufacturerLink.

A specification may later be referenced by a ProductionRun, but v1 does not create or infer ProductionRun.

Manufacturer selection and production execution remain explicit later W8 actions.

## Explicit non-effects

Creating, editing, approving, superseding or withdrawing a specification/version must not:

- modify Product.name/status/commercial_model/default_condition;
- modify ProductVariant identity or pricing;
- create/update ManufacturerLink;
- create Supplier or SupplierVariant;
- create PurchaseOrder;
- create InventorySource;
- change inventory quantity/reserved;
- create inventory movements;
- publish/unpublish product;
- create ProductionRun/Lot;
- apply the specification automatically to production.

## Acceptance

1. Manager/Admin can create/manage/approve.
2. Inventory Operator can read but not manage.
3. reports.read alone does not grant access.
4. Version numbering is sequential under lock.
5. DRAFT is editable.
6. Internal service actor cannot approve.
7. APPROVED technical content is immutable.
8. New version can clone earlier content.
9. Approving v2 atomically supersedes v1.
10. At most one APPROVED version exists.
11. Withdrawal requires a reason.
12. History preserves all technical snapshots.
13. Product, manufacturer, procurement and inventory domains remain unchanged.
