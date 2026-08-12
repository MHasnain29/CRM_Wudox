-- Persist who sent the employee onboarding PandaDoc agreement (for signed/declined CRM notifications).
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "onboarding_sent_by_id" TEXT;

CREATE INDEX IF NOT EXISTS "employees_onboarding_sent_by_id_idx" ON "employees"("onboarding_sent_by_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'employees_onboarding_sent_by_id_fkey'
  ) THEN
    ALTER TABLE "employees"
      ADD CONSTRAINT "employees_onboarding_sent_by_id_fkey"
      FOREIGN KEY ("onboarding_sent_by_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
