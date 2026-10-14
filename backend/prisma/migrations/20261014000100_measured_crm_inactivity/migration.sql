-- Legacy session counters and rounded activity logs cannot establish measured intervals.
-- Start collecting evidence after deployment; do not fabricate historical measurements.
ALTER TABLE "user_activity_sessions"
  ADD COLUMN "measurement_started_at" TIMESTAMP(3),
  ADD COLUMN "last_input_at" TIMESTAMP(3),
  ADD COLUMN "last_client_time" TIMESTAMP(3),
  ADD COLUMN "last_reported_input_at" TIMESTAMP(3),
  ADD COLUMN "measurement_client_id" TEXT,
  ADD COLUMN "tracking_timezone" TEXT,
  ADD COLUMN "on_break" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "break_started_at" TIMESTAMP(3),
  ADD COLUMN "measured_active_milliseconds" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "measured_idle_milliseconds" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "current_idle_milliseconds" BIGINT NOT NULL DEFAULT 0;

CREATE TABLE "user_activity_intervals" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "state" TEXT NOT NULL CHECK ("state" IN ('active', 'idle')),
  "started_at" TIMESTAMP(3) NOT NULL,
  "ended_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_activity_intervals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_activity_intervals_valid_range" CHECK ("ended_at" > "started_at"),
  CONSTRAINT "user_activity_intervals_session_id_fkey" FOREIGN KEY ("session_id")
    REFERENCES "user_activity_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "user_activity_intervals_session_id_ended_at_idx" ON "user_activity_intervals"("session_id", "ended_at");
CREATE INDEX "user_activity_intervals_started_at_ended_at_idx" ON "user_activity_intervals"("started_at", "ended_at");
