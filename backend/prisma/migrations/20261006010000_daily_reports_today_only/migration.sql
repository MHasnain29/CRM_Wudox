BEGIN;

ALTER TABLE "daily_report_policies" ALTER COLUMN "period" SET DEFAULT 'today';

UPDATE "daily_report_policies"
SET "period" = 'today', "updated_at" = CURRENT_TIMESTAMP
WHERE "period" <> 'today';

COMMIT;
