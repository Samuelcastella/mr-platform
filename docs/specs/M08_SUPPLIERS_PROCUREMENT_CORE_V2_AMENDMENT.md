# SPEC — Module 08: Suppliers & Procurement Core v2 Amendment

**Project:** MR עדולם
**Status:** PROPOSED FOR APPROVAL
**Date:** 2026-10-08
**Base specification:** M08_SUPPLIERS_PROCUREMENT_CORE_V1.md
**Roadmap:** STRATEGIC_BASELINE_HONDURAS_V2.md
**Dependencies:** M01 v2 amendment, M06 v2 amendment, M11, M12

## 1. Purpose

Amend M08 so procurement can coexist cleanly with the confirmed hybrid commerce model.

M08 remains the sourcing/procurement authority.
M11 owns seller/commercial entitlement.
M12 governs exceptional inventory corrections after posting.

M08 v1 remains authoritative except where explicitly extended below.

## 2. Verified implementation baseline — 2026-10-08

The current catalog-api already implements:

- suppliers;
- purchase_orders;
- purchase_order_items;
- goods_receipts;
- goods_receipt_items;
- supplier snapshots;
- purchase-order approval/status transitions;
- idempotent receipt posting;
- PURCHASE_RECEIPT inventory movements;
- RBAC for supplier/procurement actions;
- audit events.

Therefore M08 v2 is an additive integration amendment.

## 3. Supplier vs Seller boundary

Supplier and Seller are separate business roles.

Supplier:
- source from which MR procures goods;
- governed by M08.

Seller:
- commercial party entitled to proceeds or settlement from a customer sale;
- governed by M11.

One party may act as both.

Do not merge Supplier and Seller into one table solely because some organizations perform both roles.

Preferred bridge:

- M11 SellerAccount.supplier_id nullable;
- or a future shared Party abstraction only if duplication becomes materially problematic.

## 4. Procurement does not determine economic ownership by itself

A PURCHASE_RECEIPT normally represents stock physically received by MR.

However, future hybrid flows may include:

- outright MR purchase;
- consignment receipt;
- third-party stock intake;
- other owner-preserving arrangements.

M08 must not infer economic ownership solely from the existence of a GoodsReceipt.

Economic ownership/source context is resolved through M01 v2 InventorySource and M11 SellerAgreement where applicable.

## 5. GoodsReceipt ownership/source linkage

For hybrid-ready receipts, GoodsReceiptItem or an equivalent posting command may carry or resolve:

- inventory_source_id;
- seller_id nullable;
- seller_agreement_id nullable;
- economic_owner_type;
- commercial_mode;
- cost_basis_minor where applicable.

Rules:

1. Source/owner context is server-resolved.
2. PURCHASE_RECEIPT inventory movement preserves source linkage once M01 v2 is active.
3. MR procurement cost remains historical.
4. Consignment/commission economics remain governed by M11.
5. Public supplier data must not expose private seller settlement terms.

## 6. Consignment and non-purchase intake

A future CONSIGNMENT intake is not automatically a PurchaseOrder financial purchase.

M08 may support a separate intake/receiving flow later, or extend procurement with a clearly typed commercial mode.

Do not force consigned stock into PO totals as if MR purchased the goods.

If a consignment receipt is introduced, it must still:

- identify supplier/seller party;
- identify destination location;
- preserve quantity;
- create authoritative inventory/source context;
- remain idempotent;
- remain auditable.

The exact workflow requires separate implementation approval.

## 7. Receipt discrepancy boundary

A GoodsReceipt may encounter discrepancies such as:

- short shipment;
- over shipment;
- wrong SKU;
- damage on arrival;
- quality issue.

M08 owns recording the receiving discrepancy.

Rules:

- unposted discrepancy is resolved within receiving workflow before inventory mutation;
- once a receipt has posted inventory, later correction must not silently rewrite stock;
- post-posting quantity correction flows through M12 InventoryAdjustmentRequest;
- supplier claim/return is procurement-side and may later become a dedicated workflow;
- seller financial liability, if applicable, is handled through M11 after approved operational facts exist.

## 8. Damage on receipt

If goods are damaged before accepted inventory posting:

- receive only accepted quantity into sellable stock;
- record discrepancy/inspection fact;
- optionally route rejected quantity to quarantine/intake workflow when implemented.

If damage is discovered after stock was posted:

- use M12;
- do not edit the original GoodsReceipt.

## 9. Return-to-supplier boundary

M09 may classify a customer-return disposition as RETURN_TO_SUPPLIER.

M09 does not create supplier shipment/claim by itself.

Future supplier-return workflow belongs to M08 or a procurement extension.

Any stock reduction related to an approved supplier return must be traceable through M01 movement vocabulary and must not reuse customer-return events incorrectly.

## 10. Seller liability interaction

If a procurement/receiving discrepancy affects third-party-owned stock:

- M08 records operational sourcing/receipt facts;
- M12 governs any post-posting inventory adjustment;
- M11 determines whether the seller/provider bears economic liability according to SellerAgreement;
- no automatic financial charge is created inside M08.

## 11. Permissions

Existing M08 permissions remain.

M06 v2 may additionally allow staff with seller permissions to view linked seller identity where needed.

Procurement roles do not automatically gain:

- seller_agreements.manage;
- settlements.approve;
- settlements.mark_paid.

Likewise seller-management permission does not grant procurement.receive.

## 12. Audit additions

When hybrid/source context is active, audit should preserve:

- supplier_id;
- seller_id nullable;
- seller_agreement_id nullable;
- inventory_source_id nullable;
- economic_owner_type;
- commercial_mode;
- receipt discrepancy reason where applicable.

Sensitive commercial terms remain sanitized according to M06.

## 13. Functional requirements added

- FR-PROC-015 Keep Supplier and Seller roles semantically separate.
- FR-PROC-016 Preserve inventory-source/economic-owner context on hybrid receipts.
- FR-PROC-017 Do not infer MR ownership solely from GoodsReceipt.
- FR-PROC-018 Route post-posting stock corrections through M12.
- FR-PROC-019 Preserve M11 liability/settlement boundary.
- FR-PROC-020 Keep consignment economics out of PO purchase totals unless explicitly modeled.
- FR-PROC-021 Preserve compatibility with existing PURCHASE_RECEIPT implementation.
- FR-PROC-022 Keep supplier-return workflow distinct from customer-return workflow.

## 14. Acceptance criteria added

1. A Supplier may exist without a SellerAccount.
2. A SellerAccount may reference a Supplier without merging domains.
3. MR-owned and third-party-owned receipts can preserve distinct ownership context.
4. Existing PO/receipt behavior remains valid for ordinary purchases.
5. A posted GoodsReceipt is not rewritten to correct later shrinkage.
6. Post-posting discrepancy correction requires M12 where inventory changes.
7. M11 can determine liability/settlement from approved source facts.
8. Procurement permissions do not imply settlement permissions.
9. PURCHASE_RECEIPT remains backward compatible.
10. Consignment is not treated as an accounts-payable purchase by default.

## 15. Implementation gate

Before implementing hybrid receipt linkage:

- M01 v2 ownership/source model must be approved;
- inspect current receipt/inventory schema;
- choose source linkage columns or mapping table;
- preserve existing PO and receipt APIs;
- add migration/integration tests;
- define whether consignment intake is a separate workflow before coding it.

This amendment does not activate consignment intake by itself.
