-- Inbound conference bridge: track agent legs and conference metadata per call.

ALTER TABLE "inbound_calls" ADD COLUMN "conference_sid" TEXT;
ALTER TABLE "inbound_calls" ADD COLUMN "conference_room" TEXT;

CREATE TYPE "PhoneConferenceLegStatus" AS ENUM ('ringing', 'joined', 'failed', 'canceled');

CREATE TABLE "phone_conference_legs" (
    "agent_call_sid" TEXT NOT NULL,
    "inbound_call_id" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "conference_room" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "PhoneConferenceLegStatus" NOT NULL DEFAULT 'ringing',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_conference_legs_pkey" PRIMARY KEY ("agent_call_sid")
);

CREATE INDEX "phone_conference_legs_inbound_call_id_idx" ON "phone_conference_legs"("inbound_call_id");
CREATE INDEX "phone_conference_legs_inbound_call_id_status_idx" ON "phone_conference_legs"("inbound_call_id", "status");
CREATE INDEX "phone_conference_legs_user_id_idx" ON "phone_conference_legs"("user_id");

ALTER TABLE "phone_conference_legs" ADD CONSTRAINT "phone_conference_legs_inbound_call_id_fkey" FOREIGN KEY ("inbound_call_id") REFERENCES "inbound_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
