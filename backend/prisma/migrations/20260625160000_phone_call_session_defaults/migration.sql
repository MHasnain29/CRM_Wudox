-- PhoneCallSession for inbound IVR state + defaultsSeededAt on agency config
ALTER TABLE "phone_agency_configs" ADD COLUMN IF NOT EXISTS "defaults_seeded_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "phone_call_sessions" (
    "call_sid" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "inbound_call_id" TEXT,
    "flow_node_id" TEXT NOT NULL,
    "dtmf_buffer" TEXT,
    "gather_attempts" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "phone_call_sessions_pkey" PRIMARY KEY ("call_sid")
);

CREATE INDEX IF NOT EXISTS "phone_call_sessions_sub_company_id_idx" ON "phone_call_sessions"("sub_company_id");
CREATE INDEX IF NOT EXISTS "phone_call_sessions_inbound_call_id_idx" ON "phone_call_sessions"("inbound_call_id");

CREATE INDEX IF NOT EXISTS "phone_numbers_e164_idx" ON "phone_numbers"("e164");
