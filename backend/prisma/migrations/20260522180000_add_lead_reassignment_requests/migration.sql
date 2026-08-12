-- CreateEnum
CREATE TYPE "LeadReassignmentStatus" AS ENUM ('pending', 'approved', 'completed', 'rejected', 'cancelled', 'superseded');

-- CreateTable
CREATE TABLE "lead_reassignment_requests" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "requested_by_id" TEXT NOT NULL,
    "current_owner_id" TEXT NOT NULL,
    "proposed_owner_id" TEXT NOT NULL,
    "note" TEXT,
    "status" "LeadReassignmentStatus" NOT NULL DEFAULT 'pending',
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "sub_company_id" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_reassignment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_reassignment_requests_lead_id_idx" ON "lead_reassignment_requests"("lead_id");

-- CreateIndex
CREATE INDEX "lead_reassignment_requests_requested_by_id_idx" ON "lead_reassignment_requests"("requested_by_id");

-- CreateIndex
CREATE INDEX "lead_reassignment_requests_status_idx" ON "lead_reassignment_requests"("status");

-- CreateIndex
CREATE INDEX "lead_reassignment_requests_sub_company_id_idx" ON "lead_reassignment_requests"("sub_company_id");

-- AddForeignKey
ALTER TABLE "lead_reassignment_requests" ADD CONSTRAINT "lead_reassignment_requests_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_reassignment_requests" ADD CONSTRAINT "lead_reassignment_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_reassignment_requests" ADD CONSTRAINT "lead_reassignment_requests_current_owner_id_fkey" FOREIGN KEY ("current_owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_reassignment_requests" ADD CONSTRAINT "lead_reassignment_requests_proposed_owner_id_fkey" FOREIGN KEY ("proposed_owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_reassignment_requests" ADD CONSTRAINT "lead_reassignment_requests_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_reassignment_requests" ADD CONSTRAINT "lead_reassignment_requests_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
