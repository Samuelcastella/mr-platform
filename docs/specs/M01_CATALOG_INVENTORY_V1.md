# SPEC — Module 01: Catalog & Inventory v1

Status: APPROVED FOR DESIGN  
Owner: MR עדולם  
Method: Spec-Driven Development (SDD)

## 1. Purpose

Create the authoritative product, pricing, sourcing and inventory domain for MR עדולם.

MR עדולם begins as a boutique that resells third-party merchandise, but the model must evolve without redesigning the core toward curated products, private/white-label products and fully owned products.

The catalog must support physical retail, web, future mobile applications, marketplaces, multiple locations, multiple countries and multiple suppliers.

## 2. Business context

The initial operation buys merchandise opportunistically rather than from one permanent supplier. Purchasing may happen in San Pedro Sula for sale in Puerto Cortés, choosing among vendors according to price, quality and availability. Future sourcing may include manufacturers and suppliers in any country.

Therefore:

- a catalog product must not be owned by one supplier;
- the same variant may be sourced from multiple suppliers;
- every procurement can have a different unit cost;
- inventory movements must preserve traceability;
- supplier performance and landed cost must be measurable over time.

## 3. Product ownership model

Every product SHALL have one commercial model:

- `third_party` — external brand/product resold by MR עדולם;
- `curated` — external product selected under MR עדולם merchandising criteria;
- `private_label` — third-party manufactured product sold under MR עדולם branding;
- `owned` — product specified and controlled as an MR עדולם product.

This attribute is independent of the supplier used to obtain the product.

## 4. Product condition

Supported values:

- `new`
- `second_hand`
- `refurbished`

Condition may be overridden at inventory-lot level when individual units differ.

## 5. Core entities

### Product
- id UUID
- name
- slug
- short_description
- long_description
- status: draft / active / inactive / archived
- commercial_model
- brand_id nullable
- category_id
- default_condition
- metadata
- created_at / updated_at

### Category
- id UUID
- parent_id nullable
- name
- slug
- status
- sort_order

### ProductVariant
- id UUID
- product_id
- sku unique
- barcode nullable
- option_values
- weight/dimensions nullable
- status
- created_at / updated_at

### Price
- id UUID
- variant_id
- channel
- currency ISO-4217
- amount_minor
- compare_at_amount_minor nullable
- valid_from / valid_to nullable

### Supplier
- id UUID
- name
- country_code ISO-3166
- city nullable
- contact fields
- status
- notes

### SupplierVariant
Many-to-many relationship between supplier and variant:
- supplier_id
- variant_id
- supplier_sku nullable
- quoted_cost_minor
- currency
- MOQ nullable
- lead_time_days nullable
- origin_country_code nullable
- preferred boolean
- last_verified_at

### Location
- id UUID
- name
- type: store / warehouse / in_transit / quarantine
- country_code
- timezone
- address metadata
- status

### InventoryLevel
One row per variant + location:
- variant_id
- location_id
- on_hand
- reserved
- available derived as on_hand - reserved
- reorder_point
- safety_stock
- updated_at

### InventoryMovement
Immutable stock ledger:
- id UUID
- variant_id
- location_id
- movement_type
- quantity_delta
- reference_type
- reference_id
- actor_id nullable
- reason
- created_at

Movement types include:
- purchase_receipt
- sale
- return
- transfer_in
- transfer_out
- adjustment
- damage
- loss
- donation

### ProcurementLot
Captures changing sourcing economics:
- id UUID
- supplier_id
- purchase_reference
- received_location_id
- ordered_at
- received_at nullable
- currency
- freight_minor
- duties_minor
- other_landed_cost_minor
- notes

### ProcurementLotItem
- lot_id
- variant_id
- quantity_received
- unit_cost_minor
- allocated_landed_cost_minor
- condition
- origin_country_code nullable

### MediaAsset / ProductMedia
- media id
- object key / URL
- alt text
- mime type
- sort order
- primary flag

## 6. Monetary rules

- No binary floating point for money.
- API monetary values use integer minor units where feasible.
- Currency is explicit on every monetary record.
- HNL is the initial storefront currency, not a global hardcoded system currency.
- Historical procurement cost must not be overwritten when a new purchase has a different cost.

## 7. Inventory invariants

- Every stock-changing operation creates an InventoryMovement.
- InventoryMovement records are append-only after posting.
- Available quantity is derived, never manually entered.
- Transfers create traceable paired movements under one transfer reference.
- Stock adjustments require a reason.
- Negative available stock is prohibited by default; any future exception requires an explicit business rule and audit event.
- Sales must use reservations once the Orders module is authoritative.

## 8. Supplier and sourcing rules

- A product or variant can have zero, one or many suppliers.
- A supplier can serve many products.
- Supplier relationships do not determine product ownership model.
- Sourcing is country-agnostic.
- Purchase decisions can compare price, quality, availability, lead time, MOQ and supplier performance.
- San Pedro Sula suppliers are an initial sourcing channel, not a structural limitation.

## 9. Functional requirements

- FR-CAT-001 Create/edit product in draft.
- FR-CAT-002 Activate, deactivate and archive products.
- FR-CAT-003 Manage hierarchical categories.
- FR-CAT-004 Manage variants and unique SKU.
- FR-CAT-005 Assign product commercial model and condition.
- FR-PRICE-001 Manage exact prices by currency/channel.
- FR-SUP-001 Associate multiple suppliers with one variant.
- FR-SUP-002 Record supplier-specific cost, MOQ and lead time.
- FR-INV-001 Maintain inventory by variant/location.
- FR-INV-002 Write immutable stock movements.
- FR-INV-003 Transfer inventory between locations.
- FR-INV-004 Reserve/release stock transactionally.
- FR-PROC-001 Receive procurement lots with actual unit cost.
- FR-PROC-002 Preserve landed-cost components.
- FR-MEDIA-001 Attach multiple product media assets.
- FR-AUDIT-001 Record actor, timestamp and reason for critical changes.
- FR-IMPORT-001 Support future import of the current physical-store product list.

## 10. Public catalog contract

The storefront SHOULD read published catalog data from versioned APIs.

Initial public read contract:
- `GET /v1/products?status=active`

Planned:
- `GET /v1/products/:id-or-slug`
- `GET /v1/categories`
- `GET /v1/categories/:slug/products`
- search/filter/sort query parameters
- cursor pagination

Public endpoints must never expose supplier cost, landed cost, internal notes or private supplier data.

## 11. Non-functional requirements

- PostgreSQL is the transactional source of truth.
- APIs use versioned routes.
- UTC timestamps internally.
- Location timezone retained for presentation/operations.
- Schema changes use versioned migrations.
- Critical writes are transactional and idempotent where applicable.
- Auditability takes precedence over destructive historical edits.
- Services expose health/readiness checks.
- Secrets remain in Railway environment variables.

## 12. Acceptance criteria

Module 01 v1 is green when:

1. product/category/variant schemas are migrated;
2. supplier-to-variant many-to-many sourcing works;
3. price/currency model is exact;
4. inventory exists per location;
5. all stock changes generate ledger entries;
6. procurement receipt records actual historical costs;
7. the storefront receives active products from the API;
8. internal cost/supplier-private fields are not exposed publicly;
9. automated tests cover core invariants;
10. Railway production deployments are SUCCESS and health checks pass.

## 13. Out of scope for this version

- payment processing;
- full order lifecycle;
- customer identity;
- marketplace synchronization;
- manufacturing execution;
- accounting ledger;
- advanced demand forecasting.

These are later modules but this schema must not block them.

## 14. Evolution path

The domain is intentionally designed so a third-party product can later be complemented by a private-label or owned MR עדולם equivalent without changing the core commerce architecture.

