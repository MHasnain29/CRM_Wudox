-- Add multi-select availability + skills columns
ALTER TABLE "employees"
  ADD COLUMN IF NOT EXISTS "availability_types" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "skills" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Backfill from legacy single availability_type enum
UPDATE "employees"
SET "availability_types" = ARRAY[availability_type::text]
WHERE "availability_type" IS NOT NULL
  AND (cardinality("availability_types") = 0 OR "availability_types" IS NULL);

-- Drop legacy column + enum
ALTER TABLE "employees" DROP COLUMN IF EXISTS "availability_type";
DROP TYPE IF EXISTS "AvailabilityType";
