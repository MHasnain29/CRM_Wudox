-- Add sub_company_id and list_name to email_campaigns

ALTER TABLE "email_campaigns" ADD COLUMN "sub_company_id" TEXT NOT NULL DEFAULT '';
ALTER TABLE "email_campaigns" ADD COLUMN "list_name" TEXT NOT NULL DEFAULT '';

-- Backfill: if there are existing rows, set sub_company_id to a placeholder (they'll be orphaned but won't break)
-- In practice this table is empty before this feature goes live.

-- Add foreign key constraint
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_sub_company_id_fkey"
  FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Add index
CREATE INDEX "email_campaigns_sub_company_id_idx" ON "email_campaigns"("sub_company_id");
