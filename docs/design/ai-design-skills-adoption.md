# MR עדולם — storefront design integration plan

Status: design audit and implementation plan. This document does not change production behavior.

## Baseline verified
- Runtime storefront: `web/storefront/index.html` (SPA), with supplemental `assets/storefront-design.css`.
- Product/catalog integration and checkout live in the existing SPA; do not replace them with static mockups.
- Brand assets include Hebrew wordmark, gold logo, crown artwork and 3D crown script.
- Test command: `cd web/storefront && npm test` (smoke and design tests).
- Railway deploys storefront from `main`; develop through a PR.

## Adoption policy
Use `.claude/skills/landing-page-design/SKILL.md` for design review and new marketing sections, but do not blindly overwrite established brand rules or accessibility requirements. Preserve the exact visible name `MR עדולם`, existing gold/cream/ink palette, crown 3D interaction with fallback, Hebrew typography and reduced-motion support. Prefer existing design tokens and reusable styles over ad hoc overrides. Check license and upstream changes before any redistribution or update.

## Observed gaps / decisions
1. The SPA has substantial inline CSS and a separate design stylesheet. Audit cascade and existing design tests before editing visual values.
2. Existing CSS declares `Inter`, `system-ui`, and `Georgia`; the imported skill recommends a single font from its approved set. Font migration requires Hebrew glyph coverage and visual regression review, not a blind replacement.
3. Existing gradient backgrounds and rounded components differ from upstream rules. Retain deliberate branded artwork and assess each section individually.
4. The existing storefront already contains commerce sections and product states. Do not apply landing-page CTA rules to cart, checkout, or administrative actions without considering task intent.

## Proposed incremental delivery
- Phase 1: baseline screenshots at 390px, 768px, 1440px; check Hebrew rendering, keyboard navigation, product cards, cart and crown fallback.
- Phase 2: refine hero hierarchy, typography and spacing in a small, isolated commit; preserve existing links and API calls.
- Phase 3: product-grid and mobile navigation polish; verify empty/loading/error states.
- Phase 4: checkout accessibility and trust messaging; verify totals, inventory reservation and payment behavior remain unchanged.
- Phase 5: Control Center design audit in its own repository or directory after ownership is confirmed.

## Acceptance criteria
- `npm test` passes and no new console errors.
- Keyboard focus, skip link, mobile layouts, reduced motion, semantic landmarks and contrast remain usable.
- No changes to catalog API contracts, payments, stock calculations, reservations or database.
- All Hebrew brand text and existing branded assets remain intact.
- Screenshots and a reviewer sign-off are attached before merging into `main`.
