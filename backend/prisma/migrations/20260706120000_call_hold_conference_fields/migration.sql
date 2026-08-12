-- Outbound conference bridge + inbound caller participant SID for hold
ALTER TABLE "calls"
  ADD COLUMN "conference_room" TEXT,
  ADD COLUMN "conference_sid" TEXT,
  ADD COLUMN "pstn_call_sid" TEXT;

ALTER TABLE "inbound_calls"
  ADD COLUMN "caller_participant_call_sid" TEXT;
