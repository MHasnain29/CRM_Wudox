-- v1.0.3 — clients & users agency layer (frontend-only); migration ships unchanged
-- The `appProjectName` field exists in the Prisma schema (mapped to "app_project_name")
-- but no prior migration added the column. This makes the DB drift from the schema
-- and causes P2022 errors on any query that selects from sub_companies.
-- Adds the column idempotently so already-fixed environments stay safe.

ALTER TABLE "sub_companies" ADD COLUMN IF NOT EXISTS "app_project_name" TEXT;
