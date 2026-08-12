-- Add color column to user_agency_links for per-user notification color identity
ALTER TABLE "user_agency_links" ADD COLUMN "color" VARCHAR(20);
