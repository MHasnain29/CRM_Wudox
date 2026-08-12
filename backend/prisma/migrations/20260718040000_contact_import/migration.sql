-- AlterEnum: contact_import + database_contact_import
ALTER TYPE "ApprovalWorkflowType" ADD VALUE IF NOT EXISTS 'contact_import';
ALTER TYPE "ApprovalWorkflowType" ADD VALUE IF NOT EXISTS 'database_contact_import';

-- ImportMappingTemplate: entityType + new unique constraint
ALTER TABLE "import_mapping_templates" ADD COLUMN IF NOT EXISTS "entity_type" TEXT NOT NULL DEFAULT 'client';

DROP INDEX IF EXISTS "import_mapping_templates_sub_company_id_header_fingerprint_key";
CREATE UNIQUE INDEX IF NOT EXISTS "import_mapping_templates_sub_company_id_entity_type_header_fingerprint_key"
  ON "import_mapping_templates"("sub_company_id", "entity_type", "header_fingerprint");

-- PendingImportedContact
CREATE TABLE IF NOT EXISTS "pending_imported_contacts" (
    "id" TEXT NOT NULL,
    "sub_company_id" TEXT,
    "submission_source" "PendingClientSubmissionSource" NOT NULL DEFAULT 'agency',
    "imported_by_id" TEXT NOT NULL,
    "target_client_id" TEXT NOT NULL,
    "match_key" TEXT NOT NULL,
    "match_value" TEXT NOT NULL,
    "contacts" JSONB NOT NULL DEFAULT '[]',
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "current_step_index" INTEGER NOT NULL DEFAULT 0,
    "approval_chain" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "pending_imported_contacts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "pending_imported_contacts_sub_company_id_idx" ON "pending_imported_contacts"("sub_company_id");
CREATE INDEX IF NOT EXISTS "pending_imported_contacts_submission_source_idx" ON "pending_imported_contacts"("submission_source");
CREATE INDEX IF NOT EXISTS "pending_imported_contacts_target_client_id_idx" ON "pending_imported_contacts"("target_client_id");
CREATE INDEX IF NOT EXISTS "pending_imported_contacts_imported_at_idx" ON "pending_imported_contacts"("imported_at");

DO $$ BEGIN
  ALTER TABLE "pending_imported_contacts"
    ADD CONSTRAINT "pending_imported_contacts_sub_company_id_fkey"
    FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "pending_imported_contacts"
    ADD CONSTRAINT "pending_imported_contacts_imported_by_id_fkey"
    FOREIGN KEY ("imported_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "pending_imported_contacts"
    ADD CONSTRAINT "pending_imported_contacts_target_client_id_fkey"
    FOREIGN KEY ("target_client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
