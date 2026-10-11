# M15 — Credit comparator, amortization and provider boundary

This is a provider-neutral, indicative calculator. All displayed vendor terms must have documentary verification and explicit expiry. CrediLee and Mendels cannot be labeled live offers absent signed terms.

## Calculator
`services/catalog-api/credit-finance.ts` calculates fixed monthly amortization on outstanding balance in HNL centavos, including initial payment, setup fees, periodic administration fees and insurance. The annualized cash-flow yield is indicative and does not assert regulatory APR/CAT equivalence. Rounding differs by lender contract.

Tests: `bun test services/catalog-api/test/credit-finance.test.ts`.

## Database
`db/migrations/015_credit_provider_financing.sql` is an opt-in additive migration. Apply to staging, validate and back up production before rollout; do not run automatically on app startup. No providers or offers are seeded.

## Security and fulfillment
Provider underwriting stays external. Application approval alone never settles an order and never decrements on-hand inventory. Verified disbursement or binding lender guarantee must flow through the existing M03 payment state machine; inventory reservation/consumption must remain within authoritative checkout transactions. Callback signature authentication, replay protection, idempotency, RBAC, CSRF and audit review are required before enabling a live adapter.

## Deployment gates
1. Run unit and checkout concurrency tests and check existing CI.
2. Apply migration to staging and review locks and rollback.
3. Provide verified commercial terms, integration credentials and signed provider callback contract.
4. Build authenticated API route and Control Center view, with authorized staff roles.
5. Verify end-to-end payment, reservation, late-payment, Kardex and reconciliation in staging.
6. Only then deploy behind a disabled feature flag, perform production smoke tests and enable for approved users.
