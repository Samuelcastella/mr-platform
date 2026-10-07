# Honduras Fiscal Validation 2026 — MR עדולם

**Status:** VALIDATED RESEARCH / IMPLEMENTATION GATE  
**Date:** 2026-10-07  
**Scope:** Honduras — facturación, ISV, CAI/autorización de impresión, documentos complementarios  
**Authority preference:** Servicio de Administración de Rentas (SAR), Honduras  
**Purpose:** Prevent fiscal assumptions from being encoded in production before the legal/tax profile of the operating business is confirmed.

> This document is a technical compliance research artifact, not legal or accounting advice. Where the applicable treatment depends on MR עדולם's taxpayer registration, product classification, establishment configuration or active SAR authorizations, the system must remain configurable and production implementation remains blocked until those inputs are verified.

## 1. Executive decision

**Do not hardcode “15% ISV + automatic CAI invoice” across the MR עדולם catalog.**

The current SAR sources confirm that Honduras maintains a formal fiscal-document regime and ISV obligations, but the exact production rule for MR עדולם depends on business-specific facts that are not contained in the software repository:

- taxpayer identity / RTN;
- legal form;
- current tax obligations registered at SAR;
- whether the business is under the general or simplified ISV regime;
- active registration in the invoicing regime;
- authorized establishment(s) and point(s) of issue;
- active fiscal document authorization / CAI and valid ranges;
- current printing / self-printer operating method;
- product-level taxable/exempt classification;
- accountant/SAR-confirmed handling of returns and complementary documents.

The architecture can be specified now. Production issuance cannot be enabled safely yet.

## 2. Official source set reviewed

All sources below are official SAR domains and were reviewed on 2026-10-07.

### Primary facturación sources

1. SAR — Facturación  
   https://www.sar.gob.hn/facturacion/

   Current page states that taxpayers transferring goods or providing services are required to issue a fiscal receipt/document. It lists fiscal receipts such as Factura, Factura Prevalorada and Ticket, and complementary documents including Nota de Crédito, Nota de Débito, Guía de Remisión and Comprobante de Retención.

2. SAR — Régimen de Facturación legal library  
   https://www.sar.gob.hn/download-category/leyes-de-facturacion/

   Current library includes:
   - Acuerdo 481-2017;
   - Acuerdo 609-2017;
   - Acuerdo 725-2018;
   - Acuerdo 817-2018;
   - consolidated Facturación regulation.

3. SAR — Ayuda Solicitud de Autorización de Impresión por Imprenta y Auto Impresor 2026  
   https://www.sar.gob.hn/download/ayuda-solicitud-de-autorizacion-de-impresion-por-imprenta-y-auto-impresor-2025/

   SAR marks this guide as updated 2026-07-17. Its continued publication confirms that authorization of printing / self-printer workflows remain a current operational part of the SAR invoicing regime.

4. SAR — Requisitos  
   https://www.sar.gob.hn/requisitos/

   Current 2026 materials include facturación authorization/activation/cancellation procedures and fiscal-document verification procedures.

5. SAR — FAQ  
   https://www.sar.gob.hn/faqs/

   Current FAQ covers document invalidation/retention, simplified ISV conditions, discounts/rebates and other operational questions.

### Primary ISV sources

6. SAR — Impuesto Sobre Ventas (ISV)  
   https://www.sar.gob.hn/impuesto-sobre-ventas-isv/

   SAR describes ISV as a non-cumulative tax on sales in Honduras under the ISV law/regulations and publishes 2026 guides/declaration materials.

7. SAR — Régimen Simplificado del ISV  
   https://www.sar.gob.hn/regimen-simplificado-del-impuesto-sobre-ventasimpuesto-sobre-ventas-isv/

   SAR states that this regime does not require the monthly affidavit and instead requires the annual sales declaration by January 31 of the following fiscal year.

8. SAR — 2026 simplified ISV guide/declaration  
   https://www.sar.gob.hn/wp-content/uploads/2026/03/DECLARACION-REGIMEN-SIMPLIFICADO-DEL-IMPUESTO-SOBRE-VENTA-CODIGO-202.pdf

   Current guide states that the taxable base for sales of goods/services is the value of the good/service, subject to the law, and identifies general rates of 15% and 18% as applied according to Article 6. This does **not** mean every boutique product uses 15%, nor that 18% applies to any MR product without classification.

## 3. Verified facts

### FISC-HN-V001 — Fiscal document obligation exists

The current SAR Facturación page states that taxpayers transferring goods or providing services are required to issue a fiscal document/receipt.

**MR implication:** commercial Order confirmation is not, by itself, the fiscal document. MR needs a separate FiscalDocument domain.

### FISC-HN-V002 — Multiple fiscal document types exist

SAR currently lists Factura, Factura Prevalorada, Ticket and other fiscal receipts, plus complementary documents including Credit Notes and Debit Notes.

**MR implication:** do not model “invoice” as a boolean or a single string field on Order. Fiscal documents require an independent type and lifecycle.

### FISC-HN-V003 — The active legal framework includes Acuerdo 481-2017 and reforms

The current SAR legal library continues to publish Acuerdo 481-2017 plus reforms 609-2017, 725-2018 and 817-2018 and a consolidated text.

**MR implication:** rendering/numbering rules must be derived from the consolidated current framework, not an e-commerce blog or a historical implementation.

### FISC-HN-V004 — Current SAR workflows still include print/self-printer authorization

SAR currently publishes a 2026 help document for authorization through printer and self-printer workflows.

A SAR activation guide also demonstrates that authorization data includes, at minimum, operational concepts such as:

- CAI;
- Fecha Límite de Emisión;
- establishment;
- point of issue;
- document type;
- initial document number/range.

**MR implication:** a FiscalAuthorization aggregate is needed. MR must never invent a CAI, range, expiration date, establishment or point-of-issue identifier.

### FISC-HN-V005 — Invalid/errored fiscal documents are not silently deleted

Current SAR FAQ says a fiscal document issued with filling errors must be marked “Anulado” and the original/copy retained chronologically for the applicable prescription period, citing the Facturación regulation.

**MR implication:** fiscal-document history must be immutable/auditable. A fiscal document cannot be physically deleted or rewritten to hide an error.

### FISC-HN-V006 — ISV applicability cannot be inferred from “retail” alone

SAR publishes both a general ISV framework and a simplified ISV regime. The simplified regime has different filing behavior.

Current FAQ identifies conditions for applying to the simplified regime, including one establishment and a sales threshold stated there. Because the operating business's actual SAR status is not yet documented in the repo, MR cannot infer which filing regime applies.

**MR implication:** tax calculation and filing/reporting obligations must be separate concerns. Software must not assume monthly ISV filing solely because MR sells products.

### FISC-HN-V007 — General ISV rates include 15% and 18%, but product applicability is classification-dependent

Current SAR 2026 material identifies general rates of 15% and 18% according to the ISV law.

**MR implication:** never set every ProductVariant to 15% by default as an irreversible fiscal truth. Products need a tax category/rule assignment with effective dates.

### FISC-HN-V008 — Effective discounts shown on fiscal documents affect the taxable base

Current SAR FAQ states that effective discounts/rebates recorded on the Factura or Factura Prevalorada do not form part of the taxable base, citing Article 3 of the ISV law.

**MR implication:** tax must be calculated from the authoritative line/discount snapshot according to validated tax rules. Discount order matters and must be testable.

### FISC-HN-V009 — Credit Notes are recognized fiscal complementary documents

Current SAR Facturación page lists Nota de Crédito as a complementary fiscal document.

**MR implication:** a refund/return must not rewrite the original fiscal document. A future approved return workflow should create the appropriate complementary document when required.

### FISC-HN-V010 — Fiscal document validation exists as a current SAR workflow

SAR currently links a fiscal-document validator and verification procedures.

**MR implication:** the architecture should preserve enough authorization/document metadata for validation and audit.

## 4. Facts not yet safe to encode

The following must **not** be promoted to production rules yet.

### 4.1 Exact MR taxpayer regime

Unknown in the project repository:

- RTN/legal taxpayer name;
- persona natural / comerciante individual / persona jurídica;
- active tax obligations;
- general vs simplified ISV status;
- number of registered establishments;
- whether the business is currently registered in the Facturación regime.

### 4.2 Exact fiscal authorization in use

Unknown:

- current CAI;
- authorization expiration / Fecha Límite de Emisión;
- establishment code;
- point-of-issue code;
- fiscal document type(s);
- authorized range start/end;
- current last-used correlativo;
- printer vs self-printer method;
- whether existing POS/accounting software owns the active sequence.

These values are secrets/regulated operational data and should not be committed to Git.

### 4.3 Product tax classification

The current catalog includes clothing, accessories, cosmetics, hygiene/personal-care items, underwear and second-hand goods. Public SAR material does not justify assigning one uniform tax treatment to all of these categories without classification against current law/exemptions.

### 4.4 Exact fiscal treatment of shipping

Shipping/delivery tax treatment must be confirmed for MR's invoice model before production tax calculation is finalized.

### 4.5 Exact sales-return / exchange fiscal procedure

SAR recognizes Credit Notes and provides current refund/credit-note procedures, but the exact retail document flow for MR's returns/exchanges must be validated against its taxpayer regime and document type before automation.

### 4.6 Generalized electronic-invoice API assumption

No official source reviewed in this validation establishes that MR must integrate a generalized mandatory real-time SAR e-invoicing API.

Therefore:

**Do not build a fictional SAR API integration.**

The architecture may expose a FiscalProvider interface, but the initial provider must be selected only after the business's actual SAR invoicing method is confirmed.

## 5. Required business-side evidence before production fiscal issuance

This is the implementation gate.

Obtain from the store manager/accountant/authorized representative — not from browser/local storage and not from guesswork:

| Input | Why needed | Repository treatment |
|---|---|---|
| Legal taxpayer name | Fiscal issuer identity | Config reference; no fabricated value |
| RTN | Fiscal issuer identity | Secret/config; not public Git |
| Legal form | Obligation mapping | Compliance config |
| Current SAR obligations | Determine applicable declarations | Compliance record |
| ISV regime | General vs simplified behavior | TaxPolicy config |
| Facturación enrollment | Determine issuance workflow | Fiscal config |
| Current fiscal document type | Invoice/ticket/etc. | FiscalDocumentType |
| CAI | Authorization | Secret/config, never generated by MR |
| Fecha Límite de Emisión | Block expired authorization | FiscalAuthorization |
| Establishment | Numbering identity | FiscalAuthorization |
| Point of issue | Numbering identity | FiscalAuthorization |
| Authorized range | Prevent out-of-range docs | FiscalAuthorization |
| Last used correlativo | Prevent collisions | Sequence migration |
| Current issuing system | Establish source-of-truth/migration | Integration decision |
| Accountant/SAR classification by product group | Tax applicability | TaxCategory mapping |

## 6. Sale / discount / return case matrix

### Case A — Normal sale

Current architecture:

```text
Order
-> Payment
-> Fulfillment
-> Commercial completion
```

Future fiscal architecture:

```text
Eligible fiscal trigger
-> Tax calculation snapshot
-> FiscalAuthorization validation
-> FiscalDocument sequence allocation
-> FiscalDocument issued
-> immutable audit
```

No fiscal document is issued until authorization/config validation passes.

### Case B — Sale with effective discount

Verified SAR principle: effective discounts recorded on the fiscal receipt are excluded from the taxable base.

Required MR behavior:

- keep line gross amount;
- keep discount snapshot;
- calculate taxable base via effective TaxRule;
- preserve discount on fiscal snapshot;
- never recalculate an old fiscal document from a later Product price.

### Case C — Order cancelled before fiscal issuance

No fiscal document should be invented merely because an Order existed.

Commercial cancellation and fiscal issuance are separate domains.

### Case D — Fiscal document created with an error

Do not delete or overwrite it.

The architecture must support an annulled/voided fiscal status and immutable audit according to the approved fiscal workflow.

### Case E — Customer return after fiscal issuance

Do not edit the original invoice.

A return/refund workflow must determine whether the applicable complementary fiscal document is a Credit Note or another legally appropriate document under the confirmed business regime.

Inventory inspection remains separate from fiscal adjustment.

### Case F — Exchange

Treat as two auditable commercial effects:

- return/adjustment of original sale as legally applicable;
- new outbound sale/replacement as applicable.

Do not mutate the historical original transaction to make the exchange “look” like the original item was never sold.

## 7. Architecture recommendation

### TaxCategory

A stable business classification, not a raw percentage.

Proposed fields:

- id
- code
- name
- jurisdiction
- status

Examples are created only after accountant/SAR validation.

### TaxRule

Proposed fields:

- id
- tax_category_id
- jurisdiction = HN
- rate_basis_points
- effective_from
- effective_to
- rule_source
- status

The rate must be effective-dated.

### Product tax assignment

Product/Variant references TaxCategory.

Do not store only `isv_rate = 0.15` on the product.

### Order tax snapshot

At authoritative checkout/order pricing time, snapshot:

- taxable base;
- tax category;
- applied rate;
- tax amount;
- rule/version/source reference.

Historical Orders never recalculate automatically when a later TaxRule changes.

### FiscalAuthorization

Proposed fields:

- id
- issuer organization
- fiscal document type
- CAI
- establishment
- point_of_issue
- authorized_range_start
- authorized_range_end
- next_correlative
- valid_from if applicable
- valid_until / Fecha Límite de Emisión
- status
- source evidence metadata

Secrets/identifiers requiring restricted handling must be stored in protected server configuration/database, not public frontend assets or Git.

### FiscalDocument

Separate aggregate:

- id
- order_id
- document_type
- status
- authorization_id
- document_number
- issued_at
- currency
- subtotal snapshot
- discount snapshot
- taxable-base snapshot
- tax snapshot
- grand-total snapshot
- customer fiscal identity snapshot when required
- rendered artifact reference
- provider reference
- audit metadata

Suggested states:

- DRAFT
- RESERVED_NUMBER
- ISSUED
- ANNULLED
- REPLACED where legally appropriate

Final state model requires review against the confirmed issuing method.

### FiscalDocumentSequence

Must be concurrency-safe.

Properties:

- allocated only server-side;
- serialized transaction/row lock;
- cannot allocate outside authorized range;
- cannot issue after authorization expiry;
- unique full document number;
- never reused after issuance/annulment unless the approved legal procedure explicitly permits it.

### FiscalProvider interface

```text
validateAuthorization()
reserveNumber()
issueDocument()
annulDocument()
issueComplementaryDocument()
validateDocument()
```

Possible implementations:

- existing accounting/POS provider adapter;
- internal self-printer flow if legally/operationally confirmed;
- future official electronic integration if SAR publishes/requires one and MR qualifies.

## 8. Production safety rules

FISC-HN-001 — Client/browser never calculates authoritative tax.  
FISC-HN-002 — Client/browser never generates fiscal numbers.  
FISC-HN-003 — MR never fabricates a CAI.  
FISC-HN-004 — MR never issues outside an authorized range.  
FISC-HN-005 — MR never issues after a known authorization expiration.  
FISC-HN-006 — Fiscal documents are immutable historical records after issuance.  
FISC-HN-007 — Errors are handled through an approved annulment/correction workflow, not deletion.  
FISC-HN-008 — Product tax rules are configurable/effective-dated.  
FISC-HN-009 — Order, Payment, Fulfillment and FiscalDocument remain separate domains.  
FISC-HN-010 — Returns do not rewrite original fiscal history.  
FISC-HN-011 — No “SAR API” adapter is implemented without an official supported contract.  
FISC-HN-012 — Production fiscal issuance fails closed if required authorization data is missing/invalid.  
FISC-HN-013 — Taxpayer/CAI operational secrets are server-side only.  
FISC-HN-014 — Every manual fiscal action is role-restricted and audited.

## 9. Implementation gate status

### Green — architecture work may proceed

- domain model;
- interfaces;
- validation rules;
- test fixtures with explicitly fake test authorizations;
- secure configuration design;
- operational questionnaire;
- migration plan.

### Red — production behavior remains blocked

Do not enable:

- actual invoice numbering;
- actual CAI rendering;
- production ISV rates by product;
- production fiscal issuance;
- automated credit-note issuance;
- any SAR/provider transmission.

until the business-side evidence in Section 5 is verified.

## 10. Definition of validated readiness

Fiscal implementation can move from DESIGN to IMPLEMENTATION only when:

1. issuer identity and RTN are confirmed;
2. current SAR obligations/regime are confirmed;
3. active Facturación authorization method is confirmed;
4. active CAI/range/expiration/establishment/point-of-issue are verified;
5. current sequence owner/last-used number is reconciled;
6. product tax categories are signed off by qualified accounting/tax support;
7. sale, discount, cancellation, return and exchange treatment is approved;
8. exact fiscal document required fields are mapped from the current applicable regulation/document type;
9. an operations owner is assigned for authorization renewal/range exhaustion;
10. production tests use non-production/fake authorization fixtures and no live fiscal numbers are consumed accidentally.

## 11. Current decision for MR עדולם

**Status: fiscal architecture approved for specification; production fiscal issuance NOT YET APPROVED.**

This protects MR from turning market-research assumptions into tax behavior while preserving a clean path to Honduras-native fiscal compliance.

