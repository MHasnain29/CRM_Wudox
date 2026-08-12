-- CreateTable: proposal_selected_default_files
-- Snapshot of director-set default files selected at proposal submission time.
CREATE TABLE IF NOT EXISTS "proposal_selected_default_files" (
    "id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "default_file_id" TEXT,
    "name" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "mime_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_selected_default_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "proposal_selected_default_files_proposal_id_idx" ON "proposal_selected_default_files"("proposal_id");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'proposal_selected_default_files_proposal_id_fkey'
    ) THEN
        ALTER TABLE "proposal_selected_default_files"
        ADD CONSTRAINT "proposal_selected_default_files_proposal_id_fkey"
        FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END$$;
