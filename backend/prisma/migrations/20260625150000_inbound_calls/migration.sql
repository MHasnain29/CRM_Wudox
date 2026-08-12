-- Inbound call history (Phase 2 read API; populated by Phase 3 webhook)
CREATE TYPE "InboundCallOutcome" AS ENUM ('answered', 'no_answer', 'voicemail', 'abandoned', 'busy', 'failed');

CREATE TABLE "inbound_calls" (
    "id" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "from_number" TEXT NOT NULL,
    "to_number" TEXT NOT NULL,
    "menu_key" INTEGER,
    "department_label" TEXT,
    "ring_group_name" TEXT,
    "answered_by_user_id" TEXT,
    "outcome" "InboundCallOutcome" NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "duration_sec" INTEGER,
    "ring_duration_sec" INTEGER,
    "recording_url" TEXT,
    "twilio_call_sid" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_calls_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inbound_call_participants" (
    "id" TEXT NOT NULL,
    "inbound_call_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_call_participants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inbound_calls_twilio_call_sid_key" ON "inbound_calls"("twilio_call_sid");
CREATE INDEX "inbound_calls_sub_company_id_idx" ON "inbound_calls"("sub_company_id");
CREATE INDEX "inbound_calls_answered_by_user_id_idx" ON "inbound_calls"("answered_by_user_id");
CREATE INDEX "inbound_calls_started_at_idx" ON "inbound_calls"("started_at");
CREATE INDEX "inbound_calls_outcome_idx" ON "inbound_calls"("outcome");
CREATE INDEX "inbound_call_participants_inbound_call_id_idx" ON "inbound_call_participants"("inbound_call_id");
CREATE INDEX "inbound_call_participants_user_id_idx" ON "inbound_call_participants"("user_id");

ALTER TABLE "inbound_calls" ADD CONSTRAINT "inbound_calls_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inbound_calls" ADD CONSTRAINT "inbound_calls_answered_by_user_id_fkey" FOREIGN KEY ("answered_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inbound_call_participants" ADD CONSTRAINT "inbound_call_participants_inbound_call_id_fkey" FOREIGN KEY ("inbound_call_id") REFERENCES "inbound_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inbound_call_participants" ADD CONSTRAINT "inbound_call_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
