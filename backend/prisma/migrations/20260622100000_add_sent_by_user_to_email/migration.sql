-- Add sent_by_user_id to emails for tracking "Send as" impersonation
ALTER TABLE "emails" ADD COLUMN "sent_by_user_id" TEXT;

ALTER TABLE "emails" ADD CONSTRAINT "emails_sent_by_user_id_fkey"
  FOREIGN KEY ("sent_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "emails_sent_by_user_id_idx" ON "emails"("sent_by_user_id");
