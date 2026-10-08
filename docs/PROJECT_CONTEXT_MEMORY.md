# MR עדולם — Project Context Memory

**Status:** ACTIVE PROJECT CONTEXT  
**Purpose:** Durable project memory for decisions, constraints, operating context and direction that should remain available beyond individual chat sessions.  
**Last updated:** 2026-10-08

## 1. Core identity

- Brand: **MR עדולם**
- “Boutique” is the conversational/project workspace name, not the commercial brand name.
- Permanent naming rule: **עדולם must only appear in Hebrew** throughout the project.
- MR עדולם is a scalable commercial brand and platform, not only a boutique.
- Initial physical operation: Honduras.
- Remote coordination: United States.
- Sourcing: open to Honduras, the United States, China and other countries; never hardcode a single sourcing country.

## 2. Business objective

Build MR עדולם into a scalable commerce ecosystem that can support:

- physical retail;
- web storefront;
- future mobile app;
- own products;
- third-party products;
- second-hand products;
- marketplace / commission models;
- logistics and delivery;
- multiple payment methods;
- sourcing and procurement;
- future international trade.

The physical boutique is the first operating channel and learning environment, not the architectural limit.

## 3. Operating reality

Current boutique operations include:

- clothing;
- personal accessories;
- cosmetics;
- hygiene products;
- underwear and related merchandise;
- phone orders;
- walk-in sales;
- cash;
- bank transfer;
- in-store pickup;
- home delivery;
- an existing product list.

## 4. Methodology

The project follows **Spec-Driven Development (SDD)**.

Decision flow:

```text
Research / evidence
→ Diagnosis
→ Vision
→ Architecture
→ SPEC
→ Approval
→ Implementation
→ Verification
→ Production
→ Metrics
→ Iteration
```

Approved design must never be confused with implemented or verified functionality.

## 5. Strategic baseline

The Honduras market study is the strategic compass for the project.

The project now follows this progression:

```text
Boutique operation
→ Omnichannel commerce core
→ Platform for third parties
→ Marketplace
→ Broader commercial ecosystem
```

Current production is treated as **MR עדולם Baseline V0**.

The rule is: **do not rebuild what already works; close explicit gaps between Baseline V0 and the approved target vision.**

## 6. Market-informed priorities

The Honduras research reinforces these priorities:

- mobile-first experience;
- WhatsApp as a real commerce channel;
- exact product variants;
- authoritative inventory;
- cash;
- bank transfer;
- Cash on Delivery;
- local logistics;
- delivery tracking and failed-delivery handling;
- fiscal adaptation after current rules are verified;
- local brand differentiation;
- future digital credit only as a separate financial capability.

## 7. Confirmed commercial model

MR עדולם is explicitly a **hybrid commerce model** supporting MR-owned inventory and third-party products. The architecture must progressively distinguish inventory owner, supplier/seller, commercial modality, cost basis, price, margin or commission, settlement rule, returns liability and shrinkage liability.

Supporting the hybrid model in data does not mean activating an open self-service marketplace before the Commerce Core is stable.

## 8. Technical architecture

Primary repository:

`Samuelcastella/mr-platform`

Production platform:

**Railway — project MR עדולם**

Verified production services include:

- `storefront`;
- `catalog-api`;
- `control-center`;
- `Postgres`.

Architecture rule:

- Storefront is a client of the Commerce Core.
- PostgreSQL / server-side services are authoritative for commercial data.
- Browser-local state may be used for temporary UX state only.
- Catalog, inventory, orders, payments and fulfillment must progressively become authoritative server-side domains.

## 9. LIRA boundary

LIRA is an **independent financial platform**.

MR עדולם may integrate with LIRA through a versioned payment adapter, but:

- no shared database;
- no LIRA ledger inside MR;
- no duplication of LIRA financial accounting;
- MR must continue functioning with cash, transfer, COD and future providers without requiring LIRA.

## 10. Current execution order

1. Finish authoritative catalog integration.
2. Make variants and stock authoritative.
3. Implement server-side orders.
4. Implement inventory reservations and idempotency.
5. Implement server-side checkout.
6. Add cash / bank transfer / COD orchestration.
7. Implement fulfillment and local delivery.
8. Harden identity, roles and audit.
9. Validate Honduras fiscal requirements before production coding.
10. Activate marketplace and LIRA integrations only after the commerce core is stable.

## 11. Current project artifacts

Strategic documentation:

- `docs/roadmap/STRATEGIC_BASELINE_HONDURAS_V1.md`
- `docs/research/HONDURAS_RETAIL_OPERATING_PATTERNS_2026.md`
- `docs/research/Resumen_Ejecutivo.md`
- `docs/architecture/MR_עדולם_Blueprint_v2.0.md`
- `docs/specs/M01_CATALOG_INVENTORY_V1.md`
- `docs/CONVERSATION_KNOWLEDGE_CONSOLIDATION_2026-10-08.md`

Strategic PR:

- PR #12 — Honduras strategic baseline and gap roadmap.

Execution backlog:

- #13 authoritative storefront catalog;
- #14 server-side orders;
- #15 reservations + idempotency;
- #16 checkout + cash / transfer / COD;
- #17 fulfillment / local delivery / logistical COD;
- #18 Honduras fiscal validation.

## 12. Conversation-derived knowledge

The 2026-10-08 consolidation preserves new conversation research on Honduran competitors, customer segments, categories, credit, logistics, digital catalogs, local software, Kardex, shrinkage, staff commissions, Health Desk and the hybrid seller model.

Confirmed additions include:

- brand naming discipline: **MR עדולם**;
- “Boutique” is not the commercial name;
- hybrid owned + third-party commercial model;
- omnichannel authority across store, web, phone, WhatsApp and future app;
- future need for seller ownership and settlement rules;
- inventory adjustment / shrinkage approval requirements;
- staff commission requirements;
- Health Desk / operational exception visibility;
- credit as a separate future capability or adapter;
- multicategory research as expansion evidence, not immediate launch scope.

Dynamic external market facts from conversations must be revalidated before becoming public claims, contracts or production rules.

## 13. Memory rule for future work

When new research, decisions or operating facts materially affect MR עדולם:

1. Preserve the original meaning.
2. Classify it as evidence, decision, requirement or implementation fact.
3. Add it to the appropriate project artifact.
4. Link it to the relevant SPEC or issue when applicable.
5. Never silently overwrite historical decisions; version or supersede them explicitly.
6. Prefer inspecting repository, Railway and existing artifacts before asking the user for facts already available there.
7. Do not create a parallel roadmap when an authoritative roadmap already exists.

This file is a durable project-context index. Detailed research and implementation specifications remain in their dedicated documents.

---

**Project memory principle:** conversation informs the project, but durable decisions belong in versioned artifacts.
