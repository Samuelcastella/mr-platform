# SPEC — M10 Mobile Shell v0.1

**Project:** MR עדולם  
**Status:** IMPLEMENTED FOUNDATION  
**Date:** 2026-10-07  
**Issue:** #8

## Goal

Create the first independent mobile client for MR עדולם without duplicating Commerce Core business logic.

## Architecture

```text
apps/mobile
   ↓ HTTPS
catalog-api
   ↓
Postgres / Commerce Core
```

The mobile app is a channel. It is not the source of truth for products, inventory, orders, payments or fulfillment.

## v0.1 scope

- Expo SDK 57 stable foundation.
- iOS/Android identity.
- MR עדולם icon assets.
- Android adaptive icon.
- native splash plugin.
- light/dark system appearance.
- active product catalog from `GET /v1/products?status=active`.
- pull-to-refresh.
- loading/error/empty states.
- storefront handoff for purchase.
- CI typecheck and Android export.

## Explicit non-goals

- native authentication;
- native checkout;
- native payments;
- push notifications;
- local order ledger;
- duplicated inventory state;
- LIRA coupling.

## Security

Only `EXPO_PUBLIC_*` non-secret configuration may be embedded in the client.

No database credentials, internal API token, payment secret or fiscal authorization data may be shipped in the app.

## Branding

Visible brand name is **MR עדולם**. The Hebrew name is not transliterated in UI, identifiers or documentation.

## Next mobile increments

1. Product detail + media.
2. Cart shared with Commerce Core contracts.
3. Native Order creation.
4. Fulfillment selection.
5. Checkout orchestration.
6. Customer identity/session.
7. Push/order tracking.
