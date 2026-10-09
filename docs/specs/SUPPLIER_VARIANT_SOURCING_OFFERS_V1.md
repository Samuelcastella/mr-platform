# SupplierVariant Sourcing Offers v1

**Module:** M01 Catalog / Inventory sourcing foundation  
**Date:** 2026-10-08  
**Status:** implementation spec

## Purpose

Implement the many-to-many Supplier ↔ ProductVariant relationship required by M01 and preserve current supplier-specific sourcing terms before procurement.

This layer is pre-procurement. An offer is not a purchase order and does not reserve inventory.

## Data model

### SupplierVariant

Current sourcing relationship:

- supplier_id
- variant_id
- supplier_sku nullable
- quoted_cost_minor nullable
- currency
- moq nullable
- lead_time_days nullable
- origin_country_code nullable
- preferred boolean
- active boolean
- last_verified_at
- created/updated actor metadata
- timestamps

There is at most one current SupplierVariant row for a supplier + variant pair.

### SupplierVariantHistory

Append-only snapshots preserve changes in quoted terms.

Each create/update appends:

- supplier_variant_id
- actor
- action
- complete sourcing-term snapshot
- optional note
- timestamp

Historical procurement cost remains governed by PurchaseOrder / GoodsReceipt snapshots and is not rewritten by SupplierVariant updates.

## Monetary rules

- quoted costs use integer minor units;
- currency is explicit;
- no implicit FX conversion;
- offers in different currencies remain in separate comparison groups;
- retail spread is calculated only when the quote currency matches the variant retail currency;
- retail spread means **retail price minus quoted unit cost only**;
- retail spread is not landed margin, contribution margin or accounting profit.

## Endpoints

### List relationships

`GET /v1/internal/sourcing/offers`

Filters:

- `variantId`
- `supplierId`
- `active=true|false`

Requires `suppliers.read`.

### Create relationship

`POST /v1/internal/sourcing/offers`

Requires `suppliers.write` + CSRF for StaffUser.

Example:

```json
{
  "supplierId": 10,
  "variantId": 55,
  "supplierSku": "ABC-M-BLK",
  "quotedCostMinor": 8500,
  "currency": "HNL",
  "moq": 12,
  "leadTimeDays": 5,
  "originCountryCode": "HN",
  "preferred": false,
  "note": "Cotización verificada por WhatsApp"
}
```

### Read relationship + history

`GET /v1/internal/sourcing/offers/:id`

Requires `suppliers.read`.

### Update current sourcing terms

`PATCH /v1/internal/sourcing/offers/:id`

Requires `suppliers.write` + CSRF.

The update refreshes `last_verified_at` and appends a history snapshot.

### Compare a variant

`GET /v1/internal/sourcing/comparison?variantId=:id`

Requires `suppliers.read`.

Response groups offers by currency and exposes:

- quote;
- MOQ;
- lead time;
- origin;
- preferred flag;
- last verification;
- retail spread only when currencies match;
- explicit `fxConversionApplied:false`;
- explicit `automaticSupplierSelection:false`;
- explicit `createsPurchaseOrder:false`.

## Permissions

Existing permissions are reused:

- `suppliers.read` — read relationships/comparisons;
- `suppliers.write` — create/update sourcing terms.

`reports.read` alone does not grant access to private supplier pricing.

## Control Center

A `Sourcing` view allows authorized staff to:

- select a product variant;
- see supplier offers;
- compare terms by currency;
- register a new supplier-variant relationship;
- update current terms;
- activate/deactivate an offer;
- mark an offer preferred.

The view contains no “buy” or “create PO” action.

## Explicit non-effects

SupplierVariant create/update must not:

- create a PurchaseOrder;
- approve procurement;
- receive inventory;
- create an InventorySource;
- reserve stock;
- change Product status or publication;
- modify commercial ownership;
- create seller settlement or staff commission records;
- perform FX conversion;
- select a supplier automatically.

A later purchase requires an explicit M08 PurchaseOrder operation.
