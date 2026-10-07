# SPEC — Module 06: Identity, Roles & Security v1

**Project:** MR עדולם  
**Status:** APPROVED FOR IMPLEMENTATION  
**Date:** 2026-10-07  
**Issue:** #25  
**Method:** Spec-Driven Development (SDD)  
**Dependencies:** M01–M05

## 1. Objective

Introduce a real identity and authorization boundary for MR עדולם staff operations without forcing customer accounts and without coupling MR identity to LIRA.

The current shared internal token remains only as a transitional machine/service credential. It is not accepted as the long-term identity of a human operator.

## 2. Identity boundaries

### User / StaffUser

Authentication principal for internal MR operators.

Examples:

- administrator;
- manager;
- cashier;
- inventory operator;
- fulfillment operator;
- customer support.

### Customer

Commercial customer profile. A customer may place a guest order without a User account.

### Service identity

Machine-to-machine credential used by trusted services and controlled migration paths.

### LIRA

LIRA identity remains independent. MR does not share user/session tables, secrets or authentication databases with LIRA.

## 3. Security principles

1. Default deny.
2. Authorization is evaluated server-side.
3. Hiding a button is UX, not security.
4. Passwords are never stored or logged in plaintext.
5. Session credentials are revocable.
6. Staff actions are auditable.
7. Human identity is separate from shared service credentials.
8. Permissions are explicit capabilities, not only hardcoded role names.
9. Roles may be scoped globally or to a Location.
10. Customer checkout remains possible without registration.
11. Sensitive actions support future step-up/MFA.
12. Secrets stay in server-side environment/secret management.

## 4. StaffUser

Fields:

- id
- email_normalized
- display_name
- password_hash
- status
- mfa_required
- email_verified_at nullable
- last_login_at nullable
- created_at
- updated_at

Statuses:

- INVITED
- ACTIVE
- LOCKED
- DISABLED

Rules:

- email is normalized and unique;
- password hash uses Argon2id;
- disabled users cannot authenticate;
- disabling a user revokes active sessions;
- password hash never appears in API output.

## 5. Sessions

StaffSession fields:

- id
- user_id
- token_hash
- csrf_hash
- status
- created_at
- expires_at
- last_seen_at
- revoked_at nullable
- user_agent_hash nullable
- ip_hash nullable

Statuses:

- ACTIVE
- REVOKED
- EXPIRED

Browser session:

- opaque random token;
- only the SHA-256 hash is stored server-side;
- cookie is HttpOnly;
- cookie is Secure in production;
- SameSite=Strict;
- mutation requests using cookie auth require CSRF token;
- logout revokes session server-side and clears cookie.

Initial absolute lifetime: configurable; default 8 hours.

## 6. Roles

Initial roles:

- ADMIN
- MANAGER
- CASHIER
- INVENTORY_OPERATOR
- FULFILLMENT_OPERATOR
- CUSTOMER_SUPPORT
- ANALYST

Role names are convenience bundles. Authorization is permission-based.

## 7. Permissions

Initial permission vocabulary:

### Catalog

- catalog.read
- catalog.write
- catalog.publish

### Inventory

- inventory.read
- inventory.receive
- inventory.adjust
- inventory.transfer

### Orders

- orders.read
- orders.create
- orders.confirm
- orders.cancel

### Payments

- payments.read
- payments.confirm_manual
- payments.refund

### Fulfillment

- fulfillment.read
- fulfillment.prepare
- fulfillment.dispatch
- fulfillment.deliver

### Customers / support

- customers.read
- customers.write
- inquiries.read
- inquiries.write

### Administration

- reports.read
- users.manage
- roles.manage
- audit.read
- settings.manage

## 8. Role assignments and location scope

RoleAssignment:

- id
- user_id
- role_id
- scope_type
- scope_location_id nullable
- created_at
- created_by_user_id nullable

Scope types:

- GLOBAL
- LOCATION

Authorization helper conceptual contract:

```text
authorize(actor, permission, { locationId?, resource? })
```

If assignment is LOCATION scoped, it only satisfies a permission for that Location.

v1 schema includes location scope even if the first admin is global.

## 9. Seed policy

Seed operations are idempotent:

- permission definitions;
- role definitions;
- role-permission mapping.

Recommended initial bundles:

### ADMIN

All permissions.

### MANAGER

All operational permissions except users.manage / roles.manage by default.

### CASHIER

- catalog.read
- inventory.read
- orders.read/create/confirm
- payments.read
- payments.confirm_manual
- customers.read/write

### INVENTORY_OPERATOR

- catalog.read
- inventory.read/receive/adjust/transfer

### FULFILLMENT_OPERATOR

- orders.read
- payments.read
- fulfillment.read/prepare/dispatch/deliver
- inventory.read

### CUSTOMER_SUPPORT

- orders.read
- payments.read
- fulfillment.read
- customers.read/write
- inquiries.read/write

### ANALYST

Read/report permissions only.

## 10. Bootstrap

MR needs a safe first-admin path without committing credentials.

Endpoint:

`POST /v1/security/bootstrap`

Rules:

- requires valid machine credential `x-internal-key`;
- only works when no StaffUser exists;
- creates exactly one ACTIVE ADMIN;
- accepts email, display name and password;
- password minimum 12 characters;
- password is hashed with Argon2id;
- emits audit event;
- subsequent bootstrap attempts return 409;
- request/response never includes password hash.

This endpoint is transitional and may be disabled after initial setup.

## 11. Authentication

### Login

`POST /v1/auth/login`

Input:

- email
- password

Flow:

1. normalize email;
2. enforce rate limit;
3. load StaffUser;
4. reject inactive/disabled/locked;
5. verify Argon2id hash;
6. create opaque StaffSession;
7. update last_login_at;
8. emit AuthenticationSucceeded audit/security event;
9. return user projection + CSRF token;
10. set secure session cookie.

Invalid credentials return generic error and do not reveal whether the user exists.

### Logout

`POST /v1/auth/logout`

- requires active session;
- requires CSRF;
- revokes server session;
- clears cookie.

### Me

`GET /v1/auth/me`

Returns:

- user id;
- display name;
- status;
- roles/scopes;
- effective permissions.

Never returns password/session hashes.

## 12. CSRF

Cookie-authenticated state-changing operations require:

- valid StaffSession cookie;
- `x-csrf-token`;
- hash comparison against server session CSRF hash.

GET/HEAD do not require CSRF but still require authorization where protected.

## 13. Service authentication transition

Current `x-internal-key` is retained for:

- bootstrap;
- CI/integration automation;
- trusted machine-to-machine calls during migration.

It must not be presented in the UI as the identity of a human operator.

Long-term service accounts/API keys will use scoped credentials and rotation.

## 14. Audit

AuditEvent:

- id
- actor_type
- actor_user_id nullable
- actor_service nullable
- action
- resource_type nullable
- resource_id nullable
- location_id nullable
- outcome
- reason nullable
- correlation_id nullable
- metadata sanitized JSON
- occurred_at

Actor types:

- USER
- SERVICE
- SYSTEM

Critical events include:

- bootstrap admin;
- login success/failure;
- session revoked;
- user disabled/enabled;
- role assigned/revoked;
- manual payment confirmation;
- refund;
- cancellation;
- inventory adjustment;
- delivery/COD reconciliation;
- fiscal configuration later.

Audit records must not contain passwords, session tokens, API secrets, CVV/PIN/OTP, or raw authorization secrets.

## 15. Sensitive action policy

Future step-up/MFA candidates:

- users.manage;
- roles.manage;
- manual payment confirmation;
- refunds;
- fiscal authorization changes;
- large inventory adjustments;
- secret rotation;
- sensitive exports.

MFA is modeled now but not required to block v1 deployment unless configured.

## 16. Security controls

### API

- no stack traces to clients;
- strict input size limits;
- parameterized SQL;
- rate limiting on authentication;
- generic authentication failures;
- no secrets in logs;
- correlation IDs for sensitive actions.

### Browser

- HttpOnly session cookie;
- Secure;
- SameSite=Strict;
- CSRF token for mutations;
- CSP / frame denial / nosniff / referrer policy;
- no session credential in localStorage.

### Credentials

- passwords: Argon2id;
- session/service tokens: cryptographically random;
- only token hashes stored;
- environment secrets never committed.

## 17. Threat model — v1 priority

High-priority threats:

- credential stuffing;
- brute-force login;
- session theft;
- CSRF;
- IDOR/BOLA;
- privilege escalation;
- location-scope bypass;
- shared-token misuse;
- secret leakage;
- malicious insider actions;
- audit tampering;
- disabled-user session persistence.

## 18. Migration strategy

Phase 1 — identity foundation:

- schema;
- bootstrap;
- login/logout/me;
- RBAC seed;
- session + CSRF;
- audit.

Phase 2 — protect staff APIs:

- introduce shared `requirePermission()`;
- migrate inquiry/order/payment/fulfillment/inventory admin mutations;
- preserve service credential only for machine calls.

Phase 3 — Control Center:

- replace standalone shared password session with Catalog API staff identity;
- map UI actions to permissions;
- support location scope.

Phase 4 — stronger auth:

- MFA / passkeys;
- service accounts;
- approval thresholds;
- anomaly detection.

## 19. Invariants

SEC-001 — Guest checkout does not require a StaffUser or Customer account.  
SEC-002 — Every human internal mutation is attributable to a StaffUser after migration.  
SEC-003 — Authorization is default-deny.  
SEC-004 — Disabled users cannot create or continue active sessions.  
SEC-005 — Session tokens are stored only as hashes server-side.  
SEC-006 — Passwords use Argon2id and never appear in logs/responses.  
SEC-007 — Cookie mutations require CSRF.  
SEC-008 — Location scope is enforced when a resource belongs to a Location.  
SEC-009 — Users cannot grant permissions beyond the policy allowed to their actor.  
SEC-010 — Service credential is not treated as human identity.  
SEC-011 — LIRA authentication remains independent.  
SEC-012 — Audit data is append-oriented and secrets are redacted.  
SEC-013 — Authentication failure does not disclose account existence.  
SEC-014 — Bootstrap is one-time.  
SEC-015 — Session revocation is server-side and immediate for subsequent requests.

## 20. Acceptance tests

- bootstrap first admin succeeds once;
- second bootstrap returns 409;
- password is stored as Argon2id hash;
- correct login succeeds;
- wrong password returns generic 401;
- disabled user login fails;
- session cookie is HttpOnly/SameSite/Secure in production;
- /auth/me requires valid session;
- logout revokes session;
- revoked session cannot be reused;
- expired session rejected;
- mutation without CSRF rejected;
- mutation with invalid CSRF rejected;
- role seed is idempotent;
- ADMIN receives all permissions;
- scoped assignment does not authorize another location;
- audit events created for bootstrap/login/logout;
- public product/order guest endpoints remain unaffected;
- LIRA is not referenced as an identity dependency.

## 21. Definition of Done

```text
Requirement
→ Threat
→ Control
→ Implementation
→ Automated Test
→ Evidence
```

M06 v1 is complete when identity foundation is merged with CI green and migration to permission-protected internal routes is explicitly scheduled.
