-- Director/super_admin uploads visible to all agencies (mirrors client_notes.is_public).
ALTER TABLE "documents" ADD COLUMN "is_public" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "documents_is_public_idx" ON "documents"("is_public");
