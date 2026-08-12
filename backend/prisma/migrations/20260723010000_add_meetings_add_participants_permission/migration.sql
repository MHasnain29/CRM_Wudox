-- Add meetings:add_participants (Add meeting participants).
-- Default grant: every role (all users have access by default).

-- 1. Insert the permission leaf under module.meetings.
INSERT INTO "rbac_permissions" ("id", "key", "name", "module", "parent_id", "sort_order", "action_type", "is_group", "is_system", "created_at", "updated_at")
SELECT
  gen_random_uuid()::text,
  'meetings:add_participants',
  'Add meeting participants',
  'meetings',
  parent.id,
  603,
  'custom'::"PermissionActionType",
  false,
  true,
  NOW(),
  NOW()
FROM "rbac_permissions" parent
WHERE parent.key = 'module.meetings'
ON CONFLICT ("key") DO NOTHING;

-- 2. Grant to every role by default.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, add_perm.id
FROM "rbac_roles" r
CROSS JOIN "rbac_permissions" add_perm
WHERE add_perm.key = 'meetings:add_participants'
ON CONFLICT DO NOTHING;
