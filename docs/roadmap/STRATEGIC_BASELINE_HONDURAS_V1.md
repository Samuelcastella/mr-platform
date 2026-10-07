# MR עדולם — Strategic Baseline Honduras v1

**Status:** PROPOSED FOR APPROVAL  
**Method:** Spec-Driven Development (SDD)  
**Baseline date:** 2026-10-07  
**Scope:** Honduras first, architecture prepared for multi-location, multi-channel, multi-seller and multi-country evolution.

## 1. Purpose

This document converts the Honduras market study into an execution baseline for MR עדולם.

It connects five layers:

```text
Market evidence
      ↓
Strategic diagnosis
      ↓
Platform vision
      ↓
Gap analysis against production
      ↓
Implementation roadmap
```

The goal is not to redesign what already works. The goal is to preserve the verified production baseline and close the gaps between the current system and the target operating model.

## 2. Evidence hierarchy

Decisions should distinguish three evidence levels:

1. **Observed market evidence** — findings supported by the Honduras market study and its source set.
2. **Strategic inference** — conclusions derived for MR עדולם from those market findings.
3. **Implementation requirement** — technical or operational changes approved through SDD.

Regulatory, fiscal, financial and legal assumptions must be independently revalidated before they become production rules.

## 3. Strategic diagnosis

The recommended position is not to compete head-on with large Honduran chains as another generalist retailer.

MR עדולם should first become an excellent **Honduras-native omnichannel commerce platform**, using the existing boutique operation as its real-world proving ground.

The strategic progression is:

```text
Boutique operation
      ↓
Omnichannel commerce core
      ↓
Platform for third-party sellers / designers / boutiques
      ↓
Commercial ecosystem
```

The platform should be designed toward the last stage while implementing only the capabilities justified by the current phase.

## 4. North-star vision

> **MR עדולם will become a Honduras-native, omnichannel and scalable commerce platform, born from a real boutique operation, capable of selling owned and third-party products, supporting local logistics and multiple payment methods, and evolving toward a marketplace and broader commercial ecosystem.**

The boutique is the first operating channel, not the architectural limit.

## 5. Strategic principles

- Mobile-first customer experience.
- WhatsApp is treated as a real commercial channel, not a marketing afterthought.
- Cash, bank transfer and COD remain first-class payment methods.
- Product variants and inventory must be authoritative and server-side.
- Logistics must reflect Honduran delivery realities, including descriptive addresses and failed delivery attempts.
- Fiscal requirements for Honduras must be implemented only after current compliance rules are verified.
- LIRA remains an independent financial platform integrated through a payment adapter; MR must not embed LIRA's ledger.
- The Storefront is a client of the Commerce Core, never the source of truth.
- Build phase 1 now while preserving clean extension points for multi-location, multi-seller and international expansion.
- Market research remains a permanent decision input, not a one-time report.

## 6. Verified production baseline

Verified against Railway and the repository on 2026-10-07.

### Railway project

Project: **MR עדולם**  
Environment: **production**

Live services verified:

| Service | State | Notes |
|---|---|---|
| `storefront` | SUCCESS | GitHub-connected, `web/storefront`, healthcheck `/ready`, custom domain configured |
| `catalog-api` | SUCCESS | GitHub-connected, `services/catalog-api`, Bun, healthcheck `/health` |
| `control-center` | SUCCESS | Bun Function runtime, private operational interface |
| `Postgres` | SUCCESS | Persistent 50 GB volume |
| `storefront-preview` | No deployment | Present but not currently deployed |

No staged Railway changes were present at verification time.

### Repository baseline

Relevant paths:

```text
web/storefront/
services/catalog-api/
services/control-center/
brand/
docs/architecture/
docs/research/
docs/roadmap/
docs/specs/
docs/ops/
```

Existing authoritative documents already include:

- Architecture & Operating Blueprint v2.0
- Web Roadmap
- M01 Catalog & Inventory v1
- Market research / executive summary
- Railway operational documentation

This document does not replace those artifacts. It connects them.

## 7. Verified technical reality

### Catalog API

The current backend already creates and uses core records for:

- locations
- suppliers
- products
- product_variants
- inventory
- inventory_movements
- public inquiries
- public events

Public API routes currently verified include:

```text
GET  /health
GET  /v1/products
POST /v1/inquiries
POST /v1/events
```

### Storefront

The storefront is already a production SPA/PWA and consumes the catalog API.

However, several commercial concepts still exist as presentation or browser-local state, including:

- cart
- orders
- stock helpers
- seller information
- some commerce configuration

This means the UI is ahead of the authoritative Commerce Core in several areas.

### Control Center

A deployed Control Center already provides a private operational surface for inquiries, demand signals, supplier leads and sourcing opportunities.

It is useful infrastructure and should be evolved rather than replaced.

## 8. Gap analysis

| Capability | Current state | Target state | Gap |
|---|---|---|---|
| Product catalog | Backend exists | Authoritative catalog with lifecycle/categories/media | Partial |
| Variants / SKU | Database model exists | Exact sellable variants across UI + inventory + orders | Partial |
| Inventory | Tables and movements exist | Location-based authoritative stock + reservations | Partial |
| Storefront catalog integration | In progress | All active product data from Commerce Core | High-priority completion |
| Cart | Browser-local | Temporary UX state backed by server checkout | Gap |
| Orders | Browser-local/demo behavior | Server-side order domain + state machine | Critical gap |
| Checkout | UI shell | Server-side totals, inventory reservation, idempotency | Critical gap |
| Payments | Messaging / conceptual | Payment orchestration with cash, transfer, COD, adapters | Critical gap |
| WhatsApp commerce | Inquiry/preference support | Direct commercial handoff with order context | Partial |
| Logistics | Static/customer messaging | Zones, quotes, fulfillment, attempts, tracking, COD reconciliation | Gap |
| Customers | Minimal | Customer records + optional anonymous purchase | Gap |
| Staff identity / RBAC | Control Center auth exists | Role-based authorization across operations | Partial |
| Tax / fiscal Honduras | Not authoritative | Verified ISV/CAI/SAR implementation | Gap + compliance validation |
| Marketplace / third-party sellers | Conceptual/local UI data | First-class seller/ownership/commission model | Future gap |
| LIRA | Separate project | External adapter only | Correct boundary; future integration |
| Analytics | Events + basic Control Center signals | End-to-end commerce funnel and operational KPIs | Partial |

## 9. Primary conclusion from the gap analysis

**Do not rebuild the existing platform.**

The highest-value technical move is to shift commercial authority from browser-local state into the server-side Commerce Core.

The first production-critical sequence is therefore:

```text
Authoritative catalog
      ↓
Authoritative inventory
      ↓
Server-side orders
      ↓
Server-side checkout
      ↓
Payment orchestration
      ↓
Fulfillment / logistics
```

Marketplace and fintech expansion must not precede this sequence.

## 10. Implementation roadmap

### Phase 0 — Preserve the verified baseline

Objective: freeze the current production state as the reference point.

Actions:

- keep current working Railway services;
- avoid rewrites without a documented requirement;
- require PR + tests + successful Railway deployment for production changes;
- preserve current architecture documents as historical sources.

### Phase 1 — Finish authoritative catalog integration

Priority: **Immediate**

- complete Web Roadmap W1;
- storefront must read active product data from `catalog-api`;
- remove demo/local stock as a source of truth;
- ensure variants and SKU are represented consistently;
- verify responsive/mobile behavior;
- preserve empty/fallback states.

**Exit criterion:** a customer sees database-backed products and accurate availability.

### Phase 2 — Commerce Core: orders and reservations

Priority: **Next**

Implement the approved direction from the Order Management specification:

- server-side orders;
- order line price snapshots;
- order status machine;
- inventory reservations;
- cancellation stock release;
- idempotent order creation;
- channel metadata: STORE, PHONE, WHATSAPP, WEB, APP, MARKETPLACE.

**Exit criterion:** a real order can be created without relying on browser-local order state.

### Phase 3 — Checkout and Honduras payment methods

Priority: **High**

- server-side totals;
- cash;
- bank transfer;
- COD;
- payment status independent from order status;
- payment adapter interface;
- LIRA only as a future external adapter;
- webhook/idempotency patterns for future online providers.

**Exit criterion:** a real order can move through checkout using a Honduras-relevant payment method.

### Phase 4 — Fulfillment and local logistics

Priority: **High**

- store pickup;
- local delivery;
- configurable delivery zones;
- descriptive addresses;
- delivery attempts;
- proof of delivery;
- failed delivery handling;
- return-to-origin;
- COD collection vs. reconciliation separation;
- courier adapter interface.

**Exit criterion:** a real order can be fulfilled, delivered, failed and returned with auditability.

### Phase 5 — Identity, administration and compliance hardening

- staff roles / RBAC;
- customer profiles;
- audit trails;
- secure administrative actions;
- rate limiting and API security;
- verify current Honduras fiscal requirements before implementation;
- implement tax/fiscal logic only from validated rules.

### Phase 6 — Marketplace readiness

Do not activate until the boutique commerce core is stable.

Prepare:

- first-class seller entity;
- ownership model;
- commission rules;
- seller onboarding;
- channel allocations;
- settlement integration boundary;
- seller-specific reporting.

### Phase 7 — Ecosystem expansion

- LIRA adapter;
- additional payment providers;
- courier integrations;
- external marketplace connectors;
- international sourcing;
- private label / owned products;
- broader analytics and decisioning.

## 11. Honduras-first product requirements

The market diagnosis implies the following product requirements should be treated as first-class:

- mobile usability;
- exact size/color/variant selection;
- WhatsApp handoff carrying product/order context;
- cash and bank transfer;
- COD;
- clear delivery cost before confirmation where possible;
- descriptive address references;
- transparent order and delivery status;
- local currency handling;
- fast product discovery;
- low-friction repeat purchasing;
- fiscal compliance once rules are verified.

## 12. Architecture boundaries

### MR owns

- catalog
- variants
- inventory
- customers
- orders
- checkout
- commercial payment state
- fulfillment
- logistics
- suppliers
- sellers
- marketplace rules
- commerce analytics

### LIRA owns

- financial ledger
- financial account balances
- financial transaction processing
- financial risk controls
- financial authorization
- financial audit

Integration is through versioned contracts/adapters only.

No shared database.

## 13. Traceability model

Every significant capability should be traceable using:

```text
Market finding
→ Strategic decision
→ Requirement
→ SPEC
→ Code
→ Automated test
→ Railway deployment
→ Production evidence
→ KPI
```

Recommended implementation record:

| Field | Meaning |
|---|---|
| Evidence | Market / operational source |
| Decision | What MR chooses to do |
| Requirement ID | Stable requirement reference |
| SPEC | Governing specification |
| Component | Storefront / API / Control Center / infra |
| Test | Automated acceptance evidence |
| Deployment | Railway deployment ID |
| KPI | Metric used to validate the decision |

## 14. Decision gates

A phase is considered complete only when:

1. specification is approved;
2. code is versioned;
3. automated tests pass;
4. Railway deployment is SUCCESS;
5. critical production flow is verified;
6. relevant telemetry exists;
7. no regulatory assumption is being treated as fact without validation.

## 15. Immediate execution order

From the current baseline:

1. Complete database-backed catalog flow end-to-end.
2. Make variants and stock authoritative.
3. Implement server-side orders.
4. Implement inventory reservations and idempotency.
5. Implement checkout.
6. Add cash, transfer and COD orchestration.
7. Implement fulfillment/local delivery.
8. Harden staff/customer identity.
9. Validate and then implement Honduras fiscal requirements.
10. Only then activate marketplace and LIRA integrations.

## 16. Non-goals for the immediate phase

The following should **not** block the next release:

- full marketplace;
- multi-country settlement;
- embedded fintech;
- complex credit products;
- advanced courier integrations;
- full private-label manufacturing workflows;
- feature expansion solely for visual sophistication.

The 3D crown and premium brand experience remain differentiators, but commerce reliability takes precedence over additional visual complexity.

## 17. Strategic KPIs

The architecture should progressively expose:

- storefront → product conversion;
- cart → checkout conversion;
- checkout completion;
- WhatsApp-assisted conversion;
- COD acceptance and failure rate;
- delivery success rate;
- delivery cycle time;
- order cancellation rate;
- stockout rate;
- inventory accuracy;
- gross margin by product / variant / supplier;
- repeat purchase rate;
- seller/channel mix when marketplace becomes active.

## 18. Baseline decision

**Decision:** Current production becomes **MR עדולם Baseline V0**.

All future work should close an explicit gap between Baseline V0 and the approved target vision.

No rewrite is justified merely because a later architecture is more elegant. Replacement requires evidence that the current component cannot satisfy an approved requirement safely or economically.

## 19. Relationship to existing documents

This artifact acts as the strategic bridge between:

- `docs/research/Resumen_Ejecutivo.md`
- `docs/research/HONDURAS_RETAIL_OPERATING_PATTERNS_2026.md`
- `docs/architecture/MR_עדולם_Blueprint_v2.0.md`
- `docs/specs/M01_CATALOG_INVENTORY_V1.md`
- future Order / Payment / Fulfillment specs
- `docs/roadmap/WEB_ROADMAP.md`
- `docs/ops/RAILWAY.md`

It does not supersede implementation-specific specs.

## 20. Next SDD actions

1. Approve this strategic baseline.
2. Finish and verify Web Roadmap W1.
3. Version the new Order Management spec in `docs/specs/`.
4. Version Checkout & Payment Orchestration spec.
5. Version Fulfillment & Logistics spec.
6. Create implementation issues from the gap table.
7. Execute through PRs and Railway production gates.

---

**Core rule:** build the current operating phase while preserving the architecture needed for the long-term vision.

## 21. Implementation issue map

The first execution backlog has been created in GitHub:

| Issue | Workstream | Strategic phase |
|---|---|---|
| #13 | Complete authoritative storefront catalog integration | Phase 1 |
| #14 | Server-side orders and order state machine | Phase 2 |
| #15 | Inventory reservations and idempotency | Phase 2 |
| #16 | Server-side checkout + cash / bank transfer / COD | Phase 3 |
| #17 | Fulfillment, local delivery and logistical COD | Phase 4 |
| #18 | Validate Honduras fiscal rules before CAI/ISV implementation | Phase 5 |

Issues #5 (domain registration) and #8 (future mobile app) remain separate external/future work and do not block the Commerce Core sequence.

This mapping is the initial execution ledger. New work should be linked back to a strategic gap or an approved SPEC before implementation.

