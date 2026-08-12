-- Form-only employee UI extras (photo ID metadata, licenses, extra edu/exp).
-- Never store SIN digits in this column.
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "ui_extras" JSONB;
