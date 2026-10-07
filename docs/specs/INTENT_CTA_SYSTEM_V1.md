# MR עדולם — Intent & Call-to-Action System

Status: IMPLEMENTED — public lifecycle  
Version: 1.1  
Date: 2026-10-07

## Purpose

Translate the strategic intention of MR עדולם into explicit actions and measurable business signals.

The storefront must not only display products. It must capture demand, supplier interest, partnership proposals, support needs, availability interest and commercial funnel events in a structured way.

## Public intent model

| Intent | Public CTA | Structured data | Business signal |
|---|---|---|---|
| Buy | Comprar / Explorar catálogo | Catalog, cart and checkout behavior | Revenue intent |
| Product request | Solicitar producto | Product/category, size, color, budget, contact | Missing assortment / demand |
| Supplier | Soy proveedor | Company, city, categories, catalog URL, MOQ, contact | Sourcing opportunity |
| Partnership | Colaborar | Company/brand, proposal type, URL, contact | Alliance / marketplace opportunity |
| Support | Necesito ayuda | Topic, order reference, contact, message | Service need |
| Notify | Avísame | Product/variant, preferred contact channel | Restock demand |

## Public lifecycle

1. The visitor chooses an intent.
2. The storefront renders fields appropriate to that intent.
3. A validated request is posted to `POST /api/v1/inquiries`.
4. Catalog API persists the request in PostgreSQL.
5. The response returns an opaque public token and human-readable numeric reference.
6. The browser stores only the user's own reference/token locally.
7. `#/requests` allows the user to refresh the status of requests created on that device.
8. Status lookup uses `GET /v1/inquiries/:id?token=<opaque-token>`.
9. The lookup response intentionally excludes contact details, internal notes, sourcing data and private operations.

## CTA analytics

The public funnel records a deliberately small allowlisted event set:

- `page_view`
- `cta_click`
- `intent_submit`
- `add_to_cart`
- `checkout_start`

Events are accepted at `POST /v1/events` and stored in `public_events`.

### Analytics boundary

The analytics event payload is designed for behavioral/funnel measurement, not for storing form contact information. PII from inquiry forms is not copied into analytics metadata.

## Database

### public_inquiries

Core fields:
- kind
- name
- contact
- country_code
- product_id
- message
- metadata
- status
- public_token
- created_at
- updated_at

### public_events

Core fields:
- event_name
- session_id
- route
- metadata
- created_at

## Public routes

- `POST /v1/inquiries`
- `GET /v1/inquiries/:id?token=...`
- `POST /v1/events`

The public API does **not** provide an endpoint to enumerate all inquiries.

## Storefront surfaces

- Desktop navigation: Conecta con MR עדולם
- Mobile navigation: Conectar
- `#/connect`: Intent Center
- `#/requests`: My requests / status tracking
- Product detail CTAs: Consultar o solicitar / Avísame / Necesito ayuda
- Account shortcut: Mis solicitudes
- Brand page CTA
- Homepage brand CTA
- Footer CTA

## Validation and abuse controls

- Inquiry payload limit: 16 KB.
- Event payload limit: 8 KB.
- Allowlisted inquiry types.
- Allowlisted event names.
- Field length caps.
- Country code validation.
- Honeypot field for simple automated-form abuse.
- Public tracking requires both numeric request ID and opaque token.

## Internal operations boundary

The next Control Center step is a real Intent Queue / lightweight CRM, but it must not be exposed until staff identity and authorization exist.

Planned internal capabilities:
- queue by type/status/date/country;
- assignment to staff;
- internal notes;
- priority;
- status transitions;
- supplier conversion;
- product-request aggregation;
- restock demand scoring;
- response SLA;
- audit trail;
- analytics dashboards.

This private queue should be implemented behind authenticated staff access rather than by exposing inquiry enumeration on the public Catalog API.

## Commercial intelligence derived from the system

The intent layer will eventually answer questions such as:

- Which products are customers requesting that we do not stock?
- Which sizes/colors create the most unmet demand?
- Which products should be restocked first?
- Which suppliers are offering categories we need?
- Which product requests could justify private label development?
- Which CTA produces the highest conversion into cart, inquiry or checkout?
- Which countries or cities are producing supplier or customer interest?

## Acceptance criteria

- Intent Center renders without JavaScript syntax errors.
- Structured intent-specific fields are available.
- Inquiry submission persists to PostgreSQL.
- The user receives a reference and opaque token.
- My Requests can retrieve only the user's token-authorized request status.
- CTA analytics accepts only allowlisted events.
- Storefront readiness depends on Catalog API health.
- GitHub CI tests inquiry POST, public request tracking and analytics proxy.
- Railway deployments reach SUCCESS.
