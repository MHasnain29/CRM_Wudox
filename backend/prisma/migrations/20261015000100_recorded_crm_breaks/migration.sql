-- Preserve only explicitly recorded break boundaries after deployment.
-- Existing on-break state cannot establish historical break intervals.
CREATE TYPE "ActivityBreakType" AS ENUM ('break', 'coaching', 'meeting');

ALTER TABLE "user_activity_sessions" ADD COLUMN "break_type" "ActivityBreakType";

CREATE TABLE "user_activity_breaks" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "break_type" "ActivityBreakType" NOT NULL DEFAULT 'break',
  "started_at" TIMESTAMP(3) NOT NULL,
  "ended_at" TIMESTAMP(3),
  CONSTRAINT "user_activity_breaks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_activity_breaks_valid_range" CHECK ("ended_at" >= "started_at"),
  CONSTRAINT "user_activity_breaks_session_id_fkey" FOREIGN KEY ("session_id")
    REFERENCES "user_activity_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "user_activity_breaks_session_id_ended_at_idx" ON "user_activity_breaks"("session_id", "ended_at");
CREATE INDEX "user_activity_breaks_started_at_ended_at_idx" ON "user_activity_breaks"("started_at", "ended_at");
CREATE UNIQUE INDEX "user_activity_breaks_one_open_per_session_idx" ON "user_activity_breaks"("session_id") WHERE "ended_at" IS NULL;
