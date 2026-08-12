-- Requested roster role (primary vs backup) for job-target assignment requests,
-- applied to the JobAssignment roster row on approval.
ALTER TABLE "employee_assignments"
  ADD COLUMN IF NOT EXISTS "is_backup" BOOLEAN NOT NULL DEFAULT false;
