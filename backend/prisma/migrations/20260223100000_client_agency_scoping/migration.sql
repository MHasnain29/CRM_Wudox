-- CreateTable: per-agency client status (tabs: Active, Ex, Contacted, etc.)
CREATE TABLE "client_sub_companies" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "status" "ClientStatus" NOT NULL,
    "last_activity" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_sub_companies_pkey" PRIMARY KEY ("id")
);

-- Add sub_company_id to client_tags (nullable first for backfill)
ALTER TABLE "client_tags" ADD COLUMN "sub_company_id" TEXT;

UPDATE "client_tags" SET "sub_company_id" = (SELECT "id" FROM "sub_companies" LIMIT 1) WHERE "sub_company_id" IS NULL;

ALTER TABLE "client_tags" ALTER COLUMN "sub_company_id" SET NOT NULL;

-- Replace composite PK: (client_id, tag) -> (client_id, sub_company_id, tag)
ALTER TABLE "client_tags" DROP CONSTRAINT "client_tags_pkey";
ALTER TABLE "client_tags" ADD CONSTRAINT "client_tags_pkey" PRIMARY KEY ("client_id", "sub_company_id", "tag");
ALTER TABLE "client_tags" ADD CONSTRAINT "client_tags_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "client_tags_sub_company_id_idx" ON "client_tags"("sub_company_id");

-- client_notes: add sub_company_id, backfill from note author's agency
ALTER TABLE "client_notes" ADD COLUMN "sub_company_id" TEXT;
UPDATE "client_notes" n SET "sub_company_id" = (SELECT u."sub_company_id" FROM "users" u WHERE u."id" = n."user_id");
UPDATE "client_notes" SET "sub_company_id" = (SELECT "id" FROM "sub_companies" LIMIT 1) WHERE "sub_company_id" IS NULL;
ALTER TABLE "client_notes" ALTER COLUMN "sub_company_id" SET NOT NULL;
ALTER TABLE "client_notes" ADD CONSTRAINT "client_notes_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "client_notes_sub_company_id_idx" ON "client_notes"("sub_company_id");

-- calls: add sub_company_id, backfill from lead or owner
ALTER TABLE "calls" ADD COLUMN "sub_company_id" TEXT;
UPDATE "calls" c SET "sub_company_id" = COALESCE(
  (SELECT l."sub_company_id" FROM "leads" l WHERE l."id" = c."lead_id"),
  (SELECT u."sub_company_id" FROM "users" u WHERE u."id" = c."owner_id")
);
UPDATE "calls" SET "sub_company_id" = (SELECT "id" FROM "sub_companies" LIMIT 1) WHERE "sub_company_id" IS NULL;
ALTER TABLE "calls" ALTER COLUMN "sub_company_id" SET NOT NULL;
ALTER TABLE "calls" ADD CONSTRAINT "calls_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "calls_sub_company_id_idx" ON "calls"("sub_company_id");

-- follow_ups: add sub_company_id, backfill from lead or owner
ALTER TABLE "follow_ups" ADD COLUMN "sub_company_id" TEXT;
UPDATE "follow_ups" f SET "sub_company_id" = COALESCE(
  (SELECT l."sub_company_id" FROM "leads" l WHERE l."id" = f."lead_id"),
  (SELECT u."sub_company_id" FROM "users" u WHERE u."id" = f."owner_id")
);
UPDATE "follow_ups" SET "sub_company_id" = (SELECT "id" FROM "sub_companies" LIMIT 1) WHERE "sub_company_id" IS NULL;
ALTER TABLE "follow_ups" ALTER COLUMN "sub_company_id" SET NOT NULL;
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "follow_ups_sub_company_id_idx" ON "follow_ups"("sub_company_id");

-- meetings: add sub_company_id, backfill from lead or owner
ALTER TABLE "meetings" ADD COLUMN "sub_company_id" TEXT;
UPDATE "meetings" m SET "sub_company_id" = COALESCE(
  (SELECT l."sub_company_id" FROM "leads" l WHERE l."id" = m."lead_id"),
  (SELECT u."sub_company_id" FROM "users" u WHERE u."id" = m."owner_id")
);
UPDATE "meetings" SET "sub_company_id" = (SELECT "id" FROM "sub_companies" LIMIT 1) WHERE "sub_company_id" IS NULL;
ALTER TABLE "meetings" ALTER COLUMN "sub_company_id" SET NOT NULL;
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "meetings_sub_company_id_idx" ON "meetings"("sub_company_id");

-- client_sub_companies FKs and indexes
ALTER TABLE "client_sub_companies" ADD CONSTRAINT "client_sub_companies_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_sub_companies" ADD CONSTRAINT "client_sub_companies_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "client_sub_companies_client_id_sub_company_id_key" ON "client_sub_companies"("client_id", "sub_company_id");
CREATE INDEX "client_sub_companies_sub_company_id_idx" ON "client_sub_companies"("sub_company_id");
CREATE INDEX "client_sub_companies_sub_company_id_status_idx" ON "client_sub_companies"("sub_company_id", "status");
