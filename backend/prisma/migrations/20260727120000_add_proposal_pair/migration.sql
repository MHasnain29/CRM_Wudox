-- Both (Temp + Direct) proposals are stored as two linked single-type rows.
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "proposal_pair_id" TEXT;
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "pair_role" TEXT;

CREATE INDEX IF NOT EXISTS "proposals_proposal_pair_id_idx" ON "proposals"("proposal_pair_id");
