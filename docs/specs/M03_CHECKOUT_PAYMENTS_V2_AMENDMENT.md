# SPEC — Module 03: Checkout & Payment Orchestration v2 Amendment

**Project:** MR עדולם
**Status:** PROPOSED FOR APPROVAL
**Date:** 2026-10-08
**Base specification:** M03_CHECKOUT_PAYMENTS_V1.md
**Roadmap:** STRATEGIC_BASELINE_HONDURAS_V2.md
**Dependencies:** M02 v2 amendment, M06 v2 amendment, M13, M14, M15

## 1. Purpose

Amend M03 so the existing authoritative checkout/payment domain can safely support future external credit-provider adapters and expose normalized operational signals to M13/M14 without turning Payment into seller settlement, staff compensation or a financial ledger.

M03 v1 remains authoritative except where explicitly extended below.

## 2. Verified implementation baseline — 2026-10-08

The current catalog-api already implements:

- checkout_sessions;
- payments;
- payment_attempts;
- payment_status_history;
- CASH;
- BANK_TRANSFER;
- CASH_ON_DELIVERY;
- OfflinePaymentProvider;
- idempotent checkout creation;
- internal permission-protected payment reads/status mutation;
- server-authoritative order amount;
- COD linkage to fulfillment.

Current payment methods are constrained to CASH, BANK_TRANSFER and CASH_ON_DELIVERY.

Current provider boundary already exposes a PaymentProvider interface.

Therefore M03 v2 is an additive provider/integration amendment, not a rewrite of the current payment domain.

## 3. Seller settlement boundary

M03 Payment remains customer-side commercial payment state.

M03 must not store or execute:

- seller payout;
- seller payable balance;
- seller settlement statement;
- seller bank ledger;
- supplier accounts-payable ledger.

M11 may observe authoritative Payment state when determining settlement eligibility.

A Payment reaching PAID does not itself create or transfer seller funds.

## 4. Staff commission observer boundary

M13 may observe Payment state where CommissionRule.earning_trigger = ORDER_PAID.

M03 does not calculate staff commission.

Rules:

- M13 consumes stable payment/order identifiers and status events;
- commission accrual cannot mutate Payment;
- M03 v1 PARTIALLY_REFUNDED status does not imply proportional commission behavior unless M13 policy explicitly defines it;
- no partial-payment earning behavior is introduced by this amendment.

## 5. Health Desk observer contract

M14 may consume normalized operational projections such as:

- pending manual-verification payment count;
- oldest PENDING BANK_TRANSFER age;
- failed payment attempt count;
- payment status anomaly count;
- provider callback failure count when external adapters exist;
- provider latency/error metrics when available.

M14 observes; M03 remains the mutation authority.

Health Desk permissions cannot mark a payment PAID, FAILED, CANCELLED or REFUNDED.

## 6. Credit-provider integration model

External financing from M15 is provider-backed payment orchestration, not a new offline method.

Do not add a generic CREDIT value to the existing offline method enum simply to represent all financing.

Preferred integration model:

CreditProvider / CreditApplication
→ provider decision
→ server-side M15 adapter
→ provider-backed PaymentAttempt or provider-specific payment method contract
→ M03 Payment state

The final provider-specific method naming must be versioned as part of the adapter contract.

## 7. Credit application handoff

When a CreditApplication becomes APPROVED through authenticated provider evidence:

1. verify provider/application state server-side;
2. verify authoritative Order amount/currency;
3. ensure application is bound to the same Order;
4. create or update the permitted provider-backed Payment/PaymentAttempt idempotently;
5. preserve provider reference;
6. reject client-supplied approval state;
7. transition Order only through existing governed order/checkout rules.

MR staff cannot manually set an external provider decision to APPROVED.

## 8. Provider callback requirements

Future provider callbacks must:

- authenticate according to adapter contract;
- be idempotent;
- retain provider event/reference identifiers;
- reject impossible state regressions;
- never directly mutate Inventory;
- never bypass M02 order invariants;
- record sanitized audit/diagnostic data;
- expose failure state to M14 without leaking sensitive credit/payment information.

## 9. PaymentProvider evolution

The conceptual PaymentProvider boundary remains.

Future adapter contracts may add capabilities equivalent to:

- createQuote;
- createApplicationHandoff;
- handleCallback;
- authorize;
- capture/confirm where applicable.

A capability must not be required globally if only one provider needs it.

Core checkout must continue working when all external credit/payment adapters are disabled.

## 10. Data minimization

M03 stores only payment facts required by MR.

Credit-underwriting data remains governed by M15/provider.

Do not store in Payment.evidence or provider response:

- provider passwords/tokens;
- full credit bureau files;
- sensitive underwriting features;
- unnecessary identity documents.

## 11. Functional requirements added

- FR-PAY-013 Keep seller settlement outside Payment.
- FR-PAY-014 Expose stable payment-status facts to M13 without commission logic in M03.
- FR-PAY-015 Expose operational payment/provider health projections to M14.
- FR-PAY-016 Support provider-backed financing through versioned adapter contracts.
- FR-PAY-017 Reject client/staff fabrication of external credit approval.
- FR-PAY-018 Authenticate and deduplicate external provider callbacks.
- FR-PAY-019 Preserve cash/transfer/COD operation independent of credit providers.
- FR-PAY-020 Keep sensitive credit-underwriting data outside M03.

## 12. Acceptance criteria added

1. Existing CASH/BANK_TRANSFER/COD flows remain unchanged.
2. M11 can observe payment eligibility without storing seller payouts in M03.
3. M13 can consume ORDER_PAID facts without mutating Payment.
4. M14 can measure pending/failed payment conditions without changing state.
5. Removing a credit adapter does not break offline checkout.
6. Browser cannot self-report external financing approval.
7. Staff support cannot override provider APPROVED state.
8. Duplicate callbacks do not duplicate Payment/PaymentAttempt effects.
9. Provider secrets and underwriting data are absent from public/API diagnostics.
10. Existing M03 integration tests remain valid.

## 13. Implementation gate

Before implementing an external credit provider:

- M15 provider activation gate must be satisfied;
- current provider terms must be revalidated;
- M06 v2 credit permissions must exist;
- provider callback tests must cover authentication/idempotency;
- failure telemetry must integrate with M14;
- no change to the offline payment enum may be made without compatibility review.

This amendment does not activate a credit provider.
