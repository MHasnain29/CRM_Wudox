-- AlterTable (idempotent if applied manually first)
ALTER TABLE "sub_companies" ADD COLUMN IF NOT EXISTS "agency_logo_url" TEXT;
