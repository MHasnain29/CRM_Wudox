-- Add clients:contacts:edit (Edit client contacts).
-- Default grant: Super Users only (super_admin, director, company_director, operations_manager).

-- 1. Insert the permission leaf under module.clients.
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

-- 2. Grant to Super Users only.
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
