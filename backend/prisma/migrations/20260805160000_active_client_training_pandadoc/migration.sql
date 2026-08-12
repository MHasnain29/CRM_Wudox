-- Active Client training via PandaDoc template (per client).
ALTER TABLE "active_clients"
  ADD COLUMN IF NOT EXISTS "training_pandadoc_template_id" TEXT,
  ADD COLUMN IF NOT EXISTS "training_pandadoc_template_name" TEXT;

ALTER TABLE "active_client_training_assignments"
  ADD COLUMN IF NOT EXISTS "pandadoc_id" TEXT,
  ADD COLUMN IF NOT EXISTS "pandadoc_status" TEXT,
  ADD COLUMN IF NOT EXISTS "pandadoc_updated_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "active_client_training_assignments_pandadoc_id_idx"
  ON "active_client_training_assignments"("pandadoc_id");
