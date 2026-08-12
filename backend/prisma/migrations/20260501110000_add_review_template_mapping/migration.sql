CREATE TABLE "review_template_mappings" (
  "id" TEXT NOT NULL,
  "sub_company_id" TEXT NOT NULL,
  "temp_template_id" TEXT,
  "direct_template_id" TEXT,
  "both_template_id" TEXT,
  CONSTRAINT "review_template_mappings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "review_template_mappings_sub_company_id_key" ON "review_template_mappings"("sub_company_id");
CREATE UNIQUE INDEX "review_template_mappings_temp_template_id_key" ON "review_template_mappings"("temp_template_id");
CREATE UNIQUE INDEX "review_template_mappings_direct_template_id_key" ON "review_template_mappings"("direct_template_id");
CREATE UNIQUE INDEX "review_template_mappings_both_template_id_key" ON "review_template_mappings"("both_template_id");

ALTER TABLE "review_template_mappings" ADD CONSTRAINT "review_template_mappings_sub_company_id_fkey"
  FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "review_template_mappings" ADD CONSTRAINT "review_template_mappings_temp_template_id_fkey"
  FOREIGN KEY ("temp_template_id") REFERENCES "review_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "review_template_mappings" ADD CONSTRAINT "review_template_mappings_direct_template_id_fkey"
  FOREIGN KEY ("direct_template_id") REFERENCES "review_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "review_template_mappings" ADD CONSTRAINT "review_template_mappings_both_template_id_fkey"
  FOREIGN KEY ("both_template_id") REFERENCES "review_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
