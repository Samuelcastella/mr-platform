# Assortment Decision Log v1

**Status:** implementation spec  
**Date:** 2026-10-08  
**Dependency:** Product Intelligence v1

## Purpose

Provide a manual, auditable decision register for assortment strategy.

The log exists to record a human decision after reviewing sales, demand, return, inventory, supplier or market evidence. It is not an automation engine.

## Targets

A decision targets exactly one of:

- `PRODUCT` — an existing product record;
- `CATEGORY` — a named category or assortment area.

## Directions

- `WATCH` — continue observing;
- `SOURCE_SUPPLIER` — investigate supplier options;
- `EVALUATE_DIRECT_BUY` — evaluate buying/owning inventory directly;
- `PRIVATE_LABEL_CANDIDATE` — investigate whether the opportunity merits private-label development;
- `HOLD` — intentionally pause;
- `DECLINED` — explicitly reject the direction for now.

These values describe a strategic direction only. They do not create downstream transactions.

## Lifecycle

- `OPEN`
- `VALIDATED`
- `DISMISSED`
- `ARCHIVED`

`ARCHIVED` is terminal in v1.

A `VALIDATED` decision means the team has validated the decision record. It does **not** mean a supplier was contracted, inventory was bought, a brand was launched, or any economic policy was activated.

## Required evidence

Every decision requires:

- target;
- direction;
- priority 0–3;
- rationale of at least 8 characters;
- actor and timestamp.

Optional:

- evidence/reference text;
- responsible StaffUser.

## Security

Permissions:

- `assortment.decisions.read`
- `assortment.decisions.manage`

Analyst receives read access only.

Manager/Admin may create and update decision records.

All mutations require authenticated StaffUser CSRF protection or an authorized internal service.

## Audit

Every create/update writes:

1. current decision row;
2. append-only `assortment_decision_history`;
3. common `audit_events`.

The API returns `automatedActionsTriggered:false`.

## Explicit non-effects

Creating, validating, dismissing or archiving a decision must not automatically:

- create or approve a PurchaseOrder;
- create an InventorySource;
- change inventory quantity/reservations;
- change Product.status, Product.brand or catalog publication;
- create or modify SellerAgreement;
- create SettlementLine / SettlementStatement;
- create CommissionAccrual / CommissionStatement;
- create payout/payroll records;
- change fiscal configuration;
- launch a private-label product.

Any later workflow that implements one of those actions requires its own explicit governed operation.

## Endpoints

### List

`GET /v1/internal/assortment-decisions`

Optional filters:

- `status`
- `direction`
- `targetType`

### Create

`POST /v1/internal/assortment-decisions`

Example product decision:

```json
{
  "targetType": "PRODUCT",
  "productId": 123,
  "direction": "WATCH",
  "priority": 1,
  "rationale": "Strong completed units with low returns; observe two more cycles.",
  "evidenceReference": "Product Intelligence 90d"
}
```

### Detail + history

`GET /v1/internal/assortment-decisions/:id`

### Update

`PATCH /v1/internal/assortment-decisions/:id`

Updates may change direction, lifecycle status, priority, rationale, evidence reference or owner. History is appended; prior history is not rewritten.

## Control Center

The Control Center exposes:

- a `Decisiones` navigation entry;
- a read-only list for Analyst;
- create/edit forms for users with manage permission;
- direct “Registrar decisión” links from Product Intelligence product/category cards.

No execution button for procurement, publication, seller settlement or private label is included in v1.
