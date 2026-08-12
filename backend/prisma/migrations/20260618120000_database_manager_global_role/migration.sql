-- Database Manager global role: nullable user agency, client creator tracking, org approval policy

-- Enum: pending submission source
CREATE TYPE "PendingClientSubmissionSource" AS ENUM ('agency', 'global_database');

-- Extend approval workflow enum
ALTER TYPE "ApprovalWorkflowType" ADD VALUE IF NOT EXISTS 'database_client_add';
ALTER TYPE "ApprovalWorkflowType" ADD VALUE IF NOT EXISTS 'database_client_import';

-- Users: agency optional (database managers are org-global)
ALTER TABLE "users" ALTER COLUMN "sub_company_id" DROP NOT NULL;

-- Clients: track creator user
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "created_by_id" TEXT;
CREATE INDEX IF NOT EXISTS "clients_created_by_id_idx" ON "clients"("created_by_id");
DO $$ BEGIN
  ALTER TABLE "clients" ADD CONSTRAINT "clients_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Pending client submissions: global database source
ALTER TABLE "pending_client_submissions"
  ADD COLUMN IF NOT EXISTS "submission_source" "PendingClientSubmissionSource" NOT NULL DEFAULT 'agency';
ALTER TABLE "pending_client_submissions" ALTER COLUMN "sub_company_id" DROP NOT NULL;
CREATE INDEX IF NOT EXISTS "pending_client_submissions_submission_source_idx"
  ON "pending_client_submissions"("submission_source");

-- Pending imported clients: global database source
ALTER TABLE "pending_imported_clients"
  ADD COLUMN IF NOT EXISTS "submission_source" "PendingClientSubmissionSource" NOT NULL DEFAULT 'agency';
ALTER TABLE "pending_imported_clients" ALTER COLUMN "sub_company_id" DROP NOT NULL;
CREATE INDEX IF NOT EXISTS "pending_imported_clients_submission_source_idx"
  ON "pending_imported_clients"("submission_source");

-- Org-level approval policy (singleton)
CREATE TABLE IF NOT EXISTS "org_approval_policies" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "workflows" JSONB NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "org_approval_policies_pkey" PRIMARY KEY ("id")
);

INSERT INTO "org_approval_policies" ("id", "workflows", "updated_at")
VALUES (
  'default',
  '{"database_client_add":{"mode":"route","route":["director"]},"database_client_import":{"mode":"route","route":["director"]}}'::jsonb,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;

-- Existing database managers: detach from agency
UPDATE "users" SET "sub_company_id" = NULL WHERE "role" = 'database_manager';
