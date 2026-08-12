-- Add clients:contacts:add (Add client contacts).
-- Default grant: every role that currently has clients:write.

-- 1. Insert the permission leaf under module.clients.
INSERT INTO "rbac_permissions" ("id", "key", "name", "module", "parent_id", "sort_order", "action_type", "is_group", "is_system", "created_at", "updated_at")
SELECT
  gen_random_uuid()::text,
  'clients:contacts:add',
  'Add client contacts',
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

-- Keep contacts:edit after add in the catalog order.
UPDATE "rbac_permissions"
SET "sort_order" = 204, "updated_at" = NOW()
WHERE "key" = 'clients:contacts:edit';

UPDATE "rbac_permissions"
SET "sort_order" = 205, "updated_at" = NOW()
WHERE "key" = 'clients:delete';

UPDATE "rbac_permissions"
SET "sort_order" = 206, "updated_at" = NOW()
WHERE "key" = 'clients:manager_recommend';

UPDATE "rbac_permissions"
SET "sort_order" = 207, "updated_at" = NOW()
WHERE "key" = 'clients:approve';

UPDATE "rbac_permissions"
SET "sort_order" = 208, "updated_at" = NOW()
WHERE "key" = 'clients:ownership';

-- 2. Grant to every role that has clients:write.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT DISTINCT rp.role_id, add_perm.id
FROM "role_permissions" rp
JOIN "rbac_permissions" write_perm ON write_perm.id = rp.permission_id AND write_perm.key = 'clients:write'
CROSS JOIN "rbac_permissions" add_perm
WHERE add_perm.key = 'clients:contacts:add'
ON CONFLICT DO NOTHING;
