# SPEC — Module 14: Operational Health Desk v1

**Project:** MR עדולם
**Status:** PROPOSED FOR APPROVAL
**Date:** 2026-10-08
**Method:** Spec-Driven Development (SDD)

## 1. Objective

Create a single operational surface for detecting and managing system and commerce exceptions that require human attention.

The Health Desk is not a replacement for Railway observability, logs or tracing. It translates technical and business signals into actionable operational status for MR staff.

## 2. Initial signal domains

- service health / readiness;
- failed or delayed webhooks;
- queue backlog;
- reservation expiry backlog;
- stuck orders;
- payment verification backlog;
- fulfillment backlog;
- failed delivery exceptions;
- integration failures;
- fiscal / CAI operational threshold alerts once M05 provides verified data;
- object-storage or media pipeline failures;
- scheduled job failures.

## 3. Domain boundary

Inputs may come from:

- Railway service health;
- application metrics;
- M02 reservations/orders;
- M03 payments;
- M04 fulfillment;
- M05 fiscal state;
- internal job queues;
- webhook receivers;
- integration adapters.

M14 owns:

HealthSignal
→ OperationalIncident
→ acknowledgement
→ assignment
→ resolution / closure

M14 does not own the business aggregates it observes.

## 4. HealthSignal

Fields:

- id UUID
- source_type
- source_id
- signal_type
- status
- severity
- observed_value nullable
- threshold_value nullable
- unit nullable
- message
- first_seen_at
- last_seen_at
- last_healthy_at nullable
- correlation_key nullable
- metadata_json sanitized
- active boolean

Status:

- HEALTHY
- DEGRADED
- DOWN
- UNKNOWN

Severity:

- INFO
- WARNING
- CRITICAL

No signal metadata may contain secrets, passwords, tokens or raw financial credentials.

## 5. OperationalIncident

Fields:

- id UUID
- incident_number unique
- incident_type
- severity
- status
- title
- summary
- source_signal_id nullable
- related_entity_type nullable
- related_entity_id nullable
- assigned_user_id nullable
- acknowledged_by_user_id nullable
- resolved_by_user_id nullable
- created_at
- acknowledged_at nullable
- resolved_at nullable
- resolution_code nullable
- resolution_notes nullable

Status:

- OPEN
- ACKNOWLEDGED
- INVESTIGATING
- RESOLVED
- CLOSED
- SUPPRESSED

## 6. Initial alert examples

### Reservations

- expired reservations not released within tolerance;
- reservation count inconsistent with inventory.reserved;
- repeated reservation release failures.

### Orders

- order remains in an operational state longer than configured threshold;
- paid order without fulfillment progression;
- order with inventory conflict.

### Payments

- bank transfers awaiting verification beyond SLA;
- provider webhook retry exhaustion;
- duplicate/idempotency conflict spike.

### Fulfillment

- READY_FOR_PACKING backlog;
- shipment with no carrier update beyond threshold;
- failed delivery requiring action;
- COD collected but not reconciled when that capability exists.

### Fiscal

Only after M05 provides validated production data:

- CAI/range nearing configured exhaustion;
- CAI/range nearing expiry;
- fiscal document generation failures.

M14 must not invent or infer fiscal legality.

## 7. Webhook monitoring

For each webhook integration, track:

- provider / adapter;
- event type;
- received_at;
- processing status;
- retry_count;
- last_error_code sanitized;
- next_retry_at nullable;
- idempotency key/hash reference;
- linked business entity.

Repeated failure beyond policy may open an OperationalIncident.

Raw signed payloads must follow adapter-specific retention/security policy.

## 8. Queue monitoring

Queue-like workloads should expose:

- pending count;
- oldest pending age;
- processing count;
- failed count;
- retry count;
- throughput;
- last successful execution.

Thresholds are configuration.

## 9. Automated remediation boundary

v1 may:

- surface recommended actions;
- provide safe links into the correct Control Center module;
- support acknowledgement and resolution recording.

v1 must not automatically execute destructive remediation such as deleting reservations, altering stock, marking payments paid, issuing refunds or changing fiscal ranges.

Any future remediation action requires explicit permission, idempotency, audit and governing module rules.

## 10. Permissions

Suggested M06 permissions:

- health.read
- health.incidents.manage
- health.incidents.assign
- health.incidents.resolve
- health.admin

Sensitive diagnostics may require elevated roles.

## 11. UX requirements

The Control Center Health Desk should provide:

- overall status;
- critical incidents first;
- filter by domain/severity/status;
- age / SLA visibility;
- related entity link;
- responsible owner;
- recent history;
- clear distinction between technical failure and business backlog.

Avoid alert fatigue:

- deduplicate by correlation key;
- group repeated identical failures;
- allow bounded suppression with reason and expiry;
- auto-resolve only when a deterministic healthy condition is observed.

## 12. Audit

Audit incident acknowledgement, assignment, suppression, resolution, manual reopen and threshold/config changes.

## 13. Functional requirements

- FR-HLT-001 Ingest normalized health signals.
- FR-HLT-002 Open incidents from threshold/rule conditions.
- FR-HLT-003 Deduplicate repeated signals.
- FR-HLT-004 Support assignment and acknowledgement.
- FR-HLT-005 Link incidents to business entities.
- FR-HLT-006 Expose queue/backlog age.
- FR-HLT-007 Monitor webhook processing failures.
- FR-HLT-008 Support fiscal alerts only from validated M05 state.
- FR-HLT-009 Keep secrets out of diagnostics.
- FR-HLT-010 Preserve audit history.
- FR-HLT-011 Avoid destructive automatic remediation in v1.

## 14. Acceptance criteria

1. Staff can identify the highest-severity active incident from one screen.
2. Repeated identical failures do not flood the queue.
3. A reservation backlog can be distinguished from a service outage.
4. Payment verification backlog can be surfaced without changing payment status.
5. Webhook failures show retry state without exposing secrets.
6. Fiscal alerts are disabled or UNKNOWN when authoritative fiscal data is unavailable.
7. Resolution records actor, timestamp and notes.
8. No Health Desk action bypasses M01-M09 business invariants.
