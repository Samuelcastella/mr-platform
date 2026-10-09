type DB = any;

export const PRODUCT_COMMERCIAL_MODELS = new Set([
  "third_party",
  "curated",
  "private_label",
  "owned"
]);

export const PRODUCT_CONDITIONS = new Set([
  "new",
  "second_hand",
  "refurbished"
]);

export function normalizeCommercialModel(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function normalizeProductCondition(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function validCommercialModel(value: unknown) {
  const normalized = normalizeCommercialModel(value);
  return PRODUCT_COMMERCIAL_MODELS.has(normalized) ? normalized : "";
}

export function validProductCondition(value: unknown) {
  const normalized = normalizeProductCondition(value);
  return PRODUCT_CONDITIONS.has(normalized) ? normalized : "";
}

export async function ensureProductClassificationSchema(db: DB) {
  await db`ALTER TABLE products ADD COLUMN IF NOT EXISTS commercial_model TEXT`;
  await db`ALTER TABLE products ADD COLUMN IF NOT EXISTS default_condition TEXT`;

  await db.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'products_commercial_model_check'
      ) THEN
        ALTER TABLE products
        ADD CONSTRAINT products_commercial_model_check
        CHECK (
          commercial_model IS NULL OR
          commercial_model IN ('third_party','curated','private_label','owned')
        );
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'products_default_condition_check'
      ) THEN
        ALTER TABLE products
        ADD CONSTRAINT products_default_condition_check
        CHECK (
          default_condition IS NULL OR
          default_condition IN ('new','second_hand','refurbished')
        );
      END IF;
    END
    $$;
  `);
}
