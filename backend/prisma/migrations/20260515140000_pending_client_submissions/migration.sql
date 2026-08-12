-- Manual Add Client submissions; director approves into shared clients DB (per agency only).
-- DROP first so a partial failed run can be recovered cleanly.

DROP TABLE IF EXISTS "pending_client_submissions" CASCADE;

CREATE TABLE "pending_client_submissions" (
    "id" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "submitted_by_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "location" TEXT,
    "address" TEXT,
    "company_size" TEXT,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "contacts" JSONB NOT NULL DEFAULT '[]',
    "location_address" JSONB,
    "submitter_role" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_client_submissions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pending_client_submissions_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "pending_client_submissions_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "pending_client_submissions_sub_company_id_idx" ON "pending_client_submissions"("sub_company_id");
CREATE INDEX "pending_client_submissions_submitted_at_idx" ON "pending_client_submissions"("submitted_at");
