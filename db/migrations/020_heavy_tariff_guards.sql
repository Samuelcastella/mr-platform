-- M04.3: optional contract components, fail-closed dimensional limit.
-- Additive and idempotent; do not activate unverified carrier prices here.
-- Apply this migration BEFORE deploying API code that selects these columns.
ALTER TABLE carrier_heavy_rates
  ADD COLUMN IF NOT EXISTS handling_minor BIGINT NOT NULL DEFAULT 0
    CHECK (handling_minor >= 0),
  ADD COLUMN IF NOT EXISTS minimum_minor BIGINT NOT NULL DEFAULT 0
    CHECK (minimum_minor >= 0),
  ADD COLUMN IF NOT EXISTS max_edge_cm INTEGER
    CHECK (max_edge_cm > 0);

COMMENT ON COLUMN carrier_heavy_rates.handling_minor IS
  'Carrier-approved fixed handling surcharge per separate shipped unit, in HNL centavos';
COMMENT ON COLUMN carrier_heavy_rates.minimum_minor IS
  'Carrier-approved floor for each unit shipping charge, in HNL centavos';
COMMENT ON COLUMN carrier_heavy_rates.max_edge_cm IS
  'Maximum longest edge in cm. NULL means no dimension threshold configured';
