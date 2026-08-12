-- AlterTable
ALTER TABLE "inbound_calls"
  ADD COLUMN "ring_group_id" TEXT,
  ADD COLUMN "voicemail_box_id" TEXT,
  ADD COLUMN "voicemail_box_name" TEXT;

-- CreateIndex
CREATE INDEX "inbound_calls_ring_group_id_idx" ON "inbound_calls"("ring_group_id");

-- CreateIndex
CREATE INDEX "inbound_calls_voicemail_box_id_idx" ON "inbound_calls"("voicemail_box_id");

-- CreateIndex
CREATE INDEX "inbound_calls_sub_company_id_outcome_idx" ON "inbound_calls"("sub_company_id", "outcome");
