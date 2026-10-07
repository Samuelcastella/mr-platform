# MR עדולם — Control Center Intent Queue v1

Status: IMPLEMENTED — private runtime deployed; staff login activation pending  
Method: Spec-Driven Development (SDD)  
Date: 2026-10-07

## Purpose

Turn public intent submissions into an operational queue for MR עדולם without exposing customer or supplier information on public endpoints.

The public Intent Center is implemented. The private follow-up runtime is now deployed as a separate Railway service named `control-center`, connected to PostgreSQL and kept without a public domain until staff login credentials are configured.

## Actors

- Store manager / operator
- Purchasing / sourcing role
- Customer support role
- Brand / partnership role
- Administrator

## Core queue

Each inquiry will be displayed with:
- reference ID;
- intent type;
- received date/time;
- status;
- priority;
- contact identity;
- country;
- related product;
- structured metadata;
- public message;
- assigned staff member;
- internal notes;
- last activity.

## Status model

- New
- Reviewing
- Contacted
- Qualified
- Converted
- Closed
- Rejected

Status history must be append-only/auditable once the internal workflow is productionized.

## Views

### Inbox
All new actionable signals.

### Customer demand
Product requests and restock notifications.

### Suppliers
Supplier submissions, grouped by country/category and later linked to Supplier records.

### Partnerships
Brands, manufacturers, marketplace sellers, creators and commercial partnerships.

### Support
Product, order, delivery and payment questions.

### Intelligence
Aggregated demand and conversion signals without exposing unnecessary PII.

## Filters

- intent type;
- status;
- priority;
- country;
- related product/category;
- assigned staff;
- date range;
- free-text search.

## Actions

- assign owner;
- change status;
- change priority;
- add internal note;
- contact externally;
- convert supplier lead into Supplier;
- convert requested product into sourcing opportunity;
- link request to an existing product;
- close/reject with reason.

## Demand intelligence

The system should calculate:
- most requested missing products;
- most requested categories;
- size/color gaps;
- restock demand;
- supplier interest by country/category;
- inquiry-to-conversion rate;
- CTA-to-inquiry rate;
- add-to-cart and checkout-start funnel;
- demand candidates for private label / MR עדולם-owned product development.

## Security boundary

This module SHALL NOT be exposed through unauthenticated public APIs.

Before implementation, staff identity must provide:
- authenticated session;
- role/permission checks;
- server-side authorization;
- audit actor;
- session expiration;
- protected write operations.

A browser-only password or a token embedded in storefront JavaScript is explicitly prohibited.

## Current implementation

- Separate `control-center` Railway service: deployed and healthy.
- PostgreSQL-backed intent queue.
- Signed HttpOnly session cookie infrastructure.
- CSRF protection for state-changing forms.
- Login rate limiting.
- Filters by type/status/search.
- Priority, assignment and internal notes fields.
- Status-history audit table.
- CTA funnel metrics from `public_events`.
- Service is intentionally not public yet because `CONTROL_CENTER_PASSWORD` has not been configured.

## Dependencies

- Public Intent Center — IMPLEMENTED
- PostgreSQL public_inquiries — IMPLEMENTED
- Public request status tracking — IMPLEMENTED
- CTA analytics/public_events — IMPLEMENTED
- Staff identity and authorization — REQUIRED
- Audit actor model — REQUIRED

## Acceptance criteria

The module may move from PROPOSED to IMPLEMENTED only when:
1. unauthenticated users cannot enumerate inquiries;
2. operators can see only the permissions granted to their role;
3. status and assignment changes are persisted server-side;
4. internal notes never appear in public tracking;
5. every internal mutation records actor/time;
6. filtering works on server-backed records;
7. conversion actions create auditable links to Supplier/Product/Sourcing records;
8. automated authorization tests pass;
9. production deployment and health checks pass.
