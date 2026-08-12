-- Backfill employee approval permissions that exist in seed/static config but were never
-- inserted by a SQL migration. Environments with role_permissions rows use DB-only
-- effective keys, so Approve / Forward checkboxes stayed missing in Settings → Roles
-- and Recruitment Manager could not be granted employees:approve via the UI.
--
-- Additive only — does not rewrite existing role grants or approval capabilities.
-- Do not use seed-rbac / Reset system roles to apply this.

-- 1. Ensure Employees module group exists (idempotent).
INSERT INTO "rbac_permissions" ("id", "key", "name", "module", "sort_order", "is_group", "is_system", "created_at", "updated_at")
VALUES
  (gen_random_uuid()::text, 'module.employees', 'Employees', 'employees', 800, true, true, NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;

-- 2. Leaf permission rows under module.employees.
INSERT INTO "rbac_permissions" ("id", "key", "name", "module", "parent_id", "sort_order", "action_type", "is_group", "is_system", "created_at", "updated_at")
SELECT gen_random_uuid()::text, v.key, v.name, v.module, parent.id, v.sort_order, v.action_type::"PermissionActionType", false, true, NOW(), NOW()
FROM (VALUES
  ('employees:manager_recommend', 'Forward employee approvals', 'employees', 'module.employees', 804, 'write'),
  ('employees:approve',           'Approve employees',          'employees', 'module.employees', 805, 'write')
) AS v(key, name, module, parent_key, sort_order, action_type)
LEFT JOIN "rbac_permissions" parent ON parent.key = v.parent_key
ON CONFLICT ("key") DO NOTHING;

-- 3. Default grants matching systemRolePermissions.ts (idempotent).
WITH new_perms AS (
  SELECT id, key FROM "rbac_permissions"
  WHERE key IN ('employees:manager_recommend', 'employees:approve')
),
approve_roles AS (
  SELECT id FROM "rbac_roles"
  WHERE key IN (
    'super_admin',
    'director',
    'company_director',
    'operations_manager',
    'recruitment_manager',
    'sr_recruiter'
  )
),
recommend_roles AS (
  SELECT id FROM "rbac_roles"
  WHERE key IN (
    'super_admin',
    'director',
    'company_director',
    'operations_manager',
    'recruitment_manager',
    'sr_recruiter',
    'recruiter'
  )
)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id FROM approve_roles   r CROSS JOIN new_perms p WHERE p.key = 'employees:approve'
UNION ALL
SELECT r.id, p.id FROM recommend_roles r CROSS JOIN new_perms p WHERE p.key = 'employees:manager_recommend'
ON CONFLICT DO NOTHING;
