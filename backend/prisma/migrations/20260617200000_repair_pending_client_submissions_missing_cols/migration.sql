-- Repair: pending_client_submissions was missing these columns from the
-- 20260610120000_multi_level_approval_chains migration (partial execution).
-- All other tables already have these columns; IF NOT EXISTS guards prevent errors.

ALTER TABLE "pending_client_submissions"
  ADD COLUMN IF NOT EXISTS "current_step_index" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "pending_client_submissions"
  ADD COLUMN IF NOT EXISTS "approval_chain" JSONB NOT NULL DEFAULT '[]';

-- Back-fill: rows that had manager approval should be at step 1
UPDATE "pending_client_submissions"
SET "current_step_index" = 1
WHERE manager_approved_at IS NOT NULL
  AND "current_step_index" = 0;
