ALTER TABLE "email_campaign_recipients" ADD COLUMN "bounced_at" TIMESTAMP(3);
ALTER TABLE "email_campaign_recipients" ADD COLUMN "spam_reported_at" TIMESTAMP(3);
ALTER TABLE "email_campaign_recipients" ADD COLUMN "failure_reason" TEXT;
