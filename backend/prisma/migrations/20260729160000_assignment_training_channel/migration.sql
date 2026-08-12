-- Track whether training was sent by email or SMS.
ALTER TABLE "employee_assignments"
  ADD COLUMN IF NOT EXISTS "training_channel" TEXT;
