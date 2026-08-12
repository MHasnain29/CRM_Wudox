-- Standalone employee training (independent of client placements)
CREATE TABLE IF NOT EXISTS "employee_trainings" (
  "id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "message" TEXT,
  "sent_at" TIMESTAMP(3),
  "channel" TEXT,
  "certificate_document_id" TEXT,
  "completed_at" TIMESTAMP(3),
  "sent_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_trainings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "employee_trainings_employee_id_idx" ON "employee_trainings"("employee_id");
CREATE INDEX IF NOT EXISTS "employee_trainings_sent_at_idx" ON "employee_trainings"("sent_at");
CREATE INDEX IF NOT EXISTS "employee_trainings_completed_at_idx" ON "employee_trainings"("completed_at");
CREATE INDEX IF NOT EXISTS "employee_trainings_certificate_document_id_idx" ON "employee_trainings"("certificate_document_id");

DO $$ BEGIN
  ALTER TABLE "employee_trainings"
    ADD CONSTRAINT "employee_trainings_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "employee_trainings"
    ADD CONSTRAINT "employee_trainings_sent_by_id_fkey"
    FOREIGN KEY ("sent_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "employee_trainings"
    ADD CONSTRAINT "employee_trainings_certificate_document_id_fkey"
    FOREIGN KEY ("certificate_document_id") REFERENCES "employee_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
