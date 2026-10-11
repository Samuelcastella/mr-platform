-- M15: provider-neutral indicative financing records, no lender ledger.
-- Execute with deployment's migration runner. Never auto-seed unverified offers.
BEGIN;
CREATE SCHEMA IF NOT EXISTS financing;
CREATE TABLE IF NOT EXISTS financing.providers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','ACTIVE','SUSPENDED','RETIRED')),
  adapter_type text NOT NULL DEFAULT 'MANUAL',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS financing.offer_versions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_id bigint NOT NULL REFERENCES financing.providers(id),
  term_months integer NOT NULL CHECK(term_months BETWEEN 1 AND 120),
  annual_nominal_bps integer NOT NULL CHECK(annual_nominal_bps BETWEEN 0 AND 100000),
  setup_fee_minor bigint NOT NULL DEFAULT 0 CHECK(setup_fee_minor >= 0),
  periodic_fee_minor bigint NOT NULL DEFAULT 0 CHECK(periodic_fee_minor >= 0),
  insurance_periodic_minor bigint NOT NULL DEFAULT 0 CHECK(insurance_periodic_minor >= 0),
  verified_at timestamptz,
  valid_until timestamptz,
  source_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_until IS NULL OR verified_at IS NULL OR valid_until >= verified_at)
);
CREATE TABLE IF NOT EXISTS financing.quotes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  offer_version_id bigint REFERENCES financing.offer_versions(id),
  external_order_ref text,
  currency char(3) NOT NULL DEFAULT 'HNL' CHECK(currency='HNL'),
  purchase_minor bigint NOT NULL CHECK(purchase_minor > 0),
  down_payment_minor bigint NOT NULL DEFAULT 0 CHECK(down_payment_minor >= 0 AND down_payment_minor <= purchase_minor),
  simulation_snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'INDICATIVE' CHECK(status IN ('INDICATIVE','EXPIRED','SUBMITTED')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS financing.applications (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  quote_id bigint NOT NULL REFERENCES financing.quotes(id),
  idempotency_key text NOT NULL UNIQUE,
  provider_application_reference text UNIQUE,
  status text NOT NULL DEFAULT 'CREATED' CHECK(status IN ('CREATED','HANDED_OFF','PENDING','APPROVED','REJECTED','EXPIRED','CANCELLED','ERROR')),
  decision_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS financing.provider_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_id bigint NOT NULL REFERENCES financing.applications(id),
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  authenticated boolean NOT NULL DEFAULT false,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(application_id,provider_event_id)
);
CREATE TABLE IF NOT EXISTS financing.audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_ref text,
  entity_type text NOT NULL,
  entity_id bigint NOT NULL,
  operation text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  happened_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
