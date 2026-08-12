-- AlterTable: add review request fields to proposals
ALTER TABLE "proposals" ADD COLUMN "review_requested_at" TIMESTAMP(3);
ALTER TABLE "proposals" ADD COLUMN "review_requested_by_id" TEXT;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_review_requested_by_id_fkey" FOREIGN KEY ("review_requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
