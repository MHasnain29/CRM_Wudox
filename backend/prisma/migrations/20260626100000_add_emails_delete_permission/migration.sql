-- Add emails:delete permission and grant it to manager-and-above roles.
-- Associates (sales_associate, sales_executive, recruiter, sr_recruiter) are NOT granted this permission.

-- 1. Insert the permission leaf (parent = module.emails group already exists).
INSERT INTO "rbac_permissions" ("id", "key", "name", "module", "parent_id", "sort_order", "action_type", "is_group", "is_system", "created_at", "updated_at")
SELECT
  gen_random_uuid()::text,
  'emails:delete',
  'Delete emails',
  'emails',
  parent.id,
  452,
  'delete'::"PermissionActionType",
  false,
  true,
  NOW(),
  NOW()
FROM "rbac_permissions" parent
WHERE parent.key = 'module.emails'
ON CONFLICT ("key") DO NOTHING;

-- 2. Grant to: super_admin, director, company_director, operations_manager, sales_manager, recruitment_manager.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "rbac_roles" r
CROSS JOIN "rbac_permissions" p
WHERE r.key IN (
  'super_admin', 'director', 'company_director',
  'operations_manager', 'sales_manager', 'recruitment_manager'
)
AND p.key = 'emails:delete'
ON CONFLICT DO NOTHING;
