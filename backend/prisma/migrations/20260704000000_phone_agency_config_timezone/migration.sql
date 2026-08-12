-- Phone system: per-agency timezone for business-hours evaluation.
-- Business hours (open/close/enabled per day) are configured in the agency's
-- local time; evaluating them against the server clock caused inbound calls to
-- incorrectly route to the "closed" branch. Store the agency timezone so the
-- inbound TwiML interpreter can evaluate open/closed in the right zone.
ALTER TABLE "phone_agency_configs"
    ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'America/Toronto';
