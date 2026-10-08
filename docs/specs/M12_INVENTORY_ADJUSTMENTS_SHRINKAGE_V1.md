# SPEC — Module 12: Inventory Adjustments, Shrinkage & Approval v1

**Project:** MR עדולם
**Status:** PROPOSED FOR APPROVAL
**Date:** 2026-10-08
**Method:** Spec-Driven Development (SDD)

## 1. Objective

Formalize inventory adjustments that are currently represented generically in M01 so losses, count differences, damage and other shrinkage events cannot be posted as silent stock edits.

This module adds reason codes, evidence, approval workflow, segregation of duties, financial-impact metadata, immutable posting into M01 InventoryMovement and shrinkage analytics.

## 2. Domain boundary

M01 remains authoritative for Inventory and InventoryMovement.

M12 owns the workflow before an exceptional adjustment becomes an inventory movement:

InventoryAdjustmentRequest
→ approval / rejection
→ posting
→ InventoryMovement

M12 does not replace purchase receipts, sales consumption, order reservations, normal transfers or customer return disposition.

## 3. Core invariants

1. Inventory quantity is never changed directly by an adjustment workflow.
2. Every exceptional adjustment has a reason code.
3. Every POSTED adjustment produces immutable M01 InventoryMovement records.
4. A request can be posted at most once.
5. Approval rules are evaluated before posting.
6. High-risk adjustments support four-eyes approval.
7. The requester cannot approve their own adjustment when policy requires segregation.
8. Evidence cannot be silently deleted after approval.
9. Negative available stock remains prohibited unless M01 explicitly permits a controlled exception.

## 4. Reason codes

Initial vocabulary:

- COUNT_VARIANCE_NEGATIVE
- COUNT_VARIANCE_POSITIVE
- DAMAGE
- THEFT_SUSPECTED
- THEFT_CONFIRMED
- LOSS_IN_TRANSIT
- LOST_IN_STORE
- EXPIRED
- CONTAMINATED
- DESTRUCTION
- ADMIN_CORRECTION
- RECOVERY_FOUND
- OTHER

Reason codes may define whether evidence, supervisor approval, security review or seller-liability review is required.

## 5. InventoryAdjustmentRequest

Fields:

- id UUID
- request_number unique
- location_id
- status
- reason_code
- reason_text nullable
- requested_by_user_id
- requested_at
- submitted_at nullable
- approved_by_user_id nullable
- approved_at nullable
- rejected_by_user_id nullable
- rejected_at nullable
- rejection_reason nullable
- posted_by_user_id nullable
- posted_at nullable
- total_quantity_delta
- estimated_value_minor nullable
- currency nullable
- risk_level
- evidence_required boolean
- seller_liability_review_required boolean
- idempotency_key unique
- idempotency_hash

Status:

- DRAFT
- SUBMITTED
- APPROVED
- REJECTED
- POSTED
- CANCELLED

## 6. InventoryAdjustmentLine

Fields:

- id UUID
- adjustment_request_id
- variant_id
- location_id
- expected_quantity nullable
- counted_quantity nullable
- quantity_delta
- unit_cost_snapshot_minor nullable
- estimated_value_minor nullable
- notes nullable

Rules:

- quantity_delta cannot be zero;
- same variant/location appears once per request unless explicitly merged;
- cost snapshots are for impact reporting and do not rewrite historical procurement cost.

## 7. Evidence

AdjustmentEvidence fields:

- id UUID
- adjustment_request_id
- evidence_type
- object_reference
- captured_by_user_id
- captured_at
- description nullable
- checksum nullable

Evidence types may include PHOTO, VIDEO, DOCUMENT, COUNT_SHEET, COURIER_REPORT, POLICE_REPORT_REFERENCE and OTHER.

Sensitive evidence must use private object storage and signed access, not public URLs.

## 8. ApprovalPolicy

Policy inputs may include:

- reason_code;
- absolute quantity;
- estimated value;
- location;
- product category;
- repeated incidents;
- seller-owned inventory;
- requester role.

Outputs may require:

- no approval;
- supervisor approval;
- manager approval;
- security/audit review;
- two-person approval.

Threshold values are configuration, not hardcoded in this SPEC.

## 9. Risk levels

Initial enum:

- LOW
- MEDIUM
- HIGH
- CRITICAL

Risk may escalate automatically from policy.

## 10. Posting semantics

When an APPROVED request is posted:

1. lock affected inventory rows;
2. revalidate current quantities;
3. verify M01 invariants;
4. insert one immutable InventoryMovement per line;
5. map movement type to ADJUSTMENT, DAMAGE or LOSS as appropriate;
6. link movement reference to adjustment_request_id;
7. update inventory quantity transactionally;
8. mark request POSTED;
9. emit audit and analytics events;
10. commit atomically.

If revalidation fails, posting fails without partial stock changes.

## 11. Count variance

A physical count may create an adjustment request from expected quantity versus counted quantity.

The count itself does not change stock. Only a POSTED adjustment changes authoritative quantity.

Full cycle-count planning may be a later module.

## 12. Third-party inventory

If affected inventory is third-party owned:

- preserve seller / owner reference;
- mark whether liability review is required;
- do not automatically charge seller or MR;
- after approval, M11 may create a commercial settlement adjustment according to the active agreement.

## 13. Permissions

Suggested M06 permissions:

- inventory_adjustments.read
- inventory_adjustments.create
- inventory_adjustments.submit
- inventory_adjustments.approve
- inventory_adjustments.post
- inventory_adjustments.audit
- inventory_adjustments.evidence.read

## 14. Audit events

At minimum:

- AdjustmentDrafted
- AdjustmentSubmitted
- AdjustmentApproved
- AdjustmentRejected
- AdjustmentCancelled
- AdjustmentPosted
- AdjustmentEvidenceAdded
- AdjustmentPostingFailed

Audit includes actor, reason, linked request and relevant before/after values.

## 15. Analytics

Expose:

- shrinkage units;
- shrinkage value;
- shrinkage by reason;
- shrinkage by location;
- shrinkage by category;
- shrinkage by seller / owner;
- repeat incident rate;
- approval turnaround time;
- count variance rate.

## 16. Functional requirements

- FR-ADJ-001 Require reason code for exceptional stock changes.
- FR-ADJ-002 Support multi-line adjustment requests.
- FR-ADJ-003 Support policy-driven approval.
- FR-ADJ-004 Support evidence requirements.
- FR-ADJ-005 Post immutable M01 movements transactionally.
- FR-ADJ-006 Prevent duplicate posting.
- FR-ADJ-007 Support segregation of duties.
- FR-ADJ-008 Preserve third-party ownership context.
- FR-ADJ-009 Expose shrinkage analytics without exposing private evidence.
- FR-ADJ-010 Audit all lifecycle transitions.

## 17. Acceptance criteria

1. Direct stock editing is not required for any supported adjustment.
2. A posted request creates exactly one movement per line.
3. Retrying a post does not duplicate inventory impact.
4. A policy-required approval cannot be bypassed.
5. Evidence-required reasons cannot be approved without evidence.
6. High-risk self-approval is rejected when segregation policy applies.
7. Third-party-owned stock preserves owner context.
8. Shrinkage reports reconcile to posted inventory movements.
9. Rejected requests never modify inventory.
