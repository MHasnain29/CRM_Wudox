-- Backfill clients:ownership permission.
-- This permission was added to staticconfig + systemRolePermissions but never inserted
-- into rbac_permissions / role_permissions via a migration, so live environments with
-- existing role rows never received it.

-- 1. Leaf permission row (parent module.clients already exists from dynamic_rbac seed).
INSERT INTO "rbac_permissions" ("id", "key", "name", "module", "parent_id", "sort_order", "action_type", "is_group", "is_system", "created_at", "updated_at")
SELECT
  gen_random_uuid()::text,
  'clients:ownership',
  'Manage client ownership',
  'clients',
  parent.id,
  206,
  'custom'::"PermissionActionType",
  false,
  true,
  NOW(),
  NOW()
FROM "rbac_permissions" parent
WHERE parent.key = 'module.clients'
ON CONFLICT ("key") DO NOTHING;

-- 2. Grant to super_admin, director, operations_manager.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "rbac_roles" r
CROSS JOIN "rbac_permissions" p
WHERE r.key IN ('super_admin', 'director', 'operations_manager')
  AND p.key = 'clients:ownership'
ON CONFLICT DO NOTHING;
