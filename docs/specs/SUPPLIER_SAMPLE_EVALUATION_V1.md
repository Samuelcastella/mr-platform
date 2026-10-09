# Supplier & Sample Evaluation v1

**Roadmap:** W8 — Private label and owned products  
**Date:** 2026-10-08  
**Status:** implementation spec

## Purpose

Provide a structured, auditable human review of suppliers and samples before a procurement decision.

This module records evidence and a human decision. It does not rank suppliers automatically and it does not execute procurement.

## Evaluation types

- `SUPPLIER` — general supplier review, optionally tied to a current SupplierVariant offer.
- `SAMPLE` — review of a physical/product sample. A sample must be tied to a SupplierVariant offer or carry a human-readable sample reference.

Every evaluation belongs to exactly one Supplier.

## Criteria vocabulary

Each criterion uses one explicit state:

- `NOT_REVIEWED`
- `ACCEPTABLE`
- `CONCERN`
- `UNACCEPTABLE`

Criteria in v1:

- quality;
- consistency;
- communication;
- lead-time confidence;
- packaging.

The API does not calculate a numeric or weighted composite score.

## Human decision

Exactly one manual decision is recorded:

- `CONTINUE`
- `SHORTLIST`
- `REQUEST_REVISION`
- `HOLD`
- `DECLINE`

`SHORTLIST` is not equivalent to preferred supplier and does not modify `SupplierVariant.preferred`.

## Lifecycle

- `OPEN`
- `FINAL`
- `ARCHIVED`

`ARCHIVED` is terminal in v1.

The lifecycle describes the evaluation record only. It does not authorize spending or procurement.

## Required fields

Every evaluation requires:

- evaluation type;
- supplier;
- decision;
- rationale of at least 8 characters;
- actor/timestamp.

A `SAMPLE` evaluation additionally requires either:

- `supplier_variant_id`, or
- `sample_reference`.

Optional:

- sourcing offer link;
- evidence/reference;
- sample reference.

## Data model

### SupplierEvaluation

- id
- evaluation_type
- supplier_id
- supplier_variant_id nullable
- sample_reference nullable
- status
- decision
- quality
- consistency
- communication
- lead_time_confidence
- packaging
- rationale
- evidence_reference nullable
- created_by_user_id
- updated_by_user_id
- created_at / updated_at

### SupplierEvaluationHistory

Append-only snapshot log:

- evaluation_id
- actor user/service
- action
- complete evaluation snapshot JSON
- note nullable
- created_at

## Security

Existing supplier permissions are reused:

- `suppliers.read` — list/read evaluations and history;
- `suppliers.write` — create/update evaluations.

StaffUser mutations require CSRF.

An Analyst with only `reports.read` does not gain access to private supplier evaluation data.

## API

### List

`GET /v1/internal/sourcing/evaluations`

Optional filters:

- `type`
- `status`
- `supplierId`

### Create

`POST /v1/internal/sourcing/evaluations`

Example:

```json
{
  "type": "SAMPLE",
  "supplierId": 12,
  "supplierVariantId": 44,
  "sampleReference": "Sample 2026-10-A",
  "decision": "REQUEST_REVISION",
  "criteria": {
    "quality": "CONCERN",
    "consistency": "NOT_REVIEWED",
    "communication": "ACCEPTABLE",
    "leadTimeConfidence": "ACCEPTABLE",
    "packaging": "CONCERN"
  },
  "rationale": "Construction is acceptable but stitching and packaging need revision.",
  "evidenceReference": "Photos and sample review notes"
}
```

### Detail + history

`GET /v1/internal/sourcing/evaluations/:id`

### Update

`PATCH /v1/internal/sourcing/evaluations/:id`

May update:

- lifecycle status;
- manual decision;
- criteria;
- sample reference;
- rationale;
- evidence reference.

Each change appends history and a common audit event.

## Audit

Critical actions:

- `supplier_evaluation.created`
- `supplier_evaluation.updated`

API responses explicitly expose:

- `compositeScore:null`;
- `automaticSupplierSelection:false`;
- `createsPurchaseOrder:false`;
- `inventoryChanged:false`;
- `supplierPreferenceChanged:false`.

## Control Center

The `Evaluaciones` view provides:

- filter by lifecycle status;
- create supplier/sample evaluation;
- optional link to a SupplierVariant sourcing offer;
- manual criterion capture;
- manual decision;
- edit/finalize/archive;
- read-only experience for users without `suppliers.write`.

## Explicit non-effects

Creating, updating, finalizing or archiving an evaluation must not automatically:

- calculate a composite supplier score;
- mark a SupplierVariant as preferred;
- activate/deactivate a Supplier;
- create or approve a PurchaseOrder;
- create an InventorySource;
- change inventory quantity or reservations;
- create inventory movements;
- change Product status/brand/ownership;
- create settlement, commission or payout records.

Any procurement action remains an explicit M08 operation.
