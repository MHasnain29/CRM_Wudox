-- Add ClientVisibility enum and delayed global client visibility setting

-- 1) Enum for client visibility
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ClientVisibility') THEN
    CREATE TYPE "ClientVisibility" AS ENUM ('agency', 'global');
  END IF;
END$$;

-- 2) Client fields (default keeps existing clients global)
ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "visibility" "ClientVisibility" NOT NULL DEFAULT 'global',
  ADD COLUMN IF NOT EXISTS "created_by_role" TEXT,
  ADD COLUMN IF NOT EXISTS "visibility_promoted_at" TIMESTAMP(3);

-- 3) Indexes for promoter job and filters
CREATE INDEX IF NOT EXISTS "clients_visibility_idx" ON "clients" ("visibility");
CREATE INDEX IF NOT EXISTS "clients_created_at_idx" ON "clients" ("created_at");

-- 4) Per-agency setting table (one row per sub-company)
CREATE TABLE IF NOT EXISTS "client_visibility_settings" (
  -- NOTE: This project stores ids as text (uuid strings) in Postgres.
  "id" TEXT NOT NULL DEFAULT (gen_random_uuid()::text),
  "sub_company_id" TEXT NOT NULL,
  "days" INTEGER NOT NULL DEFAULT 7,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "client_visibility_settings_pkey" PRIMARY KEY ("id")
);

-- If the table existed from a partial/failed run, ensure column types match sub_companies.id (text).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'client_visibility_settings' AND column_name = 'sub_company_id') THEN
    BEGIN
      ALTER TABLE "client_visibility_settings"
        ALTER COLUMN "sub_company_id" TYPE TEXT USING ("sub_company_id"::text);
    EXCEPTION WHEN others THEN
      -- ignore
    END;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'client_visibility_settings' AND column_name = 'id') THEN
    BEGIN
      ALTER TABLE "client_visibility_settings"
        ALTER COLUMN "id" TYPE TEXT USING ("id"::text);
    EXCEPTION WHEN others THEN
      -- ignore
    END;
  END IF;
END$$;

-- One setting per sub-company
CREATE UNIQUE INDEX IF NOT EXISTS "client_visibility_settings_sub_company_id_key"
  ON "client_visibility_settings" ("sub_company_id");

-- Foreign key
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_type = 'FOREIGN KEY'
      AND table_name = 'client_visibility_settings'
      AND constraint_name = 'client_visibility_settings_sub_company_id_fkey'
  ) THEN
    ALTER TABLE "client_visibility_settings"
      ADD CONSTRAINT "client_visibility_settings_sub_company_id_fkey"
      FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

