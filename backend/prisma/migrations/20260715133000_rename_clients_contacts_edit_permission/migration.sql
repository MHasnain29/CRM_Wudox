-- Rename clients:contacts:write → clients:contacts:edit (if the old key exists),
-- ensure Super Users have it, and revoke from managers / Database Manager / below.

-- 1. Rename key if previous permission was seeded as clients:contacts:write.
UPDATE "rbac_permissions"
SET
  "key" = 'clients:contacts:edit',
  "name" = 'Edit client contacts',
  "action_type" = 'custom'::"PermissionActionType",
  "updated_at" = NOW()
WHERE "key" = 'clients:contacts:write';

-- 2. Ensure the permission exists (idempotent for DBs that only ran this fix).
INSERT INTO "rbac_permissions" ("id", "key", "name", "module", "parent_id", "sort_order", "action_type", "is_group", "is_system", "created_at", "updated_at")
SELECT
  gen_random_uuid()::text,
  'clients:contacts:edit',
  'Edit client contacts',
  'clients',
  parent.id,
  203,
  'custom'::"PermissionActionType",
  false,
  true,
  NOW(),
  NOW()
FROM "rbac_permissions" parent
WHERE parent.key = 'module.clients'
ON CONFLICT ("key") DO NOTHING;

-- 3. Grant to Super Users only.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "rbac_roles" r
CROSS JOIN "rbac_permissions" p
WHERE r.key IN (
  'super_admin',
  'director',
  'company_director',
  'operations_manager'
)
AND p.key = 'clients:contacts:edit'
ON CONFLICT DO NOTHING;

-- 4. Revoke from everyone else (managers, Database Manager, associates, etc.).
DELETE FROM "role_permissions" rp
USING "rbac_roles" r, "rbac_permissions" p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND p.key = 'clients:contacts:edit'
  AND r.key NOT IN (
    'super_admin',
    'director',
    'company_director',
    'operations_manager'
  );
