-- Database Manager CSV import destination: global database or a fixed agency (Settings → Global Database).

ALTER TABLE "org_approval_policies"
  ADD COLUMN IF NOT EXISTS "database_import_destination" TEXT NOT NULL DEFAULT 'global';

ALTER TABLE "org_approval_policies"
  ADD COLUMN IF NOT EXISTS "database_import_agency_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "org_approval_policies"
    ADD CONSTRAINT "org_approval_policies_database_import_agency_id_fkey"
    FOREIGN KEY ("database_import_agency_id") REFERENCES "sub_companies"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
