-- Phone system: per-agency config and numbers (Phase 2)
CREATE TABLE "phone_agency_configs" (
    "sub_company_id" TEXT NOT NULL,
    "outbound_caller_id" TEXT,
    "outbound_enabled" BOOLEAN NOT NULL DEFAULT true,
    "inbound_enabled" BOOLEAN NOT NULL DEFAULT true,
    "provider" TEXT NOT NULL DEFAULT 'twilio',
    "sync_status" TEXT NOT NULL DEFAULT 'not_connected',
    "last_synced_at" TIMESTAMP(3),
    "auto_attendant_extension" TEXT NOT NULL DEFAULT '112',
    "allow_extension_dialing" BOOLEAN NOT NULL DEFAULT true,
    "gather_timeout_sec" INTEGER NOT NULL DEFAULT 5,
    "greeting_clip_name" TEXT,
    "timeout_route_label" TEXT,
    "invalid_route_label" TEXT,
    "flow_title" TEXT NOT NULL DEFAULT 'Main call flow',
    "menu_routes" JSONB NOT NULL DEFAULT '[]',
    "ring_groups" JSONB NOT NULL DEFAULT '[]',
    "staff_extensions" JSONB NOT NULL DEFAULT '[]',
    "voicemail_boxes" JSONB NOT NULL DEFAULT '[]',
    "audio_clips" JSONB NOT NULL DEFAULT '[]',
    "business_hours" JSONB NOT NULL DEFAULT '[]',
    "readiness_steps" JSONB NOT NULL DEFAULT '[]',
    "draft_flow" JSONB,
    "published_flow" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "phone_agency_configs_pkey" PRIMARY KEY ("sub_company_id")
);

CREATE TABLE "phone_numbers" (
    "id" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "e164" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "twilio_incoming_sid" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "phone_numbers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "phone_numbers_sub_company_id_idx" ON "phone_numbers"("sub_company_id");
CREATE INDEX "phone_numbers_sub_company_id_is_active_idx" ON "phone_numbers"("sub_company_id", "is_active");

ALTER TABLE "phone_agency_configs" ADD CONSTRAINT "phone_agency_configs_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "phone_numbers" ADD CONSTRAINT "phone_numbers_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One-time seed: agency_phone → PhoneNumber + outboundCallerId (normalize to E.164 digits with +)
INSERT INTO "phone_agency_configs" ("sub_company_id", "updated_at")
SELECT sc."id", CURRENT_TIMESTAMP
FROM "sub_companies" sc
ON CONFLICT ("sub_company_id") DO NOTHING;

INSERT INTO "phone_numbers" ("id", "sub_company_id", "e164", "label", "is_active", "updated_at")
SELECT
    gen_random_uuid()::text,
    sc."id",
    '+' || regexp_replace(sc."agency_phone", '[^0-9]', '', 'g'),
    'Main line',
    true,
    CURRENT_TIMESTAMP
FROM "sub_companies" sc
WHERE sc."agency_phone" IS NOT NULL
  AND trim(sc."agency_phone") <> ''
  AND length(regexp_replace(sc."agency_phone", '[^0-9]', '', 'g')) >= 10
  AND NOT EXISTS (
    SELECT 1 FROM "phone_numbers" pn WHERE pn."sub_company_id" = sc."id"
  );

UPDATE "phone_agency_configs" pac
SET
    "outbound_caller_id" = pn."e164",
    "outbound_enabled" = true,
    "inbound_enabled" = true,
    "updated_at" = CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT ON ("sub_company_id") "sub_company_id", "e164"
    FROM "phone_numbers"
    WHERE "is_active" = true
    ORDER BY "sub_company_id", "created_at" ASC
) pn
WHERE pac."sub_company_id" = pn."sub_company_id"
  AND pac."outbound_caller_id" IS NULL;

UPDATE "sub_companies" sc
SET "agency_phone" = pn."e164"
FROM (
    SELECT DISTINCT ON ("sub_company_id") "sub_company_id", "e164"
    FROM "phone_numbers"
    WHERE "is_active" = true
    ORDER BY "sub_company_id", "created_at" ASC
) pn
WHERE sc."id" = pn."sub_company_id"
  AND (sc."agency_phone" IS NULL OR trim(sc."agency_phone") = '');
