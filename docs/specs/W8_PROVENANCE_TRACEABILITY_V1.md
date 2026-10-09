# W8 Provenance / Traceability v1

**Roadmap:** W8 — Private label and owned products  
**Date:** 2026-10-09  
**Status:** implementation spec  
**Dependencies:** M01 Catalog/Inventory, M08 Procurement, W8 Manufacturer Registry, Product Specification, Quality Control, Production Run/Lot and Landed Cost

## Purpose

Provide one internal, read-only traceability view that reconstructs product lineage from existing authoritative records.

Provenance v1 is not a new stock ledger, production ledger, quality ledger or cost ledger. It does not create a mutable provenance table. It reads the systems of record and exposes only relationships supported by explicit keys or governed references.

## Evidence model

The API distinguishes:

1. **authoritative lineage edges** — relationships backed by explicit database keys or an exact governed reference;
2. **context records** — relevant records for the same product/variant that are not linked strongly enough to assert a lineage edge.

No edge may be invented from:

- matching free text;
- similar timestamps;
- approximate quantities;
- common supplier/manufacturer names;
- inferred operational sequence.

## Procurement lineage

For a ProductVariant, an exact procurement lineage may contain:

- PurchaseOrder;
- PurchaseOrderItem;
- Supplier snapshot;
- supplier SKU;
- origin_country_code;
- GoodsReceipt;
- GoodsReceiptItem;
- receipt location;
- received quantity and historical receipt unit cost;
- exact PURCHASE_RECEIPT InventoryMovement when its governed reference equals the GoodsReceipt reference;
- LandedCostAllocation and LandedCostCase linked to the GoodsReceiptItem.

Hard path:

`ProductVariant <- GoodsReceiptItem -> GoodsReceipt -> PurchaseOrder -> Supplier snapshot`

Landed cost path:

`GoodsReceiptItem <- LandedCostAllocation -> LandedCostCase`

Inventory movement path uses the existing governed reference:

`goods_receipt:<receipt_number>`

The provenance view does not create or repair missing movements.

## Production lineage

For a ProductVariant, an exact production lineage may contain:

- ProductionLot;
- ProductionRun;
- ProductSpecificationVersion;
- ProductSpecification;
- ManufacturerLink;
- Manufacturer;
- produced/planned quantities;
- run/lot lifecycle state;
- LandedCostAllocation and LandedCostCase linked to the ProductionLot.

Hard path:

`ProductVariant <- ProductionLot -> ProductionRun -> ProductSpecificationVersion`

and:

`ProductionRun -> ManufacturerLink -> Manufacturer`

Landed cost path:

`ProductionLot <- LandedCostAllocation -> LandedCostCase`

A ManufacturerLink by itself is capability/provenance context and does not prove that production occurred.

## Quality Control context

QualityInspection v1 has Product/Variant and optional ProductSpecificationVersion references, but no `production_lot_id`.

Therefore quality inspections may appear as compatible context when:

- inspection is FINAL;
- it targets the same Product or Variant;
- for ProductionLot detail, an inspection with specification reference must use the same ProductSpecificationVersion.

Every returned QualityInspection context record explicitly states:

- `explicitProductionLotLink: false`.

The API must never describe such context as a passed/failed inspection of a specific ProductionLot unless a future schema adds an authoritative lot key.

## InventorySource context

InventorySource is authoritative for current commercial/economic source context by Variant + Location.

Its current `procurement_lot_id` is not an authoritative foreign key to GoodsReceipt.

Therefore InventorySource may be shown as location context, but every returned record explicitly states:

- `explicitGoodsReceiptLink: false`.

The provenance view does not infer a GoodsReceipt link from supplier, amount, location or time.

## Inventory levels

Current InventoryLevel projection may be shown as context:

- location;
- quantity;
- reserved;
- available.

Current stock is not treated as proof that units came from a specific historical receipt or production lot.

## Permission

New permission:

- `provenance.read`

Initial role intent:

- ADMIN: global read;
- MANAGER: global read;
- INVENTORY_OPERATOR: read, respecting its assigned RBAC scope;
- ANALYST: `reports.read` does not imply provenance access.

### GLOBAL scope

GLOBAL `provenance.read` may read:

- procurement lineage;
- production lineage;
- landed-cost lineage;
- QC context;
- ManufacturerLink context;
- InventorySource context;
- inventory levels.

### LOCATION scope

LOCATION `provenance.read` may read only data whose physical location is explicitly authoritative for that record.

Visible:

- GoodsReceipt/GoodsReceiptItem lineage for matching `GoodsReceipt.location_id`;
- current InventorySource rows for matching `InventorySource.location_id`;
- current inventory levels for matching location.

Not visible:

- ProductionRun/ProductionLot lineage, because ProductionRun/Lot v1 has no authoritative Location;
- global QC context;
- global ManufacturerLink capability context.

A direct Variant trace request fails with `403 forbidden` for a LOCATION actor when no procurement, InventorySource or InventoryLevel evidence is visible inside that actor's allowed locations.

GoodsReceiptItem detail validates its GoodsReceipt location.

ProductionLot detail requires GLOBAL scope.

Internal service authentication is treated as global internal access.

## API

### Variant index

`GET /v1/internal/provenance/variants?q=<sku-or-product>`

Returns only variants visible under the caller's provenance scope.

### Variant trace

`GET /v1/internal/provenance/variants/:id`

Returns:

- variant/product identity;
- visibility metadata;
- authoritative procurement lineage;
- authoritative production lineage where allowed;
- explicit landed-cost lineage;
- current inventory levels;
- InventorySource context;
- ManufacturerLink capability context;
- QualityInspection context;
- traceability facts;
- limitations.

### GoodsReceiptItem trace

`GET /v1/internal/provenance/goods-receipt-items/:id`

Returns the exact procurement lineage for one receipt item and location-compatible InventorySource context.

LOCATION actors must match the GoodsReceipt location.

### ProductionLot trace

`GET /v1/internal/provenance/production-lots/:id`

GLOBAL only in v1.

Returns the exact production lineage and compatible QC context.

## Control Center

The `Trazabilidad` view supports:

- search by SKU or product name;
- open a visible Variant;
- inspect procurement lineage;
- inspect production lineage where permitted;
- inspect exact landed-cost relationships;
- inspect current inventory/location context;
- inspect InventorySource context;
- inspect ManufacturerLink capability context;
- inspect compatible FINAL Quality Control context.

The UI visibly distinguishes hard lineage from context and repeats the non-inference rules.

There are no write actions.

## Explicit non-effects

Reading provenance must not:

- create a provenance table or row;
- modify Product or ProductVariant;
- create/change InventorySource;
- change inventory quantity/reserved;
- create inventory movements;
- create/change PurchaseOrder or GoodsReceipt;
- create/change ProductionRun or ProductionLot;
- create/change ProductSpecification;
- create/change Manufacturer or ManufacturerLink;
- create/change QualityInspection;
- create/change LandedCostCase/Allocation;
- publish/unpublish catalog data;
- perform accounting/AP activity;
- create seller settlement, staff commission or payout records.

## Public-data boundary

Provenance v1 is internal only.

Public storefront APIs must not expose through this feature:

- supplier-private identities/terms;
- procurement unit costs;
- landed costs;
- internal InventorySource economics;
- private QC rationale/evidence;
- manufacturer-private notes.

A future public provenance/claims surface requires a separate privacy and evidence contract.

## Acceptance

1. Manager/Admin can search and read full Variant provenance.
2. Analyst with reports.read alone receives forbidden.
3. Procurement lineage resolves exact PO, receipt, supplier snapshot and origin.
4. Exact PURCHASE_RECEIPT movement is surfaced when its governed receipt reference exists.
5. Receipt-item LandedCostAllocation/Case is surfaced through hard keys.
6. Production lineage resolves exact lot, run, specification version and manufacturer.
7. Production-lot LandedCostAllocation/Case is surfaced through hard keys.
8. ManufacturerLink shown outside a run is labeled capability-only and does not prove production.
9. FINAL QC appears only as context and always declares no explicit ProductionLot link.
10. InventorySource appears only as context and declares no explicit GoodsReceipt link.
11. LOCATION actor sees only procurement/inventory context for allowed locations.
12. LOCATION actor cannot read ProductionLot provenance.
13. LOCATION actor cannot directly read a Variant with no visible local evidence.
14. GoodsReceiptItem detail rejects an actor scoped to another location.
15. No text/time/quantity inference creates a provenance edge.
16. All provenance endpoints are GET/read-only; unsupported mutation methods are rejected.
17. Provenance reads have no side effects on inventory, procurement, production, QC, landed cost, catalog or economic ownership.
