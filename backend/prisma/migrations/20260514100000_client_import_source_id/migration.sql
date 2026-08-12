-- Persist the source-file "ID" column on the approved client so we can trace
-- any record back to the batch/vendor reference it came from.
-- Plan reference: plan-csv-import-dynamic-mapping.md
-- Frontend version bump: see frontend/package.json

ALTER TABLE "clients" ADD COLUMN "import_source_id" TEXT;

CREATE INDEX "clients_import_source_id_idx" ON "clients"("import_source_id");
