-- Installation workflow foundation; deliberately separate from payments and inventory.
CREATE TABLE IF NOT EXISTS installation_jobs (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  fulfillment_id BIGINT REFERENCES fulfillments(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE,
  service_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'REQUESTED'
    CHECK (status IN ('REQUESTED','APPROVED','SCHEDULED','IN_PROGRESS','COMPLETED','FAILED','CANCELLED')),
  authorized_price_minor BIGINT CHECK (authorized_price_minor >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'HNL' CHECK (currency = 'HNL'),
  technician_reference TEXT,
  scheduled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  completion_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status NOT IN ('APPROVED','SCHEDULED','IN_PROGRESS','COMPLETED') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND authorized_price_minor IS NOT NULL)),
  CHECK (status <> 'COMPLETED' OR completed_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_installation_jobs_order ON installation_jobs(order_id, created_at DESC);
CREATE TABLE IF NOT EXISTS installation_job_events (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES installation_jobs(id) ON DELETE RESTRICT,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_installation_job_events_job ON installation_job_events(job_id, created_at);
