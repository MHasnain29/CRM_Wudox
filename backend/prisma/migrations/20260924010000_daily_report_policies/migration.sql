BEGIN;

CREATE TABLE "daily_report_policies" (
  "id" TEXT NOT NULL PRIMARY KEY, "scope" TEXT NOT NULL, "scope_id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false, "send_hour" INTEGER NOT NULL DEFAULT 8,
  "send_minute" INTEGER NOT NULL DEFAULT 0, "timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
  "shift_hours" INTEGER NOT NULL DEFAULT 8, "period" TEXT NOT NULL DEFAULT 'previous_day',
  "recipient_user_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "recipients_configured" BOOLEAN NOT NULL DEFAULT false, "send_to_managers" BOOLEAN NOT NULL DEFAULT false,
  "profiles" TEXT[] NOT NULL DEFAULT ARRAY['software','marketing_sales','recruitment','general']::TEXT[],
  "agency_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "daily_report_policies_scope_scope_id_key" ON "daily_report_policies"("scope", "scope_id");
INSERT INTO "daily_report_policies" ("id","scope","scope_id","enabled","send_hour","send_minute","timezone","shift_hours","period","send_to_managers","agency_ids","created_at","updated_at")
SELECT "id",'agency',"sub_company_id","enabled","send_hour","send_minute","timezone","shift_hours",'today',true,ARRAY["sub_company_id"],"created_at","updated_at" FROM "daily_report_settings";
CREATE TABLE "report_profile_assignments" (
  "id" TEXT NOT NULL PRIMARY KEY, "main_org_id" TEXT NOT NULL, "subject_type" TEXT NOT NULL,
  "subject_id" TEXT NOT NULL, "profile" TEXT NOT NULL, "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "changed_by_id" TEXT NOT NULL
);
CREATE INDEX "report_profile_assignments_scope_idx" ON "report_profile_assignments"("main_org_id","subject_type","subject_id","effective_from");
CREATE TABLE "daily_report_snapshots" (
  "id" TEXT NOT NULL PRIMARY KEY, "policy_id" TEXT NOT NULL REFERENCES "daily_report_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "recipient_id" TEXT NOT NULL, "report_date" TEXT NOT NULL, "preview" BOOLEAN NOT NULL DEFAULT false,
  "payload" JSONB NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "daily_report_snapshots_policy_id_report_date_idx" ON "daily_report_snapshots"("policy_id","report_date");
CREATE TABLE "daily_report_deliveries" (
  "id" TEXT NOT NULL PRIMARY KEY, "delivery_key" TEXT NOT NULL UNIQUE,
  "snapshot_id" TEXT NOT NULL UNIQUE REFERENCES "daily_report_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "recipient_id" TEXT NOT NULL, "recipient_email" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0, "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_until" TIMESTAMP(3), "last_error" TEXT, "provider_id" TEXT, "accepted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "daily_report_deliveries_status_next_attempt_at_idx" ON "daily_report_deliveries"("status","next_attempt_at");

COMMIT;
