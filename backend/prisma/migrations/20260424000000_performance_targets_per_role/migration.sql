-- Switch performance_targets from per-user to per-role.
-- Clears existing data (targets reset), replaces user_id with role.

-- Drop user_id foreign key
ALTER TABLE "performance_targets" DROP CONSTRAINT IF EXISTS "performance_targets_user_id_fkey";

-- Clear any existing rows (targets are being redesigned)
DELETE FROM "performance_targets";

-- Drop user_id column
ALTER TABLE "performance_targets" DROP COLUMN IF EXISTS "user_id";

-- Add role column (table is empty so NOT NULL with temp default is safe)
ALTER TABLE "performance_targets" ADD COLUMN "role" TEXT NOT NULL DEFAULT '';
ALTER TABLE "performance_targets" ALTER COLUMN "role" DROP DEFAULT;

-- Drop old indexes
DROP INDEX IF EXISTS "performance_targets_sub_company_id_user_id_idx";
DROP INDEX IF EXISTS "performance_targets_sub_company_id_user_id_effective_from_idx";

-- Create new indexes
CREATE INDEX "performance_targets_sub_company_id_role_idx" ON "performance_targets"("sub_company_id", "role");
CREATE INDEX "performance_targets_sub_company_id_role_effective_from_idx" ON "performance_targets"("sub_company_id", "role", "effective_from");
