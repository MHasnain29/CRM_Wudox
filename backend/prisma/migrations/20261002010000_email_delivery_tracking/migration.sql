-- Personal CRM emails: record which messages ask SendGrid for delivery/open/click
-- events, and the first time each event is reported per recipient.
ALTER TABLE "emails" ADD COLUMN "delivery_tracked" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "email_recipients" ADD COLUMN "delivered_at" TIMESTAMP(3),
ADD COLUMN "opened_at" TIMESTAMP(3),
ADD COLUMN "clicked_at" TIMESTAMP(3),
ADD COLUMN "bounced_at" TIMESTAMP(3);

-- Last time a provider webhook delivered any event (reports use it to tell
-- "no results yet" apart from "the webhook is not reporting").
CREATE TABLE "webhook_heartbeats" (
    "provider" TEXT NOT NULL,
    "last_event_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_heartbeats_pkey" PRIMARY KEY ("provider")
);

-- Daily reports read one period of each campaign's sends. The composite index's
-- leading campaign_id also serves per-campaign lookups, so it replaces the old one.
CREATE INDEX "email_campaign_recipients_campaign_id_sent_at_idx" ON "email_campaign_recipients"("campaign_id", "sent_at");
DROP INDEX IF EXISTS "email_campaign_recipients_campaign_id_idx";
