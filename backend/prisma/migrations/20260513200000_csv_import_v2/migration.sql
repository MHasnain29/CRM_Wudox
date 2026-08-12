-- CSV Import v2: parent/branch clients, multi-contact pending imports, mapping templates.
-- Plan reference: plan-csv-import-dynamic-mapping.md
-- Frontend version bump: see frontend/package.json

-- ─── 1. Client: add parent ↔ branch self-FK ──────────────────────────────────
ALTER TABLE "clients" ADD COLUMN "parent_client_id" TEXT;

ALTER TABLE "clients"
  ADD CONSTRAINT "clients_parent_client_id_fkey"
  FOREIGN KEY ("parent_client_id") REFERENCES "clients"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "clients_parent_client_id_idx" ON "clients"("parent_client_id");

-- ─── 2. PendingImportedClient: add new columns, copy old contact data, drop old columns
ALTER TABLE "pending_imported_clients"
  ADD COLUMN "website"   TEXT,
  ADD COLUMN "employees" TEXT,
  ADD COLUMN "source_id" TEXT,
  ADD COLUMN "contacts"  JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Copy any existing single-contact rows into the new contacts JSONB array.
-- Filters out fully-empty contacts. Strings remain strings; nulls remain nulls.
UPDATE "pending_imported_clients"
SET "contacts" = jsonb_build_array(
    jsonb_strip_nulls(
        jsonb_build_object(
            'name',  NULLIF("contact_name", ''),
            'title', NULLIF("contact_title", ''),
            'email', NULLIF("contact_email", ''),
            'phone', NULLIF("contact_phone", '')
        )
    )
)
WHERE COALESCE("contact_name", "contact_title", "contact_email", "contact_phone") IS NOT NULL;

ALTER TABLE "pending_imported_clients"
  DROP COLUMN "contact_name",
  DROP COLUMN "contact_title",
  DROP COLUMN "contact_email",
  DROP COLUMN "contact_phone";

-- ─── 3. ImportMappingTemplate: new table ─────────────────────────────────────
CREATE TABLE "import_mapping_templates" (
    "id"                  TEXT       NOT NULL,
    "sub_company_id"      TEXT       NOT NULL,
    "name"                TEXT,
    "header_fingerprint"  TEXT       NOT NULL,
    "mapping"             JSONB      NOT NULL,
    "created_by_id"       TEXT       NOT NULL,
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_mapping_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "import_mapping_templates_sub_company_id_header_fingerprint_key"
  ON "import_mapping_templates"("sub_company_id", "header_fingerprint");

CREATE INDEX "import_mapping_templates_sub_company_id_idx"
  ON "import_mapping_templates"("sub_company_id");

ALTER TABLE "import_mapping_templates"
  ADD CONSTRAINT "import_mapping_templates_sub_company_id_fkey"
  FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "import_mapping_templates"
  ADD CONSTRAINT "import_mapping_templates_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
