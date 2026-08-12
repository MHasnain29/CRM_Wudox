-- AddColumn: document_type on review_templates
-- Default 'agreement' covers all existing rows
ALTER TABLE "review_templates" ADD COLUMN "document_type" TEXT NOT NULL DEFAULT 'agreement';
