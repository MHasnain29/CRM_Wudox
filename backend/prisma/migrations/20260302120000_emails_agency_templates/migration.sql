-- Add sub_company_id and to_user_id to emails (agency scoping + inbox recipient)
ALTER TABLE "emails" ADD COLUMN "sub_company_id" TEXT;
ALTER TABLE "emails" ADD COLUMN "to_user_id" TEXT;

-- Backfill sub_company_id for existing rows (use first sub_company)
UPDATE "emails" SET "sub_company_id" = (SELECT id FROM "sub_companies" LIMIT 1) WHERE "sub_company_id" IS NULL;

-- Make sub_company_id required
ALTER TABLE "emails" ALTER COLUMN "sub_company_id" SET NOT NULL;

-- Add FK for sub_company_id and to_user_id
ALTER TABLE "emails" ADD CONSTRAINT "emails_sub_company_id_fkey" 
  FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "emails" ADD CONSTRAINT "emails_to_user_id_fkey" 
  FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex for to_user_id and sub_company_id
CREATE INDEX "emails_to_user_id_idx" ON "emails"("to_user_id");
CREATE INDEX "emails_sub_company_id_idx" ON "emails"("sub_company_id");

-- CreateTable email_templates
CREATE TABLE "email_templates" (
    "id" TEXT NOT NULL,
    "sub_company_id" TEXT,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body_html" TEXT NOT NULL,
    "header_html" TEXT,
    "footer_html" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "email_templates_sub_company_id_idx" ON "email_templates"("sub_company_id");

ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_sub_company_id_fkey" 
  FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
