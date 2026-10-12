-- M04.1 additive schema; no live tariffs seeded.
CREATE TABLE IF NOT EXISTS product_shipping_profiles (
  variant_id BIGINT PRIMARY KEY REFERENCES product_variants(id) ON DELETE CASCADE,
  weight_grams INTEGER NOT NULL CHECK (weight_grams > 0),
  length_cm INTEGER NOT NULL CHECK (length_cm > 0),
  width_cm INTEGER NOT NULL CHECK (width_cm > 0),
  height_cm INTEGER NOT NULL CHECK (height_cm > 0),
  requires_special_handling BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS carrier_heavy_rates (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  department TEXT NOT NULL,
  service_type TEXT NOT NULL CHECK (service_type IN ('LOCAL_DELIVERY','COURIER')),
  active BOOLEAN NOT NULL DEFAULT FALSE,
  base_minor BIGINT NOT NULL CHECK (base_minor >= 0),
  included_grams INTEGER NOT NULL CHECK (included_grams >= 0),
  additional_minor_per_kg BIGINT NOT NULL CHECK (additional_minor_per_kg >= 0),
  volumetric_divisor INTEGER NOT NULL CHECK (volumetric_divisor > 0),
  max_billable_grams INTEGER CHECK (max_billable_grams > 0),
  currency CHAR(3) NOT NULL DEFAULT 'HNL' CHECK (currency = 'HNL'),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);
CREATE INDEX IF NOT EXISTS idx_carrier_heavy_rates_lookup
ON carrier_heavy_rates(department, service_type, active, effective_from DESC);
