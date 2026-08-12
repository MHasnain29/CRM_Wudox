-- Manager pre-approval on manual client submissions (director still creates the Client row).

ALTER TABLE "pending_client_submissions" ADD COLUMN IF NOT EXISTS "manager_approved_at" TIMESTAMP(3);
ALTER TABLE "pending_client_submissions" ADD COLUMN IF NOT EXISTS "manager_approved_by_id" TEXT;

CREATE INDEX IF NOT EXISTS "pending_client_submissions_manager_approved_by_id_idx" ON "pending_client_submissions"("manager_approved_by_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pending_client_submissions_manager_approved_by_id_fkey'
  ) THEN
    ALTER TABLE "pending_client_submissions" ADD CONSTRAINT "pending_client_submissions_manager_approved_by_id_fkey"
      FOREIGN KEY ("manager_approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;
