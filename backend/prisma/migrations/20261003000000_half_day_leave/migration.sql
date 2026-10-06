-- Existing integer quantities convert exactly, and historical requests remain full days.
CREATE TYPE "LeaveSession" AS ENUM ('full_day', 'first_half', 'second_half');

ALTER TABLE "leave_types"
  ALTER COLUMN "days_per_year" TYPE DOUBLE PRECISION,
  ALTER COLUMN "max_carry_over" TYPE DOUBLE PRECISION;

ALTER TABLE "leave_balances"
  ALTER COLUMN "entitled" TYPE DOUBLE PRECISION,
  ALTER COLUMN "used" TYPE DOUBLE PRECISION,
  ALTER COLUMN "carried_over" TYPE DOUBLE PRECISION;

ALTER TABLE "leave_requests"
  ALTER COLUMN "days" TYPE DOUBLE PRECISION,
  ADD COLUMN "session" "LeaveSession" NOT NULL DEFAULT 'full_day';
