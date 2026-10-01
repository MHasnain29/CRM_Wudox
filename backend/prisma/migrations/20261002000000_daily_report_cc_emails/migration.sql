ALTER TABLE "daily_report_policies"
  ADD COLUMN "cc_emails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
