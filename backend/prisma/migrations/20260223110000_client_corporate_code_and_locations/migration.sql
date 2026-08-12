-- Add business identity (corporateCode): not a FK; distinct from row id. Backfill then enforce unique + not null.
ALTER TABLE "clients" ADD COLUMN "corporate_code" TEXT;

UPDATE "clients" SET "corporate_code" = 'CLI-' || UPPER(SUBSTRING(REPLACE("id"::text, '-', '') FROM 1 FOR 12))
WHERE "corporate_code" IS NULL;

ALTER TABLE "clients" ALTER COLUMN "corporate_code" SET NOT NULL;
CREATE UNIQUE INDEX "clients_corporate_code_key" ON "clients"("corporate_code");
CREATE INDEX "clients_corporate_code_idx" ON "clients"("corporate_code");

-- Multiple locations per client (same city/area, same corporate identity)
CREATE TABLE "client_locations" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postal_code" TEXT,
    "country" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_locations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "client_locations" ADD CONSTRAINT "client_locations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "client_locations_client_id_idx" ON "client_locations"("client_id");
CREATE INDEX "client_locations_client_id_is_primary_idx" ON "client_locations"("client_id", "is_primary");
