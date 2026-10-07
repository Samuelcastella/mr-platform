# MR עדולם — Storefront v1.2 Commerce First

Status: IMPLEMENTED  
Date: 2026-10-07  
Surface: Public storefront

## Decision

The public homepage is optimized primarily for shopping and conversion. The broader business architecture remains visible, but it has been moved into a dedicated "Nuestra marca" route so customers are not forced to read internal operational concepts before shopping.

## Homepage hierarchy

1. Hero with direct shopping CTA.
2. Category navigation.
3. New arrivals.
4. Curated MR עדולם selection.
5. Second-hand promotion.
6. Featured products.
7. Marketplace section.
8. Customer benefits.
9. Brief brand-growth teaser.

## Separate brand page

The route `#/brand` contains:
- evolution from third-party products to private label and owned products;
- omnichannel ecosystem;
- sourcing loop;
- multip-country readiness;
- Control Center concept;
- growth roadmap.

## Mobile

A bottom mobile navigation now exposes:
- Home
- Catalog
- Brand
- Account
- Cart

## Preserved behavior

- existing catalog route;
- product detail;
- cart;
- checkout prototype;
- account and order history prototype;
- marketplace;
- admin prototype;
- catalog API synchronization;
- 3D crown behavior;
- Railway static server.

## Next visual milestone

Replace emoji/demo product artwork with real product photography and image records sourced from the catalog/media pipeline.
