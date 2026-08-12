ALTER TABLE "leads"
ADD COLUMN "closed_at" TIMESTAMP(3),
ADD COLUMN "closed_by_id" TEXT,
ADD COLUMN "loss_reason" TEXT,
ADD COLUMN "reassigned_from_lead_id" TEXT,
ADD COLUMN "reassigned_by_id" TEXT;

ALTER TABLE "leads"
ADD CONSTRAINT "leads_closed_by_id_fkey"
FOREIGN KEY ("closed_by_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "leads"
ADD CONSTRAINT "leads_reassigned_by_id_fkey"
FOREIGN KEY ("reassigned_by_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "leads"
ADD CONSTRAINT "leads_reassigned_from_lead_id_fkey"
FOREIGN KEY ("reassigned_from_lead_id") REFERENCES "leads"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "leads_closed_at_idx" ON "leads"("closed_at");
CREATE INDEX "leads_reassigned_from_lead_id_idx" ON "leads"("reassigned_from_lead_id");

CREATE UNIQUE INDEX "leads_one_open_per_client_agency_idx"
ON "leads"("client_id", "sub_company_id")
WHERE "status" = 'open';
