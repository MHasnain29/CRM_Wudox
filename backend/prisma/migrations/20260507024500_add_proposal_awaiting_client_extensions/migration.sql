-- Director-configurable awaiting-client timer (days) per agency
CREATE TABLE "proposal_awaiting_client_settings" (
  "id" TEXT NOT NULL,
  "sub_company_id" TEXT NOT NULL,
  "days" INTEGER NOT NULL DEFAULT 7,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "proposal_awaiting_client_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "proposal_awaiting_client_settings_sub_company_id_key"
  ON "proposal_awaiting_client_settings"("sub_company_id");

ALTER TABLE "proposal_awaiting_client_settings"
  ADD CONSTRAINT "proposal_awaiting_client_settings_sub_company_id_fkey"
  FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Awaiting-client timer fields on proposals
ALTER TABLE "proposals"
  ADD COLUMN "awaiting_client_due_at" TIMESTAMP(3),
  ADD COLUMN "awaiting_client_reason" TEXT;

-- Extension workflow rows (associate request → manager approve/reject)
CREATE TYPE "ProposalExtensionRequestStatus" AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE "proposal_extension_requests" (
  "id" TEXT NOT NULL,
  "proposal_id" TEXT NOT NULL,
  "requested_by_id" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "requested_days" INTEGER NOT NULL,
  "status" "ProposalExtensionRequestStatus" NOT NULL DEFAULT 'pending',
  "reviewed_by_id" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "review_comment" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "proposal_extension_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "proposal_extension_requests_proposal_id_idx"
  ON "proposal_extension_requests"("proposal_id");
CREATE INDEX "proposal_extension_requests_status_idx"
  ON "proposal_extension_requests"("status");
CREATE INDEX "proposal_extension_requests_requested_by_id_idx"
  ON "proposal_extension_requests"("requested_by_id");

ALTER TABLE "proposal_extension_requests"
  ADD CONSTRAINT "proposal_extension_requests_proposal_id_fkey"
  FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proposal_extension_requests"
  ADD CONSTRAINT "proposal_extension_requests_requested_by_id_fkey"
  FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "proposal_extension_requests"
  ADD CONSTRAINT "proposal_extension_requests_reviewed_by_id_fkey"
  FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
