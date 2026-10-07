# SPEC — Module 05: Honduras Fiscal Compliance Boundary v1

**Status:** DESIGN APPROVED / PRODUCTION IMPLEMENTATION BLOCKED  
**Owner:** MR עדולם  
**Method:** Spec-Driven Development (SDD)  
**Issue:** #18  
**Dependency:** M02 Orders, M03 Checkout & Payments, M04 Fulfillment & Logistics  
**Research:** `docs/research/HONDURAS_FISCAL_VALIDATION_2026.md`

## 1. Objective

Define a safe, auditable fiscal architecture for MR עדולם in Honduras without encoding unverified tax assumptions, fabricating SAR authorization data, or coupling the Commerce Core to one invoicing implementation.

This SPEC defines the target contract and the evidence required before fiscal issuance may be enabled in production.

## 2. Core decision

Fiscal compliance is a separate bounded context from:

- Catalog;
- Inventory;
- Orders;
- Payments;
- Fulfillment.

The dependency direction is:

```text
Order pricing snapshot
      ↓
Tax Engine
      ↓
Fiscal Policy
      ↓
Fiscal Authorization
      ↓
Fiscal Document
      ↓
Fiscal Provider
```

Fiscal behavior may observe approved commercial facts. It must not rewrite commercial history.

## 3. Non-goals for this version

This version does **not** authorize production code that:

- assigns 15% ISV to all products;
- generates real fiscal correlatives;
- stores a real CAI in Git;
- emits an official invoice;
- sends data to a presumed SAR API;
- creates real Credit Notes automatically;
- determines the business's tax regime from revenue estimates.

Those actions require the Production Gate in Section 14.

## 4. Domain model

### 4.1 TaxCategory

Purpose: stable classification assigned to products/variants.

Proposed fields:

- `id`
- `code`
- `name`
- `jurisdiction`
- `status`
- `created_at`
- `updated_at`

Examples are not pre-seeded with production semantics until reviewed.

### 4.2 TaxRule

Purpose: effective-dated rule applied to a TaxCategory.

Proposed fields:

- `id`
- `tax_category_id`
- `jurisdiction`
- `rate_basis_points`
- `effective_from`
- `effective_to`
- `source_reference`
- `status`
- `approved_by`
- timestamps

Invariant:

```text
one active rule per tax category + jurisdiction + effective instant
```

### 4.3 ProductTaxAssignment

- `product_id` or `variant_id`
- `tax_category_id`
- `effective_from`
- `effective_to`
- `source_reference`
- `approved_by`

Do not use a single unversioned `tax_rate` field as the source of truth.

### 4.4 OrderTaxSnapshot

Immutable calculation result attached to an Order/OrderItem version.

Fields:

- `order_id`
- `order_item_id`
- `tax_category_code`
- `tax_rule_id`
- `rate_basis_points`
- `gross_minor`
- `discount_minor`
- `taxable_base_minor`
- `tax_minor`
- `currency`
- `calculated_at`
- `calculation_version`

### 4.5 FiscalAuthorization

Purpose: represent an authorization/range issued or recognized by the applicable SAR workflow.

Fields are provisional until the business-side authorization is inspected:

- `id`
- `issuer_id`
- `document_type`
- `cai_encrypted`
- `establishment_code`
- `point_of_issue_code`
- `range_start`
- `range_end`
- `next_correlative`
- `valid_from` nullable
- `valid_until`
- `status`
- `source_reference`
- timestamps

Statuses:

- `DRAFT`
- `ACTIVE`
- `EXHAUSTED`
- `EXPIRED`
- `SUSPENDED`
- `REVOKED`

### 4.6 FiscalDocument

Fields:

- `id`
- `order_id`
- `authorization_id`
- `document_type`
- `document_number`
- `status`
- `issued_at`
- `currency`
- `subtotal_minor`
- `discount_total_minor`
- `taxable_base_minor`
- `tax_total_minor`
- `shipping_minor`
- `grand_total_minor`
- `customer_fiscal_snapshot` JSON
- `line_snapshot` JSON
- `provider`
- `provider_reference`
- `rendered_artifact_reference`
- `correlation_id`
- timestamps

Suggested statuses:

- `DRAFT`
- `NUMBER_RESERVED`
- `ISSUED`
- `ANNULLED`
- `FAILED`

Final statuses remain subject to validation against the actual issuance method.

### 4.7 FiscalAdjustment

Purpose: link returns/corrections to the original FiscalDocument without mutating it.

Fields:

- `id`
- `original_fiscal_document_id`
- `commercial_return_id` nullable
- `adjustment_type`
- `status`
- `amount_minor`
- `reason`
- `complementary_document_id` nullable
- timestamps

## 5. Tax engine

Conceptual interface:

```text
TaxEngine.calculate({
  jurisdiction,
  orderLines,
  discounts,
  shipping,
  effectiveAt
})
-> TaxCalculation
```

Server responsibilities:

1. load effective ProductTaxAssignment;
2. load effective TaxRule;
3. calculate line taxable bases;
4. account for approved discounts according to current rules;
5. calculate tax using integer minor units / deterministic rounding policy;
6. return immutable calculation snapshot;
7. fail closed when a taxable item has no approved rule.

The client may display a server quote but never becomes tax authority.

## 6. Rounding policy

Before implementation, the accounting owner must approve:

- whether rounding occurs per line or document;
- decimal precision;
- treatment of fractional centavos;
- discount allocation across multiple tax categories;
- shipping tax treatment.

The implementation must use integer minor units and deterministic rules. Binary floating-point is prohibited for fiscal amounts.

## 7. Fiscal trigger

Do not assume “Order created” is the issuance trigger.

The final trigger must be confirmed operationally.

Candidate policy:

```text
Order eligible
+ payment/fulfillment rule satisfied
+ tax snapshot valid
+ active authorization valid
→ issue fiscal document
```

COD may have a different issuance timing from immediate cash or transfer depending on confirmed accounting procedure.

This is an explicit business/accounting decision.

## 8. Number allocation

A fiscal number is allocated only in a server-side transaction.

Algorithm:

1. lock FiscalAuthorization;
2. validate ACTIVE;
3. validate current date <= valid_until where applicable;
4. validate next_correlative <= range_end;
5. allocate next number;
6. persist NUMBER_RESERVED FiscalDocument;
7. increment next_correlative atomically;
8. issue/render through FiscalProvider;
9. transition to ISSUED or FAILED according to approved recovery policy.

Invariant:

```text
No two fiscal documents can share the same authorization + document number.
```

Numbers are never generated in the browser.

## 9. CAI / authorization handling

MR must never generate or infer a real CAI.

Requirements:

- supplied only through authorized back-office configuration;
- encrypted or otherwise protected at rest where appropriate;
- never exposed through public storefront API;
- never written to application logs in full;
- never committed in Git;
- validity/range checked before issuance;
- renewal/range-exhaustion alerts supported.

Masked display may be available to authorized operators.

## 10. FiscalProvider

Conceptual interface:

```text
interface FiscalProvider {
  validateAuthorization(...)
  issue(...)
  annul(...)
  issueComplementaryDocument(...)
  validateDocument(...)
}
```

Providers may later include:

- an existing accountant/POS/invoicing system;
- an internally operated self-printer workflow, if validated;
- an official future electronic service/API, if supported and applicable.

There is no default `SAR_API` implementation in this SPEC.

## 11. Sales, discounts and returns

### Normal sale

- commercial totals come from Order;
- tax engine computes authoritative tax snapshot;
- fiscal document snapshots all amounts and lines;
- historical Product price changes do not affect it.

### Discount

- effective discount is retained in the order/fiscal snapshot;
- taxable base uses the approved current rule;
- later discount edits cannot rewrite an already issued FiscalDocument.

### Cancellation before fiscal issuance

- cancel commercial order according to Order rules;
- no fiscal document is fabricated.

### Error after fiscal issuance

- do not delete;
- use approved annulment/correction flow;
- preserve original fiscal record and audit.

### Return after issuance

- Return domain records commercial return;
- Inventory domain decides restock after inspection;
- Payment domain decides refund status;
- Fiscal domain determines required complementary fiscal document;
- original FiscalDocument remains immutable.

### Exchange

Model as auditable return/adjustment + new outbound commercial transaction as required. Never rewrite the original line history.

## 12. API surface — conceptual only

No production route should be enabled until Section 14 passes.

Potential internal routes:

```text
GET  /v1/internal/tax-categories
POST /v1/internal/tax-categories
GET  /v1/internal/tax-rules
POST /v1/internal/tax-rules
POST /v1/internal/tax/quote

GET  /v1/internal/fiscal-authorizations
POST /v1/internal/fiscal-authorizations
POST /v1/internal/fiscal-authorizations/:id/activate

POST /v1/internal/orders/:id/fiscal-documents
GET  /v1/internal/fiscal-documents/:id
POST /v1/internal/fiscal-documents/:id/annul
POST /v1/internal/fiscal-documents/:id/adjustments
```

Public storefront should receive only the fiscal information needed by the customer.

## 13. Security / RBAC

At minimum:

- `FISCAL_ADMIN`: configure authorization/ranges;
- `FISCAL_OPERATOR`: issue/correct within approved policy;
- `MANAGER`: review;
- `AUDITOR`: read-only historical access.

Audit log fields:

- actor;
- action;
- entity;
- entity_id;
- before/after status;
- reason;
- correlation_id;
- timestamp.

Sensitive fiscal identifiers are redacted in logs.

## 14. Production Gate

**Status on 2026-10-07: BLOCKED.**

The following evidence must be collected and reviewed before production fiscal code is enabled:

- legal taxpayer name;
- RTN;
- legal form;
- current SAR tax obligations;
- confirmed general vs simplified ISV status;
- current Facturación enrollment;
- current document type used for retail sales;
- current CAI;
- Fecha Límite de Emisión;
- establishment code;
- point-of-issue code;
- authorized range;
- last-used correlativo/current sequence owner;
- current issuance system/printer/self-printer workflow;
- approved tax classification for current product groups;
- approved tax treatment of delivery charges;
- approved refund/return/exchange fiscal procedure.

These values must be sourced from current business records/accountant/SAR, not guessed from public market research.

## 15. Required implementation tests after gate approval

### Tax

- effective-date rule selection;
- missing tax assignment fails closed;
- taxable/exempt classifications;
- discount base handling;
- deterministic rounding;
- shipping tax rule;
- historical snapshot immutability.

### Authorization

- reject expired authorization;
- reject exhausted range;
- prevent duplicate document number under concurrency;
- number allocation atomicity;
- secrets never exposed through public API.

### Fiscal document

- normal issuance;
- retry/idempotency;
- provider timeout with recoverable state;
- annulment;
- complementary document linkage;
- no deletion of issued history.

### Integration

- Order amount = source commercial snapshot;
- Payment changes do not rewrite issued fiscal document;
- Return does not automatically alter fiscal history;
- restart/redeploy does not lose sequence state.

## 16. Operational controls

Production dashboard should eventually show:

- active authorization status;
- days to expiration;
- numbers remaining in authorized range;
- failed issuance;
- documents awaiting correction;
- unclassified products blocking tax calculation;
- fiscal provider health.

Alerts:

- authorization near expiration;
- range below threshold;
- issuance failure;
- sequence conflict;
- missing tax classification.

## 17. Acceptance criteria for Issue #18

This SPEC/research phase is complete when:

1. official current SAR sources are documented;
2. verified facts are separated from assumptions;
3. sale/discount/cancellation/return/exchange cases are defined;
4. target architecture is defined;
5. production code is explicitly blocked on missing taxpayer/authorization/product-classification evidence;
6. the business-side evidence checklist is recorded;
7. no unverified fiscal rule is deployed.

## 18. Next implementation decision

Once Section 14 is satisfied:

```text
M05A — Tax Classification & Calculation
→ M05B — Fiscal Authorization & Sequence
→ M05C — Fiscal Document Issuance
→ M05D — Returns / Credit-Note integration
→ Production verification
```

Until then, MR עדולם continues operating its commercial Order/Payment/Fulfillment core without pretending that a commercial confirmation is an official SAR fiscal document.
