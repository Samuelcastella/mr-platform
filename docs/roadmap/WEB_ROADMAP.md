# MR עדולם — Web Roadmap

Status: ACTIVE  
Method: Spec-Driven Development (SDD)  
Primary production URL: https://storefront-production-e7b5.up.railway.app/

## North star

The web is the first public channel of the MR עדולם brand platform. It must start small enough to operate now, while preserving a path toward multi-category, multi-location, multi-country, marketplace, private-label and owned-product operations.

## Delivery gates

A phase is not considered complete until:
1. the specification is documented;
2. implementation is versioned in GitHub;
3. Railway deployment reaches SUCCESS;
4. production health is green;
5. critical user flows are verified;
6. no known blocker is carried silently into the next phase.

## Phase W0 — Foundation — COMPLETE

- GitHub repository connected to Railway.
- Production storefront deployed.
- PostgreSQL online.
- catalog-api online.
- Storefront public domain available.
- Project documentation and migration ledger present in GitHub.

## Phase W1 — Live catalog integration — IN PROGRESS

Goal: make the storefront consume the central catalog instead of treating browser-local demo data as the source of truth.

Deliverables:
- configure `CATALOG_API_URL` in Railway;
- proxy catalog reads through the storefront server;
- load active products from `/v1/products`;
- preserve an explicit fallback/empty state when the catalog has no published products;
- verify price, category, currency and available stock mapping;
- keep browser-local cart as temporary presentation state only.

Acceptance:
- storefront deployment SUCCESS;
- catalog-api deployment SUCCESS;
- storefront can reach catalog-api;
- no secrets exposed to the browser;
- catalog page renders database-backed products when active products exist.

## Phase W2 — Catalog domain v1

Goal: turn Module 01 into a production-grade product catalog.

Deliverables:
- categories as first-class records;
- product lifecycle: draft / active / inactive / archived;
- variants and SKU;
- product type: third-party / curated / private-label / owned;
- condition: new / second-hand / refurbished where applicable;
- brand, supplier, manufacturer and country of origin;
- price lists and currency-safe monetary values;
- media references and primary image;
- inventory by location and reservations;
- stock movement ledger.

## Phase W3 — Storefront commerce UX

Goal: complete the customer shopping journey.

Deliverables:
- category and search pages;
- product-detail page;
- variant selection;
- cart;
- delivery choice;
- checkout shell;
- customer account shell;
- order confirmation and order history;
- accessible responsive behavior.

## Phase W4 — Orders and inventory reservation

Goal: move orders from browser-local state into the commerce core.

Deliverables:
- orders API;
- server-side totals;
- inventory reservation;
- idempotency;
- order status workflow;
- audit trail;
- stock release on cancellation;
- transactional consistency.

## Phase W5 — Customer identity and administration

Goal: separate public customer experience from internal operations.

Deliverables:
- authentication;
- customer profiles;
- staff roles and permissions;
- protected MR עדולם Control Center;
- product and inventory administration;
- supplier and purchasing administration.

## Phase W6 — Payments and delivery

Goal: support real commercial transactions.

Deliverables:
- payment gateway abstraction;
- cash / bank transfer workflows for Honduras;
- delivery zones and pricing;
- local delivery workflow;
- payment and delivery status events;
- refund/cancellation rules.

## Phase W7 — Omnichannel and marketplace

Goal: prepare physical store, web, app and external channels to share one commerce core.

Deliverables:
- channel listings;
- physical-store/POS integration;
- marketplace connectors;
- stock allocation per channel;
- channel pricing rules;
- unified customer/order reporting.

## Phase W8 — Private label and owned products

Goal: support the evolution from reseller to brand owner.

Deliverables:
- sourcing opportunities;
- sample and supplier evaluation;
- manufacturer records;
- MOQ and lead time;
- product specification/version;
- quality control;
- production runs/lots;
- landed cost;
- provenance and traceability.

## Architecture rule

The storefront is a client of the commerce core. It must never become the authoritative database for products, inventory, prices, orders or customers.

## Current next action

Finish W1 and mark it green before starting W2 implementation.
