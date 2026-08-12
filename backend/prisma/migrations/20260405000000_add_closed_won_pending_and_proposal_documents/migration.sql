-- AlterEnum: add closed_won_pending to LeadStatus
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'closed_won_pending';

-- CreateEnum: ProposalDocumentCategory
CREATE TYPE "ProposalDocumentCategory" AS ENUM ('sent_to_client', 'received_from_client');

-- AlterTable: add activation fields to proposals
ALTER TABLE "proposals" ADD COLUMN "activated_at" TIMESTAMP(3);
ALTER TABLE "proposals" ADD COLUMN "activated_by_id" TEXT;

-- CreateTable: proposal_documents
CREATE TABLE "proposal_documents" (
    "id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "category" "ProposalDocumentCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "proposal_documents_proposal_id_idx" ON "proposal_documents"("proposal_id");

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_activated_by_id_fkey" FOREIGN KEY ("activated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_documents" ADD CONSTRAINT "proposal_documents_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_documents" ADD CONSTRAINT "proposal_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
