-- Add per-agency email address for Operations Managers
ALTER TABLE "operations_manager_sub_companies" ADD COLUMN "agency_email" TEXT;

-- Index for fast login lookup by agency email
CREATE INDEX "operations_manager_sub_companies_agency_email_idx" ON "operations_manager_sub_companies"("agency_email");
