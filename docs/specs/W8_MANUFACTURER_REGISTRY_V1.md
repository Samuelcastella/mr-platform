# W8 Manufacturer Registry v1

**Roadmap:** W8 — Private label and owned products  
**Date:** 2026-10-08  
**Status:** implementation spec  
**Dependency:** M01 Product Classification v1

## Purpose

Create a first-class manufacturer registry and auditable product/variant associations without treating Manufacturer as Supplier, Seller or economic inventory owner.

A manufacturer link documents provenance / production capability context. It does not prove that a production run occurred.

## Manufacturer

Fields:

- id
- name
- legal_name nullable
- country_code nullable
- city nullable
- contact_name nullable
- email nullable
- phone nullable
- website nullable
- notes nullable
- active
- created_by / updated_by
- created_at / updated_at

Manufacturer records are independent of Supplier records.

Creating a Manufacturer does not create a Supplier.

## ManufacturerLink

A link targets exactly one catalog entity:

- `PRODUCT`
- `VARIANT`

Fields:

- manufacturer_id
- target_type
- product_id nullable
- variant_id nullable
- manufacturer_reference nullable
- notes nullable
- active
- created_by / updated_by
- created_at / updated_at

A manufacturer may link to many products/variants.

A product/variant may link to many manufacturers.

There is no `preferred` or automatic winner field in v1.

## Relationship with Product.commercial_model

ManufacturerLink is independent of `Product.commercial_model`.

Examples:

- a `private_label` product may have candidate manufacturer links;
- an `owned` product may have multiple historical/current manufacturer links;
- a `curated` or `third_party` product may also have a known manufacturer.

Creating/updating a link must not modify `commercial_model`.

## Relationship with Supplier and sourcing

Manufacturer is not Supplier.

Manufacturer Registry does not create:

- Supplier;
- SupplierVariant sourcing offer;
- supplier preference;
- MOQ/lead-time quote;
- PurchaseOrder.

If a manufacturer also sells directly, that relationship must be represented independently in the Supplier domain.

## Relationship with production

ManufacturerLink is not a production event.

It must not create or imply:

- ProductionRun;
- production lot;
- quality-control pass;
- received inventory;
- landed cost.

Those are later W8 domains.

## Permissions

- `manufacturers.read`
- `manufacturers.manage`

Role policy in v1:

- ADMIN: read/manage
- MANAGER: read/manage
- INVENTORY_OPERATOR: read
- ANALYST: no access merely through `reports.read`

Staff mutations require CSRF.

## Audit and history

Manufacturer and ManufacturerLink each maintain append-only snapshot history.

Common audit actions:

- `manufacturer.created`
- `manufacturer.updated`
- `manufacturer_link.created`
- `manufacturer_link.updated`

Audit metadata explicitly records that no supplier, procurement, production or inventory side effect occurred.

## API

### Manufacturers

- `GET /v1/internal/manufacturers`
- `POST /v1/internal/manufacturers`
- `GET /v1/internal/manufacturers/:id`
- `PATCH /v1/internal/manufacturers/:id`

List supports `active=true|false`.

### Manufacturer links

- `GET /v1/internal/manufacturer-links`
- `POST /v1/internal/manufacturer-links`
- `GET /v1/internal/manufacturer-links/:id`
- `PATCH /v1/internal/manufacturer-links/:id`

List filters:

- manufacturerId
- productId
- variantId
- active

Create contract:

```json
{
  "manufacturerId": 15,
  "targetType": "VARIANT",
  "targetId": 88,
  "manufacturerReference": "FACTORY-SKU-88",
  "notes": "Candidate factory reference"
}
```

The same manufacturer cannot create duplicate links to the same exact product or exact variant. A different manufacturer may link to that target.

## Lifecycle rules

Manufacturer and ManufacturerLink use an `active` flag instead of hard deletion in v1.

Deactivating a Manufacturer:

- does not cascade-delete or silently rewrite existing links;
- prevents creation of new links;
- prevents reactivation of an inactive link until the Manufacturer is active again.

## Control Center

The `Fabricantes` view supports:

- create/edit/deactivate Manufacturer;
- create PRODUCT or VARIANT link;
- edit/deactivate link;
- read-only access when the user has `manufacturers.read` without manage permission.

The page contains no purchase, production-run or automatic-selection action.

## Explicit non-effects

Manufacturer Registry must not:

- create Supplier;
- create SupplierVariant;
- create PurchaseOrder;
- create InventorySource;
- change inventory quantity/reservations;
- create inventory movements;
- change Product.commercial_model;
- create SellerAgreement;
- create settlement or commission records;
- select a manufacturer automatically;
- create ProductionRun or production lot.

## Acceptance

1. Manager/Admin can create/update records and links.
2. Inventory Operator can read but not manage.
3. reports.read alone does not grant manufacturer access.
4. Multiple manufacturers can link to one product/variant.
5. One manufacturer can link separately at PRODUCT and VARIANT level.
6. Duplicate exact links are rejected.
7. Histories are append-only.
8. Inactive manufacturer blocks new links and link reactivation.
9. No Supplier/SupplierVariant/PO/InventorySource is created.
10. No inventory or commercial-model mutation occurs.
