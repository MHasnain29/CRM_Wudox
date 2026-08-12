-- Per-agency Twilio subaccount credentials
ALTER TABLE "phone_agency_configs" ADD COLUMN IF NOT EXISTS "twilio_account_sid" TEXT;
ALTER TABLE "phone_agency_configs" ADD COLUMN IF NOT EXISTS "twilio_auth_token_enc" TEXT;
ALTER TABLE "phone_agency_configs" ADD COLUMN IF NOT EXISTS "twilio_api_key_sid" TEXT;
ALTER TABLE "phone_agency_configs" ADD COLUMN IF NOT EXISTS "twilio_api_key_secret_enc" TEXT;
ALTER TABLE "phone_agency_configs" ADD COLUMN IF NOT EXISTS "twilio_twiml_app_sid" TEXT;
ALTER TABLE "phone_agency_configs" ADD COLUMN IF NOT EXISTS "twilio_region" TEXT;

CREATE INDEX IF NOT EXISTS "phone_agency_configs_twilio_account_sid_idx" ON "phone_agency_configs"("twilio_account_sid");

-- Unique E.164 per system (drop duplicates first if any — keep earliest row)
CREATE UNIQUE INDEX IF NOT EXISTS "phone_numbers_e164_key" ON "phone_numbers"("e164");
