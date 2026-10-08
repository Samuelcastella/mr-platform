# M11 / M13 — Phase B Policy Gate

**Project:** MR עדולם  
**Date:** 2026-10-08  
**Status:** PROPOSED / NOT APPROVED  
**Purpose:** Separate safe platform behavior from business-economic choices before implementing seller settlement and staff commission accruals.

## 1. Why this gate exists

M11 Phase A and M13 Phase A are now repository implementation facts:

- M11 can distinguish MR-owned inventory from third-party-owned inventory and preserve immutable seller/agreement economics on OrderItem.
- M13 can attribute a sale to staff and preserve auditable corrections.

The next phases create money entitlements. They therefore must not infer rates, earning triggers, return liability, payout cadence or settlement eligibility from incomplete data.

The safe platform rule proposed here is:

> **No explicit approved economic policy = no settlement accrual and no staff commission accrual.**

This is fail-closed behavior, not a business default.

## 2. M11 seller settlement decisions

### 2.1 Settlement eligibility trigger

Business choice required per SellerAgreement:

- ORDER_DELIVERED
- ORDER_COMPLETED
- configurable future event

**Recommended initial operating option:** ORDER_COMPLETED.

Reason: it is the most conservative current commerce state and reduces premature seller entitlement before the physical order lifecycle is finished.

This recommendation is not approved until the owner confirms it.

### 2.2 Payment eligibility

A settlement policy must explicitly define which payment facts make seller proceeds eligible.

The engine should never treat “order completed” alone as proof that funds are economically settled.

Possible policy categories:

- PAYMENT_PAID_REQUIRED
- COD_RECONCILED_REQUIRED
- METHOD_SPECIFIC

**Recommended platform behavior:** require an explicit payment policy per agreement; if absent, line remains NOT_ELIGIBLE_POLICY_MISSING.

### 2.3 Settlement delay

SellerAgreement already supports settlement_delay_days.

**Recommended platform behavior:** no global hardcoded delay. Require the agreement value to be explicit before settlement activation.

A business starting point such as 7 days can be selected later, but the core should not invent it.

### 2.4 Settlement frequency

Existing agreement field supports frequency.

Suggested controlled vocabulary:

- WEEKLY
- BIWEEKLY
- MONTHLY
- MANUAL

**Recommended platform behavior:** no implicit frequency. Missing frequency blocks statement generation.

### 2.5 Discounts, shipping and payment fees

Existing allocation fields should be explicit using the current vocabulary:

- MR
- SELLER
- PROPORTIONAL
- NOT_APPLICABLE

**Recommended platform behavior:** any economic component present on an order but lacking an applicable allocation rule blocks automatic calculation for that line and surfaces a configuration exception.

### 2.6 Returns

M09 remains authoritative for return approval and disposition.

Policy choice required:

- when does a return reduce seller entitlement;
- who absorbs the return value;
- who absorbs return shipping where applicable;
- how a reversal behaves if the original seller statement is already PAID.

**Safe engine behavior:** never rewrite the original settlement line. Generate an explicit reversal/adjustment only from an authoritative return event.

### 2.7 Shrinkage

M12 remains authoritative for inventory loss/adjustment approval.

Seller financial liability must only be created when:

- M12 produces an approved event; and
- the immutable agreement snapshot contains an explicit applicable shrinkage rule.

No automatic seller debit from a raw stock discrepancy.

## 3. M13 staff commission decisions

### 3.1 Earning trigger

Business choice required:

- ORDER_PAID
- ORDER_DELIVERED
- ORDER_COMPLETED

**Recommended initial operating option:** ORDER_COMPLETED.

Reason: conservative and easiest to reconcile against returns/failed fulfillment. It should remain configurable by CommissionRule.

### 3.2 Calculation basis

Possible basis:

- GROSS_SALES
- NET_SALES
- GROSS_MARGIN
- FIXED_PER_ORDER
- FIXED_PER_UNIT

**Recommended platform behavior:** no global default basis. A CommissionRule must name the basis explicitly.

### 3.3 Commission rate

No rate should exist as a platform default.

A missing or zero-value rule must never be silently interpreted as a business-approved percentage.

Rates must be versioned and effective-dated.

### 3.4 Discounts and shipping

Business choices required:

- commission before or after discount;
- whether shipping participates in the base;
- whether taxes participate in the base when fiscal implementation is authoritative.

**Recommended safe behavior:** calculation refuses to accrue if the selected basis needs a component whose treatment is not explicitly configured.

### 3.5 Third-party seller inventory

Business choice required: whether staff commissions apply to seller-owned / consignment / commission inventory.

**Recommended platform behavior:** default to NOT_ELIGIBLE unless a CommissionRule explicitly includes the relevant commercial mode.

This prevents seller economics and staff incentives from being unintentionally stacked.

### 3.6 Returns and reversals

When an authoritative return reverses an already-earned commission:

- create a negative CommissionAccrual/reversal;
- do not edit the original accrual;
- preserve the original CommissionRule snapshot;
- if a statement was already paid, carry the reversal into a later statement according to approved policy.

### 3.7 Statement and payout frequency

Business choice required:

- WEEKLY
- BIWEEKLY
- MONTHLY
- MANUAL

No default is proposed at platform level.

### 3.8 Negative carry-forward

Business choice required when reversals exceed current positive accruals:

- CARRY_FORWARD
- CAP_AT_ZERO_WITH_REVIEW
- MANUAL_REVIEW

The platform must not choose this automatically.

## 4. Technical behavior safe to implement before economic values are approved

The following is safe to build without inventing business economics:

1. versioned policy/rule schemas;
2. explicit “policy missing / not eligible” states;
3. immutable source snapshots;
4. read-only eligibility diagnostics;
5. idempotency keys/source-event uniqueness;
6. statement lifecycle skeletons that cannot calculate without complete policy;
7. approval segregation;
8. audit history;
9. reversal primitives that require authoritative M09/M12 source events;
10. Health Desk signals for blocked/misconfigured economic rules.

## 5. Activation gates

### M11 settlement activation

Do not activate automatic settlement calculation until these are approved:

- settlement trigger;
- payment eligibility;
- frequency;
- delay;
- discount allocation;
- shipping allocation;
- payment-fee allocation;
- return allocation;
- shrinkage liability;
- fiscal/legal treatment of third-party sales where applicable.

### M13 commission activation

Do not activate CommissionAccrual until these are approved:

- earning trigger;
- eligible staff roles;
- eligible commercial modes;
- calculation basis;
- rate(s);
- discount treatment;
- shipping treatment;
- return reversal policy;
- statement frequency;
- negative carry-forward policy.

## 6. Recommended next implementation increment

Before activating economics, implement a **Policy Readiness layer**:

- validate whether each SellerAgreement is settlement-ready;
- validate whether each CommissionRule is commission-ready;
- expose missing-policy reasons internally;
- never create payable/accrued value when readiness is false;
- surface configuration blockers in Control Center / Health Desk.

This lets the codebase advance while preserving the owner’s authority over actual economic policy.

## 7. Decision record

Nothing in this document is a business-policy approval.

Approved implementation facts remain limited to the foundations already merged. The recommendations above become implementation requirements only after explicit owner approval.
