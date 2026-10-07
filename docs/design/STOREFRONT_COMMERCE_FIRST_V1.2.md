# MR עדולם — Storefront v1.2 Commerce First

Status: IMPLEMENTED  
Date: 2026-10-07  
Surface: Public storefront

## Product decision

The public homepage is optimized first for shopping and conversion. The broader business architecture remains available, but it now lives primarily under the dedicated `#/brand` route so customers are not required to read internal operational concepts before browsing products.

## Homepage hierarchy

1. Hero with direct shopping CTA.
2. Category navigation.
3. New arrivals.
4. Curated MR עדולם selection.
5. Second-hand promotion.
6. Featured products.
7. Marketplace section.
8. Customer benefits.
9. Short brand-growth teaser.

## Dedicated brand page

The `#/brand` route contains:
- evolution from third-party products to private label and owned products;
- physical store + web + future app + commerce core + marketplace;
- sourcing loop: sell → measure → compare → buy → receive → learn;
- Honduras-first, multi-country-ready operations;
- private Control Center concept;
- staged growth roadmap.

## Mobile

A bottom navigation exposes:
- Home
- Catalog
- Brand
- Account
- Cart

## Reliability

- GitHub CI executes `npm test` for storefront smoke tests.
- The inline JavaScript is syntax-checked in CI.
- Storefront liveness is `/health`.
- Storefront readiness is `/ready` and depends on Catalog API health.
- Railway production health checks use `/ready`.
- Railway deployment watch patterns are limited to runtime storefront files and assets; tests and docs no longer trigger production redeploys.

## Preserved behavior

- catalog;
- product detail;
- cart;
- checkout prototype;
- account;
- order history prototype;
- marketplace;
- admin prototype;
- Catalog API synchronization;
- 3D crown behavior.

## Next visual milestone

Replace emoji/demo product artwork with real product photography backed by the product-media pipeline. Real photography should become the dominant merchandising surface while the current iconography remains only as a fallback.
