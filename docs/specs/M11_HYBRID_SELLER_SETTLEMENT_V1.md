# SPEC — Module 11: Hybrid Seller Ownership & Settlement v1

**Project:** MR עדולם
**Status:** PROPOSED FOR APPROVAL
**Date:** 2026-10-08
**Method:** Spec-Driven Development (SDD)

## 1. Objective

Define the commercial ownership and settlement domain required by the confirmed hybrid model of MR עדולם.

MR may sell MR-owned inventory, consigned inventory, third-party inventory under commission, associated-brand inventory and future marketplace inventory.

This SPEC makes those distinctions explicit without turning MR into a banking ledger or activating an open marketplace before the Commerce Core is stable.

## 2. Domain boundary

This module owns:

Seller / Commercial Party
→ Seller Agreement
→ Order-line commercial snapshot
→ Settlement calculation
→ Seller statement
→ Operational payout confirmation

This module does not own bank balances, money-transfer rails, accounts-payable accounting, external financial ledgers, credit underwriting, tax authority rules or open self-service seller onboarding in v1.

## 3. Relationship to existing modules

- M01 remains authoritative for Product, Variant, Inventory and InventoryMovement.
- M02 remains authoritative for Order and OrderItem.
- M03 remains authoritative for commercial Payment state.
- M08 remains authoritative for Supplier and Procurement.
- M09 remains authoritative for ReturnCase and returned inventory disposition.
- M06 remains authoritative for staff identity, permissions and audit actor.

A Supplier may also be a Seller, but the roles are not equivalent.

Supplier = party from whom MR sources goods.
Seller = party economically entitled to proceeds from a sale.

One organization may have both roles.

## 4. Commercial modes

Initial enum:

- OWNED
- CONSIGNMENT
- COMMISSION
- WHOLESALE_MARGIN
- MARKETPLACE_FUTURE

Rules:

- OWNED means MR is the economic inventory owner.
- CONSIGNMENT means ownership remains with a third party until the agreed sale event.
- COMMISSION means MR retains a configured commission from eligible proceeds.
- WHOLESALE_MARGIN means MR recognizes a cost basis and retains the retail margin.
- MARKETPLACE_FUTURE reserves the model for later activation; it is not self-service marketplace behavior in v1.

## 5. SellerAccount

Fields:

- id UUID
- legal_name
- display_name
- status
- country_code nullable
- tax_identifier nullable
- contact_email nullable
- contact_phone nullable
- supplier_id nullable
- created_at
- updated_at

Status:

- PROSPECT
- ACTIVE
- SUSPENDED
- CLOSED

An inactive SellerAccount cannot receive new seller-attributed listings or agreements.

## 6. SellerAgreement

Fields:

- id UUID
- seller_id
- commercial_mode
- agreement_version
- effective_from
- effective_to nullable
- currency
- commission_basis
- commission_rate_bps nullable
- fixed_fee_minor nullable
- discount_allocation_rule
- return_allocation_rule
- shipping_allocation_rule
- payment_fee_allocation_rule
- shrinkage_liability_rule
- settlement_frequency
- settlement_delay_days
- notes nullable
- created_by_user_id nullable
- approved_by_user_id nullable
- status
- created_at
- approved_at nullable

Status:

- DRAFT
- APPROVED
- ACTIVE
- EXPIRED
- TERMINATED

Agreement terms are versioned. Historical sales never recalculate from a newly edited agreement.

## 7. Sellable commercial attribution

Every third-party sellable unit must resolve to:

- seller_id;
- commercial_mode;
- seller_agreement_id;
- inventory_owner;
- cost basis or commission rule;
- location / stock source.

Implementation may place this attribution at lot, inventory-source or variant-location level, but each OrderItem must receive an immutable commercial snapshot at purchase time.

## 8. OrderItemCommercialSnapshot

Persist:

- order_item_id
- seller_id nullable
- commercial_mode
- seller_agreement_id nullable
- inventory_owner_type
- unit_cost_minor nullable
- commission_basis
- commission_rate_bps nullable
- fixed_fee_minor nullable
- discount_allocation_rule
- shipping_allocation_rule
- payment_fee_allocation_rule
- return_allocation_rule
- currency
- snapshot_at

Rules:

- snapshot is immutable after commercial commitment;
- later agreement edits do not alter historical order economics;
- OWNED inventory may have seller_id null.

## 9. Settlement eligibility

A seller-attributed order line becomes settlement-eligible only when configured business conditions are satisfied.

Default proposal for v1:

- order is DELIVERED or COMPLETED;
- payment state satisfies agreement policy;
- line has not been fully returned, cancelled or reversed;
- configured settlement delay has elapsed.

Eligibility rules must be configurable and versioned.

## 10. SettlementStatement

Fields:

- id UUID
- settlement_number unique
- seller_id
- period_start
- period_end
- currency
- status
- gross_sales_minor
- discounts_minor
- returns_minor
- commissions_minor
- fees_minor
- adjustments_minor
- net_payable_minor
- calculated_at nullable
- approved_at nullable
- paid_at nullable
- external_payment_reference nullable
- created_by_user_id nullable
- approved_by_user_id nullable
- paid_by_user_id nullable

Status:

- OPEN
- CALCULATED
- APPROVED
- PAID
- VOID

PAID is an operational confirmation that an external payout was completed. It is not a bank ledger entry.

## 11. SettlementLine

Fields:

- id UUID
- settlement_id
- order_id
- order_item_id
- seller_id
- gross_line_minor
- allocated_discount_minor
- allocated_shipping_minor
- allocated_payment_fee_minor
- return_adjustment_minor
- commission_minor
- other_adjustment_minor
- net_minor
- source_event_type
- source_event_id
- created_at

Each source event may affect settlement only once.

## 12. Returns and reversals

M09 remains authoritative for return approval and inventory disposition.

When a return changes commercial entitlement:

- create an explicit negative or reversal settlement line;
- do not rewrite the original sales line;
- preserve the original rule snapshot;
- if the original statement is already PAID, carry the reversal into the next open statement or an explicit adjustment statement.

## 13. Discounts and fees

Each SellerAgreement defines how eligible discounts, shipping, payment fees and promotion funding are allocated.

Initial allocation vocabulary:

- MR
- SELLER
- PROPORTIONAL
- NOT_APPLICABLE

More complex promotion funding belongs in a future Pricing & Promotions SPEC.

## 14. Shrinkage interaction

M12 governs inventory adjustment and shrinkage approval.

If a shrinkage event creates seller or MR liability:

- M12 produces the approved operational event;
- M11 may create a settlement adjustment according to the active agreement;
- original inventory movements remain unchanged.

## 15. Idempotency

Settlement generation must be idempotent.

- repeated calculation cannot duplicate SettlementLines;
- source events are unique within settlement accounting;
- recalculation before APPROVED may replace a draft calculation with audit history;
- APPROVED or PAID statements are immutable except through explicit adjustment statements.

## 16. Permissions

Suggested M06 permissions:

- sellers.read
- sellers.manage
- seller_agreements.read
- seller_agreements.manage
- settlements.read
- settlements.calculate
- settlements.approve
- settlements.mark_paid

## 17. Audit requirements

Audit seller creation/status changes, agreement changes and approval, settlement calculation, approval, payout confirmation, manual adjustments and reversals.

Audit must include actor, timestamp, reason and linked entity.

## 18. Functional requirements

- FR-SEL-001 Support SellerAccount independent from Supplier role.
- FR-SEL-002 Version commercial agreements.
- FR-SEL-003 Attribute third-party inventory to seller/agreement.
- FR-SEL-004 Snapshot commercial terms on OrderItem.
- FR-SET-001 Calculate settlement from immutable source events.
- FR-SET-002 Allocate discounts and fees by agreement.
- FR-SET-003 Reverse returns without rewriting historical sales.
- FR-SET-004 Require approval before payout confirmation.
- FR-SET-005 Preserve idempotency and audit.
- FR-SET-006 Keep private seller economics out of public catalog APIs.

## 19. Acceptance criteria

1. MR-owned and third-party order lines are distinguishable.
2. Historical order economics do not change when an agreement changes.
3. One source event cannot create duplicate settlement value.
4. Returns create explicit reversals.
5. A statement cannot move to PAID without APPROVED.
6. PAID does not imply MR stores a banking ledger.
7. Seller-private cost and commission data is inaccessible through public storefront APIs.
8. Every settlement mutation records an authenticated audit actor.
9. Existing M01-M09 invariants remain intact.

## 20. Rollout gate

Do not activate marketplace self-service from this SPEC alone.

Implementation may begin with operator-managed third-party inventory and settlement only after M01-M04 are stable enough to provide authoritative source events.


## 21. Approved implementation decision — 2026-10-08

The following commercial ownership rule is approved for implementation:

- when MR purchases a product from a third party and incorporates it into MR inventory for resale, the subsequent customer sale is treated as MR-owned commerce;
- when a third party retains the economic ownership of the product and offers it through MR, the inventory must retain explicit Seller / SellerAgreement attribution and THIRD_PARTY economic ownership;
- Supplier and Seller remain separate roles even when the same organization performs both;
- operator-managed third-party inventory may proceed before open marketplace self-service;
- MARKETPLACE_FUTURE remains inactive;
- the fiscal issuer for third-party-owned sales is not inferred by M11 and remains gated by M05 legal/tax validation.

Phase A implementation landed through PR #62 and established SellerAccount, versioned SellerAgreement, InventorySource and immutable commercial snapshots on OrderItem.

Settlement calculation, eligibility defaults, payout timing and return/fee allocation remain subject to the agreement configuration and the unresolved business decisions in this SPEC. This approval does not authorize a hardcoded settlement trigger or marketplace activation.
