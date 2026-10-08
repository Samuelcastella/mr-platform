# SPEC — Module 15: Credit Provider Adapter Boundary v1

**Project:** MR עדולם
**Status:** PROPOSED FOR APPROVAL
**Date:** 2026-10-08
**Method:** Spec-Driven Development (SDD)

## 1. Objective

Define a safe future integration boundary for installment / credit providers without making MR עדולם a lender, credit bureau, underwriting engine or financial ledger.

This SPEC exists because Honduras retail research identified credit as commercially important, while M03 intentionally excludes lending / credit.

It does not approve any specific provider or launch credit in production.

## 2. Core boundary

MR may:

- display currently verified provider options;
- request or retrieve a financing quote through an adapter;
- hand off an application to an external provider;
- receive provider decision/status callbacks;
- associate an approved financing reference with an Order;
- maintain commercial state needed to complete checkout.

MR must not, unless a future separately approved regulated capability exists:

- calculate proprietary credit scores;
- make lending decisions;
- store a lender's internal risk model;
- hold loan principal balances;
- calculate a lender's interest ledger;
- collect regulated debt as lender of record;
- represent stale provider terms as current.

## 3. Provider neutrality

Do not hardcode Credilee, CrediDiunsa, Crédito Mendels or any other researched option into the core domain.

A CreditProvider adapter has capabilities and configuration.

Provider-specific requirements belong in adapter documentation after current commercial and legal verification.

## 4. CreditProvider

Fields:

- id UUID
- code unique
- display_name
- status
- country_code
- adapter_type
- supports_quote
- supports_application
- supports_callback
- terms_verified_at nullable
- terms_source_reference nullable
- created_at
- updated_at

Status:

- DRAFT
- ACTIVE
- SUSPENDED
- RETIRED

A provider with expired or unverified public terms may remain technically configured but must not present unverified terms as authoritative customer-facing facts.

## 5. CreditQuote

Fields:

- id UUID
- provider_id
- order_id nullable
- currency
- purchase_amount_minor
- quoted_terms_json sanitized
- provider_quote_reference nullable
- expires_at nullable
- status
- created_at

Status:

- REQUESTED
- AVAILABLE
- UNAVAILABLE
- EXPIRED
- ERROR

MR stores only normalized terms required to present the quote and preserve checkout traceability.

## 6. CreditApplication

Fields:

- id UUID
- provider_id
- order_id
- customer_id nullable
- status
- provider_application_reference nullable
- handoff_url nullable
- submitted_at nullable
- decided_at nullable
- approved_amount_minor nullable
- currency nullable
- expires_at nullable
- last_callback_at nullable
- idempotency_key
- created_at
- updated_at

Status:

- CREATED
- HANDED_OFF
- SUBMITTED
- PENDING
- APPROVED
- REJECTED
- EXPIRED
- CANCELLED
- ERROR

Sensitive application data should remain with the provider unless explicitly required and legally justified.

## 7. Checkout interaction

M03 remains authoritative for checkout and commercial Payment state.

Future integration pattern:

1. server computes authoritative order total;
2. customer selects an available external credit option;
3. MR creates CreditApplication;
4. provider handles application / underwriting;
5. MR receives verified decision;
6. APPROVED financing may create or update a provider-backed Payment or PaymentAttempt through a future M03 adapter extension;
7. order confirmation follows M03 rules.

A client cannot self-report approval.

## 8. Callbacks and idempotency

Provider callbacks must:

- be authenticated according to provider contract;
- use idempotency and deduplication;
- preserve raw event reference safely;
- reject impossible state regressions;
- never directly mutate order or inventory outside governed service logic.

## 9. Customer disclosure

Customer-facing credit information must distinguish:

- provider identity;
- indicative vs binding terms;
- total financed amount;
- installment count where supplied;
- payment frequency;
- interest or fees where supplied and legally required;
- expiration;
- redirect / handoff ownership.

No stale research note may be displayed as a live offer.

## 10. Data minimization

Store only data required for application correlation, order completion, support, audit and legally required retention.

Avoid storing full external credit files, sensitive underwriting features, provider passwords or unnecessary identity documents.

## 11. Permissions

Suggested M06 permissions:

- credit.read
- credit.providers.manage
- credit.applications.read
- credit.applications.support

Staff cannot change an external provider decision to APPROVED manually.

## 12. Observability

M14 may monitor adapter availability, quote errors, callback failures and applications stuck beyond SLA.

Diagnostics must not expose sensitive credit data.

## 13. Functional requirements

- FR-CRD-001 Support provider-neutral credit adapters.
- FR-CRD-002 Preserve current-term verification timestamp/source.
- FR-CRD-003 Support quote/application handoff.
- FR-CRD-004 Accept authenticated idempotent provider callbacks.
- FR-CRD-005 Prevent client-side approval spoofing.
- FR-CRD-006 Minimize sensitive data retention.
- FR-CRD-007 Integrate with M03 only through versioned contracts.
- FR-CRD-008 Keep lending ledger and underwriting outside MR.
- FR-CRD-009 Mark expired/unverified offers unavailable for authoritative display.

## 14. Acceptance criteria

1. Core commerce does not depend on any one credit provider.
2. Removing one adapter does not break cash, transfer or COD.
3. Unverified terms are not presented as authoritative offers.
4. A browser cannot mark an application approved.
5. Duplicate provider callbacks do not duplicate payment or order effects.
6. MR does not store a lender's loan ledger.
7. Credit status can be supported without exposing sensitive underwriting data.

## 15. Activation gate

Before any provider becomes ACTIVE:

- revalidate current provider requirements and terms;
- complete legal/compliance review applicable to MR's role;
- approve adapter contract;
- implement automated callback/idempotency tests;
- verify failure behavior;
- add customer disclosures;
- obtain production approval through SDD.
