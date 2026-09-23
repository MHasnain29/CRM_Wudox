-- Add inbound Message-Id for webhook idempotency (dedupe SendGrid Inbound Parse retries)
ALTER TABLE "emails" ADD COLUMN "inbound_message_id" TEXT;

-- Index for fast dedupe lookups on inbound
CREATE INDEX "emails_inbound_message_id_idx" ON "emails"("inbound_message_id");
