BEGIN;

ALTER TABLE "daily_report_policies"
  ADD COLUMN "recipient_email" TEXT,
  ADD COLUMN "authorized_by_id" TEXT;

-- A new external destination must be explicitly saved by an authorized admin.
-- Retain legacy selections as history; do not guess which address should receive all users.
UPDATE "daily_report_policies"
SET "enabled" = false, "recipients_configured" = false, "updated_at" = CURRENT_TIMESTAMP;

UPDATE "daily_report_settings" SET "enabled" = false, "updated_at" = CURRENT_TIMESTAMP;

COMMIT;
