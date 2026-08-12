-- Soft-retire support: keep replaced review templates so proposal history can still resolve them.
ALTER TABLE "review_templates" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "review_templates_sub_company_id_document_type_is_active_idx"
  ON "review_templates"("sub_company_id", "document_type", "is_active");
