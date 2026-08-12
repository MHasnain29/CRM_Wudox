-- Backfill permissions added to static config + seed-rbac that never made it into a SQL
-- migration. On environments where role_permissions already has rows for a role,
-- getEffectivePermissionKeysForRoleKey returns DB-only and ignores the static fallback,
-- so newer permissions never reach those roles unless we explicitly insert them here.
--
-- Affected:
--   remarks:write, remarks:public   → "Add Remark" button and Visibility picker stayed hidden
--   agencies:cross_org, agencies:global → "All agencies" option in the Visibility picker was missing

-- 1. Ensure parent module group rows exist (idempotent).
INSERT INTO "rbac_permissions" ("id", "key", "name", "module", "sort_order", "is_group", "is_system", "created_at", "updated_at")
VALUES
  (gen_random_uuid()::text, 'module.calls',    'Calls & Remarks', 'calls',    400,  true, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'module.agencies', 'Agencies',        'agencies', 1050, true, true, NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;

-- 2. Leaf permission rows.
INSERT INTO "rbac_permissions" ("id", "key", "name", "module", "parent_id", "sort_order", "action_type", "is_group", "is_system", "created_at", "updated_at")
SELECT gen_random_uuid()::text, v.key, v.name, v.module, parent.id, v.sort_order, v.action_type::"PermissionActionType", false, true, NOW(), NOW()
FROM (VALUES
  ('remarks:write',      'Add remarks',                     'calls',    'module.calls',    403,  'write'),
  ('remarks:public',     'Create public / shared remarks',  'calls',    'module.calls',    404,  'custom'),
  ('agencies:cross_org', 'Switch agencies (org-wide)',      'agencies', 'module.agencies', 1051, 'read'),
  ('agencies:global',    'All agencies (system-wide)',      'agencies', 'module.agencies', 1052, 'read')
) AS v(key, name, module, parent_key, sort_order, action_type)
LEFT JOIN "rbac_permissions" parent ON parent.key = v.parent_key
ON CONFLICT ("key") DO NOTHING;

-- 3. Default grants per static systemRolePermissions config.
WITH new_perms AS (
  SELECT id, key FROM "rbac_permissions"
  WHERE key IN ('remarks:write', 'remarks:public', 'agencies:cross_org', 'agencies:global')
),
remarks_write_roles AS (
  SELECT id FROM "rbac_roles"
  WHERE key IN (
    'super_admin', 'director', 'operations_manager',
    'sales_manager', 'recruitment_manager',
    'sales_associate', 'sales_executive',
    'data_entry_specialist'
  )
),
remarks_public_roles AS (
  SELECT id FROM "rbac_roles"
  WHERE key IN (
    'super_admin', 'director', 'operations_manager',
    'sales_manager', 'recruitment_manager'
  )
),
cross_org_roles AS (
  SELECT id FROM "rbac_roles"
  WHERE key IN ('super_admin', 'director', 'operations_manager')
),
global_roles AS (
  SELECT id FROM "rbac_roles" WHERE key = 'super_admin'
)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id FROM remarks_write_roles  r CROSS JOIN new_perms p WHERE p.key = 'remarks:write'
UNION ALL
SELECT r.id, p.id FROM remarks_public_roles r CROSS JOIN new_perms p WHERE p.key = 'remarks:public'
UNION ALL
SELECT r.id, p.id FROM cross_org_roles      r CROSS JOIN new_perms p WHERE p.key = 'agencies:cross_org'
UNION ALL
SELECT r.id, p.id FROM global_roles         r CROSS JOIN new_perms p WHERE p.key = 'agencies:global'
ON CONFLICT DO NOTHING;
