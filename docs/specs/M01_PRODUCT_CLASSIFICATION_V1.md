# M01 Product Classification v1

**Module:** M01 Catalog & Inventory  
**Date:** 2026-10-08  
**Status:** implementation spec  
**Dependencies:** M01 v1, M01 v2 Amendment, M11 ownership separation

## Purpose

Implement the approved M01 product-classification fields without conflating merchandising with economic inventory ownership.

## Product.commercial_model

Allowed values:

- `third_party`
- `curated`
- `private_label`
- `owned`

This field describes the product's commercial / brand relationship only.

It does **not** determine:

- inventory economic owner;
- seller identity;
- consignment status;
- SellerAgreement;
- settlement policy;
- commission policy;
- cost basis;
- InventorySource.

Those concerns remain governed by M11 and InventorySource.

## Product.default_condition

Allowed values:

- `new`
- `second_hand`
- `refurbished`

This is the product-level default condition. Future lot/unit-specific condition may override it where supported.

## Migration policy

The migration is additive:

- add nullable `products.commercial_model`;
- add nullable `products.default_condition`;
- add database CHECK constraints for both vocabularies;
- do not backfill or infer legacy values.

Legacy compatibility:

- an already-active legacy product is not automatically unpublished;
- a legacy product with missing classification may remain readable;
- a legacy product cannot transition from non-active to active until both fields are explicitly supplied;
- once classification is explicitly edited, both fields must be present to prevent partial classification.

## New product contract

`POST /v1/internal/catalog/products` requires:

- `commercialModel`;
- `defaultCondition`.

Missing fields fail closed.

No default is assigned by the API.

## Product update contract

`PATCH /v1/internal/catalog/products/:id` may update classification.

Rules:

- invalid vocabulary → 400;
- partial explicit classification → 409 `classification_required`;
- publication of an unclassified legacy product → 409 `classification_required`.

## Vendor product review

Vendor users do not assign MR product classification.

A vendor may create and submit an external catalog product with classification unset.

Staff approval:

`POST /v1/internal/vendor-products/:id/review`

with `decision=APPROVE` requires explicit staff-supplied:

- `commercialModel`;
- `defaultCondition`.

The approval transaction persists classification and publication status atomically.

A missing classification leaves the product `SUBMITTED` + `draft`.

`REJECT` does not require classification.

## Public catalog

The public product representation may expose:

- `commercialModel`;
- `defaultCondition`.

Legacy unclassified products expose `null`, not an inferred value.

No private ownership, seller agreement, supplier cost or settlement data is exposed by these fields.

## Control Center

Catalog product creation requires explicit selection of both classification fields.

Existing products show current classification and expose a staff-only classification form.

Vendor review requires explicit classification before “Aprobar y publicar”.

The UI must not preselect a commercial model or condition for a new/reviewed product.

## Audit

Product create/update audit metadata includes classification values and:

`economicOwnershipChanged: false`

Vendor approval audit metadata records the staff-selected classification and the same ownership-separation assertion.

## Explicit non-effects

Creating or changing product classification must not:

- create/update/delete InventorySource;
- create inventory movements;
- create inventory levels;
- change inventory quantity/reservations;
- create or alter SellerAgreement;
- calculate settlement;
- calculate commission;
- create payout;
- infer economic ownership from `commercial_model`.

## Acceptance tests

1. Legacy rows remain null after migration.
2. Existing active legacy product remains public.
3. Unclassified legacy draft cannot be published.
4. Partial explicit classification is rejected.
5. New products require both fields.
6. Invalid values are rejected by API and DB constraint.
7. Valid classification appears in internal and public catalog responses.
8. Reclassification creates no InventorySource or inventory side effect.
9. Vendor submission remains unclassified.
10. Vendor approval without staff classification fails closed.
11. Vendor approval with explicit classification succeeds atomically.
12. Audit records preserve the merchandising/economic-ownership separation.
