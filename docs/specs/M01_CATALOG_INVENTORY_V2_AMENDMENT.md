# SPEC — Module 01: Catalog & Inventory v2 Amendment

**Project:** MR עדולם
**Status:** PROPOSED FOR APPROVAL
**Date:** 2026-10-08
**Base specification:** M01_CATALOG_INVENTORY_V1.md
**Roadmap:** STRATEGIC_BASELINE_HONDURAS_V2.md
**Dependencies:** M11, M12

## 1. Purpose

Amend M01 so the authoritative catalog/inventory domain supports the confirmed hybrid commerce model without overloading product merchandising fields or breaking deployed inventory behavior.

This amendment preserves M01 v1 except where explicitly changed below.

## 2. Verified implementation baseline — 2026-10-08

The current catalog-api schema is simpler than the full M01 v1 design and must be treated as the migration starting point.

Verified current tables include:

- products with name, slug, description, category text, brand text and status;
- product_variants with SKU, size, color, cost, price, currency, supplier_id and origin_country_code;
- inventory keyed by variant_id + location_id with quantity and reserved;
- inventory_movements with movement_type, quantity, reference and notes.

Important implementation fact:

- Product.commercial_model is not currently present in the verified catalog-api schema.
- InventorySource does not currently exist.
- Supplier sourcing is currently represented directly on product_variants in the baseline schema.

Therefore this amendment is an additive migration direction. It must not assume every M01 v1 design field already exists in production.

## 3. Key correction: product model vs economic ownership

M01 v1 defines Product.commercial_model as:

- third_party
- curated
- private_label
- owned

This remains a merchandising / brand relationship.

It SHALL NOT determine:

- who economically owns physical inventory;
- who is entitled to seller proceeds;
- whether inventory is consigned;
- whether MR earns margin or commission;
- who bears shrinkage or return liability.

Economic ownership is a separate concern governed by this amendment + M11.

## 4. InventorySource

Introduce an explicit inventory-source / ownership record.

Suggested entity:

InventorySource

- id
- variant_id
- location_id
- source_type
- economic_owner_type
- seller_id nullable
- seller_agreement_id nullable
- supplier_id nullable
- procurement_lot_id nullable
- currency nullable
- cost_basis_minor nullable
- status
- effective_from
- effective_to nullable
- created_at
- updated_at

source_type initial vocabulary:

- PROCUREMENT
- CONSIGNMENT
- THIRD_PARTY
- OWNED_OPENING_STOCK
- RETURNED_STOCK
- OTHER

economic_owner_type:

- MR
- THIRD_PARTY

Rules:

1. A Product may remain curated/third_party while physical inventory is MR-owned.
2. A Product may remain curated/third_party while physical inventory is third-party-owned.
3. Ownership may differ between inventory sources for the same Variant.
4. Public catalog APIs must not expose private seller agreement, cost or settlement data.
5. SellerAgreement remains governed by M11.

## 5. InventoryLevel compatibility

M01 v1 models one InventoryLevel per variant + location.

For hybrid ownership, implementation must not lose owner/source traceability.

Allowed implementation strategies:

- owner/source-aware inventory rows;
- lot/source subledger with aggregated public InventoryLevel projection;
- another normalized model proven equivalent.

Constraint:

Public availability may aggregate compatible stock, but order allocation must resolve the actual inventory source before commercial settlement is finalized.

## 6. Inventory movement vocabulary

Approved documentation and implementation currently differ.

Verified code on 2026-10-08 already writes:

- INITIAL_STOCK
- PURCHASE_RECEIPT
- SALE
- CUSTOMER_RETURN
- ADJUSTMENT

These values become part of the authoritative compatibility set.

Future supported values may include:

- TRANSFER_IN
- TRANSFER_OUT
- DAMAGE
- LOSS
- DONATION
- RECOVERY
- SUPPLIER_RETURN
- RTO_RESTOCK

Do not rename deployed values only for naming consistency.

Before adding a new value:

1. inspect production schema and constraints;
2. verify current consumers/tests;
3. add compatible migration if required;
4. update this contract.

## 7. InventoryMovement amendment

InventoryMovement must preserve enough context to support M11/M12.

Add or support references equivalent to:

- inventory_source_id nullable
- economic_owner_type nullable
- seller_id nullable
- adjustment_request_id nullable
- actor_id
- reason_code nullable
- reference_type / reference_id
- quantity delta
- created_at

Rules:

- append-only after posting;
- actor required for staff-originated exceptional adjustments once M06 is active;
- exceptional adjustments must flow through M12 once M12 is activated;
- movement rows do not calculate seller settlement; M11 consumes authoritative events.

## 8. Adjustment boundary

M01 remains the stock ledger authority.

After M12 activation:

InventoryAdjustmentRequest
→ approval
→ M12 post command
→ M01 InventoryMovement + InventoryLevel transaction

Direct operator edits that bypass M12 are prohibited for governed exceptional adjustments.

Normal system flows remain governed by their source modules:

- purchase receipt: M08
- sale/reservation consumption: M02
- customer restock: M09
- transfer: M01
- exceptional loss/damage/count correction: M12

## 9. Cost basis

Historical procurement costs remain immutable.

Hybrid inventory may use different economic basis:

- MR procurement cost;
- consignment seller basis;
- commission arrangement with no MR inventory cost;
- other agreement-defined basis.

M01 stores or references inventory cost/source facts.

M11 determines seller settlement economics.

M13 may consume cost basis for margin-based commission only when the cost attribution is deterministic.

## 10. Public catalog contract

Public APIs may expose:

- product;
- variant;
- price;
- public availability;
- public condition;
- approved brand/category/media.

Public APIs must not expose:

- seller private commission;
- settlement rules;
- internal cost;
- shrinkage liability;
- supplier private terms;
- seller agreement IDs unless explicitly intended for public marketplace contracts later.

## 11. Functional requirements added

- FR-INV-005 Separate economic inventory ownership from Product.commercial_model.
- FR-INV-006 Preserve inventory source/owner context through stock lifecycle.
- FR-INV-007 Support MR-owned and third-party-owned stock for the same catalog model.
- FR-INV-008 Preserve compatibility with implemented movement values.
- FR-INV-009 Link exceptional adjustments to M12 governance.
- FR-INV-010 Provide authoritative inventory-source context to M02/M11.
- FR-AUDIT-002 Preserve actor/reason/source references for governed inventory mutations.

## 12. Acceptance criteria added

1. A curated or third-party Product can be MR-owned without semantic conflict.
2. A curated or third-party Product can be third-party-owned.
3. Public availability never exposes private seller economics.
4. Existing INITIAL_STOCK, PURCHASE_RECEIPT, SALE, CUSTOMER_RETURN and ADJUSTMENT flows remain compatible.
5. A governed M12 adjustment cannot post twice.
6. Inventory movements retain enough source context to attribute seller-owned stock.
7. M02 can resolve an inventory source for an OrderItem.
8. M11 can consume commercial ownership context without altering inventory history.
9. No production movement value is renamed without migration review.

## 13. Migration gate

Before implementation:

- inspect actual production tables/constraints;
- compare implemented schema with M01 v1;
- decide whether InventorySource is a new table, lot extension or equivalent normalized structure;
- create migration tests;
- verify storefront availability remains backward compatible.

This amendment authorizes design direction only. It does not itself approve a production migration.


## 14. Implementation checkpoint — 2026-10-08

Since the verified baseline in Section 2:

- `InventorySource` has been implemented as part of M11 Phase A;
- OrderItem now preserves commercial/economic source snapshots;
- Product Intelligence v1 has been implemented through PR #76 and consumes those historical facts read-only.

The following remains intentionally **not implemented**:

- `Product.commercial_model` / merchandising relationship (`third_party`, `curated`, `private_label`, `owned`).

Product Intelligence does not backfill or infer this field from:

- `economic_owner_type`;
- Seller/SellerAgreement;
- Supplier;
- current inventory source;
- sales volume;
- brand name.

Reason: those facts answer different questions and an inference would corrupt product history. A future commercial-model migration must be explicit, audited and backward-compatible, and remains behind this amendment's approval/migration gate.
