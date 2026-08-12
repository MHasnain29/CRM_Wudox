-- Per-agency scoping for client/lead attachments (documents table).
ALTER TABLE "documents" ADD COLUMN "sub_company_id" TEXT;

-- Backfill from linked lead's agency.
UPDATE "documents" d
SET "sub_company_id" = l."sub_company_id"
FROM "leads" l
WHERE d."lead_id" = l."id" AND d."sub_company_id" IS NULL;

-- Backfill client-only uploads from activity log metadata when present.
UPDATE "documents" d
SET "sub_company_id" = al."sub_company_id"
FROM "activity_logs" al
WHERE d."sub_company_id" IS NULL
  AND d."client_id" IS NOT NULL
  AND al."metadata"->>'documentId' = d."id";

-- Remaining rows: first agency (legacy fallback, same pattern as client_agency_scoping migration).
UPDATE "documents"
SET "sub_company_id" = (SELECT "id" FROM "sub_companies" LIMIT 1)
WHERE "sub_company_id" IS NULL;

ALTER TABLE "documents" ALTER COLUMN "sub_company_id" SET NOT NULL;

ALTER TABLE "documents"
  ADD CONSTRAINT "documents_sub_company_id_fkey"
  FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "documents_sub_company_id_idx" ON "documents"("sub_company_id");
CREATE INDEX "documents_client_id_sub_company_id_idx" ON "documents"("client_id", "sub_company_id");
