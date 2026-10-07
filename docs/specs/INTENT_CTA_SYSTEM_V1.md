# MR עדולם — Intent & Call-to-Action System v1.0

Status: IMPLEMENTED  
Version target: Storefront 1.3.0  
Date: 2026-10-07

## Purpose

Translate the strategic intent of MR עדולם into explicit public actions. The storefront should not only display products; it should convert customer demand, supplier interest, partnership proposals, support needs and stock interest into structured business signals.

## Intent model

| Intent | Public CTA | Data captured | Business use |
|---|---|---|---|
| Buy | Comprar / Explorar catálogo | Product/cart behavior | Revenue and demand |
| Product request | Solicitar producto | Need, contact, product/message | Assortment discovery |
| Supplier | Soy proveedor | Supplier contact, country, offer details | Sourcing pipeline |
| Partnership | Colaborar | Brand/partner proposal | Marketplace and alliances |
| Support | Necesito ayuda | Contact + issue | Customer service |
| Notify | Avísame | Product interest + contact | Restock / demand signal |

## Public flow

1. User chooses an intent.
2. Storefront renders an intent-specific form.
3. Browser sends the form to `POST /api/v1/inquiries`.
4. Storefront server proxies only the allowed inquiry POST to Catalog API.
5. Catalog API validates and persists the inquiry in PostgreSQL.
6. The user receives a reference number.
7. Future Control Center functionality will triage, assign and close the inquiry.

## Database

Table: `public_inquiries`

Core fields:
- kind
- name
- contact
- country_code
- product_id
- message
- metadata
- status
- created_at

Allowed kinds:
- supplier
- product_request
- support
- partnership
- notify

## Safety and validation

- 16 KB request-size limit.
- Field length limits.
- Honeypot bot field.
- Allowlist for intent type.
- Country-code validation.
- Public API does not expose inquiry listing.
- No internal costs, supplier-private records or admin data are returned.
- Internal triage/listing remains blocked until authentication and authorization exist.

## Storefront integration

The intent center is available at `#/connect`.

Calls to action are wired into:
- desktop navigation;
- brand page;
- homepage brand section;
- product page;
- mobile navigation;
- footer.

## Product-level CTAs

Product pages expose:
- Consultar o solicitar
- Avisarme cuando esté disponible
- Necesito ayuda

The current product route is carried into the inquiry flow when possible.

## Supplier intent

Supplier submissions support the real operating model of MR עדולם: multiple vendors, multiple cities and multiple countries. The system does not assume one fixed brand, one permanent supplier or one source country.

## Future Control Center

The next internal module should add an authenticated Inquiry Queue with:
- filters by kind/status/date/country;
- assignment to staff;
- notes;
- status transitions;
- supplier conversion;
- product-request aggregation;
- demand scoring;
- restock campaigns;
- audit trail.

## Acceptance criteria

- Intent route renders without JS syntax errors.
- Storefront readiness passes.
- Public inquiry POST is proxied.
- Catalog API validates and persists an inquiry.
- GitHub CI tests readiness and inquiry proxying.
- Railway deployments reach SUCCESS.
