-- Add 'initiated' to CallOutcome enum (for calls just placed, before Twilio callback)
ALTER TYPE "CallOutcome" ADD VALUE 'initiated' BEFORE 'answered';

-- Add twilio_call_sid for webhook lookup (unique so we can find Call by Twilio CallSid)
ALTER TABLE "calls" ADD COLUMN "twilio_call_sid" TEXT;
CREATE UNIQUE INDEX "calls_twilio_call_sid_key" ON "calls"("twilio_call_sid");
