CREATE TABLE "lead_deadline_settings" (
  "id" TEXT NOT NULL,
  "sub_company_id" TEXT NOT NULL,
  "days" INTEGER NOT NULL DEFAULT 7,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "lead_deadline_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lead_deadline_settings_sub_company_id_key"
ON "lead_deadline_settings"("sub_company_id");

ALTER TABLE "lead_deadline_settings"
ADD CONSTRAINT "lead_deadline_settings_sub_company_id_fkey"
FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "leads"
  ADD COLUMN "lead_deadline" TIMESTAMP(3),
  ADD COLUMN "extension_requested" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "extension_reason" TEXT,
  ADD COLUMN "extension_days" INTEGER,
  ADD COLUMN "extension_status" TEXT,
  ADD COLUMN "extension_requested_at" TIMESTAMP(3),
  ADD COLUMN "extension_reviewed_at" TIMESTAMP(3),
  ADD COLUMN "reviewed_by" TEXT,
  ADD COLUMN "manager_remarks" TEXT,
  ADD COLUMN "reassignment_locked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "locked_associate_id" TEXT;

CREATE INDEX "leads_lead_deadline_idx" ON "leads"("lead_deadline");
CREATE INDEX "leads_locked_associate_id_idx" ON "leads"("locked_associate_id");

CREATE TYPE "LeadExtensionRequestStatus" AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE "lead_extension_requests" (
  "id" TEXT NOT NULL,
  "lead_id" TEXT NOT NULL,
  "requested_by_id" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "requested_days" INTEGER NOT NULL,
  "status" "LeadExtensionRequestStatus" NOT NULL DEFAULT 'pending',
  "manager_remarks" TEXT,
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at" TIMESTAMP(3),
  "reviewed_by_id" TEXT,
  CONSTRAINT "lead_extension_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lead_extension_requests_lead_id_idx" ON "lead_extension_requests"("lead_id");
CREATE INDEX "lead_extension_requests_status_idx" ON "lead_extension_requests"("status");
CREATE INDEX "lead_extension_requests_requested_by_id_idx" ON "lead_extension_requests"("requested_by_id");

ALTER TABLE "lead_extension_requests"
  ADD CONSTRAINT "lead_extension_requests_lead_id_fkey"
  FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_extension_requests"
  ADD CONSTRAINT "lead_extension_requests_requested_by_id_fkey"
  FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_extension_requests"
  ADD CONSTRAINT "lead_extension_requests_reviewed_by_id_fkey"
  FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
