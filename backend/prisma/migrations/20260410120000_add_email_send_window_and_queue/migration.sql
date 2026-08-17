-- Email send window settings (per agency) + persistent outbound email queue

CREATE TABLE IF NOT EXISTS "email_send_window_settings" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "sub_company_id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "start_minute_of_day" INTEGER,
  "cutoff_minute_of_day" INTEGER,
  "timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_send_window_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "email_send_window_settings_sub_company_id_key" UNIQUE ("sub_company_id"),
  CONSTRAINT "email_send_window_settings_sub_company_id_fkey"
    FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "email_send_window_settings_start_minute_check"
    CHECK ("start_minute_of_day" IS NULL OR ("start_minute_of_day" >= 0 AND "start_minute_of_day" <= 1439)),
  CONSTRAINT "email_send_window_settings_cutoff_minute_check"
    CHECK ("cutoff_minute_of_day" IS NULL OR ("cutoff_minute_of_day" >= 0 AND "cutoff_minute_of_day" <= 1439))
);

CREATE INDEX IF NOT EXISTS "email_send_window_settings_timezone_idx"
  ON "email_send_window_settings" ("timezone");

CREATE TABLE IF NOT EXISTS "outbound_email_queue" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "dedupe_key" TEXT,
  "sub_company_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "requested_send_at" TIMESTAMP(3),
  "next_eligible_at" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "last_attempt_at" TIMESTAMP(3),
  "sent_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outbound_email_queue_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outbound_email_queue_sub_company_id_fkey"
    FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "outbound_email_queue_status_check"
    CHECK ("status" IN ('queued', 'sending', 'sent', 'failed', 'dead_letter'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "outbound_email_queue_dedupe_key_key"
  ON "outbound_email_queue" ("dedupe_key");

CREATE INDEX IF NOT EXISTS "outbound_email_queue_status_next_eligible_idx"
  ON "outbound_email_queue" ("status", "next_eligible_at");

CREATE INDEX IF NOT EXISTS "outbound_email_queue_sub_company_status_idx"
  ON "outbound_email_queue" ("sub_company_id", "status");

