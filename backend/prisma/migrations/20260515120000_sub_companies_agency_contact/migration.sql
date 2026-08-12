-- AlterTable
ALTER TABLE "sub_companies" ADD COLUMN IF NOT EXISTS "agency_email" TEXT;
ALTER TABLE "sub_companies" ADD COLUMN IF NOT EXISTS "agency_phone" TEXT;
