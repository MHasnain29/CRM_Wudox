-- Assignment details captured when requesting a client placement
ALTER TABLE "employee_assignments"
  ADD COLUMN "work_location" TEXT,
  ADD COLUMN "position_title" TEXT,
  ADD COLUMN "pay_rate" TEXT,
  ADD COLUMN "shift_schedule" TEXT,
  ADD COLUMN "expected_duration" TEXT,
  ADD COLUMN "supervisor_info" TEXT,
  ADD COLUMN "required_ppe" TEXT,
  ADD COLUMN "workplace_hazards" TEXT;
