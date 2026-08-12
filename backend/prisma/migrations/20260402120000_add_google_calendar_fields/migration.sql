-- AlterTable: add Google Calendar fields to users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "google_refresh_token" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "google_calendar_connected" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: add Google Calendar event ID to meetings
ALTER TABLE "meetings" ADD COLUMN IF NOT EXISTS "google_calendar_event_id" TEXT;
