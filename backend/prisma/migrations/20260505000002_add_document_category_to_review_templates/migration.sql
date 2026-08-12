-- AddColumn: document_category on review_templates
-- Stores which pdfkit renderer to use (agreement, offer_letter, business_proposal)
ALTER TABLE "review_templates" ADD COLUMN "document_category" TEXT NOT NULL DEFAULT 'agreement';
