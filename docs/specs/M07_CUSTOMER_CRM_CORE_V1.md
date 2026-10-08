# SPEC — Module 07: Customer & CRM Core v1

**Project:** MR עדולם  
**Status:** APPROVED FOR IMPLEMENTATION  
**Date:** 2026-10-08  
**Issue:** #30  
**Method:** Spec-Driven Development (SDD)  
**Dependencies:** M01–M06

## 1. Objective

Create the customer and CRM domain for MR עדולם while preserving two existing architectural guarantees:

1. guest checkout continues to work without creating an account;
2. internal StaffUser identity remains separate from customer identity.

The CRM must support physical store, phone, WhatsApp, web, app and future marketplace channels without making marketing consent, login or loyalty mandatory.

## 2. Domain boundaries

### Customer

Commercial/customer record used to recognize a person or organization across interactions.

### StaffUser

Internal operator identity from M06.

A StaffUser is never implicitly a Customer.

### Guest

A purchase or inquiry may remain unlinked to any Customer.

### Future Consumer Account

If MR later adds customer login, that consumer identity will be modeled separately. The StaffUser table must not be reused for consumer authentication.

## 3. Core principles

1. Customer is optional for Order.
2. Historical Order/Fulfillment snapshots remain immutable even when a customer later edits a profile/address.
3. Marketing preferences are separate from the existence of a customer record.
4. No marketing channel is implicitly opted in.
5. Contact normalization helps search/deduplication but does not automatically prove identity.
6. Shared phone numbers/emails are possible; no destructive auto-merge by contact value alone.
7. Customer merge is explicit, audited and non-destructive.
8. Sensitive-category inference is out of scope.
9. Data collection is minimized to operationally useful fields.
10. Access is protected by M06 permissions and StaffUser audit.

## 4. Customer entity

Fields:

- id BIGSERIAL
- display_name
- customer_type
- status
- preferred_language nullable
- notes_summary nullable
- merged_into_customer_id nullable
- created_at
- updated_at

Customer types:

- PERSON
- BUSINESS

Statuses:

- ACTIVE
- ARCHIVED
- MERGED

Rules:

- MERGED requires merged_into_customer_id;
- merged target must be an ACTIVE customer;
- a customer cannot merge into itself;
- new activity should resolve to the canonical customer;
- source customer rows are retained for history.

## 5. Contact points

CustomerContact fields:

- id
- customer_id
- type
- raw_value
- normalized_value
- label nullable
- is_primary
- verified_at nullable
- active
- created_at
- updated_at

Types:

- PHONE
- EMAIL
- WHATSAPP
- OTHER

Normalization:

### Email

- trim;
- lowercase;
- no mailbox ownership assumption from normalization alone.

### Phone

- store raw value;
- normalize conservatively;
- country context may be used when available;
- exact E.164 validation can be added through a phone library later.

Important:

normalized_value is indexed for lookup but not globally unique.

MR must not automatically merge two customers because they share a phone/email.

## 6. Addresses

CustomerAddress:

- id
- customer_id
- label nullable
- recipient_name
- recipient_phone nullable
- country_code
- department_or_state nullable
- municipality_or_city nullable
- locality nullable
- address_line
- reference nullable
- latitude nullable
- longitude nullable
- is_default_shipping
- active
- created_at
- updated_at

Rules:

- one active default shipping address per customer where practical;
- editing an address never mutates historical Order/Fulfillment address snapshots;
- addresses may be deactivated instead of deleted when referenced historically.

## 7. Preferences and consent state

CustomerPreference:

- id
- customer_id
- channel
- purpose
- status
- source
- evidence_reference nullable
- captured_by_user_id nullable
- captured_at
- updated_at

Channels:

- EMAIL
- SMS
- WHATSAPP
- PUSH
- PHONE

Purposes:

- MARKETING
- ORDER_UPDATES
- SERVICE_MESSAGES

Statuses:

- UNKNOWN
- GRANTED
- DENIED
- WITHDRAWN

Rules:

- default is UNKNOWN;
- UNKNOWN is never treated as GRANTED;
- changing a preference creates an audit record;
- transactional/order communications remain a separate business purpose from marketing;
- legal interpretation for Honduras is validated in the fiscal/legal workstream before claiming a statutory basis.

## 8. Internal notes

CustomerNote:

- id
- customer_id
- author_user_id nullable
- author_service nullable
- note
- visibility
- created_at

Visibility v1:

- INTERNAL

Rules:

- notes are StaffUser/service operational data;
- notes are not exposed on public storefront;
- author attribution is mandatory;
- notes must not be used to store passwords, payment credentials or unnecessary sensitive information.

## 9. Tags

CustomerTag:

- customer_id
- tag
- source
- created_by_user_id nullable
- created_at

Initial source values:

- MANUAL
- SYSTEM

Constraints:

- tags are operational/commercial labels only;
- no race, religion, health, politics, sexual orientation or other sensitive classifications;
- system-generated tags require documented logic.

## 10. Duplicate handling

CustomerDuplicateCandidate:

- id
- left_customer_id
- right_customer_id
- reason
- score nullable
- status
- created_at
- resolved_at nullable
- resolved_by_user_id nullable

Statuses:

- OPEN
- DUPLICATE
- NOT_DUPLICATE
- IGNORED

v1 does not need an automatic matcher to ship. The table establishes a safe path for future dedupe tooling.

## 11. Merge

Endpoint concept:

POST /v1/internal/customers/{sourceId}/merge

Body:

- targetCustomerId
- reason

Requires:

- customers.merge;
- CSRF for StaffUser cookie session;
- source and target exist;
- source != target;
- target canonical/ACTIVE.

Behavior:

1. lock source and target;
2. reject cyclic/invalid merge;
3. mark source MERGED;
4. set merged_into_customer_id;
5. optionally move active contact/address associations in a later phase;
6. preserve source row;
7. emit audit.

v1 intentionally does not mass-rewrite historical orders.

## 12. Search

Internal search supports:

- name;
- normalized phone;
- normalized email;
- contact raw value;
- customer id.

Query:

GET /v1/internal/customers?q=...&status=ACTIVE

Rules:

- requires customers.read;
- max 100 results;
- no unrestricted public customer lookup;
- search responses minimize fields.

## 13. API v1

### Customers

- POST /v1/internal/customers
- GET /v1/internal/customers
- GET /v1/internal/customers/{id}
- PATCH /v1/internal/customers/{id}

### Contacts

- POST /v1/internal/customers/{id}/contacts
- PATCH /v1/internal/customer-contacts/{id}

### Addresses

- POST /v1/internal/customers/{id}/addresses
- PATCH /v1/internal/customer-addresses/{id}

### Notes

- POST /v1/internal/customers/{id}/notes

### Preferences

- PUT /v1/internal/customers/{id}/preferences/{channel}/{purpose}

### Merge

- POST /v1/internal/customers/{id}/merge

OpenAPI remains the final contract authority before external integrations.

## 14. Authorization

Existing permissions:

- customers.read
- customers.write

New permission:

- customers.merge

Initial role policy:

### ADMIN

All customer permissions.

### MANAGER

All customer permissions, including merge.

### CUSTOMER_SUPPORT

- customers.read
- customers.write
- not customers.merge.

### CASHIER

- customers.read
- customers.write.

### ANALYST

No direct PII customer search by default unless a later reporting projection is created.

## 15. Audit events

Critical actions:

- customer.created
- customer.updated
- customer.contact_added
- customer.contact_updated
- customer.address_added
- customer.address_updated
- customer.note_added
- customer.preference_changed
- customer.merged
- customer.archived

Audit metadata should contain identifiers/status transitions, not full note bodies or unnecessary PII.

## 16. Order integration

Current guest Order behavior remains valid.

Future integration adds nullable:

- orders.customer_id

Rules:

- guest order: customer_id NULL;
- linked order: customer_id points to canonical customer;
- order still keeps name/phone/address commercial snapshots;
- customer profile edits do not rewrite past order snapshots.

M07 v1 can ship before all existing orders are linked.

## 17. Inquiry integration

A public inquiry may remain unlinked.

Future optional field:

- public_inquiries.customer_id

Staff may associate an inquiry with a customer after recognition.

No automatic identity assertion solely from contact similarity.

## 18. Derived CRM metrics

Allowed derived commercial metrics:

- order_count;
- last_order_at;
- gross_merchandise_value from MR orders;
- inquiry_count;
- last_interaction_at.

These are projections/analytics, not financial ledger balances.

MR must not duplicate LIRA financial ledger data.

## 19. Privacy/security

- minimize PII;
- never store CVV, PIN, OTP, account passwords in CRM;
- customer API is internal-only in v1;
- StaffUser permission checks are server-side;
- StaffUser cookie mutations require CSRF;
- audit all material changes;
- sanitize/redact customer fields in logs;
- no public endpoint may enumerate customer records.

## 20. Invariants

CRM-001 — Guest commerce works without Customer.  
CRM-002 — StaffUser and Customer are separate identities.  
CRM-003 — A contact match does not auto-merge customers.  
CRM-004 — Historical Order/Fulfillment snapshots are not rewritten by CRM edits.  
CRM-005 — Marketing preference UNKNOWN is not GRANTED.  
CRM-006 — Merge is explicit, non-destructive and audited.  
CRM-007 — MERGED customer resolves to a canonical target.  
CRM-008 — Customer mutations require customers.write except merge.  
CRM-009 — Merge requires customers.merge.  
CRM-010 — Customer read/search requires customers.read.  
CRM-011 — Internal notes are never public.  
CRM-012 — Sensitive classification tags are prohibited.  
CRM-013 — Customer PII is not written to security logs unnecessarily.  
CRM-014 — LIRA financial ledger data is not copied into CRM.

## 21. Acceptance tests

- create PERSON customer;
- create BUSINESS customer;
- reject invalid type/status;
- search customer by name;
- search customer by normalized contact;
- shared phone can belong to multiple customers;
- add/update contact;
- add address;
- only one default shipping address after update;
- add internal note and verify author;
- preference defaults UNKNOWN;
- grant preference;
- withdraw preference;
- customer support can write but cannot merge;
- manager/admin can merge;
- merge cannot target self;
- merge cannot target already merged record incorrectly;
- source remains in database as MERGED;
- audit events generated;
- mutation without CSRF rejected;
- unauthenticated search rejected;
- guest order endpoints still work without customer.

## 22. Delivery sequence

Phase 1:

- schema;
- permission customers.merge;
- CRUD/search;
- contacts;
- addresses;
- notes;
- preferences;
- merge;
- integration tests.

Phase 2:

- order.customer_id;
- inquiry.customer_id;
- manual linking;
- canonical-customer resolver.

Phase 3:

- consumer account;
- consent UI;
- segmentation projections;
- duplicate candidate workflow;
- marketplace identities;
- loyalty.

## 23. Definition of Done

Requirement
→ Domain model
→ Authorization rule
→ API contract
→ Implementation
→ Automated test
→ Audit evidence

M07 v1 is complete when the CRM core is merged with CI green and guest checkout remains unaffected.
