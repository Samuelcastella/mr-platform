# MR עדולם — Strategic Baseline Honduras v2

**Status:** PROPOSED FOR APPROVAL
**Method:** Spec-Driven Development (SDD)
**Baseline date:** 2026-10-08
**Supersedes on approval:** STRATEGIC_BASELINE_HONDURAS_V1.md
**Scope:** Honduras first, architecture prepared for multi-location, multi-channel, hybrid inventory ownership, third-party commerce and multi-country evolution.

## 1. Purpose

This document aligns the strategic roadmap with the full project knowledge base consolidated through 2026-10-08.

It preserves the validated execution spine of the original roadmap while incorporating newly confirmed requirements from project conversations and the merged documentation set.

The roadmap now connects:

Market evidence
→ conversation-derived knowledge
→ strategic decisions
→ approved/proposed SPECs
→ production gap analysis
→ implementation sequence
→ operational controls
→ expansion capabilities

The rule remains: **do not rebuild what already works. Close explicit gaps between Baseline V0 and the approved target operating model.**

## 2. What changed from v1

The v1 roadmap correctly prioritized the Commerce Core, but it predated several project decisions now documented.

v2 adds explicit roadmap treatment for:

- hybrid commerce: MR-owned + third-party inventory;
- seller economic ownership and settlement;
- controlled inventory adjustments and shrinkage approval;
- staff sales commissions and incentive accounting;
- operational Health Desk and exception management;
- external credit-provider adapters;
- broader Control Center operating model;
- supplier / seller distinction;
- multicategory expansion evidence;
- pricing and promotions as a still-pending policy domain;
- stronger traceability from conversation knowledge to roadmap/SPEC/code.

These additions **do not replace** the Commerce Core sequence. They change where supporting capabilities enter the roadmap and what later phases must contain.

## 3. Evidence hierarchy

Decisions must distinguish:

1. **Observed market evidence** — external research and operating observations.
2. **Conversation-derived project knowledge** — user decisions, operating needs and project-specific requirements.
3. **Strategic decision** — a direction accepted for MR עדולם.
4. **Implementation requirement** — a requirement governed by a SPEC.
5. **Implementation fact** — code, schema or deployed behavior verified in repository/Railway.

Dynamic market, legal, fiscal, credit and provider facts must be revalidated before becoming production rules.

## 4. Core strategic position

MR עדולם is not merely a boutique website.

It is a Honduras-first omnichannel commerce platform growing from an existing physical operation.

The strategic progression is:

Boutique operation
→ authoritative omnichannel Commerce Core
→ controlled hybrid commerce
→ third-party seller operations
→ marketplace capabilities
→ broader commercial ecosystem

The architecture should support the end-state without forcing end-state complexity into the immediate MVP.

## 5. North-star vision

> **MR עדולם will become a Honduras-native, omnichannel and scalable commerce platform that combines MR-owned and third-party products, authoritative inventory, local logistics, multiple payment methods, controlled seller economics and an operational Control Center, while preserving clean boundaries for future marketplace, credit and financial integrations.**

The boutique remains the first operating channel and learning environment, not the architectural limit.

## 6. Confirmed strategic principles

- Mobile-first customer experience.
- WhatsApp is a real commercial channel.
- Store, phone, WhatsApp, web and future app converge into the same commercial authority.
- Catalog, inventory, orders and payment state become server-authoritative.
- Cash, bank transfer and COD are first-class payment methods.
- Hybrid inventory ownership is a confirmed model.
- Product merchandising classification must remain separate from economic inventory ownership.
- Third-party seller settlement is operational/commercial, not a bank ledger.
- Inventory adjustments require traceability; higher-risk shrinkage requires approval/evidence.
- Staff commissions are separate from payroll and seller settlements.
- Health Desk must make business and technical exceptions visible without bypassing governing modules.
- Credit is an external-provider capability/adapter; MR is not assumed to be a lender.
- Fiscal logic is implemented only after current Honduras requirements are validated.
- LIRA remains an independent financial platform connected by adapter only.
- Market research remains an ongoing input.
- No new infrastructure is introduced solely because it appeared in historical architecture research.

## 7. Verified production baseline

Baseline V0 remains the existing Railway/repository implementation, including:

- storefront;
- catalog-api;
- control-center;
- Postgres;
- current product/inventory/order/payment/fulfillment work;
- existing private operational surfaces.

The system is extended rather than casually rewritten.

Repository verification on 2026-10-08 also confirmed that inventory movement values already used in code include:

- INITIAL_STOCK
- PURCHASE_RECEIPT
- SALE
- CUSTOMER_RETURN
- ADJUSTMENT

Documentation amendments must respect deployed behavior before proposing schema migrations.

## 8. Target operating domains

The long-term MR operating model now includes these bounded capabilities.

### Commerce Core

- catalog;
- categories;
- variants / SKU;
- media;
- prices;
- authoritative inventory;
- Kardex / inventory movements;
- orders;
- reservations;
- checkout;
- payment orchestration;
- fulfillment;
- returns.

### Operating Control

- staff identity;
- roles / permissions;
- audit;
- inventory adjustments;
- shrinkage workflow;
- approvals;
- Health Desk;
- exception queues;
- reconciliation support.

### Commercial Network

- suppliers;
- procurement;
- sellers;
- commercial agreements;
- economic inventory ownership;
- commissions / margin rules;
- third-party settlements;
- future seller portal / marketplace.

### Customer / Growth

- CRM;
- WhatsApp commerce;
- channel attribution;
- staff sales attribution;
- commissions;
- analytics;
- pricing / promotions when policy is approved.

### External / Regulated Integrations

- fiscal / SAR / CAI;
- couriers;
- payment providers;
- credit providers;
- LIRA;
- future external marketplaces.

## 9. Updated gap analysis

| Capability | Current / verified state | Target | Roadmap treatment |
|---|---|---|---|
| Catalog | backend exists | authoritative catalog | immediate core |
| Variants / SKU | partial | exact sellable variants | immediate core |
| Inventory / Kardex | implemented in part | authoritative per location with reservations | immediate core |
| Inventory ownership | not first-class in verified code | MR-owned / consignment / third-party source attribution | core-compatible design, activate with M11 |
| Orders | server-side work exists | authoritative order lifecycle | immediate core |
| Checkout | partial | server-authoritative | immediate core |
| Payments | offline orchestration defined | cash / transfer / COD + adapters | immediate core |
| Fulfillment | defined/implemented in parts | pickup/delivery/attempts/RTO/COD | immediate core |
| Returns | defined | inspected post-sale return workflow | near-core |
| Staff identity / RBAC | present but evolving | permission-based operations | near-core |
| Inventory adjustments / shrinkage | generic adjustment exists | governed request/evidence/approval workflow | operational hardening |
| Health Desk | conceptual / partial signals | unified incident and exception surface | operational hardening |
| Suppliers / procurement | defined and implemented in parts | purchase / receipt / sourcing authority | near-core |
| Hybrid sellers | model confirmed | seller ownership + agreements + settlements | controlled expansion |
| Staff commissions | requirement confirmed | event-driven accrual/reversal/statements | controlled expansion |
| Credit | external research / no core support | provider-neutral adapter | later integration |
| Fiscal Honduras | validation boundary exists | production fiscal implementation after verification | compliance gate |
| Pricing/promotions | base pricing exists | policy-driven promotions/funding/stacking | pending business policy |
| Marketplace | future | seller self-service / broader third-party commerce | after stable hybrid core |

## 10. Roadmap structure

The roadmap is divided into:

- **Execution spine** — capabilities that must be completed in sequence.
- **Parallel hardening tracks** — design/control work that can proceed without blocking the spine.
- **Expansion tracks** — activated only after their dependencies are stable.

This prevents new requirements from derailing the Commerce Core while ensuring they are not forgotten.

# EXECUTION SPINE

## Phase 0 — Preserve Baseline V0

Objective: protect working production behavior.

Actions:

- keep verified Railway services;
- no rewrite without an explicit requirement;
- PR + automated tests + deployment verification for production changes;
- inspect production schema before migration proposals;
- preserve historical documents through versioning/supersession rather than silent rewriting.

Exit criterion: every new work item is traceable to a roadmap gap and governing SPEC.

## Phase 1 — Authoritative Catalog, Variants and Inventory

Priority: **Immediate**

Complete:

- database-backed storefront catalog;
- categories and product lifecycle;
- exact variants / SKU;
- media;
- HNL storefront pricing;
- inventory by location;
- authoritative availability;
- inventory movement contract aligned to implemented values;
- remove demo/local stock as authority.

Hybrid-readiness requirement:

- do not overload Product.commercial_model with inventory ownership;
- reserve a clean extension point for inventory source / economic owner.

Related specs:

- M01
- future M01 v2 amendment
- M12 integration boundary

Exit criterion: customers see authoritative products/variants/availability and every stock-changing event is traceable.

## Phase 2 — Orders, Reservations and Channel Authority

Priority: **Immediate / Next**

Complete:

- server-side orders;
- immutable OrderItem snapshots;
- reservation / release / consumption;
- idempotency;
- channel: STORE / PHONE / WHATSAPP / WEB / APP / MARKETPLACE;
- concurrency protection;
- order tracking.

New alignment requirements:

- reserve OrderItem commercial snapshot hook for M11;
- reserve staff attribution hook for M13;
- preserve mixed commercial ownership capability without requiring open marketplace.

Related specs:

- M02
- future M02 v2 amendment
- M11
- M13

Exit criterion: real orders are authoritative server-side and safe from overselling/duplicate submission.

## Phase 3 — Checkout and Honduras Payment Orchestration

Priority: **High**

Complete:

- authoritative totals;
- checkout session;
- CASH;
- BANK_TRANSFER;
- CASH_ON_DELIVERY;
- manual confirmation rules;
- independent order/payment states;
- payment attempts;
- adapter contract;
- idempotency.

Alignment requirements:

- seller settlement may observe payment state but never lives inside Payment;
- staff commission may observe qualifying payment state;
- future M15 credit provider connects through a versioned adapter extension;
- LIRA remains external.

Related specs:

- M03
- M11
- M13
- M15

Exit criterion: a real order completes checkout using Honduras-relevant payment methods without a provider-specific core.

## Phase 4 — Fulfillment, Delivery and Returns

Priority: **High**

Complete:

- store pickup;
- local delivery;
- delivery zones;
- descriptive address;
- attempts;
- proof of delivery;
- failed delivery;
- return-to-origin;
- COD collection/reconciliation boundary;
- customer returns and inspection.

Alignment requirements:

- Health Desk receives fulfillment backlog/failure signals;
- M11 receives stable return events for seller economic reversals;
- M13 receives stable return events for commission reversals;
- third-party seller-managed fulfillment remains later scope.

Related specs:

- M04
- M09
- M11
- M13
- M14

Exit criterion: physical order lifecycle and post-sale returns are auditable.

## Phase 5 — Identity, RBAC, Audit and Operational Controls

Priority: **High after core transaction flow is stable**

Complete/harden:

- StaffUser identity;
- permission-based authorization;
- role scoping;
- audit actor;
- secure administrative operations;
- CSRF/session hardening;
- sensitive-action policies.

Add permissions and operating controls for:

- seller agreements / settlements;
- inventory adjustment approvals;
- commissions;
- Health Desk;
- credit-provider support.

Related specs:

- M06
- future M06 v2 amendment
- M11
- M12
- M13
- M14
- M15

Exit criterion: every sensitive internal mutation has an authenticated actor and appropriate permission.

# PARALLEL HARDENING TRACKS

## Track A — Inventory Adjustments & Shrinkage

This track should be designed early and activated after identity/approval prerequisites are available.

Capabilities:

- adjustment request;
- reason codes;
- evidence;
- risk level;
- approval policy;
- segregation of duties;
- idempotent posting;
- shrinkage analytics;
- seller-liability handoff where applicable.

Related spec: M12.

Important dependency:

M12 does not replace M01 InventoryMovement; it governs exceptional adjustment workflow before posting.

## Track B — Operational Health Desk

Health Desk design can proceed in parallel with core implementation because it mainly defines observability contracts.

Initial signals:

- reservation expiry backlog;
- stuck orders;
- payment verification backlog;
- failed webhooks;
- fulfillment backlog;
- failed delivery;
- queue failures;
- fiscal provider / CAI operational alerts when M05 has authoritative data.

M14 observes domains; it does not bypass them.

Related spec: M14.

## Track C — Honduras Fiscal Validation

Continue research and validation in parallel.

Do not activate production fiscal issuance until validated:

- taxpayer data;
- CAI/ranges;
- document formats;
- tax treatment;
- shipping treatment;
- return/exchange treatment;
- seller-of-record implications for hybrid commerce.

Related spec: M05.

Hybrid-commerce fiscal question is now explicit:

**Who issues the fiscal document and bears fiscal responsibility under each third-party commercial mode?**

That decision is required before live seller settlement/marketplace activation.

# CONTROLLED EXPANSION

## Phase 6 — Suppliers, Procurement and Hybrid Inventory Operations

This phase turns the confirmed hybrid model into controlled operating capability without opening a public marketplace.

Complete:

- supplier master;
- purchase orders;
- goods receipts;
- landed cost;
- inventory source / economic ownership;
- seller account;
- seller agreements;
- MR-owned vs third-party inventory;
- consignment / commission / wholesale-margin modes;
- owner/liability context through stock lifecycle.

Related specs:

- M08
- M11
- M12

Exit criterion: MR can operate both owned and selected third-party inventory with traceable economics.

## Phase 7 — Seller Settlement

Activate after authoritative orders/payments/returns are stable.

Complete:

- order-line commercial snapshots;
- seller eligibility rules;
- settlement statements;
- discount/fee allocation;
- return reversals;
- manual adjustments;
- approval;
- external payout reference / operational mark-paid.

Do not create bank/accounting ledger behavior.

Related spec: M11.

Exit criterion: third-party seller economics reconcile to immutable commerce events.

## Phase 8 — Staff Commissions & Incentives

Activate after staff attribution and authoritative sales events are stable.

Complete:

- salesperson attribution;
- versioned commission rules;
- accruals;
- reversals;
- statements;
- approval;
- payout confirmation;
- privacy by role.

Business policy still required:

- earning trigger;
- commission rates;
- discount treatment;
- shipping treatment;
- seller-owned inventory treatment;
- payout frequency.

Related spec: M13.

Exit criterion: commissions reconcile to authoritative commercial events and returns.

## Phase 9 — Credit Provider Integrations

Credit remains an external-provider capability.

Before activation:

- revalidate provider terms;
- define MR legal/commercial role;
- approve adapter contract;
- implement authenticated callbacks;
- add disclosure and failure handling;
- protect sensitive application data.

Provider examples researched in conversations are evidence only, not hardcoded choices.

Related spec: M15.

Exit criterion: a provider can be added/removed without breaking cash/transfer/COD or turning MR into a lender ledger.

## Phase 10 — Marketplace Readiness and Seller Self-Service

Only after controlled hybrid operations are stable.

Potential scope:

- seller onboarding;
- seller portal;
- seller-managed catalog submissions;
- seller-specific inventory;
- moderation;
- seller fulfillment where approved;
- marketplace reporting;
- broader settlement automation.

The existing vendor/supplier surfaces should be extended, not replaced without evidence.

## Phase 11 — Ecosystem Expansion

Future capabilities:

- LIRA adapter;
- additional payment providers;
- courier integrations;
- external marketplace connectors;
- international sourcing;
- private label / owned product expansion;
- broader analytics;
- mobile app;
- multicountry capabilities.

# BUSINESS POLICY WORKSTREAMS

## 11. Customer and category strategy

Conversation research expanded knowledge across:

- adult fashion;
- youth / graduation / beach;
- infant / family;
- older adult / adaptive opportunity;
- activewear;
- artisan footwear;
- appliances;
- furniture / home.

Roadmap rule:

These are commercial research inputs, not automatic implementation categories.

Pending decisions:

- primary launch customer;
- launch assortment;
- category priority;
- price positioning;
- stock depth.

Platform taxonomy should remain flexible enough to support future categories.

## 12. Pricing & Promotions

Base price is governed by M01.

A separate Pricing & Promotions SPEC should be created only after business rules are approved for:

- markdowns;
- promotion funding;
- seller vs MR discount allocation;
- stacking;
- coupon eligibility;
- date windows;
- channel-specific offers;
- approval thresholds;
- margin floors.

Until then, do not invent a promotion engine.

## 13. Logistics policy

Technical logistics exists in M04, but commercial policy still requires decisions on:

- launch coverage;
- zone pricing;
- free-shipping thresholds;
- courier selection;
- oversized-item handling;
- return logistics;
- SLA targets.

Dynamic courier prices and coverage must be revalidated.

## 14. Returns policy

M09 defines the technical return domain.

Business/legal policy still needs final decisions for:

- return window;
- category exclusions;
- hygiene-sensitive items;
- exchanges;
- store credit;
- refund method;
- seller liability;
- shipping cost responsibility.

## 15. Hybrid seller policy

Before broad third-party activation, approve:

- seller onboarding criteria;
- accepted commercial modes;
- default settlement frequency;
- commission ranges;
- liability allocation;
- return allocation;
- shrinkage liability;
- promotion funding;
- seller service levels.

# CONTROL CENTER ROADMAP

## 16. Control Center target modules

The Control Center evolves around operating work rather than only CRUD.

Target surfaces:

- dashboard / daily operations;
- catalog;
- inventory;
- Kardex;
- orders;
- customers;
- suppliers;
- procurement;
- fulfillment;
- returns;
- payments;
- reconciliation support;
- sellers;
- seller agreements;
- settlements;
- inventory adjustments;
- shrinkage approvals;
- staff;
- roles;
- commissions;
- audit;
- Health Desk;
- configuration.

Existing modules remain starting points.

# TRACEABILITY AND GOVERNANCE

## 17. Traceability chain

Every significant capability should follow:

Evidence / conversation knowledge
→ strategic decision
→ roadmap phase
→ requirement
→ SPEC
→ implementation issue
→ code / migration
→ automated tests
→ Railway deployment
→ production verification
→ KPI

No feature should jump directly from conversation to production.

## 18. Decision gates

A capability moves to production only when:

1. roadmap placement is explicit;
2. governing SPEC is approved;
3. dependencies are satisfied;
4. data migration impact is reviewed;
5. code is versioned;
6. tests pass;
7. Railway deployment succeeds;
8. production flow is verified;
9. relevant telemetry exists;
10. regulatory/provider assumptions are currently validated where applicable.

## 19. Updated immediate execution order

The immediate execution spine remains:

1. complete authoritative catalog integration;
2. make variants and stock authoritative;
3. normalize/document inventory movement contract against actual implementation;
4. implement/finish server-side orders;
5. implement reservations and idempotency;
6. implement/finish server-side checkout;
7. complete cash / transfer / COD orchestration;
8. complete fulfillment / local delivery / returns;
9. harden staff identity, roles and audit;
10. activate governed inventory-adjustment/shrinkage workflow;
11. establish Health Desk signals for the stabilized core;
12. validate and implement Honduras fiscal requirements;
13. activate controlled hybrid seller ownership/agreements;
14. activate seller settlement;
15. activate staff commissions after policy approval;
16. integrate external credit provider(s) only after validation;
17. move toward marketplace self-service only after controlled hybrid operations are stable.

This is the same Commerce Core path as v1, expanded so newly accepted capabilities have explicit placement.

## 20. Implementation issue strategy

Existing issues remain valid where they still map to the execution spine.

New issues should be created only for approved increments, especially:

- M01 v2 amendment implementation;
- M02 v2 amendment implementation;
- M06 v2 permission expansion;
- M12 adjustment/shrinkage workflow;
- M14 Health Desk;
- M11 hybrid ownership / settlement;
- M13 commissions;
- M15 credit adapter when provider work is approved.

Do not create implementation issues for unresolved pricing/promotion policy.

## 21. KPI expansion

Core commerce:

- storefront → product conversion;
- cart → checkout conversion;
- checkout completion;
- WhatsApp-assisted conversion;
- ticket average;
- cancellation rate;
- return rate.

Inventory:

- stockout rate;
- inventory accuracy;
- shrinkage units/value;
- count variance;
- inventory turnover;
- days of inventory.

Operations:

- order cycle time;
- packing time;
- delivery success;
- failed-delivery rate;
- reservation backlog;
- payment-verification backlog;
- incident age / resolution time.

Economics:

- gross margin by SKU/category;
- margin by supplier;
- seller commission / take rate;
- settlement payable;
- staff commission;
- returns impact;
- logistics cost contribution.

Network:

- seller mix;
- supplier performance;
- third-party inventory rotation;
- seller settlement aging.

## 22. Baseline decision

Current production remains **MR עדולם Baseline V0**.

Strategic Baseline v2 does not declare proposed features implemented.

Its purpose is to align the roadmap with the current knowledge and approved/proposed design artifacts while preserving the verified production baseline.

## 23. Relationship to project artifacts

Primary inputs:

- docs/CONVERSATION_KNOWLEDGE_CONSOLIDATION_2026-10-08.md
- docs/PROJECT_CONTEXT_MEMORY.md
- docs/roadmap/STRATEGIC_BASELINE_HONDURAS_V1.md
- docs/research/*
- docs/architecture/*
- M01-M10
- M11 Hybrid Seller Ownership & Settlement
- M12 Inventory Adjustments, Shrinkage & Approval
- M13 Staff Commissions & Incentives
- M14 Operational Health Desk
- M15 Credit Provider Adapter Boundary
- M11-M15 Dependency & Impact Matrix

On approval, this v2 roadmap becomes the strategic bridge for subsequent SPEC amendments and implementation issues.

## 24. Next SDD actions

1. Review and approve Strategic Baseline Honduras v2.
2. Version M01 amendment against actual schema/code.
3. Version M02 amendment for commercial snapshots and staff attribution hooks.
4. Version M06 amendment for M11-M15 permissions.
5. Continue existing Commerce Core implementation sequence.
6. Create M12/M14 implementation issues only when dependencies are ready.
7. Keep M11/M13/M15 implementation behind their dependency and policy gates.
8. Create Pricing & Promotions SPEC only after business policy is defined.

---

**Core rule:** new knowledge must change the roadmap when it materially changes the target operating model, but it must not destabilize the proven execution sequence without evidence.
