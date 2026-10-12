-- M04.2: immutable line-level snapshots for consolidated freight quotes.
-- The parent quote is still the sole source of the accepted shipping total.
CREATE TABLE IF NOT EXISTS heavy_logistics_quote_lines (
  id BIGSERIAL PRIMARY KEY,
  quote_id BIGINT NOT NULL REFERENCES heavy_logistics_quotes(id) ON DELETE RESTRICT,
  variant_id BIGINT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  actual_grams BIGINT NOT NULL CHECK (actual_grams > 0),
  volumetric_grams BIGINT NOT NULL CHECK (volumetric_grams > 0),
  billable_grams BIGINT NOT NULL CHECK (billable_grams >= actual_grams AND billable_grams >= volumetric_grams),
  shipping_minor BIGINT NOT NULL CHECK (shipping_minor >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(quote_id, variant_id)
);
CREATE INDEX IF NOT EXISTS idx_heavy_quote_lines_quote ON heavy_logistics_quote_lines(quote_id);
