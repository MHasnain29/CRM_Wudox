-- Add a permanent, unique per-client serial number used for verbal cross-associate
-- references (e.g. "select client #312"). Backfilled in createdAt order so the
-- numbering is intuitive (oldest client = #1).

CREATE SEQUENCE IF NOT EXISTS "clients_serial_number_seq";

ALTER TABLE "clients" ADD COLUMN "serial_number" INTEGER;

WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "created_at" ASC, id ASC) AS rn
  FROM "clients"
)
UPDATE "clients" c
SET "serial_number" = o.rn
FROM ordered o
WHERE c.id = o.id;

SELECT setval(
  'clients_serial_number_seq',
  COALESCE((SELECT MAX("serial_number") FROM "clients"), 0) + 1,
  false
);

ALTER TABLE "clients" ALTER COLUMN "serial_number" SET DEFAULT nextval('clients_serial_number_seq');
ALTER TABLE "clients" ALTER COLUMN "serial_number" SET NOT NULL;
ALTER SEQUENCE "clients_serial_number_seq" OWNED BY "clients"."serial_number";

CREATE UNIQUE INDEX "clients_serial_number_key" ON "clients"("serial_number");
