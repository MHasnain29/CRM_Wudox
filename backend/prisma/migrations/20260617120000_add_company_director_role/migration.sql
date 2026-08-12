-- Add Company Director system role (single-agency director; same grants as director minus agencies:cross_org).

-- 1. Upsert role under super_admin.
INSERT INTO "rbac_roles" (
  "id", "key", "name", "description", "parent_role_id", "sort_order",
  "scope_level", "is_system", "is_active", "version", "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  'company_director',
  'Company Director',
  'Full agency access for one company (no cross-org)',
  parent.id,
  3,
  'agency'::"DataScopeLevel",
  true,
  true,
  1,
  NOW(),
  NOW()
FROM "rbac_roles" parent
WHERE parent.key = 'super_admin'
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "sort_order" = EXCLUDED."sort_order",
  "scope_level" = EXCLUDED."scope_level",
  "parent_role_id" = EXCLUDED."parent_role_id",
  "is_system" = true,
  "is_active" = true,
  "updated_at" = NOW();

-- Keep IT after company_director in the tree.
UPDATE "rbac_roles" SET "sort_order" = 4, "updated_at" = NOW()
WHERE "key" = 'it' AND "sort_order" < 4;

-- 2. Permission grants: copy director grants except agencies:cross_org.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT cd.id, rp.permission_id
FROM "rbac_roles" cd
JOIN "rbac_roles" d ON d.key = 'director'
JOIN "role_permissions" rp ON rp.role_id = d.id
JOIN "rbac_permissions" p ON p.id = rp.permission_id
WHERE cd.key = 'company_director'
  AND p.key <> 'agencies:cross_org'
ON CONFLICT DO NOTHING;

-- 3. Approval capabilities: same as director (forward_final on all workflows).
INSERT INTO "role_approval_capabilities" ("role_id", "workflow", "mode")
SELECT cd.id, rac.workflow, rac.mode
FROM "rbac_roles" cd
JOIN "rbac_roles" d ON d.key = 'director'
JOIN "role_approval_capabilities" rac ON rac.role_id = d.id
WHERE cd.key = 'company_director'
ON CONFLICT ("role_id", "workflow") DO UPDATE SET "mode" = EXCLUDED."mode";
