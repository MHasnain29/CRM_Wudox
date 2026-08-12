-- Replace manual task/follow-up daily targets with meeting schedule count target.
-- Tasks and follow-ups are tracked dynamically via activity (assigned vs completed).

ALTER TABLE "performance_targets"
  ADD COLUMN "meeting_schedule_count_target" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "performance_targets"
  DROP COLUMN "tasks_target",
  DROP COLUMN "follow_ups_target";

ALTER TABLE "users"
  ADD COLUMN "daily_meeting_schedule_target" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "users"
  DROP COLUMN "daily_tasks_target",
  DROP COLUMN "daily_follow_ups_target";
