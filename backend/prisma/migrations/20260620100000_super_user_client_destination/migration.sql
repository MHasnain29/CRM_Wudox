-- Super Users (super_admin, director, company_director, operations_manager): global vs agency add/import destination
ALTER TABLE "org_approval_policies"
  ADD COLUMN IF NOT EXISTS "super_user_client_destination" TEXT NOT NULL DEFAULT 'agency';
