-- AlterTable: add review rejection fields to proposals
ALTER TABLE "proposals" ADD COLUMN "review_rejected_at" TIMESTAMP(3);
ALTER TABLE "proposals" ADD COLUMN "review_rejected_by_id" TEXT;
ALTER TABLE "proposals" ADD COLUMN "review_rejection_comment" TEXT;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_review_rejected_by_id_fkey" FOREIGN KEY ("review_rejected_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
