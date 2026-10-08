# SPEC — Module 13: Staff Commissions & Incentives v1

**Project:** MR עדולם
**Status:** PROPOSED FOR APPROVAL
**Date:** 2026-10-08
**Method:** Spec-Driven Development (SDD)

## 1. Objective

Define a traceable staff commission domain for sellers and advisors without mixing commissions with payroll, bank settlement or customer payment processing.

The module must calculate incentives from authoritative commerce events and reverse them when the economic basis disappears.

## 2. Domain boundary

Inputs:

- StaffUser / role from M06;
- Order / OrderItem from M02;
- Payment state from M03;
- ReturnCase from M09;
- cost / margin data from M01 where a margin-based rule is used.

M13 owns:

CommissionRule
→ CommissionAccrual
→ CommissionStatement
→ approval
→ operational payment confirmation

M13 does not own salary payroll, IHSS / RAP / ISR calculation, employee bank ledger, customer payment collection or seller settlement from M11.

## 3. Eligible staff attribution

Orders must be able to preserve:

- primary_salesperson_user_id nullable;
- assisted_by_user_ids optional;
- originating_channel;
- originating_location;
- assignment snapshot.

Attribution changes after sale commitment require auditable correction, not silent overwrite.

## 4. CommissionRule

Fields:

- id UUID
- name
- version
- status
- effective_from
- effective_to nullable
- scope_type
- scope_reference nullable
- earning_trigger
- calculation_basis
- rate_bps nullable
- fixed_amount_minor nullable
- currency nullable
- minimum_margin_bps nullable
- cap_minor nullable
- return_reversal_policy
- cancellation_reversal_policy
- created_by_user_id
- approved_by_user_id nullable
- created_at
- approved_at nullable

Status:

- DRAFT
- APPROVED
- ACTIVE
- EXPIRED
- DISABLED

Scope examples:

- GLOBAL
- USER
- ROLE
- LOCATION
- CATEGORY
- PRODUCT
- CHANNEL

## 5. Calculation basis

Initial vocabulary:

- GROSS_SALES
- NET_SALES
- GROSS_MARGIN
- FIXED_PER_ORDER
- FIXED_PER_UNIT

Rules:

- GROSS_MARGIN requires authoritative cost basis;
- percentage arithmetic uses integer basis points;
- money uses minor units;
- rule version is snapshotted when an accrual is created.

## 6. Earning trigger

Initial options:

- ORDER_PAID
- ORDER_DELIVERED
- ORDER_COMPLETED

Default business trigger must be approved before implementation.

A commission is not earned merely because an order was drafted.

## 7. CommissionAccrual

Fields:

- id UUID
- staff_user_id
- order_id
- order_item_id nullable
- commission_rule_id
- commission_rule_version
- basis_amount_minor
- rate_bps nullable
- fixed_amount_minor nullable
- accrued_amount_minor
- status
- earned_at nullable
- held_reason nullable
- source_event_type
- source_event_id
- reversal_of_accrual_id nullable
- created_at

Status:

- PENDING
- EARNED
- HELD
- REVERSED
- INCLUDED_IN_STATEMENT

Each qualifying source event may create at most one active accrual for the same rule and staff attribution.

## 8. Returns and cancellations

If an eligible sale is later cancelled or returned:

- create an explicit negative or reversal accrual;
- do not rewrite the original accrual;
- partial returns reverse only the economically affected portion;
- if a statement was already paid, the reversal carries forward to a future statement unless policy specifies manual recovery.

## 9. CommissionStatement

Fields:

- id UUID
- staff_user_id
- period_start
- period_end
- status
- gross_earned_minor
- reversals_minor
- adjustments_minor
- net_payable_minor
- currency
- calculated_at
- approved_at nullable
- paid_at nullable
- external_payment_reference nullable
- approved_by_user_id nullable
- paid_by_user_id nullable

Status:

- CALCULATED
- APPROVED
- PAID
- VOID

PAID is operational confirmation only; payroll/accounting systems remain external unless later integrated.

## 10. Manual adjustments

Manual positive or negative commission adjustments require:

- reason code;
- actor;
- amount;
- affected period;
- approval when configured;
- audit history.

They cannot modify order totals or payment records.

## 11. Permissions

Suggested M06 permissions:

- commissions.read_own
- commissions.read_all
- commissions.rules.manage
- commissions.calculate
- commissions.adjust
- commissions.approve
- commissions.mark_paid

A salesperson should normally see only their own statement unless granted broader access.

## 12. Audit requirements

Audit:

- rule creation/versioning;
- approval;
- assignment corrections;
- accrual creation;
- reversals;
- manual adjustments;
- statement approval;
- payment confirmation.

## 13. Functional requirements

- FR-COM-001 Version commission rules.
- FR-COM-002 Attribute eligible commerce to staff.
- FR-COM-003 Calculate using authoritative order/payment/return data.
- FR-COM-004 Support sales- and margin-based rules.
- FR-COM-005 Reverse cancellations and returns explicitly.
- FR-COM-006 Prevent duplicate accruals through idempotency.
- FR-COM-007 Produce per-user commission statements.
- FR-COM-008 Support approval before payout confirmation.
- FR-COM-009 Preserve privacy by permission.
- FR-COM-010 Keep payroll and banking outside M13.

## 14. Acceptance criteria

1. A commission cannot be generated from a non-eligible event.
2. Historical accrual values do not change when a rule changes.
3. Duplicate source events do not duplicate commission.
4. Partial returns create proportional or rule-defined reversals.
5. A user without permission cannot see another user's statement.
6. A statement cannot move to PAID before APPROVED.
7. Commission totals reconcile to underlying accruals and reversals.
8. M13 does not calculate payroll taxes or employee bank balances.

## 15. Pending business decisions

Before implementation, approve:

- default earning trigger;
- rule basis by role/category;
- commission rates;
- treatment of discounts;
- treatment of shipping;
- treatment of seller-owned inventory;
- payout frequency;
- handling of negative carry-forward.
