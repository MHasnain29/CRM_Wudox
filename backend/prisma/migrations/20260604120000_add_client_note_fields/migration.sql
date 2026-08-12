-- Client Notes: custom field definitions + values, plus 3 RBAC permission keys.
-- v1.0.8 — adds "Field Notes" panel gated by closed_won lead status.

-- 1. Field-type enum
CREATE TYPE "ClientNoteFieldType" AS ENUM ('text', 'textarea', 'number', 'boolean', 'select');

-- 2. Field definitions (configured in Settings → Client Notes by users with client_notes:configure)
CREATE TABLE "client_note_field_defs" (
  "id" TEXT NOT NULL,
  "key" VARCHAR(64) NOT NULL,
  "label" VARCHAR(128) NOT NULL,
  "field_type" "ClientNoteFieldType" NOT NULL,
  "options" JSONB,
  "visibility" "ClientVisibility" NOT NULL DEFAULT 'global',
  "sub_company_id" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "client_note_field_defs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "client_note_field_defs_sub_key" ON "client_note_field_defs" ("sub_company_id", "key");
-- Postgres treats NULL as distinct; partial unique index for global scope (sub_company_id IS NULL)
CREATE UNIQUE INDEX "client_note_field_defs_global_key" ON "client_note_field_defs" ("key") WHERE "sub_company_id" IS NULL;
CREATE INDEX "client_note_field_defs_visibility_sub_idx" ON "client_note_field_defs" ("visibility", "sub_company_id");
CREATE INDEX "client_note_field_defs_active_order_idx" ON "client_note_field_defs" ("is_active", "sort_order");

ALTER TABLE "client_note_field_defs"
  ADD CONSTRAINT "client_note_field_defs_sub_fk" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "client_note_field_defs_created_by_fk" FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Field values per client (one row per client, fieldDef, agency for agency-scoped fields;
--    global fields enforce one-row-per-(client, fieldDef) via service-layer transactional upsert)
CREATE TABLE "client_note_field_values" (
  "id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "field_def_id" TEXT NOT NULL,
  "sub_company_id" TEXT NOT NULL,
  "value" TEXT,
  "updated_by_id" TEXT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "client_note_field_values_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "client_note_field_values_unique" ON "client_note_field_values" ("client_id", "field_def_id", "sub_company_id");
CREATE INDEX "client_note_field_values_client_idx" ON "client_note_field_values" ("client_id");
CREATE INDEX "client_note_field_values_field_def_idx" ON "client_note_field_values" ("field_def_id");

ALTER TABLE "client_note_field_values"
  ADD CONSTRAINT "client_note_field_values_client_fk" FOREIGN KEY ("client_id") REFERENCES "clients" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "client_note_field_values_field_def_fk" FOREIGN KEY ("field_def_id") REFERENCES "client_note_field_defs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "client_note_field_values_sub_fk" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "client_note_field_values_updated_by_fk" FOREIGN KEY ("updated_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. RBAC permission catalog rows (dynamic; super users can grant these to any custom role via Settings → Roles)
INSERT INTO "rbac_permissions" ("id", "key", "name", "description", "module", "action_type", "is_group", "is_system", "created_at", "updated_at")
VALUES
  (gen_random_uuid()::text, 'client_notes:configure',    'Configure client note fields', 'Create/edit/deactivate Client Notes field definitions', 'client_notes', 'write',  false, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'client_notes:fields:write', 'Edit client note field values', 'Fill custom field values on a Closed-Won client',         'client_notes', 'write',  false, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'client_notes:fields:read',  'Read client note field values', 'View custom field values on a client',                    'client_notes', 'read',   false, true, NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;

-- 5. Default grants for system roles (only those that should have these by default;
--    others must be granted explicitly via Settings → Roles UI)
WITH new_perms AS (
  SELECT id, key FROM "rbac_permissions"
  WHERE key IN ('client_notes:configure', 'client_notes:fields:write', 'client_notes:fields:read')
),
configure_roles AS (
  SELECT id FROM "rbac_roles" WHERE key IN ('super_admin', 'director', 'operations_manager')
),
write_roles AS (
  SELECT id FROM "rbac_roles"
  WHERE key IN (
    'super_admin', 'director', 'operations_manager',
    'sales_manager', 'recruitment_manager',
    'sales_associate', 'sales_executive',
    'recruiter', 'sr_recruiter'
  )
)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM configure_roles r
CROSS JOIN new_perms p
WHERE p.key = 'client_notes:configure'
UNION ALL
SELECT r.id, p.id
FROM write_roles r
CROSS JOIN new_perms p
WHERE p.key IN ('client_notes:fields:write', 'client_notes:fields:read')
ON CONFLICT DO NOTHING;
