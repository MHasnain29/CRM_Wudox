-- v1.0.4: Track the user who actually submitted a proposal (so Proposal History
-- can show when a manager created on behalf of an associate).

ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "created_by_id" TEXT;

CREATE INDEX IF NOT EXISTS "proposals_created_by_id_idx" ON "proposals"("created_by_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'proposals_created_by_id_fkey'
  ) THEN
    ALTER TABLE "proposals" ADD CONSTRAINT "proposals_created_by_id_fkey"
      FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;
