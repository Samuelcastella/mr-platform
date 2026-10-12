-- M04.1 immutable server-side quote snapshots, not yet wired into checkout.
CREATE TABLE IF NOT EXISTS heavy_logistics_quotes (
  id BIGSERIAL PRIMARY KEY,
  public_token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  variant_id BIGINT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  rate_id BIGINT NOT NULL REFERENCES carrier_heavy_rates(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  department TEXT NOT NULL,
  service_type TEXT NOT NULL CHECK (service_type IN ('LOCAL_DELIVERY','COURIER')),
  actual_grams INTEGER NOT NULL CHECK (actual_grams > 0),
  volumetric_grams INTEGER NOT NULL CHECK (volumetric_grams > 0),
  billable_grams INTEGER NOT NULL CHECK (billable_grams >= actual_grams AND billable_grams >= volumetric_grams),
  shipping_minor BIGINT NOT NULL CHECK (shipping_minor >= 0),
  currency CHAR(3) NOT NULL CHECK (currency = 'HNL'),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACCEPTED','EXPIRED','CANCELLED')),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (expires_at > created_at),
  CHECK ((status = 'ACCEPTED') = (accepted_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_heavy_quotes_one_accepted_per_order
ON heavy_logistics_quotes(order_id) WHERE status = 'ACCEPTED';
CREATE INDEX IF NOT EXISTS idx_heavy_quotes_order ON heavy_logistics_quotes(order_id, created_at DESC);
