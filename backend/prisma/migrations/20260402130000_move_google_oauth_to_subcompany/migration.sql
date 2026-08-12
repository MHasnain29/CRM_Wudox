-- Move Google OAuth fields from users to sub_companies

ALTER TABLE "sub_companies"
  ADD COLUMN "google_refresh_token" TEXT,
  ADD COLUMN "google_calendar_connected" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "users"
  DROP COLUMN IF EXISTS "google_refresh_token",
  DROP COLUMN IF EXISTS "google_calendar_connected";
