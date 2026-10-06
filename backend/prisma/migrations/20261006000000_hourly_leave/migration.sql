-- Preserve historical day-based requests while adding optional hourly details.
ALTER TYPE "LeaveSession" ADD VALUE 'hourly';

CREATE TYPE "LeaveHourlyCategory" AS ENUM ('time_away', 'late_arrival');

ALTER TABLE "leave_requests"
    ADD COLUMN "hourly_category" "LeaveHourlyCategory",
    ADD COLUMN "start_time" TEXT,
    ADD COLUMN "end_time" TEXT,
    ADD COLUMN "duration_minutes" INTEGER,
    ADD COLUMN "timezone" TEXT,
    ADD COLUMN "work_day_start_time" TEXT,
    ADD COLUMN "work_day_end_time" TEXT;
