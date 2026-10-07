# MR עדולם — Honduras Fiscal Onboarding Checklist

**Status:** REQUIRED BEFORE M05 FISCAL PRODUCTION IMPLEMENTATION  
**Audience:** Store manager, accountant, legal/authorized representative, MR technical owner  
**Date:** 2026-10-07

## Purpose

Collect the minimum verified business-side evidence needed to configure Honduras fiscal behavior safely.

Do **not** paste real passwords, SAR credentials, API secrets or full sensitive authorization data into GitHub issues or chat. Sensitive evidence belongs in an approved secure channel/configuration store.

## A. Taxpayer identity

- [ ] Legal taxpayer / business name confirmed.
- [ ] RTN confirmed.
- [ ] Legal form confirmed:
  - [ ] Persona Natural
  - [ ] Comerciante Individual
  - [ ] Persona Jurídica
  - [ ] Other, documented
- [ ] Fiscal domicile confirmed.
- [ ] Registered establishment(s) relevant to MR operations identified.

## B. Current SAR obligations

Obtain a current obligation/profile confirmation from SAR/Office Virtual/accountant.

- [ ] Is the business currently registered for ISV?
- [ ] Which ISV regime applies?
  - [ ] General / monthly
  - [ ] Simplified
  - [ ] Other / special condition
- [ ] Is DMC required for this taxpayer?
- [ ] Any exemptions/exonerations/special certificates relevant to products?
- [ ] Accountant or qualified tax contact identified.

**Evidence date:** __________  
**Verified by:** __________

## C. Current Facturación setup

- [ ] Business is registered in SAR Facturación regime.
- [ ] Current fiscal document used for normal retail sales confirmed:
  - [ ] Factura
  - [ ] Ticket
  - [ ] Factura Prevalorada
  - [ ] Other: __________
- [ ] Current issuing method confirmed:
  - [ ] Imprenta
  - [ ] Auto Impresor
  - [ ] Existing POS/accounting platform
  - [ ] Other: __________

## D. Current authorization

Record in a secure system, not this Git file:

- [ ] CAI.
- [ ] Fecha Límite de Emisión.
- [ ] Establishment code.
- [ ] Point-of-issue code.
- [ ] Document type code.
- [ ] Authorized range start.
- [ ] Authorized range end.
- [ ] Last-used/current correlativo.
- [ ] Authorization status verified with current SAR tools/workflow.
- [ ] Existing sequence owner identified so MR will not allocate duplicate numbers.

## E. Product tax classification

Accountant/SAR-supported classification required for every active commercial group:

- [ ] Clothing.
- [ ] Underwear.
- [ ] Accessories.
- [ ] Cosmetics.
- [ ] Hygiene/personal-care.
- [ ] Second-hand merchandise.
- [ ] Future categories.
- [ ] Shipping/delivery charges.

For each group record separately in protected operational documentation:

- taxable / exempt / special;
- applicable rate if taxable;
- legal/source reference;
- effective date;
- reviewer/approver.

## F. Discounts

Confirm:

- [ ] How store discounts are represented on the fiscal document.
- [ ] How line discounts and order-level discounts are allocated.
- [ ] Whether promotional coupons are treated identically to effective discounts.
- [ ] Rounding method approved by accountant.

## G. Cancellations / errors

Confirm current operational procedure:

- [ ] Commercial cancellation before fiscal issuance.
- [ ] Fiscal document issued with an error.
- [ ] How “Anulado” documents are retained/audited.
- [ ] Who is authorized to annul/correct.
- [ ] What records must be retained and for how long under the applicable current rule.

## H. Returns and exchanges

Confirm:

- [ ] Return after an issued fiscal document.
- [ ] When a Nota de Crédito is required.
- [ ] Partial return.
- [ ] Full return.
- [ ] Exchange for different product/price.
- [ ] Refund by cash.
- [ ] Refund by transfer.
- [ ] COD return/rejection.
- [ ] Whether returned shipping is adjusted fiscally.

## I. Fiscal issuance trigger

Accountant/business must approve when the fiscal document is created for each flow:

| Commercial flow | Fiscal trigger confirmed? | Approved trigger |
|---|---|---|
| Cash in store | [ ] | __________ |
| Bank transfer | [ ] | __________ |
| COD | [ ] | __________ |
| Store pickup | [ ] | __________ |
| Local delivery | [ ] | __________ |
| Cancelled before fulfillment | [ ] | __________ |

## J. Operational ownership

- [ ] Person responsible for CAI/range renewal.
- [ ] Person responsible for sequence reconciliation.
- [ ] Person authorized for fiscal correction/annulment.
- [ ] Escalation contact if authorization expires or range is exhausted.
- [ ] Procedure for system outage/manual contingency confirmed.

## K. Technical handoff

Once sections A–J are complete:

1. Technical owner maps evidence to M05 configuration.
2. Product tax assignments are imported with effective dates.
3. FiscalAuthorization is configured securely.
4. Existing sequence is reconciled.
5. Test environment uses fake authorization/range only.
6. Production dry-run is reviewed without consuming a real number unless explicitly approved.
7. Production issuance is enabled through a controlled release.
8. First documents are independently checked against SAR/accountant expectations.

## Gate

**M05 implementation remains blocked until the required boxes are verified.**

The purpose is not to slow the project; it prevents a software deployment from creating invalid tax documents or corrupting an authorized fiscal sequence.
