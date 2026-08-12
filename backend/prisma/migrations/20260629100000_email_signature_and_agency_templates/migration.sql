-- Add configurable agency email signature template to sub_companies
ALTER TABLE "sub_companies"
  ADD COLUMN IF NOT EXISTS "email_signature_template" TEXT;

-- Add agency signature permission
INSERT INTO "rbac_permissions" (id, key, name, module, parent_id, sort_order, action_type, is_group, is_system, created_at, updated_at)
SELECT gen_random_uuid()::text, 'email:configure_signature', 'Configure agency email signature',
  'emails', parent.id, 453, 'write'::"PermissionActionType", false, true, NOW(), NOW()
FROM "rbac_permissions" parent WHERE parent.key = 'module.emails'
ON CONFLICT (key) DO NOTHING;

INSERT INTO "role_permissions" (role_id, permission_id)
SELECT r.id, p.id FROM "rbac_roles" r CROSS JOIN "rbac_permissions" p
WHERE r.key IN ('super_admin', 'director', 'operations_manager', 'company_director')
AND p.key = 'email:configure_signature'
ON CONFLICT DO NOTHING;

-- Assign any orphaned templates (subCompanyId = NULL) to the first sub_company so they remain accessible
UPDATE "email_templates"
SET "sub_company_id" = (SELECT id FROM "sub_companies" ORDER BY created_at ASC LIMIT 1)
WHERE "sub_company_id" IS NULL;

-- Add personal signature permission
INSERT INTO "rbac_permissions" (id, key, name, module, parent_id, sort_order, action_type, is_group, is_system, created_at, updated_at)
SELECT gen_random_uuid()::text, 'email:personal_signature', 'Configure personal email signature',
  'emails', parent.id, 454, 'write'::"PermissionActionType", false, true, NOW(), NOW()
FROM "rbac_permissions" parent WHERE parent.key = 'module.emails'
ON CONFLICT (key) DO NOTHING;

INSERT INTO "role_permissions" (role_id, permission_id)
SELECT r.id, p.id FROM "rbac_roles" r CROSS JOIN "rbac_permissions" p
WHERE r.key IN ('super_admin', 'director', 'operations_manager', 'sales_manager', 'recruitment_manager')
AND p.key = 'email:personal_signature'
ON CONFLICT DO NOTHING;
