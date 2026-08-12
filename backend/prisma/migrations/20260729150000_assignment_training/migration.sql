-- Optional training checklist on employee assignments (does not block approval).
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'training_certificate';

ALTER TABLE "employee_assignments"
  ADD COLUMN IF NOT EXISTS "training_message" TEXT,
  ADD COLUMN IF NOT EXISTS "training_sent_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "training_certificate_document_id" TEXT,
  ADD COLUMN IF NOT EXISTS "training_completed_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "employee_assignments_training_certificate_document_id_idx"
  ON "employee_assignments"("training_certificate_document_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'employee_assignments_training_certificate_document_id_fkey'
  ) THEN
    ALTER TABLE "employee_assignments"
      ADD CONSTRAINT "employee_assignments_training_certificate_document_id_fkey"
      FOREIGN KEY ("training_certificate_document_id")
      REFERENCES "employee_documents"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;
