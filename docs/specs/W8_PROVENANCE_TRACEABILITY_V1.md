# W8 Provenance & Traceability v1

**Roadmap:** W8 — Private label and owned products  
**Date:** 2026-10-09  
**Status:** implementation spec  
**Dependencies:** M08 Procurement, W8 Manufacturer Registry, Product Specification, Quality Control, Production Run/Lot and Landed Cost

## Purpose

Close W8 with explicit source-event lineage from products/variants to procurement and manufacturing facts without claiming unit-level provenance that the current aggregate inventory model cannot prove.

Traceability v1 is a read/relationship layer. It does not alter procurement, production, quality, costing or inventory.

## Source-event lineage

Two authoritative source-event types are represented:

- `GOODS_RECEIPT_ITEM`
- `PRODUCTION_LOT`

These are historical event facts, not claims about which current physical unit remains in stock.

### Procurement lineage

Direct chain:

`Supplier snapshot → PurchaseOrder → GoodsReceipt → GoodsReceiptItem`

The GoodsReceiptItem identifies:

- variant;
- quantity received;
- receipt;
- PO;
- supplier snapshot;
- receiving location/time.

A FINAL LandedCost allocation may be attached to the receipt item in the trace view.

### Production lineage

Direct chain:

`ProductSpecificationVersion → ManufacturerLink → Manufacturer → ProductionRun → ProductionLot`

The ProductionLot identifies:

- variant;
- planned/produced quantity;
- run;
- exact specification version;
- manufacturer relationship;
- production timestamps/status.

A FINAL LandedCost allocation may be attached to the lot in the trace view.

## TraceabilityQualityLink

Quality is never linked to a source event by date, SKU similarity or other inference.

An explicit link records:

- quality_inspection_id;
- source_type;
- goods_receipt_item_id nullable;
- production_lot_id nullable;
- notes nullable;
- active;
- created/updated actor metadata;
- timestamps.

The link targets exactly one GoodsReceiptItem or ProductionLot.

Exact duplicate QC/source links are rejected.

## Quality-link validation

Creating or reactivating a TraceabilityQualityLink requires:

1. QualityInspection exists.
2. QualityInspection status is `FINAL`.
3. Source event exists.
4. QC resolved Product matches source Product.
5. If QC target type is `VARIANT`, its variant exactly matches the source variant.
6. For ProductionLot, when the QC declares a specification_version_id, it must exactly equal the ProductSpecificationVersion used by the ProductionRun.

A QC inspection may omit specification_version_id; in that case no specification match is inferred.

## Explicit relationship semantics

Active source-event rows expose:

- `relationship: DIRECT_SOURCE_EVENT`
- `inferred: false`

Quality links expose:

- `relationship: EXPLICIT`
- `automaticallyInferred: false`

No API response may claim an inferred QC/source relationship.

## Current inventory boundary

Current inventory remains authoritative at:

`variant + location → quantity / reserved`

It is not lot/unit attributed.

The trace view therefore exposes current inventory separately with:

- `sourceAttributed:false`
- `attributionLevel: VARIANT_LOCATION_AGGREGATE_ONLY`

When positive stock exists, the view reports:

`CURRENT_STOCK_NOT_SOURCE_ATTRIBUTED`

This is a model limitation, not an error in historical source-event lineage.

## Traceability gaps

The view may expose explicit evidence gaps:

- `CURRENT_STOCK_NOT_SOURCE_ATTRIBUTED`
- `EXPLICIT_QUALITY_LINK_MISSING`
- `FINAL_LANDED_COST_MISSING`

A gap indicates missing explicit evidence only. It must not cause the platform to infer or create a relationship.

## Landed-cost visibility

`traceability.read` does not imply access to cost amounts.

If the actor also has `landed_cost.read`, traceability may expose FINAL allocation details:

- case code/id;
- currency;
- quantity snapshot;
- base cost where authoritative;
- allocated landed cost;
- total source-line cost.

Without `landed_cost.read`, the lineage exposes only:

- that a FINAL landed-cost record is present;
- `visibility: REDACTED`.

No amounts or cost detail are returned.

## Permissions

- `traceability.read`
- `traceability.manage`

Role policy:

- ADMIN: read/manage
- MANAGER: read/manage
- INVENTORY_OPERATOR: read
- ANALYST: `reports.read` does not grant traceability access

Cost visibility additionally requires `landed_cost.read`.

StaffUser mutations require CSRF.

## API

### Trace view

`GET /v1/internal/traceability?productId=:id`

or

`GET /v1/internal/traceability?variantId=:id`

Exactly one trace target is required.

Response includes:

- target Product classification;
- relevant variants;
- current aggregate inventory;
- procurement lineage;
- production lineage;
- explicitly linked quality inspections;
- FINAL LandedCost presence/details subject to permission;
- compatible FINAL quality candidates for manual linking;
- traceability gaps;
- explicit non-inference assertions.

### Quality links

- `GET /v1/internal/traceability/quality-links`
- `POST /v1/internal/traceability/quality-links`
- `GET /v1/internal/traceability/quality-links/:id`
- `PATCH /v1/internal/traceability/quality-links/:id`

Links use active/inactive lifecycle rather than hard delete.

Reactivation revalidates the quality/source compatibility rules.

## History and audit

Append-only history:

`traceability_quality_link_history`

Actions:

- `CREATED`
- `UPDATED`

Common audit actions:

- `traceability.quality_link.created`
- `traceability.quality_link.updated`

Audit metadata explicitly records:

- relationship is EXPLICIT;
- automaticallyInferred is false;
- sourceMutated is false;
- qualityInspectionMutated is false.

## Control Center

The `Trazabilidad` view allows authorized staff to:

- select a Product or Variant;
- inspect current aggregate inventory separately;
- review procurement lineage;
- review production lineage;
- see FINAL LandedCost subject to cost permission;
- inspect traceability gaps;
- manually create an explicit QC/source link;
- deactivate/reactivate a link.

Compatible QC candidates shown by the UI are suggestions for manual selection only. Displaying a candidate does not create or assert a relationship.

## Explicit non-effects

Traceability v1 must not:

- change QualityInspection or QualityDefect;
- change PurchaseOrder, GoodsReceipt or GoodsReceiptItem;
- change ProductionRun or ProductionLot;
- change ProductSpecificationVersion;
- change Manufacturer or ManufacturerLink;
- change LandedCost case/component/allocation;
- create/update/delete InventorySource;
- change inventory quantity or reserved;
- create inventory movements;
- change Product.commercial_model;
- create accounting entries;
- create seller settlement, commission or payout records;
- infer source links automatically;
- claim current unit-level stock provenance.

## Acceptance criteria

1. Inventory Operator can read but not manage trace links.
2. Analyst cannot read solely through reports.read.
3. Manager/Admin can create/deactivate/reactivate explicit links.
4. DRAFT QC cannot be linked.
5. Product/variant target mismatches fail closed.
6. Production QC specification mismatch fails closed.
7. Exact duplicate links are rejected.
8. Product trace shows procurement source-event chain.
9. Product trace shows production/spec/manufacturer source-event chain.
10. Only active explicit QC links appear as active evidence.
11. Deactivating a link produces an evidence gap rather than inference.
12. Current inventory is shown as non-source-attributed aggregate.
13. Landed-cost amounts are visible only with landed_cost.read.
14. traceability.read without landed_cost.read receives redacted cost presence only.
15. Trace reads/link management do not mutate QC, procurement, production, landed cost, InventorySource or inventory.
16. Link history and audit remain append-only.
