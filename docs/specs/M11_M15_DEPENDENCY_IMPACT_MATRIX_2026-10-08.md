# MR עדולם — M11–M15 Dependency & Impact Matrix

**Status:** ANALYSIS / IMPLEMENTATION IMPACT
**Date:** 2026-10-08
**Scope:** Proposed M11–M15 compared against approved M01–M09.
**Rule:** This document identifies required extensions and conflicts. It does not modify approved SPEC authority by itself.

## 1. Purpose

The new conversation-derived requirements created five proposed modules:

- M11 Hybrid Seller Ownership & Settlement
- M12 Inventory Adjustments, Shrinkage & Approval
- M13 Staff Commissions & Incentives
- M14 Operational Health Desk
- M15 Credit Provider Adapter Boundary

This matrix determines which approved modules would require a versioned amendment if M11–M15 are approved.

## 2. Summary matrix

| Proposed module | Approved dependencies | Required change type | Risk if omitted |
|---|---|---|---|
| M11 Hybrid Seller Settlement | M01, M02, M03, M06, M08, M09 | schema + snapshots + permissions + return hooks | incorrect seller economics / non-auditable settlements |
| M12 Inventory Adjustments & Shrinkage | M01, M06, M08, M09 | adjustment workflow + permissions + movement normalization | silent stock edits / weak fraud controls |
| M13 Staff Commissions | M01, M02, M03, M06, M09 | salesperson attribution + accrual triggers + permissions | non-reconcilable commissions |
| M14 Health Desk | M02, M03, M04, M05, M06 | observability contracts + incident permissions | hidden operational failures / alert fragmentation |
| M15 Credit Provider Adapter | M03, M06, M07, M14 | payment adapter extension + customer linkage + monitoring | provider coupling / stale terms / unsafe approval flow |

## 3. Cross-cutting issue A — commercial model vs economic ownership

### Current documentation state

M01 defines Product.commercial_model as:

- third_party
- curated
- private_label
- owned

That field describes the product's commercial/branding relationship.

### Gap

The confirmed hybrid model requires a separate economic ownership dimension:

- MR-owned inventory
- consigned inventory
- commission-based third-party inventory
- wholesale-margin inventory
- future marketplace inventory

These are not equivalent to M01 Product.commercial_model.

### Verified implementation note — 2026-10-08

Repository code search did not find commercial_model in services/catalog-api. Treat the M01 field as approved design intent until schema/code verification proves it is deployed.

This strengthens the rule: the hybrid ownership amendment must be designed against the implemented schema rather than assuming every M01 field already exists.

Example:

A curated external product may be:

- bought outright by MR;
- held on consignment;
- sold under commission.

Therefore commercial_model cannot safely serve as inventory ownership or settlement logic.

### Required amendment if M11 is approved

M01 should add a separate ownership / commercial-source construct.

Preferred direction:

- Product.commercial_model remains merchandising/brand classification.
- Inventory economic ownership moves to an inventory-source or lot-level entity.
- OrderItem receives immutable M11 commercial snapshot.

Do not overload Product.commercial_model.

## 4. Cross-cutting issue B — inventory movement vocabulary

### Current documentation state

M01 documents conceptual movement types in lowercase:

- purchase_receipt
- sale
- return
- transfer_in
- transfer_out
- adjustment
- damage
- loss
- donation

M08 specifies PURCHASE_RECEIPT.
M09 specifies CUSTOMER_RETURN.
M04 also uses CUSTOMER_RETURN for a restock after RTO inspection.

### Verified implementation state — 2026-10-08

Repository inspection confirms the deployed code writes string values including:

- PURCHASE_RECEIPT in procurement;
- CUSTOMER_RETURN in customer returns;
- SALE in order inventory consumption;
- INITIAL_STOCK in catalog/internal stock creation;
- ADJUSTMENT in internal stock changes.

Therefore the mismatch is primarily a documentation/contract normalization issue, not proof that production data must be renamed.

### Gap

The movement taxonomy is not fully normalized across approved SPECs, and the actual implementation already contains values not enumerated by M01.

### Required amendment

Before M12 adds additional movement semantics, M01 vNext should publish one authoritative vocabulary that reflects implemented values and defines future additions.

Candidate vocabulary:

- INITIAL_STOCK
- PURCHASE_RECEIPT
- SALE
- CUSTOMER_RETURN
- TRANSFER_IN
- TRANSFER_OUT
- ADJUSTMENT
- DAMAGE
- LOSS
- DONATION
- RECOVERY
- SUPPLIER_RETURN
- RTO_RESTOCK

Exact future additions require implementation review.

### Migration caution

Do not rename existing production string values merely for stylistic consistency.
Prefer documenting existing values and adding compatible new values unless a verified data migration is justified.

## 5. M11 impact — Hybrid Seller Ownership & Settlement

### M01 — Catalog & Inventory

Required extension:

- economic owner / seller attribution at inventory source level;
- commercial modality distinct from Product.commercial_model;
- seller/agreement reference for third-party stock;
- private seller economics excluded from public catalog;
- preserve owner through inventory movement and stock lifecycle where required.

Recommended entity direction:

InventorySource or InventoryLotCommercialTerms:

- seller_id nullable
- seller_agreement_id nullable
- ownership_type
- commercial_mode
- cost_basis_minor nullable
- currency
- received_at / effective dates

Do not force seller identity onto Product itself.

### M02 — Orders

Required extension:

OrderItem must support an immutable commercial snapshot.

Add or link:

- seller_id nullable
- seller_agreement_id nullable
- commercial_mode
- inventory_owner_type
- cost_basis snapshot if required for settlement
- settlement rule snapshot/version reference

Mixed orders become possible.

Important unresolved implementation decision:

- one Order containing multiple sellers;
- or split child fulfillments / seller allocations.

Recommendation for Commerce Core:

Allow one customer Order with multiple commercial ownership lines, but do not require seller-managed fulfillment in the first M11 implementation.

### M03 — Payments

No seller payout logic should be added to Payment.

Required integration only:

- settlement eligibility may observe Payment.status;
- Payment remains customer-side commercial payment state;
- seller payouts remain M11 operational settlement;
- no bank ledger.

### M06 — Identity / RBAC

Add permissions proposed by M11:

- sellers.read
- sellers.manage
- seller_agreements.read
- seller_agreements.manage
- settlements.read
- settlements.calculate
- settlements.approve
- settlements.mark_paid

Recommended role mapping:

- ADMIN: all
- MANAGER: read/manage sellers, calculate/approve settlements
- FINANCE / future role: settlement read/calculate/mark_paid
- PROCUREMENT: seller read where supplier/seller overlap requires it
- ANALYST: aggregated reporting only unless explicitly granted

A dedicated FINANCE role may be justified, but should be introduced only if operationally needed.

### M08 — Suppliers & Procurement

Required distinction:

Supplier and Seller are separate roles.

M08 Supplier remains sourcing-side.
M11 Seller is sales-proceeds-side.

Recommended bridge:

- SellerAccount.supplier_id nullable
- or organization/party abstraction later if duplication becomes material

Do not merge Supplier and Seller into one table prematurely.

### M09 — Returns

Required hook:

After a return is approved/received/inspected and commercial resolution is known, M11 may create settlement reversals.

M09 remains authoritative for physical return and disposition.
M11 owns economic seller reversal.

Return events should expose:

- return_case_id
- order_item_id
- returned quantity
- final disposition
- resolution status
- completion timestamp

No direct settlement mutation inside M09.

## 6. M12 impact — Inventory Adjustments, Shrinkage & Approval

### M01 — Catalog & Inventory

M01 already requires a reason for adjustments but lacks:

- request lifecycle;
- evidence;
- approval thresholds;
- risk;
- segregation of duties;
- explicit posting idempotency.

Required change:

M01 remains stock ledger authority.
M12 becomes pre-posting workflow.

M01 vNext should explicitly state:

No direct operator adjustment endpoint may mutate inventory without a governed M12 request once M12 is active.

### M06 — Identity / RBAC

Add permissions:

- inventory_adjustments.read
- inventory_adjustments.create
- inventory_adjustments.submit
- inventory_adjustments.approve
- inventory_adjustments.post
- inventory_adjustments.audit
- inventory_adjustments.evidence.read

Potential step-up requirement:

- HIGH / CRITICAL loss;
- suspected theft;
- large-value negative adjustment.

### M08 — Procurement

Goods-receipt discrepancies must not be silently corrected as stock.

Required boundary:

- PO/receipt discrepancy recorded in M08;
- if stock must be corrected after posting, generate M12 adjustment request;
- supplier claims remain M08 / future claims workflow;
- seller financial liability, if any, flows to M11.

### M09 — Returns

If returned stock is later discovered damaged/lost after M09 disposition:

- do not mutate completed ReturnCase;
- create M12 adjustment from current inventory state.

M09 inspection dispositions and M12 shrinkage reasons must remain distinct.

## 7. M13 impact — Staff Commissions & Incentives

### M01 — Catalog & Inventory

Only required when commission basis is GROSS_MARGIN.

M13 needs authoritative cost basis.

Risk:

M01 ProcurementLot cost and Seller/consignment economics may not map 1:1 to a simple unit cost.

Recommendation:

CommissionRule must declare which cost basis applies.
Do not implement GROSS_MARGIN commission until cost attribution is deterministic for the affected SKU/order line.

### M02 — Orders

Required extension:

Add immutable salesperson attribution.

Recommended fields or linked attribution table:

- primary_salesperson_user_id nullable
- attribution_source
- attributed_at
- attribution_snapshot

Avoid storing arbitrary arrays directly if multi-assist commission becomes real; use a normalized OrderStaffAttribution table if more than one staff member can earn.

### M03 — Payments

M13 may observe Payment status for ORDER_PAID trigger.

No commission record may change Payment.

If commission earning trigger is ORDER_PAID, define which payment statuses qualify:

- PAID
- possibly PARTIALLY_PAID only if future policy explicitly supports proportional earning

Current M03 does not define partial payment as an active v1 flow, so M13 should not assume it.

### M06 — Identity / RBAC

Add:

- commissions.read_own
- commissions.read_all
- commissions.rules.manage
- commissions.calculate
- commissions.adjust
- commissions.approve
- commissions.mark_paid

Recommended privacy rule:

Sales staff can view own accruals/statements only.

### M09 — Returns

M09 completion should emit a stable event/input for commission reversal.

M13 must reverse economically affected commission rather than edit historical accrual.

## 8. M14 impact — Operational Health Desk

### M02 — Orders & Reservations

Expose health projections / metrics:

- active reservation count;
- expired-but-not-released count;
- oldest expired reservation age;
- orders by status and age;
- failed reservation-release jobs;
- idempotency conflict rate.

No M14 process may release stock directly in v1.

### M03 — Checkout & Payments

Expose:

- pending manual verification count;
- oldest pending verification age;
- failed provider attempt count;
- webhook processing failures once adapters exist;
- payment status anomaly signals.

M14 observes; M03 mutates.

### M04 — Fulfillment

Expose:

- queue by fulfillment state;
- oldest READY/PREPARING shipment;
- failed delivery count;
- RETURNING backlog;
- COD collected-not-reconciled count.

M04 remains the authority for fulfillment/COD mutation.

### M05 — Fiscal

M05 already defines operational controls including fiscal provider health.

Required integration:

M05 produces authoritative fiscal health facts.
M14 displays and incident-manages them.

M14 must not derive CAI legality or fabricate range status independently.

### M06 — Identity / RBAC

Add:

- health.read
- health.incidents.manage
- health.incidents.assign
- health.incidents.resolve
- health.admin

Audit incident actions through M06 actor identity.

## 9. M15 impact — Credit Provider Adapter

### M03 — Checkout & Payments

This is the primary dependency.

M03 currently excludes lending / credit but already defines a PaymentProvider boundary.

Required vNext extension after M15 approval:

- add provider-backed financing method category;
- allow CreditApplication APPROVED to create/update a PaymentAttempt through server-side adapter logic;
- preserve authoritative amount from Order;
- authenticate callbacks;
- deduplicate callbacks;
- never allow client-provided APPROVED state.

Recommendation:

Do not make CREDIT a generic offline payment method.
Treat external financing as provider-backed payment orchestration.

### M06 — Identity / RBAC

Add:

- credit.read
- credit.providers.manage
- credit.applications.read
- credit.applications.support

Staff support may view status but cannot approve credit.

### M07 — Customer & CRM

Credit application may reference Customer, but Customer remains optional for ordinary commerce.

Required privacy rule:

- do not place underwriting data in Customer notes/tags;
- retain only normalized provider/application references needed by MR;
- provider handles sensitive underwriting unless explicitly required.

### M14 — Health Desk

Monitor:

- adapter availability;
- quote failures;
- callback failures;
- stuck applications;
- provider latency / error rate where available.

Never expose sensitive application data in incident metadata.

## 10. M04/M05/M07 impacts from M11–M13

### M04 Fulfillment

M11 does not require seller-managed fulfillment in v1.

However, future seller fulfillment will need:

- fulfillment_party;
- seller-specific shipment responsibility;
- split shipment support.

Do not add now unless marketplace fulfillment is approved.

### M05 Fiscal

The hybrid model introduces a major future legal/fiscal decision:

Who issues the customer fiscal document for third-party merchandise under each commercial mode?

This must not be inferred from M11.

Before marketplace/consignment production activation, M05 or a validated fiscal amendment must define:

- merchant / seller-of-record implications;
- invoice issuer;
- tax responsibility;
- returns/credit-note responsibility;
- settlement documentation.

M11 may calculate operational economics but cannot decide tax liability.

### M07 Customer

M11 does not expose customer PII to sellers by default.

Any future seller portal must receive a purpose-limited projection only where fulfillment/support requires it.

## 11. Approved SPECs that likely need versioned amendment after approval

### High-priority amendments

M01 vNext:
- separate product commercial model from economic inventory ownership;
- normalize inventory movement vocabulary;
- define integration boundary with M11/M12.

M02 vNext:
- OrderItem commercial snapshot hook for M11;
- staff attribution hook for M13.

M06 vNext:
- add permissions for M11–M15.

### Medium-priority amendments

M03 vNext:
- M15 credit-provider adapter extension;
- explicit observer contract for M13/M14.

M08 vNext:
- Supplier vs Seller boundary;
- receipt discrepancy -> M12 boundary.

M09 vNext:
- stable economic-return event contract for M11/M13.

### Integration-only / no immediate schema rewrite

M04:
- expose health metrics to M14;
- no seller fulfillment yet.

M05:
- expose fiscal health to M14;
- later fiscal amendment required before third-party seller activation.

M07:
- M15 customer-reference/privacy boundary.

## 12. Recommended approval sequence

If the user approves the new direction, approve/spec-refine in this order:

1. M12 — because it strengthens an existing M01 risk area without depending on marketplace activation.
2. M14 — because it improves operational control across current and near-term modules.
3. M11 — because hybrid ownership is confirmed, but settlement implementation depends on authoritative orders/payments/returns.
4. M13 — because commission rules depend on authoritative orders and business policy still has open parameters.
5. M15 — because credit is strategically relevant but remains provider/legal dependent and is not required for initial Commerce Core stability.

This is an implementation-risk recommendation, not a change to the existing Commerce Core roadmap.

## 13. Implementation gating

Even if M11–M15 are approved as design:

- M01–M04 Commerce Core sequence remains the immediate implementation priority;
- no marketplace activation before stable catalog/inventory/orders/checkout/fulfillment;
- no live credit provider before current terms and legal role are verified;
- no automated shrinkage posting without M06 actor identity;
- no staff commission payouts before earning/reversal rules are approved;
- no fiscal assumption inferred from seller settlement logic.

## 14. Required follow-up artifacts

After approval of M11–M15:

1. create versioned amendment proposals for M01, M02, M03, M06, M08 and M09;
2. inspect production schema before finalizing movement enum changes;
3. define event contracts between modules;
4. create GitHub implementation issues only for approved work;
5. keep Pricing & Promotions separate until business rules are defined.

## 15. Decision record

This matrix deliberately does **not** edit approved SPECs.

It establishes a safe boundary:

Conversation knowledge
→ proposed SPEC
→ dependency analysis
→ explicit approval
→ versioned amendment
→ implementation issue
→ code / migration
→ CI
→ Railway deployment
→ production verification.
