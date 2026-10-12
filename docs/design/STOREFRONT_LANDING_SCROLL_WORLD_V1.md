# MR עדולם — Landing design and brand journey

Status: implemented for PR review; cinematic media pending. Date: 2026-10-12.

## Purpose and layout

Keep the storefront shopping-first. Apply `landing-page-design` to the hierarchy,
copy, spacing, navigation, states and calls to action. Use the `scroll-world`
approach for a separate brand journey with scroll-linked scenes, persistent
posters and optional video scrubbing. Preserve the existing cream, ink and gold
identity, crown and Hebrew wordmark. Existing branding and accessibility take
priority over the upstream skill's prescriptive typography and motion choices.

1. Hero: “Encuentra algo que va contigo.” Primary action: “Explorar catálogo”.
   Context: MR עדולם, Honduras. No invented testimonials or sales statistics.
2. Categories derived from published catalog data, then up to eight products.
3. Three steps: choose a product, review payment/delivery, follow the order.
4. A two-line brand statement linking to the separate journey.
5. Six concise questions about stock, currency, payment, delivery, orders and help.
6. Final catalog CTA. Homepage remains indexable with one description and social metadata.

Use a classic hero plus sections: visitors can shop immediately without completing
a cinematic sequence. Keep search available on mobile. Do not manufacture offer,
popular, new-arrival or discount labels from array positions. Product photography,
prices, variants and availability come from the API.

## Brand journey and media boundary

Route: `#/brand`. Three story beats: discover, choose, receive. The current visual
is a lightweight brand composition made from existing assets, not a rendering of
the physical store and not an AI-generated 3D camera flight. Text remains in normal
document flow; desktop has a sticky scene; mobile and reduced-motion get a linear
layout. All three sections work without video, WebGL or IntersectionObserver.

`assets/brand-journey.js` adapts scroll-world's local scroll-to-time, blob loading,
poster retention, coalesced seeks and cleanup requirements to this SPA. No third-party
generation credentials, assets or services are called by this change. The code has
an empty media manifest; clips can be enabled only after approved assets exist.

Before generating: obtain the user's camera choice, desktop/mobile choice, provider
access and approval of a current cost estimate. Neither Monid nor Higgsfield CLI was
available during implementation. Do not treat the reference skill's historic prices
as a quote. For seamless flight, use actual rendered boundary frames; review every
join in both scroll directions. Native portrait media is a separate rendering job.
Do not describe cropped desktop video as the native mobile experience.

## Acceptance and validation

- Preserve product detail, favorites, cart, server orders, checkout and fulfillment.
- Search/category state must survive async catalog arrival and route changes.
- Show distinct loading, empty, filtered-empty and network-error states.
- Maintain visible focus, touch targets, contrast, safe areas and reduced motion.
- Do not fetch video for save-data/reduced-motion or with an empty manifest.
- Cancel animation frames, observers and media requests on route teardown.
- Run existing storefront smoke tests and focused behavioral checks for catalog
  states, escaping, route behavior and journey lifecycle.
- Browser visual QA is unavailable in this managed session; do not claim a desktop,
  mobile or cinematic seam screenshot review. PR review must include those checks.

## Sources

- https://github.com/elayadesign/ai-design-skills — `landing-page-design`
  (source blob `d1f81e4f1142c0369828b14f4d04ccd5b898106a`).
- https://github.com/oso95/scroll-world — commit
  `71cc36d3bb150248ae36a2c552f9cbf88802a79c`; source MIT notice retained beside adapter.
- Existing `STOREFRONT_COMMERCE_FIRST_V1.2.md` and repository `AGENTS.md`.
