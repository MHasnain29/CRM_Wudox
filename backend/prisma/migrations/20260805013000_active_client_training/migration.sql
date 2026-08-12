-- Active Client training fields + per-assignment training paperwork (isolated from EmployeeTraining).

CREATE TYPE "ActiveClientTrainingStatus" AS ENUM ('pending', 'signed');

ALTER TABLE "active_clients"
  ADD COLUMN "client_training" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "trainer_name" TEXT,
  ADD COLUMN "training_file_key" TEXT,
  ADD COLUMN "training_file_name" TEXT,
  ADD COLUMN "training_mime_type" TEXT,
  ADD COLUMN "training_file_size" BIGINT;

CREATE TABLE "active_client_training_assignments" (
  "id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "active_client_id" TEXT NOT NULL,
  "assignment_id" TEXT NOT NULL,
  "status" "ActiveClientTrainingStatus" NOT NULL DEFAULT 'pending',
  "trainer_name" TEXT,
  "template_file_key" TEXT NOT NULL,
  "template_file_name" TEXT NOT NULL,
  "template_mime_type" TEXT,
  "template_file_size" BIGINT,
  "sent_at" TIMESTAMP(3),
  "sent_by_user_id" TEXT,
  "signed_file_key" TEXT,
  "signed_file_name" TEXT,
  "signed_mime_type" TEXT,
  "signed_file_size" BIGINT,
  "completed_at" TIMESTAMP(3),
  "completed_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "active_client_training_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "active_client_training_assignments_assignment_id_key"
  ON "active_client_training_assignments"("assignment_id");

CREATE INDEX "active_client_training_assignments_employee_id_idx"
  ON "active_client_training_assignments"("employee_id");

CREATE INDEX "active_client_training_assignments_active_client_id_idx"
  ON "active_client_training_assignments"("active_client_id");

CREATE INDEX "active_client_training_assignments_status_idx"
  ON "active_client_training_assignments"("status");

ALTER TABLE "active_client_training_assignments"
  ADD CONSTRAINT "active_client_training_assignments_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "active_client_training_assignments"
  ADD CONSTRAINT "active_client_training_assignments_active_client_id_fkey"
  FOREIGN KEY ("active_client_id") REFERENCES "active_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "active_client_training_assignments"
  ADD CONSTRAINT "active_client_training_assignments_assignment_id_fkey"
  FOREIGN KEY ("assignment_id") REFERENCES "employee_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "active_client_training_assignments"
  ADD CONSTRAINT "active_client_training_assignments_sent_by_user_id_fkey"
  FOREIGN KEY ("sent_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "active_client_training_assignments"
  ADD CONSTRAINT "active_client_training_assignments_completed_by_user_id_fkey"
  FOREIGN KEY ("completed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
