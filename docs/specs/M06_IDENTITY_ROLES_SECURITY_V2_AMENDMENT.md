# SPEC — Module 06: Identity, Roles & Security v2 Amendment

**Project:** MR עדולם
**Status:** PROPOSED FOR APPROVAL
**Date:** 2026-10-08
**Base specification:** M06_IDENTITY_ROLES_SECURITY_V1.md
**Roadmap:** STRATEGIC_BASELINE_HONDURAS_V2.md
**Dependencies:** M11, M12, M13, M14, M15

## 1. Purpose

Amend M06 so the identity and authorization boundary can govern the new operational and hybrid-commerce capabilities introduced by the consolidated project knowledge and M11–M15.

M06 v1 remains authoritative except where explicitly extended below.

This amendment does not create new business logic for settlements, shrinkage, commissions, incidents or credit. It defines who may perform sensitive actions and how those actions remain attributable and auditable.

## 2. Verified implementation baseline — 2026-10-08

The catalog-api already implements a real RBAC foundation, including:

- StaffUser/session persistence;
- permission records;
- role bundles;
- user-role assignments;
- location scope;
- audit events;
- requireStaffPermission / internal authorization helpers;
- existing permissions for catalog, inventory, orders, payments, fulfillment, customers, suppliers, procurement, returns, reports, users, roles, audit and settings.

Current production code seeds role bundles for:

- ADMIN;
- MANAGER;
- CASHIER;
- INVENTORY_OPERATOR;
- FULFILLMENT_OPERATOR;
- CUSTOMER_SUPPORT;
- ANALYST.

Therefore M06 v2 is an additive permission/policy extension over an implemented authorization system, not a new identity subsystem.

## 3. Security principles added

Add the following principles:

13. Approval-sensitive workflows must distinguish request, approval and posting/payment confirmation permissions.
14. High-risk actions may require segregation of duties even when one user technically holds multiple roles.
15. A role bundle never overrides an explicit policy prohibition such as self-approval.
16. External seller/provider identities are not automatically StaffUser identities.
17. Staff may support an external credit application but cannot fabricate or override provider approval.
18. Health/diagnostic access must not expose secrets or unnecessary sensitive customer/provider data.
19. Permission expansion must remain default-deny.
20. Human actions performed through the Control Center must resolve to a StaffUser actor after the M06 migration is active.

## 4. New permission families

### Sellers and commercial agreements

- sellers.read
- sellers.manage
- seller_agreements.read
- seller_agreements.manage

### Seller settlements

- settlements.read
- settlements.calculate
- settlements.approve
- settlements.mark_paid
- settlements.adjust

### Inventory adjustments and shrinkage

- inventory_adjustments.read
- inventory_adjustments.create
- inventory_adjustments.submit
- inventory_adjustments.approve
- inventory_adjustments.post
- inventory_adjustments.audit
- inventory_adjustments.evidence.read

### Staff commissions

- commissions.read_own
- commissions.read_all
- commissions.rules.manage
- commissions.calculate
- commissions.adjust
- commissions.approve
- commissions.mark_paid

### Operational Health Desk

- health.read
- health.incidents.manage
- health.incidents.assign
- health.incidents.resolve
- health.admin

### Credit-provider integrations

- credit.read
- credit.providers.manage
- credit.applications.read
- credit.applications.support

These permissions are additive to the M06 v1 vocabulary.

## 5. Approval-capability separation

The following capabilities must remain distinct:

### Inventory adjustment

create / submit
→ approve
→ post

A policy may prohibit the same StaffUser from approving their own request.

### Seller settlement

calculate
→ approve
→ mark_paid

A statement cannot be marked paid unless already approved.

mark_paid is operational confirmation only; it does not authorize bank-ledger mutation.

### Staff commission statement

calculate / adjust
→ approve
→ mark_paid

Approval and payment confirmation remain separate.

### Commercial agreement

manage
→ approval state governed by M11 workflow

Possessing seller_agreements.manage does not imply the user may bypass any M11 approval state machine.

## 6. Segregation-of-duties policy

Introduce a policy layer independent from role bundles.

Suggested policy evaluation inputs:

- actor user id;
- requested permission;
- resource type/id;
- resource creator/requester;
- risk level;
- value/quantity thresholds;
- location scope;
- workflow status;
- prior approver(s).

Example prohibitions:

- requester cannot approve HIGH/CRITICAL inventory adjustment;
- user cannot both calculate and approve settlement where configured four-eyes policy applies;
- user cannot approve their own manual commission adjustment when policy requires review;
- credit support user cannot set provider decision to APPROVED;
- Health Desk user cannot use incident permissions to mutate inventory/payment/fiscal state directly.

Thresholds are configuration and business policy, not hardcoded in this amendment.

## 7. Step-up / MFA candidates expanded

In addition to M06 v1 candidates, step-up authentication may be required for:

- settlements.approve;
- settlements.mark_paid;
- settlements.adjust;
- inventory_adjustments.approve for HIGH/CRITICAL risk;
- inventory_adjustments.post above configured thresholds;
- commissions.rules.manage;
- commissions.adjust;
- commissions.approve;
- commissions.mark_paid;
- credit.providers.manage;
- health.admin;
- seller_agreements.manage when changing economic liability/commission terms.

Step-up policy can be activated later without changing permission names.

## 8. Role-bundle guidance

Roles remain convenience bundles. The exact production mapping must be approved as operating policy.

### ADMIN

All permissions, subject to explicit segregation-of-duties policy where configured.

### MANAGER

May include:

- sellers.read/manage;
- seller_agreements.read/manage;
- settlements.read/calculate/approve;
- inventory_adjustments full operational lifecycle except restricted high-risk self-approval;
- commissions.read_all/calculate/approve;
- health.read/incidents.manage/assign/resolve;
- credit.read/applications.read/support.

### INVENTORY_OPERATOR

May include:

- inventory_adjustments.read/create/submit;
- inventory_adjustments.evidence.read;
- no approval/post by default unless explicitly granted.

### CUSTOMER_SUPPORT

May include:

- health.read where operationally useful;
- credit.read/applications.read/support;
- no provider management;
- no settlement/commission approval.

### ANALYST

May receive aggregated reporting only.

Direct access to private seller agreements, staff compensation, credit application details or sensitive incident metadata is not implied by reports.read.

### FINANCE role — optional future bundle

A dedicated FINANCE role may be introduced if operations justify it.

Potential permissions:

- payments.read;
- settlements.read/calculate/mark_paid;
- commissions.read_all/mark_paid;
- audit.read.

Creation of this role is optional and requires explicit operational approval. This amendment does not require it.

## 9. External identities

### Seller / provider identity

M11 SellerAccount is a commercial party, not a StaffUser.

A future seller portal may introduce a separate external identity model or explicit linked identity.

Do not grant StaffUser permissions to a SellerAccount simply because they reference the same organization/person.

### Credit provider

External providers authenticate through adapter-specific machine credentials/callback validation.

Provider callbacks are SERVICE actors, not StaffUser actors.

### LIRA

LIRA identity remains independent as defined in M06 v1.

## 10. Resource and location scoping

New permissions must support resource/location scope where meaningful.

Examples:

- inventory adjustment create/approve/post may be location-scoped;
- seller settlement may be globally scoped or seller-scoped in a future policy layer;
- Health Desk incidents may reference a location or global service;
- commissions.read_own is inherently user-scoped;
- credit application support may require customer-support scope rather than inventory location.

The authorization engine may extend the conceptual contract:

authorize(actor, permission, { locationId?, resourceType?, resourceId?, ownerUserId?, riskLevel? })

Resource-specific policy may impose restrictions beyond role permission.

## 11. Audit events added

At minimum, audit:

### M11

- seller.created
- seller.status_changed
- seller_agreement.created
- seller_agreement.approved
- seller_agreement.changed
- settlement.calculated
- settlement.approved
- settlement.adjusted
- settlement.marked_paid

### M12

- inventory_adjustment.created
- inventory_adjustment.submitted
- inventory_adjustment.approved
- inventory_adjustment.rejected
- inventory_adjustment.posted
- inventory_adjustment.evidence_added

### M13

- commission_rule.created
- commission_rule.approved
- commission_accrual.created
- commission_accrual.reversed
- commission.adjusted
- commission_statement.approved
- commission_statement.marked_paid

### M14

- health_incident.acknowledged
- health_incident.assigned
- health_incident.suppressed
- health_incident.resolved
- health_config.changed

### M15

- credit_provider.created
- credit_provider.changed
- credit_application.support_accessed
- credit_callback.accepted
- credit_callback.rejected

Audit metadata must follow M06 v1 redaction rules.

## 12. Sensitive-data rules

Do not place in audit/logs:

- seller bank credentials;
- private payout credentials;
- full credit underwriting data;
- provider passwords/tokens;
- raw session tokens;
- full payment credentials;
- unnecessary customer PII;
- raw sensitive evidence from M12.

Audit may retain identifiers, statuses, reason codes, sanitized amounts and references as needed for traceability.

## 13. Control Center requirements

The Control Center must derive action visibility from effective permissions but still rely on server-side authorization.

Examples:

- hide Approve adjustment unless inventory_adjustments.approve;
- hide Mark paid unless settlements.mark_paid or commissions.mark_paid as applicable;
- show own commission statement with commissions.read_own;
- show all commission statements only with commissions.read_all;
- show provider configuration only with credit.providers.manage;
- show Health Desk administrative settings only with health.admin.

UI visibility is not authorization.

## 14. Service-account transition

The shared internal service credential may continue for trusted machine calls during migration, as defined in M06 v1.

However:

- it must not be used to represent a manager approving a settlement;
- it must not represent a supervisor approving shrinkage;
- it must not represent staff commission approval;
- it must not represent manual credit support decisions.

Human approval events require StaffUser attribution after the relevant workflow is activated.

## 15. Functional requirements added

- FR-SEC-016 Add permission vocabulary required by M11–M15.
- FR-SEC-017 Support workflow-specific segregation-of-duties policies.
- FR-SEC-018 Keep request/approve/post or calculate/approve/pay capabilities distinct.
- FR-SEC-019 Preserve StaffUser actor attribution for sensitive workflows.
- FR-SEC-020 Keep seller/provider external identities separate from staff identity.
- FR-SEC-021 Prevent staff from overriding external credit-provider approval.
- FR-SEC-022 Protect private seller, commission, credit and incident data by explicit permission.
- FR-SEC-023 Support resource/risk-aware authorization context.
- FR-SEC-024 Audit all sensitive M11–M15 lifecycle transitions.
- FR-SEC-025 Allow future MFA/step-up policies without renaming permissions.

## 16. Invariants added

SEC-016 — SellerAccount is not implicitly a StaffUser.
SEC-017 — CreditProvider/service callback identity is not a StaffUser.
SEC-018 — Provider credit approval cannot be fabricated by staff.
SEC-019 — An approval workflow may reject self-approval despite the actor holding the nominal permission.
SEC-020 — Mark-paid permission does not grant authority to mutate an external bank ledger.
SEC-021 — Health Desk permissions do not authorize business-state mutation in observed modules.
SEC-022 — commissions.read_own never permits viewing another user's statement.
SEC-023 — Private seller economics require explicit seller/settlement permissions.
SEC-024 — Sensitive evidence access requires explicit permission.
SEC-025 — Human approval events are attributable to StaffUser after workflow activation.

## 17. Acceptance criteria added

1. Permission seed is idempotent with the expanded vocabulary.
2. A user lacking settlements.approve cannot approve a settlement.
3. A user with settlements.approve may still be blocked from self-approval by policy.
4. Inventory operator can submit an adjustment without automatically gaining approval rights.
5. commissions.read_own cannot read another StaffUser's commission statement.
6. Customer Support cannot change a credit-provider decision to APPROVED.
7. Health Desk operator cannot mutate Payment or Inventory through incident permissions alone.
8. SellerAccount cannot authenticate as StaffUser without a separately approved identity link.
9. Sensitive M11–M15 actions generate audit events with StaffUser/SERVICE/SYSTEM actor type as appropriate.
10. Existing M06 v1 authentication/session/CSRF tests remain valid.

## 18. Migration / implementation gate

Before implementation:

- inspect current permission/role seed in production code;
- compare existing Control Center authorization behavior with M06 v1;
- add permissions through idempotent migrations/seeds;
- define approved initial role bundles;
- define first segregation-of-duties policies;
- add authorization tests for every new mutation endpoint;
- preserve current service credentials only for machine flows;
- do not expose proposed permissions in UI until the governing module endpoint exists.

This amendment authorizes the security/authorization direction only. It does not itself activate M11–M15 workflows.
