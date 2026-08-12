-- AddColumn: review_document_type on proposals
-- Default 'agreement' covers all existing rows
ALTER TABLE "proposals" ADD COLUMN "review_document_type" TEXT NOT NULL DEFAULT 'agreement';
