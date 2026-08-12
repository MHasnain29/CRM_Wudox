-- AlterTable: add send metadata to proposal_documents
ALTER TABLE "proposal_documents" ADD COLUMN "contact_id" TEXT;
ALTER TABLE "proposal_documents" ADD COLUMN "contact_name" TEXT;
ALTER TABLE "proposal_documents" ADD COLUMN "contact_email" TEXT;
ALTER TABLE "proposal_documents" ADD COLUMN "sent_at" TIMESTAMP(3);
ALTER TABLE "proposal_documents" ADD COLUMN "delivery_status" TEXT;
