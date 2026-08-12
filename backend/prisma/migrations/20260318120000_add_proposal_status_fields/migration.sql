-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('pending', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "proposals"
  ADD COLUMN "status" "ProposalStatus" NOT NULL DEFAULT 'pending',
  ADD COLUMN "rejection_comment" TEXT,
  ADD COLUMN "reviewed_at" TIMESTAMP(3),
  ADD COLUMN "reviewed_by_id" TEXT;

-- CreateIndex
CREATE INDEX "proposals_status_idx" ON "proposals"("status");

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
