-- Agency email signature visual builder config (JSON).
-- Stores v2 SignatureConfig; rendered HTML remains in email_signature_template.

ALTER TABLE "sub_companies"
  ADD COLUMN IF NOT EXISTS "email_signature_config" JSONB;
