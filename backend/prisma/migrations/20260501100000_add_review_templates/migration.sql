CREATE TABLE "review_templates" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "original_filename" TEXT NOT NULL,
  "file_key" TEXT NOT NULL,
  "sub_company_id" TEXT NOT NULL,
  "uploaded_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "review_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "review_templates_sub_company_id_idx" ON "review_templates"("sub_company_id");

ALTER TABLE "review_templates" ADD CONSTRAINT "review_templates_sub_company_id_fkey"
  FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "review_templates" ADD CONSTRAINT "review_templates_uploaded_by_id_fkey"
  FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "proposals" ADD COLUMN "review_template_id" TEXT;

ALTER TABLE "proposals" ADD CONSTRAINT "proposals_review_template_id_fkey"
  FOREIGN KEY ("review_template_id") REFERENCES "review_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
