ALTER TABLE "proposals"
  ADD COLUMN IF NOT EXISTS "preview_pdf_url"    TEXT,
  ADD COLUMN IF NOT EXISTS "preview_pdf_hash"   TEXT,
  ADD COLUMN IF NOT EXISTS "preview_pdf_status" TEXT;
